import {
  ATTACKS, Action, BODY_RADIUS, GRAB, KNOCKBACK_DECEL, KNOCKDOWN_FRAMES, THROW, TICK_RATE, knockbackSpeed,
} from '@fight-club/shared'
import { describe, expect, it } from 'vitest'
import {
  SEOI, THROWN_AIR_FRAMES, bowAngle, chooseClip, createClipChoice, createSeoiFlight, getupProgress, loadProgress, seoiFlight,
  strikeTime, type AnimInput,
} from './animation.ts'
import { CLIP_INFO, type ClipName } from './assets.gen.ts'
import { CHARACTER_MOVES } from './characters.ts'

const CLIPS: Record<ClipName, { duration: number; impact?: number }> = CLIP_INFO

const input = (action: number, actionFrame: number, extra: Partial<AnimInput> = {}): AnimInput => ({
  action, actionFrame, stun: 0, speed: 0, rising: false, idleClip: 'Idle', moves: CHARACTER_MOVES[0], ...extra,
})

/** [동작, 프레임 창, 캐릭터별 클립] — 판정 첫 프레임이 클립의 타격 시점과 맞아야 하는 동작들 */
const STRIKES = CHARACTER_MOVES.flatMap((moves) => [
  [Action.Jab, ATTACKS.jab, moves.jab, moves],
  [Action.Straight, ATTACKS.straight, moves.straight, moves],
  [Action.Dash, ATTACKS.dash, moves.dash, moves],
  [Action.Kick, ATTACKS.kick, 'Unarmed_Melee_Attack_Kick', moves],
  [Action.GrabTry, GRAB, 'Interact', moves],
] as const)

describe('공격 클립 재생 위치', () => {
  it.each(STRIKES)('동작 %i: 판정 첫 프레임에 타격 시점, 처음부터 끝까지 앞으로만 간다', (action, frames, clip, moves) => {
    const info = { duration: CLIPS[clip].duration, impact: CLIPS[clip].impact ?? 0 }
    const out = createClipChoice()
    expect(chooseClip(input(action, frames.startup, { moves }), out).clip).toBe(clip)
    expect(out.time).toBeCloseTo(info.impact, 9)

    const total = frames.startup + frames.active + frames.recovery
    let last = -1
    for (let f = 0; f <= total; f++) {
      const t = strikeTime(info, frames, f)
      expect(t).toBeGreaterThanOrEqual(last)
      expect(t).toBeLessThanOrEqual(info.duration)
      last = t
    }
  })

  it('준비 동작은 2배속을 넘지 않는다', () => {
    for (const [, frames, clip] of STRIKES) {
      const info = { duration: CLIPS[clip].duration, impact: CLIPS[clip].impact ?? 0 }
      const span = strikeTime(info, frames, frames.startup) - strikeTime(info, frames, 0)
      expect(span / (frames.startup / 60)).toBeLessThanOrEqual(2 + 1e-9)
    }
  })

  it('날아차기는 착지할 때까지 뻗은 다리를 유지한다', () => {
    const out = createClipChoice()
    const impact = CLIPS.Unarmed_Melee_Attack_Kick.impact
    for (const f of [ATTACKS.flyingKick.startup, 20, 40]) {
      expect(chooseClip(input(Action.FlyingKick, f), out).time).toBeCloseTo(impact ?? 0, 9)
    }
  })

  it('엎어치기 동안 던지는 쪽은 잡은 자세 그대로다 (잡기의 타격 시점에 멈춰 있고, 숙이는 것은 캐릭터가 그린다)', () => {
    const out = createClipChoice()
    for (const f of [0, THROW.release, THROW.release + THROW.recovery - 1]) {
      expect(chooseClip(input(Action.Throwing, f), out).clip).toBe('Interact')
      expect(out.time).toBeCloseTo(CLIPS.Interact.impact ?? 0, 9)
    }
  })
})

describe('엎어치기 연출', () => {
  it('업히기는 방향을 고른 순간 시작해 놓는 프레임에 다 업힌다', () => {
    expect(loadProgress(0)).toBe(0)
    expect(loadProgress(THROW.release / 2)).toBeCloseTo(0.5, 9)
    expect(loadProgress(THROW.release)).toBe(1)
    expect(loadProgress(THROW.release + 5)).toBe(1)
  })

  it('던져지면 업힌 자세에서 시작해 가장 높을 때 거꾸로 서고, 바닥에 등을 대고 떨어진다', () => {
    const k = createSeoiFlight()
    // 시작: 업힌 자세 그대로 (등 뒤 출발점, 들린 높이, 앞으로 기댐)
    expect(seoiFlight(0, k)).toEqual({ merge: 0, pivot: SEOI.backPivot, pitch: SEOI.drape })
    // 가장 높은 곳: 머리(약 1.6m)보다 높고 거꾸로 서 있다
    seoiFlight(SEOI.apexAt, k)
    expect(k.pivot).toBeCloseTo(SEOI.apex, 9)
    expect(k.pitch).toBeGreaterThan(Math.PI * 0.75)
    expect(k.pitch).toBeLessThan(Math.PI * 1.25)
    // 끝: 시뮬레이션 위치에, 바닥 높이로, 앞으로 3/4바퀴 (등을 대고 머리는 던진 쪽)
    seoiFlight(1, k)
    expect(k.merge).toBe(1)
    expect(k.pivot).toBeCloseTo(SEOI.lieHeight, 9)
    expect(k.pitch).toBeCloseTo((3 * Math.PI) / 2, 9)
  })

  it('시뮬레이션대로 미끄러지면: 머리보다 높이 던진 쪽 바로 위를 넘고, 화면 속 빠르기가 튀지 않으며 떨어질 때 시뮬레이션과 같다', () => {
    // 서버는 놓는 순간 잡힌 쪽을 던진 방향 0.8m 앞에 두고 넉백으로 민다 (던진 쪽 기준, 던진 방향 거리)
    const v0 = knockbackSpeed(THROW.knockback)
    const slide = (s: number) => {
      const t = Math.min(s, v0 / KNOCKBACK_DECEL)
      return BODY_RADIUS * 2 + v0 * t - (KNOCKBACK_DECEL * t * t) / 2
    }
    const air = THROWN_AIR_FRAMES / TICK_RATE
    const shown = (s: number) => {
      const k = seoiFlight(s / air, createSeoiFlight())
      return { x: -SEOI.backGap + (slide(s) + SEOI.backGap) * k.merge, pivot: k.pivot }
    }
    let crossed = false, top = 0
    const step = 0.001
    for (let s = 0; s < air; s += step) {
      const a = shown(s), b = shown(s + step)
      if (a.x <= 0 && b.x > 0) crossed = a.pivot > 1.8
      top = Math.max(top, (b.x - a.x) / step)
    }
    expect(crossed).toBe(true)
    expect(top).toBeLessThan(20)
    const end = (shown(air).x - shown(air - step).x) / step
    const sim = (slide(air) - slide(air - step)) / step
    expect(shown(air).x).toBeCloseTo(slide(air), 6)
    expect(Math.abs(end - sim)).toBeLessThan(1)
  })

  it('공중에서는 앞으로만 돌고 높이는 가장 높은 곳까지 오르다 내려온다', () => {
    const k = createSeoiFlight()
    let pitch = -Infinity, pivot = -Infinity, rising = true
    for (let i = 0; i <= 60; i++) {
      seoiFlight(i / 60, k)
      expect(k.pitch).toBeGreaterThanOrEqual(pitch)
      if (rising && k.pivot < pivot) rising = false
      if (!rising) expect(k.pivot).toBeLessThanOrEqual(pivot)
      pitch = k.pitch
      pivot = k.pivot
    }
  })

  it('던지는 쪽은 업는 동안 숙이기 시작해 놓은 직후 가장 깊고, 후딜이 끝나면 다시 선다', () => {
    expect(bowAngle(0)).toBe(0)
    expect(bowAngle(THROW.release)).toBeGreaterThan(SEOI.bow / 2)
    expect(bowAngle(SEOI.bowPeak)).toBeCloseTo(SEOI.bow, 9)
    expect(bowAngle(THROW.release + THROW.recovery)).toBe(0)
    for (let f = 1; f < THROW.release + THROW.recovery; f++) expect(bowAngle(f)).toBeLessThanOrEqual(SEOI.bow)
  })
})

describe('그 밖의 동작', () => {
  it('던져지면 공중에서는 피격 자세, 떨어지면 등을 대고 눕는다', () => {
    const out = createClipChoice()
    expect(chooseClip(input(Action.Thrown, 0), out).clip).toBe('Hit_B')
    expect(chooseClip(input(Action.Thrown, THROWN_AIR_FRAMES), out).clip).toBe('Lie_Idle')
  })

  it('다운은 누워 있다가 끝날 때 다 일어난다 (일어나는 진행률은 그 구간에서 0 → 1)', () => {
    const out = createClipChoice()
    expect(chooseClip(input(Action.Knockdown, 0), out).clip).toBe('Lie_Idle')
    expect(getupProgress(0)).toBe(0)
    chooseClip(input(Action.Knockdown, KNOCKDOWN_FRAMES), out)
    expect(out.clip).toBe('Lie_StandUp')
    expect(out.time).toBeLessThanOrEqual(CLIPS.Lie_StandUp.duration)
    expect(getupProgress(KNOCKDOWN_FRAMES)).toBe(1)
  })

  it('걷기·달리기는 반복하고, 빠를수록 빨리 재생하되 한계를 넘지 않는다', () => {
    const slow = chooseClip(input(Action.Walk, 0, { speed: 0.3 }), createClipChoice())
    const fast = chooseClip(input(Action.Run, 0, { speed: 6.5 }), createClipChoice())
    expect([slow.clip, slow.loop, slow.time]).toEqual(['Walking_A', true, null])
    expect(fast.clip).toBe('Running_A')
    expect(slow.rate).toBeLessThan(fast.rate)
    expect(fast.rate).toBeLessThanOrEqual(1.8)
  })

  it('가만히 있으면 캐릭터의 대기 동작', () => {
    expect(chooseClip(input(Action.Idle, 0, { idleClip: 'Unarmed_Idle' }), createClipChoice()).clip).toBe('Unarmed_Idle')
  })
})
