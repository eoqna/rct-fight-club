import { ATTACKS, Action, GRAB, KNOCKDOWN_FRAMES, THROW, TICK_RATE } from '@fight-club/shared'
import { CLIP_INFO, type ClipName } from './assets.gen.ts'
import { MODEL_SCALE, type CharacterMoves } from './characters.ts'

/** 동작이 바뀔 때 앞 클립과 섞는 시간 (초) — 공격·피격은 짧게, 눕기는 길게 */
const FADE = 0.12
const QUICK_FADE = 0.06
const LIE_FADE = 0.2
/** 공격 클립의 준비·마무리 동작을 게임 프레임에 맞출 때 허용하는 최대 배속 */
const MAX_STRIKE_RATE = 2
/** 걷기·달리기 재생 속도 한계. 게임 이동(4~6.5m/s)이 클립 보폭보다 훨씬 빨라 발이 조금 미끄러지는 것은 받아들인다 */
const LOCO_RATE_MIN = 0.6
const LOCO_RATE_MAX = 1.8
/** 던져진 쪽이 공중에 떠 있는 시간 (프레임) — 이 동안 어깨 너머로 넘어가 떨어진다 */
export const THROWN_AIR_FRAMES = 30
/** 다운 끝에서 일어나는 시간 (프레임)과, 일어나기 클립 중 실제로 몸을 일으키는 구간 (초) */
const GETUP_FRAMES = 28
const GETUP_FROM = 0.45
const GETUP_TO = 2.1
/** 잡혀 있는 동안 멈춰 둘 피격 자세 (초) */
const GRABBED_POSE = 0.2

/**
 * 엎어치기 연출 — design §7.5. 시뮬레이션은 그대로(잡힌 쪽은 앞에 붙어 있다가 바닥을 미끄러진다) 두고 화면에만 더한다.
 * 잡힌 쪽은 놓기 전에 던지는 쪽 등 뒤로 돌아가 업히고, 놓인 뒤에는 등 뒤에서 시뮬레이션 위치로 부드럽게 옮겨 가며
 * 어깨 너머로 앞으로 3/4바퀴 돌아 등을 대고 떨어진다 (머리는 던진 쪽 — 눕기 클립 Lie_Idle과 같은 자세).
 * 던지는 쪽은 그동안 허리를 숙인다
 */
export const SEOI = {
  /** 업혔을 때 던지는 쪽 몸 중심에서 등 뒤까지 거리 (m) */
  backGap: 0.35,
  /** 업혔을 때 잡힌 쪽 회전 중심(엉덩이) 높이 (m)와 앞으로 기운 각도 */
  backPivot: 1.15,
  drape: (50 * Math.PI) / 180,
  /** 어깨 너머 가장 높은 곳의 회전 중심 높이 (m)와 그때의 공중 진행률 */
  apex: 2.1,
  apexAt: 0.28,
  /** 떨어질 때 회전 중심 높이 (m)와 마지막 각도 (앞으로 3/4바퀴 = 등을 대고 눕는다) */
  lieHeight: 0.2,
  land: (270 * Math.PI) / 180,
  /** 던지는 쪽이 숙이는 가장 큰 각도와 그 프레임 (놓은 직후, 잡힌 쪽이 어깨를 넘어갈 때) */
  bow: (80 * Math.PI) / 180,
  bowPeak: 13,
} as const

const CLIPS: Record<ClipName, { duration: number; impact?: number; speed?: number }> = CLIP_INFO
const FLYING = ATTACKS.flyingKick
const KICK: ClipName = 'Unarmed_Melee_Attack_Kick'

export interface AnimInput {
  action: number
  actionFrame: number
  /** 피격 경직 길이 (프레임) */
  stun: number
  /** 수평 이동 속도 (m/s) */
  speed: number
  /** 공중에서 올라가는 중 */
  rising: boolean
  idleClip: ClipName
  moves: CharacterMoves
}

export interface ClipChoice {
  clip: ClipName
  /** 재생 위치 (초). null이면 직접 rate배속으로 진행한다 */
  time: number | null
  /** time이 null일 때 끝에서 처음으로 돌아갈지 (아니면 끝에서 멈춘다) */
  loop: boolean
  rate: number
  /** 이 클립으로 넘어갈 때 섞는 시간 (초) */
  fade: number
}

export const createClipChoice = (): ClipChoice => ({ clip: 'Idle', time: null, loop: true, rate: 1, fade: FADE })

interface FrameWindow {
  startup: number
  active: number
  recovery: number
}

/**
 * 공격 클립의 타격 시점(impact)이 판정 첫 프레임에 오도록 재생 위치(초)를 정한다 — design §7.5
 * 선딜에는 타격 시점 앞부분을, 판정 동안은 제 속도로, 후딜에는 그 뒤를 재생한다 (준비·마무리는 최대 2배속).
 * 클립이 남은 채 후딜이 끝나면 다음 동작으로 섞여 넘어간다
 */
export function strikeTime(clip: { duration: number; impact: number }, frames: FrameWindow, frame: number): number {
  const s = frame / TICK_RATE
  const startup = frames.startup / TICK_RATE
  const active = frames.active / TICK_RATE
  const recovery = frames.recovery / TICK_RATE
  if (s < startup) {
    const from = Math.max(0, clip.impact - MAX_STRIKE_RATE * startup)
    return from + (clip.impact - from) * (s / startup)
  }
  const hit = Math.min(clip.duration, clip.impact + Math.min(s - startup, active))
  if (s < startup + active || recovery <= 0) return hit
  const end = Math.min(clip.duration, hit + MAX_STRIKE_RATE * recovery)
  return hit + (end - hit) * Math.min(1, (s - startup - active) / recovery)
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** 엎어치기에서 업히는 진행률 0~1 — 던지는 쪽이 방향을 고른 뒤 놓을 때까지 */
export function loadProgress(throwerFrame: number): number {
  return smooth(throwerFrame / THROW.release)
}

export interface SeoiFlight {
  /** 등 뒤 출발점에서 시뮬레이션 위치 쪽으로 옮겨 간 비율 0~1 — 화면 위치 = 출발점 + (시뮬레이션 위치 − 출발점) × merge.
   *  처음에는 천천히(던진 쪽 위를 넘는 동안), 끝에는 시뮬레이션과 같은 빠르기로 */
  merge: number
  /** 회전 중심 높이 (m) */
  pivot: number
  /** 앞으로 돈 각도 (rad) */
  pitch: number
}

export const createSeoiFlight = (): SeoiFlight => ({ merge: 0, pivot: 0, pitch: 0 })

/** 엎어치기로 던져진 뒤 공중 진행률 t(0~1)의 자세: 등 뒤 → 어깨 너머 가장 높은 곳 → 던진 방향 바닥에 등을 대고 */
export function seoiFlight(t: number, out: SeoiFlight): SeoiFlight {
  const k = Math.min(1, Math.max(0, t))
  out.merge = smooth(k)
  out.pivot = k < SEOI.apexAt
    ? SEOI.backPivot + (SEOI.apex - SEOI.backPivot) * Math.sin((Math.PI / 2) * (k / SEOI.apexAt))
    : SEOI.apex - (SEOI.apex - SEOI.lieHeight) * ((k - SEOI.apexAt) / (1 - SEOI.apexAt)) ** 2
  // 처음에 빨리 돌아 가장 높은 곳에서 거꾸로 서고, 떨어지며 천천히 눕는다
  out.pitch = SEOI.drape + (SEOI.land - SEOI.drape) * (1 - (1 - k) * (1 - k))
  return out
}

/** 다운 끝에서 일어나는 진행률 0~1 (일어나기 전에는 0) — 등을 대고 누웠던 쪽은 일어나면서 원래 방향으로 돈다 */
export function getupProgress(knockdownFrame: number): number {
  return smooth((knockdownFrame - (KNOCKDOWN_FRAMES - GETUP_FRAMES)) / GETUP_FRAMES)
}

/** 던지는 쪽이 앞으로 숙이는 각도 (rad): 업는 동안 숙이기 시작해 잡힌 쪽이 어깨를 넘을 때 가장 깊고, 후딜이 끝나면 선다 */
export function bowAngle(throwerFrame: number): number {
  const end = THROW.release + THROW.recovery
  const f = throwerFrame
  if (f <= 0 || f >= end) return 0
  const k = f < SEOI.bowPeak ? smooth(f / SEOI.bowPeak) : 1 - smooth((f - SEOI.bowPeak) / (end - SEOI.bowPeak))
  return SEOI.bow * k
}

/** 동작·프레임으로 재생할 클립과 위치를 고른다. 위치를 프레임에서 정하므로 원격 캐릭터의 공격도 프레임 단위로 맞는다 */
export function chooseClip(a: AnimInput, out: ClipChoice): ClipChoice {
  const f = a.actionFrame
  switch (a.action) {
    case Action.Walk:
      return loop(out, 'Walking_A', locoRate(a.speed, 'Walking_A'))
    case Action.Run:
      return loop(out, 'Running_A', locoRate(a.speed, 'Running_A'))
    case Action.Air:
      return a.rising ? once(out, 'Jump_Start') : loop(out, 'Jump_Idle')
    case Action.Falling:
      return loop(out, 'Jump_Idle')
    case Action.Jab:
      return strike(out, a.moves.jab, ATTACKS.jab, f)
    case Action.Straight:
      return strike(out, a.moves.straight, ATTACKS.straight, f)
    case Action.Kick:
      return strike(out, KICK, ATTACKS.kick, f)
    case Action.Dash:
      return strike(out, a.moves.dash, ATTACKS.dash, f)
    case Action.FlyingKick:
      // 판정은 착지할 때까지 이어지므로 뻗은 다리를 그대로 둔다
      return strike(out, KICK, { startup: FLYING.startup, active: 0, recovery: 0 }, f)
    case Action.Landing:
      return at(out, 'Jump_Land', (f / FLYING.recovery) * CLIPS.Jump_Land.duration, FADE)
    case Action.Guard:
      return loop(out, 'Blocking')
    case Action.GuardStun:
      return at(out, 'Block_Hit', f / TICK_RATE, QUICK_FADE)
    case Action.GrabTry:
      return strike(out, 'Interact', GRAB, f)
    case Action.Holding:
      return at(out, 'Interact', CLIPS.Interact.impact ?? 0, FADE)
    case Action.Throwing:
      // 엎어치기: 잡은 자세 그대로 업어 넘긴다 (허리를 숙이는 것은 캐릭터가 그린다)
      return at(out, 'Interact', CLIPS.Interact.impact ?? 0, FADE)
    case Action.Grabbed:
      return at(out, 'Hit_B', Math.min(f / TICK_RATE, GRABBED_POSE), QUICK_FADE)
    case Action.Thrown:
      // 공중에서는 젖혀진 피격 자세, 떨어지면 등을 대고 눕는다 (어깨 너머로 도는 것은 캐릭터가 그린다)
      return f < THROWN_AIR_FRAMES ? at(out, 'Hit_B', Math.min(f / TICK_RATE, GRABBED_POSE), QUICK_FADE) : loop(out, 'Lie_Idle', 1, LIE_FADE)
    case Action.Hitstun:
      return at(out, 'Hit_A', Math.min(1, f / Math.max(1, a.stun)) * CLIPS.Hit_A.duration * 0.8, QUICK_FADE)
    case Action.Knockdown: {
      const getup = f - (KNOCKDOWN_FRAMES - GETUP_FRAMES)
      if (getup < 0) return loop(out, 'Lie_Idle', 1, LIE_FADE)
      return at(out, 'Lie_StandUp', GETUP_FROM + (GETUP_TO - GETUP_FROM) * Math.min(1, getup / GETUP_FRAMES), FADE)
    }
    case Action.KO:
      return at(out, 'Death_A', Math.min(CLIPS.Death_A.duration, f / TICK_RATE), QUICK_FADE)
    default:
      return loop(out, a.idleClip)
  }
}

function strike(out: ClipChoice, clip: ClipName, frames: FrameWindow, frame: number): ClipChoice {
  const info = CLIPS[clip]
  return at(out, clip, strikeTime({ duration: info.duration, impact: info.impact ?? 0 }, frames, frame), QUICK_FADE)
}

function at(out: ClipChoice, clip: ClipName, time: number, fade: number): ClipChoice {
  out.clip = clip
  out.time = time
  out.loop = false
  out.rate = 1
  out.fade = fade
  return out
}

function loop(out: ClipChoice, clip: ClipName, rate = 1, fade = FADE): ClipChoice {
  out.clip = clip
  out.time = null
  out.loop = true
  out.rate = rate
  out.fade = fade
  return out
}

function once(out: ClipChoice, clip: ClipName): ClipChoice {
  loop(out, clip)
  out.loop = false
  return out
}


/** 실제 이동 속도 / 클립의 원래 속도, 한계 안에서 */
function locoRate(speed: number, clip: ClipName): number {
  const natural = (CLIPS[clip].speed ?? 1) * MODEL_SCALE
  return Math.min(LOCO_RATE_MAX, Math.max(LOCO_RATE_MIN, speed / natural))
}
