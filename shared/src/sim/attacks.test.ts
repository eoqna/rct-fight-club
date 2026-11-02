import { describe, expect, it } from 'vitest'
import { Action, Btn } from '../actions.ts'
import { ATTACKS, DASH_DISTANCE, type AttackDef } from '../attacks.ts'
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
