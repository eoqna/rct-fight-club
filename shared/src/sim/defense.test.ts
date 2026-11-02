import { describe, expect, it } from 'vitest'
import { Action, Btn } from '../actions.ts'
import { ATTACKS, GRAB, THROW } from '../attacks.ts'
import { GETUP_INVULN_FRAMES, GUARD_STUN_FRAMES, KNOCKDOWN_FRAMES, SPAWN_INVULN_FRAMES, TICK_RATE } from '../constants.ts'
import { applyHit, applyThrow, isGrabbable, isGuarding, isHittable, type Hittable } from './combat.ts'
import { makePlayer } from './fixtures.ts'
import { IDLE_INPUT, stepPlayer, type InputLike, type PlayerSim, type StepEvent } from './player.ts'

const DT = 1 / TICK_RATE
const GUARD: InputLike = { mx: 0, mz: 0, held: Btn.Guard, pressed: 0 }
const RIGHT: InputLike = { mx: 127, mz: 0, held: 0, pressed: 0 }
const FROM_BEHIND_Z = { x: 0, z: -1, fx: 0, fz: 1 }
const target = (overrides: Partial<Hittable> = {}): Hittable => ({ ...makePlayer(), hp: 100, ...overrides })

function run(p: PlayerSim, input: InputLike, steps: number) {
  for (let i = 0; i < steps; i++) stepPlayer(p, input, DT)
}

describe('가드', () => {
  it('F를 누르는 동안 가드하며 움직이지 못하고, 떼면 다시 움직인다', () => {
    const p = makePlayer()
    run(p, { ...GUARD, mx: 127 }, 10)
    expect(p.action).toBe(Action.Guard)
    expect(p.x).toBe(0)

    stepPlayer(p, RIGHT, DT)
    expect(p.action).toBe(Action.Walk)
    expect(p.x).toBeGreaterThan(0)
  })

  it('가드 중에는 공격 키를 눌러도 나가지 않는다', () => {
    const p = makePlayer()
    run(p, GUARD, 2)
    stepPlayer(p, { ...GUARD, pressed: Btn.PunchL }, DT)
    expect(p.action).toBe(Action.Guard)
  })

  it('정면(±70°)에서 오는 공격만 막는다', () => {
    const p = makePlayer({ action: Action.Guard, fx: 0, fz: 1 })
    expect(isGuarding(p, 0, 1)).toBe(true)
    expect(isGuarding(p, 0.9, 0.5)).toBe(true)
    expect(isGuarding(p, 1, 0)).toBe(false)
    expect(isGuarding(p, 0, -1)).toBe(false)
    expect(isGuarding({ ...p, action: Action.Idle }, 0, 1)).toBe(false)
  })

  it('막으면 피해 0.2배·넉백 0.3배이고, 가드 경직 뒤 다시 가드한다', () => {
    const p = target({ action: Action.Guard })
    const dealt = applyHit(p, FROM_BEHIND_Z, ATTACKS.straight, { guarded: true })
    expect(dealt).toBe(2)
    expect(p.hp).toBe(98)
    expect(p.action).toBe(Action.GuardStun)

    run(p, GUARD, GUARD_STUN_FRAMES)
    expect(p.action).toBe(Action.Guard)
    run(p, GUARD, 30)
    expect(p.z).toBeCloseTo(ATTACKS.straight.knockback * 0.3, 1)
  })

  it('막아도 피해는 최소 1이다', () => {
    const p = target({ action: Action.Guard })
    expect(applyHit(p, FROM_BEHIND_Z, { damage: 2, knockback: 0.1, hitstun: 5 }, { guarded: true })).toBe(1)
  })
})

describe('잡기·던지기', () => {
  it('G를 누르면 6프레임 뒤 3프레임 동안 잡기 판정이 나고, 헛잡으면 33프레임 뒤 끝난다', () => {
    const p = makePlayer()
    const total = GRAB.startup + GRAB.active + GRAB.recovery
    const events: (StepEvent | null)[] = [stepPlayer(p, { ...IDLE_INPUT, pressed: Btn.Grab }, DT)]
    for (let i = 1; i < total; i++) events.push(stepPlayer(p, IDLE_INPUT, DT))
    expect(events.flatMap((e, i) => (e?.kind === 'grab' ? [i] : []))).toEqual([6, 7, 8])
    expect(p.action).toBe(Action.GrabTry)
    stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Idle)
  })

  it('잡은 뒤 방향을 누르면 그쪽으로 돌아 던지고, 10프레임째에 놓는다', () => {
    const p = makePlayer({ action: Action.Holding })
    stepPlayer(p, { mx: -127, mz: 0, held: 0, pressed: 0 }, DT)
    expect(p.action).toBe(Action.Throwing)
    expect(p.fx).toBe(-1)

    const events: (StepEvent | null)[] = []
    for (let i = 0; i < THROW.release + THROW.recovery; i++) events.push(stepPlayer(p, IDLE_INPUT, DT))
    expect(events.findIndex((e) => e?.kind === 'throw')).toBe(THROW.release - 1)
    expect(p.action).toBe(Action.Idle)
  })

  it('방향을 고르지 않으면 0.6초 뒤 바라보는 방향으로 던진다', () => {
    const p = makePlayer({ action: Action.Holding, fx: 0, fz: 1 })
    run(p, IDLE_INPUT, GRAB.holdFrames - 1)
    expect(p.action).toBe(Action.Holding)
    stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Throwing)
    expect(p.fz).toBe(1)
  })

  it('던져지면 5m 날아가 다운되고, 일어나면 잠시 무적이다', () => {
    const p = target()
    expect(applyThrow(p, { x: 0, z: 0, fx: 1, fz: 0 })).toBe(THROW.damage)
    expect(p.action).toBe(Action.Thrown)

    run(p, IDLE_INPUT, THROW.hitstun)
    expect(p.action).toBe(Action.Knockdown)
    expect(isHittable(p)).toBe(false)
    run(p, IDLE_INPUT, KNOCKDOWN_FRAMES)
    expect(p.action).toBe(Action.Idle)
    expect(p.invuln).toBe(GETUP_INVULN_FRAMES)
    expect(p.x).toBeCloseTo(THROW.knockback, 1)
    expect(isHittable(p)).toBe(false)
  })

  it('공중·무적·다운·KO·잡기에 얽힌 상대는 잡을 수 없지만, 가드 중인 상대는 잡힌다', () => {
    expect(isGrabbable(makePlayer())).toBe(true)
    expect(isGrabbable(makePlayer({ action: Action.Guard }))).toBe(true)
    expect(isGrabbable(makePlayer({ y: 0.5 }))).toBe(false)
    expect(isGrabbable(makePlayer({ invuln: 10 }))).toBe(false)
    for (const action of [Action.Knockdown, Action.KO, Action.Grabbed, Action.Holding, Action.Throwing, Action.Thrown]) {
      expect(isGrabbable(makePlayer({ action }))).toBe(false)
    }
  })
})

describe('무적·다운·KO', () => {
  it('무적은 프레임마다 줄고, 공격하면 바로 풀린다', () => {
    const p = makePlayer({ invuln: SPAWN_INVULN_FRAMES })
    run(p, IDLE_INPUT, 10)
    expect(p.invuln).toBe(SPAWN_INVULN_FRAMES - 10)
    expect(isHittable(p)).toBe(false)

    stepPlayer(p, { ...IDLE_INPUT, pressed: Btn.PunchL }, DT)
    expect(p.invuln).toBe(0)
    expect(isHittable(p)).toBe(true)
  })

  it('연속 피격으로 다운되면 48프레임 뒤 일어나며 60프레임 동안 무적이다', () => {
    const p = target()
    applyHit(p, FROM_BEHIND_Z, ATTACKS.jab, { knockdown: true })
    expect(p.action).toBe(Action.Knockdown)
    run(p, IDLE_INPUT, KNOCKDOWN_FRAMES - 1)
    expect(p.action).toBe(Action.Knockdown)
    stepPlayer(p, IDLE_INPUT, DT)
    expect(p.action).toBe(Action.Idle)
    expect(p.invuln).toBe(GETUP_INVULN_FRAMES)
  })

  it('HP가 0이 되면 KO되어 더는 움직이거나 맞지 않는다', () => {
    const p = target({ hp: 5 })
    applyHit(p, FROM_BEHIND_Z, ATTACKS.jab)
    expect(p.hp).toBe(0)
    expect(p.action).toBe(Action.KO)
    run(p, { ...RIGHT, pressed: Btn.PunchL }, 120)
    expect(p.action).toBe(Action.KO)
    expect(isHittable(p)).toBe(false)
  })
})
