import { describe, expect, it } from 'vitest'
import { Action, Btn } from '../actions.ts'
import { ATTACKS, DASH_DISTANCE, GRAB, KICK_COOLDOWN, type AttackDef } from '../attacks.ts'
import { TICK_RATE } from '../constants.ts'
import { makePlayer } from './fixtures.ts'
import { IDLE_INPUT, stepPlayer, type Body, type InputLike, type StepEvent } from './player.ts'

const DT = 1 / TICK_RATE
const RIGHT: InputLike = { mx: 127, mz: 0, held: 0, pressed: 0 }
const RUN_RIGHT: InputLike = { ...RIGHT, held: Btn.Run }
const press = (bits: number, base: InputLike = IDLE_INPUT): InputLike => ({ ...base, pressed: bits })
const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i)
const hitIndexes = (events: (StepEvent | null)[]) => events.flatMap((e, i) => (e?.kind === 'hit' ? [i] : []))

describe('지상 공격', () => {
  it.each<[string, number, AttackDef, number]>([
    ['스트레이트(S)', Btn.PunchR, ATTACKS.straight, Action.Straight],
    ['발차기(D)', Btn.Kick, ATTACKS.kick, Action.Kick],
  ])('%s는 프레임 데이터대로 판정이 나고 끝난다', (_label, bits, def, action) => {
    const p = makePlayer()
    const total = def.startup + def.active + def.recovery
    const events = [stepPlayer(p, press(bits), DT)]
    for (let i = 1; i < total; i++) events.push(stepPlayer(p, IDLE_INPUT, DT))
    expect(hitIndexes(events)).toEqual(range(def.startup, def.active))
    expect(p.action).toBe(action)
    stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Idle)
  })

  it('여러 키를 함께 누르면 잡기 > 발차기 > 오른손 > 왼손 순으로 하나만 나간다', () => {
    const cases: [number, number][] = [
      [Btn.Grab | Btn.Kick | Btn.PunchL, Action.GrabTry],
      [Btn.Kick | Btn.PunchR, Action.Kick],
      [Btn.PunchR | Btn.PunchL, Action.Straight],
      [Btn.PunchL | Btn.Jump, Action.Jab],
    ]
    for (const [bits, action] of cases) {
      const p = makePlayer()
      stepPlayer(p, press(bits), DT)
      expect(p.action).toBe(action)
    }
  })

  it('오른손(S, 특수)은 왼손(A, 기본)보다 피해가 조금 더 크고, 대신 선딜·후딜이 길다 (사용자 요청 2026-11-03)', () => {
    expect(ATTACKS.straight.damage).toBeGreaterThan(ATTACKS.jab.damage)
    expect(ATTACKS.straight.startup).toBeGreaterThan(ATTACKS.jab.startup)
    expect(ATTACKS.straight.recovery).toBeGreaterThan(ATTACKS.jab.recovery)
  })
})

describe('연계 공격', () => {
  it('달리면서 공격하면 2m를 내달린 뒤 그 자리에 서는 돌진 공격이 나간다', () => {
    const p = makePlayer()
    for (let i = 0; i < 20; i++) stepPlayer(p, RUN_RIGHT, DT)
    expect(p.action).toBe(Action.Run)

    const startX = p.x
    stepPlayer(p, press(Btn.PunchL, RUN_RIGHT), DT)
    expect(p.action).toBe(Action.Dash)
    for (let i = 0; i < 45; i++) stepPlayer(p, IDLE_INPUT, DT)
    expect(p.x - startX).toBeCloseTo(DASH_DISTANCE, 6)
    expect(p.action).toBe(Action.Idle)
  })

  it('공중에서 D를 누르면 날아차기가 나가고, 착지하면 18프레임 후딜이 있다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.Jump), DT)
    stepPlayer(p, IDLE_INPUT, DT)
    const events = [stepPlayer(p, press(Btn.Kick), DT)]
    expect(p.action).toBe(Action.FlyingKick)
    while (p.action === Action.FlyingKick) events.push(stepPlayer(p, IDLE_INPUT, DT))
    expect(hitIndexes(events)[0]).toBe(ATTACKS.flyingKick.startup)
    expect(p.action).toBe(Action.Landing)

    for (let i = 0; i < ATTACKS.flyingKick.recovery - 1; i++) stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Landing)
    stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Idle)
  })

  it('공중 펀치는 지상 펀치와 같지만 수평 속도를 잃지 않는다', () => {
    const p = makePlayer({ vx: 4, action: Action.Walk })
    stepPlayer(p, press(Btn.Jump, RIGHT), DT)
    stepPlayer(p, press(Btn.PunchL), DT)
    expect(p.action).toBe(Action.Jab)
    expect(p.vx).toBe(4)
  })
})

describe('선입력', () => {
  it('후딜 마지막 6프레임 안에 누른 공격은 후딜이 끝나자마자 나간다', () => {
    const p = makePlayer()
    const total = ATTACKS.jab.startup + ATTACKS.jab.active + ATTACKS.jab.recovery
    stepPlayer(p, press(Btn.PunchL), DT)
    for (let frame = 1; frame < total - 3; frame++) stepPlayer(p, IDLE_INPUT, DT)
    stepPlayer(p, press(Btn.Kick), DT)
    stepPlayer(p, IDLE_INPUT, DT)
    stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Jab)

    stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Kick)
    expect(p.actionFrame).toBe(0)
  })

  it('그보다 일찍 누른 공격은 무시된다', () => {
    const p = makePlayer()
    const total = ATTACKS.jab.startup + ATTACKS.jab.active + ATTACKS.jab.recovery
    stepPlayer(p, press(Btn.PunchL), DT)
    for (let frame = 1; frame < 10; frame++) stepPlayer(p, IDLE_INPUT, DT)
    stepPlayer(p, press(Btn.Kick), DT)
    for (let frame = 11; frame <= total; frame++) stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Idle)
  })
})

describe('쿨타임', () => {
  /** 동작이 끝날 때까지 빈 입력으로 진행한다 */
  const finishAction = (p: ReturnType<typeof makePlayer>) => {
    for (let i = 0; i < 120 && p.action !== Action.Idle; i++) stepPlayer(p, IDLE_INPUT, DT)
  }
  /** 조건이 맞을 때까지 빈 입력으로 진행한다 */
  const wait = (p: ReturnType<typeof makePlayer>, until: (p: ReturnType<typeof makePlayer>) => boolean) => {
    for (let i = 0; i < 1000 && !until(p); i++) stepPlayer(p, IDLE_INPUT, DT)
  }

  it('발차기는 시작하고 3초(180프레임) 동안 다시 찰 수 없다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.Kick), DT)
    expect(p.kickCooldown).toBe(KICK_COOLDOWN)
    finishAction(p)
    stepPlayer(p, press(Btn.Kick), DT)
    expect(p.action).toBe(Action.Idle)

    // 처음 찬 스텝부터 정확히 180스텝째에 다시 찰 수 있다
    const p2 = makePlayer()
    stepPlayer(p2, press(Btn.Kick), DT)
    for (let i = 1; i < KICK_COOLDOWN; i++) stepPlayer(p2, IDLE_INPUT, DT)
    expect(p2.kickCooldown).toBe(1)
    stepPlayer(p2, press(Btn.Kick), DT)
    expect(p2.action).toBe(Action.Kick)
  })

  it('날아차기도 발차기 쿨타임을 같이 쓴다 — 점프로 쿨타임을 피할 수 없다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.Kick), DT)
    finishAction(p)
    stepPlayer(p, press(Btn.Jump), DT)
    stepPlayer(p, press(Btn.Kick), DT)
    expect(p.action).toBe(Action.Air)

    const q = makePlayer()
    stepPlayer(q, press(Btn.Jump), DT)
    stepPlayer(q, press(Btn.Kick), DT)
    expect(q.action).toBe(Action.FlyingKick)
    wait(q, (x) => x.action === Action.Idle)
    stepPlayer(q, press(Btn.Kick), DT)
    expect(q.action).toBe(Action.Idle)
  })

  it('쿨타임 중에 함께 누른 다른 공격은 나가고, 달리며 D(돌진)는 막지 않는다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.Kick), DT)
    finishAction(p)
    stepPlayer(p, press(Btn.Kick | Btn.PunchR), DT)
    expect(p.action).toBe(Action.Straight)

    const q = makePlayer({ kickCooldown: KICK_COOLDOWN })
    for (let i = 0; i < 20; i++) stepPlayer(q, RUN_RIGHT, DT)
    stepPlayer(q, press(Btn.Kick, RUN_RIGHT), DT)
    expect(q.action).toBe(Action.Dash)
  })

  it('쿨타임 중인 발차기는 선입력되지 않는다', () => {
    const p = makePlayer({ kickCooldown: KICK_COOLDOWN })
    const total = ATTACKS.jab.startup + ATTACKS.jab.active + ATTACKS.jab.recovery
    stepPlayer(p, press(Btn.PunchL), DT)
    for (let frame = 1; frame < total - 3; frame++) stepPlayer(p, IDLE_INPUT, DT)
    stepPlayer(p, press(Btn.Kick), DT)
    for (let i = 0; i < 4; i++) stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Idle)
  })

  it('잡기는 헛잡아도 5초(300프레임) 동안 다시 잡을 수 없다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.Grab), DT)
    expect(p.action).toBe(Action.GrabTry)
    expect(p.grabCooldown).toBe(GRAB.cooldown)
    finishAction(p)
    stepPlayer(p, press(Btn.Grab), DT)
    expect(p.action).toBe(Action.Idle)

    wait(p, (x) => x.grabCooldown === 1)
    stepPlayer(p, press(Btn.Grab), DT)
    expect(p.action).toBe(Action.GrabTry)
  })
})

describe('조준 보정', () => {
  const aim = (targets: Body[]) => ({ aimTargets: () => targets })

  it('공격 순간 앞쪽 45°·2m 안의 가장 가까운 상대 쪽으로 돈다', () => {
    const p = makePlayer({ fx: 1, fz: 0 })
    stepPlayer(p, press(Btn.PunchL), DT, aim([{ x: 1.5, y: 0, z: 0.5 }, { x: 1, y: 0, z: -0.5 }]))
    expect(p.fx).toBeCloseTo(1 / Math.hypot(1, 0.5), 9)
    expect(p.fz).toBeCloseTo(-0.5 / Math.hypot(1, 0.5), 9)
  })

  it('옆에 있거나 2m보다 먼 상대 쪽으로는 돌지 않는다', () => {
    const p = makePlayer({ fx: 1, fz: 0 })
    stepPlayer(p, press(Btn.PunchL), DT, aim([{ x: 0.5, y: 0, z: 1 }, { x: 2.5, y: 0, z: 0 }]))
    expect(p.fx).toBe(1)
    expect(p.fz).toBe(0)
  })
})
