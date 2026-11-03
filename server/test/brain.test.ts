import { ARENA_HALF, Action, Btn, MAX_HP, PlayerState } from '@fight-club/shared'
import { describe, expect, it } from 'vitest'
import { BOT, BotBrain, type BotWorld } from '../src/bots/brain.ts'

/** 재현할 수 있는 난수 (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function at(x: number, z: number, extra: Partial<PlayerState> = {}): PlayerState {
  const p = new PlayerState()
  Object.assign(p, { x, y: 0, z, fx: 0, fz: 1, action: Action.Idle, actionFrame: 0, hp: MAX_HP, invuln: 0, ...extra })
  return p
}

function world(players: Record<string, PlayerState>, opts: { tick?: number; humans?: string[]; chasers?: Record<string, number> } = {}): BotWorld {
  return {
    tick: opts.tick ?? 100,
    players: new Map(Object.entries(players)),
    isHuman: (id) => opts.humans?.includes(id) ?? false,
    chasers: (id) => opts.chasers?.[id] ?? 0,
  }
}

/** 여러 번(씨앗마다 새 두뇌) 시켜 본 비율 */
function rate(trials: number, run: (brain: BotBrain) => boolean): number {
  let hits = 0
  for (let i = 0; i < trials; i++) if (run(new BotBrain(seeded(i + 1)))) hits++
  return hits / trials
}

describe('봇 두뇌', () => {
  it('복귀: 가장자리 2m 안이면 무엇보다 먼저 중앙 쪽으로 걷는다 (상대가 바로 앞에 있어도)', () => {
    const self = at(ARENA_HALF - 1, 0, { fx: 1, fz: 0 })
    const input = new BotBrain(seeded(1)).think('me', self, world({ me: self, foe: at(ARENA_HALF - 0.2, 0) }, { humans: ['foe'] }))
    expect(input.mx).toBeLessThan(0)
    expect(input.pressed).toBe(0)
    expect(input.held).toBe(0)
  })

  it('추격: 8m 안에서 사람을 먼저 쫓고, 멀면 달리고 가까우면 걷는다', () => {
    const self = at(0, 0)
    const far = new BotBrain(seeded(1)).think('me', self, world({ me: self, human: at(6, 0), bot: at(-2, 0) }, { humans: ['human'] }))
    expect(far.mx).toBeGreaterThan(0)
    expect(far.held & Btn.Run).toBe(Btn.Run)
    const near = new BotBrain(seeded(1)).think('me', self, world({ me: self, human: at(3, 0) }, { humans: ['human'] }))
    expect(near.mx).toBeGreaterThan(0)
    expect(near.held & Btn.Run).toBe(0)
    // 8m보다 멀면 쫓지 않는다
    const brain = new BotBrain(seeded(1))
    brain.think('me', self, world({ me: self, human: at(9, 0) }, { humans: ['human'] }))
    expect(brain.target).toBeNull()
  })

  it('한 상대를 이미 봇 둘이 쫓고 있으면 다른 상대를 고른다 (나도 쫓던 중이면 계속)', () => {
    const self = at(0, 0)
    const players = { me: self, human: at(3, 0), other: at(-4, 0) }
    const fresh = new BotBrain(seeded(1))
    fresh.think('me', self, world(players, { humans: ['human'], chasers: { human: 2 } }))
    expect(fresh.target).toBe('other')
    const chasing = new BotBrain(seeded(1))
    chasing.think('me', self, world(players, { humans: ['human'] }))
    expect(chasing.target).toBe('human')
    chasing.think('me', self, world(players, { tick: 100 + BOT.retarget, humans: ['human'], chasers: { human: 2 } }))
    expect(chasing.target).toBe('human')
  })

  it('공격: 1.2m 안에 들어오면 250~450ms 뒤에 친다 — 잽 50% · 스트레이트 30% · 발차기 20%', () => {
    const counts = { [Btn.PunchL]: 0, [Btn.PunchR]: 0, [Btn.Kick]: 0 }
    const trials = 3000
    for (let i = 0; i < trials; i++) {
      const brain = new BotBrain(seeded(i + 1))
      const self = at(0, 0, { fx: 1, fz: 0 })
      const players = { me: self, foe: at(1, 0) }
      let pressedAt = -1
      for (let tick = 100; tick < 140 && pressedAt < 0; tick++) {
        const input = brain.think('me', self, world(players, { tick, humans: ['foe'] }))
        if (input.pressed) {
          pressedAt = tick
          counts[input.pressed as keyof typeof counts]++
        }
      }
      expect(pressedAt - 100).toBeGreaterThanOrEqual(BOT.reactMin)
      expect(pressedAt - 100).toBeLessThanOrEqual(BOT.reactMax)
    }
    expect(counts[Btn.PunchL] / trials).toBeCloseTo(0.5, 1)
    expect(counts[Btn.PunchR] / trials).toBeCloseTo(0.3, 1)
    expect(counts[Btn.Kick] / trials).toBeCloseTo(0.2, 1)
  })

  it('발차기 쿨타임 중에는 발차기 대신 펀치를 고른다', () => {
    for (let i = 0; i < 300; i++) {
      const brain = new BotBrain(seeded(i + 1))
      const self = at(0, 0, { fx: 1, fz: 0, kickCooldown: 100 })
      for (let tick = 100; tick < 140; tick++) {
        const input = brain.think('me', self, world({ me: self, foe: at(1, 0) }, { tick }))
        expect(input.pressed & Btn.Kick).toBe(0)
      }
    }
  })

  it('방어: 나를 보고 선딜 중인 상대에게 30% 확률로 그쪽을 보며 0.5초 가드한다 (같은 공격에는 한 번만)', () => {
    const attacker = () => at(1.5, 0, { fx: -1, fz: 0, action: Action.Straight, actionFrame: 2 })
    const guarded = rate(3000, (brain) => {
      const self = at(0, 0)
      const input = brain.think('me', self, world({ me: self, foe: attacker() }))
      return (input.held & Btn.Guard) !== 0
    })
    expect(guarded).toBeCloseTo(BOT.guardChance, 1)

    // 가드하면 그쪽을 보고, 0.5초 동안 계속 누른다
    let guardTick = -1
    let brain = new BotBrain(seeded(1))
    for (let seed = 1; guardTick < 0; seed++) {
      brain = new BotBrain(seeded(seed))
      const self = at(0, 0)
      const input = brain.think('me', self, world({ me: self, foe: attacker() }))
      if (input.held & Btn.Guard) {
        expect(input.mx).toBeGreaterThan(0)
        guardTick = 100
      }
    }
    const self = at(0, 0, { action: Action.Guard })
    for (let t = 1; t < BOT.guardFrames; t++) expect(brain.think('me', self, world({ me: self }, { tick: guardTick + t })).held).toBe(Btn.Guard)
    expect(brain.think('me', at(0, 0), world({ me: at(0, 0) }, { tick: guardTick + BOT.guardFrames })).held).toBe(0)

    // 확률이 빗나가면 같은 공격(같은 시작 틱)에는 다시 굴리지 않는다
    const missed = new BotBrain(() => 0.99)
    const me = at(0, 0)
    for (let f = 2; f < 8; f++) {
      const foe = at(1.5, 0, { fx: -1, fz: 0, action: Action.Straight, actionFrame: f })
      expect(missed.think('me', me, world({ me, foe }, { tick: 100 + f })).held & Btn.Guard).toBe(0)
    }
  })

  it('나를 보지 않는 상대의 선딜이나 멀리 있는 공격에는 가드하지 않는다', () => {
    const away = rate(500, (brain) => {
      const self = at(0, 0)
      const foe = at(1.5, 0, { fx: 1, fz: 0, action: Action.Kick, actionFrame: 3 })
      return (brain.think('me', self, world({ me: self, foe })).held & Btn.Guard) !== 0
    })
    expect(away).toBe(0)
    const far = rate(500, (brain) => {
      const self = at(0, 0)
      const foe = at(4, 0, { fx: -1, fz: 0, action: Action.Kick, actionFrame: 3 })
      return (brain.think('me', self, world({ me: self, foe })).held & Btn.Guard) !== 0
    })
    expect(far).toBe(0)
  })

  it('잡기: 가까운 상대가 가드 중이면 20% 확률로 잡는다 (잡기 쿨타임 중에는 안 잡는다)', () => {
    const grabbed = rate(3000, (brain) => {
      const self = at(0, 0, { fx: 1, fz: 0 })
      const foe = at(1, 0, { fx: -1, fz: 0, action: Action.Guard, actionFrame: 5 })
      return (brain.think('me', self, world({ me: self, foe })).pressed & Btn.Grab) !== 0
    })
    expect(grabbed).toBeCloseTo(BOT.grabChance, 1)
    const cooling = rate(500, (brain) => {
      const self = at(0, 0, { fx: 1, fz: 0, grabCooldown: 60 })
      const foe = at(1, 0, { fx: -1, fz: 0, action: Action.Guard, actionFrame: 5 })
      return (brain.think('me', self, world({ me: self, foe })).pressed & Btn.Grab) !== 0
    })
    expect(cooling).toBe(0)
  })

  it('잡으면 잠깐 뒤 가장 가까운 가장자리 쪽으로 던진다', () => {
    const brain = new BotBrain(seeded(3))
    const self = at(6, 2, { action: Action.Holding })
    let thrownAt = -1
    for (let tick = 100; tick < 140 && thrownAt < 0; tick++) {
      const input = brain.think('me', self, world({ me: self }, { tick }))
      if (input.mx || input.mz) {
        thrownAt = tick
        expect([input.mx, input.mz]).toEqual([127, 0])
      }
    }
    expect(thrownAt - 100).toBeGreaterThanOrEqual(BOT.throwMin)
    expect(thrownAt - 100).toBeLessThanOrEqual(BOT.throwMax)
  })

  it('상대가 없으면 안쪽 영역을 배회한다 (맞을 수 없는 상대는 쫓지 않는다)', () => {
    const brain = new BotBrain(seeded(7))
    const self = at(0, 0)
    const input = brain.think('me', self, world({ me: self, downed: at(2, 0, { action: Action.Knockdown }), fresh: at(-2, 0, { invuln: 60 }) }))
    expect(brain.target).toBeNull()
    expect(Math.hypot(input.mx, input.mz)).toBeGreaterThan(100)
  })

  it('맞거나 공격 중일 때는 아무것도 누르지 않는다', () => {
    for (const action of [Action.Hitstun, Action.Jab, Action.Knockdown, Action.Grabbed, Action.Thrown, Action.Falling]) {
      const self = at(0, 0, { action })
      const input = new BotBrain(seeded(1)).think('me', self, world({ me: self, foe: at(1, 0) }))
      expect([input.mx, input.mz, input.held, input.pressed]).toEqual([0, 0, 0, 0])
    }
  })
})
