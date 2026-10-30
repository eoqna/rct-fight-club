import { describe, expect, it } from 'vitest'
import { Action, Btn } from '../actions.ts'
import { ATTACKS } from '../attacks.ts'
import { ARENA_HALF, FALL_OUT_Y, GRAVITY, JUMP_SPEED, RUN_SPEED, TICK_RATE, WALK_SPEED } from '../constants.ts'
import { makePlayer } from './fixtures.ts'
import { IDLE_INPUT, stepPlayer, type HitQuery, type InputLike, type PlayerSim } from './player.ts'

const DT = 1 / TICK_RATE
const RIGHT: InputLike = { mx: 127, mz: 0, held: 0, pressed: 0 }
const LEFT: InputLike = { mx: -127, mz: 0, held: 0, pressed: 0 }

function run(p: PlayerSim, input: InputLike, steps: number) {
  for (let i = 0; i < steps; i++) stepPlayer(p, input, DT)
}

const press = (bit: number): InputLike => ({ ...IDLE_INPUT, pressed: bit })

describe('stepPlayer 이동', () => {
  it('같은 입력 열이면 언제나 같은 결과를 낸다', () => {
    const script = (i: number): InputLike => ({
      mx: i % 50 < 25 ? 127 : -127,
      mz: i % 70 < 35 ? 127 : 0,
      held: i % 90 < 45 ? Btn.Run : 0,
      pressed: i % 37 === 0 ? Btn.Jump : i % 53 === 0 ? Btn.PunchL : 0,
    })
    const a = makePlayer()
    const b = makePlayer()
    const queriesA: (HitQuery | null)[] = []
    const queriesB: (HitQuery | null)[] = []
    for (let i = 0; i < 600; i++) {
      queriesA.push(stepPlayer(a, script(i), DT))
      queriesB.push(stepPlayer(b, script(i), DT))
    }
    expect(b).toEqual(a)
    expect(queriesB).toEqual(queriesA)
  })

  it('걷기와 달리기 속도에 도달한다', () => {
    const walker = makePlayer()
    run(walker, RIGHT, 30)
    expect(walker.vx).toBe(WALK_SPEED)
    expect(walker.action).toBe(Action.Walk)

    const runner = makePlayer()
    run(runner, { ...RIGHT, held: Btn.Run }, 30)
    expect(runner.vx).toBe(RUN_SPEED)
    expect(runner.action).toBe(Action.Run)
  })

  it('대각선으로 움직여도 속도는 같다', () => {
    const p = makePlayer()
    run(p, { mx: 127, mz: 127, held: 0, pressed: 0 }, 30)
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(WALK_SPEED, 9)
  })

  it('입력 방향을 바로 바라본다', () => {
    const p = makePlayer()
    stepPlayer(p, LEFT, DT)
    expect(p.fx).toBe(-1)
    expect(p.fz).toBe(0)
  })

  it('공중에서도 몸은 바로 돌지만 이동 방향은 천천히 바뀐다', () => {
    const p = makePlayer({ vx: WALK_SPEED, fx: 1, fz: 0, action: Action.Walk })
    stepPlayer(p, { ...RIGHT, pressed: Btn.Jump }, DT)
    stepPlayer(p, LEFT, DT)
    expect(p.action).toBe(Action.Air)
    expect(p.fx).toBe(-1)
    expect(p.vx).toBeGreaterThan(WALK_SPEED - 0.2)
  })

  it('점프하면 약 1.2m 올라갔다가 0.7초 뒤 착지한다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.Jump), DT)
    let peak = p.y
    let steps = 1
    while (p.y > 0 && steps < 200) {
      stepPlayer(p, IDLE_INPUT, DT)
      peak = Math.max(peak, p.y)
      steps++
    }
    expect(Math.abs(peak - JUMP_SPEED ** 2 / (2 * GRAVITY))).toBeLessThan(0.02)
    expect(steps).toBeGreaterThanOrEqual(41)
    expect(steps).toBeLessThanOrEqual(43)
    expect(p.y).toBe(0)
    expect(p.action).toBe(Action.Idle)
  })

  it('공중에서 다시 점프할 수 없다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.Jump), DT)
    run(p, IDLE_INPUT, 10)
    const vyBefore = p.vy
    stepPlayer(p, press(Btn.Jump), DT)
    expect(p.vy).toBeLessThan(vyBefore)
  })

  it('경기장 밖으로 걸어 나가면 떨어지고 다시 착지하지 못한다', () => {
    const p = makePlayer({ x: ARENA_HALF - 0.05 })
    run(p, RIGHT, 120)
    expect(p.action).toBe(Action.Falling)
    expect(p.y).toBeLessThan(FALL_OUT_Y)
  })

  it('가장자리 밖으로 뛰어도 바닥 높이 아래로 내려가기 전에 돌아오면 착지한다', () => {
    const p = makePlayer({ x: ARENA_HALF - 0.05 })
    stepPlayer(p, { ...RIGHT, pressed: Btn.Jump }, DT)
    run(p, RIGHT, 4)
    expect(p.x).toBeGreaterThan(ARENA_HALF)

    let steps = 0
    while (p.action === Action.Air && steps < 100) {
      stepPlayer(p, LEFT, DT)
      steps++
    }
    expect(p.y).toBe(0)
    expect(p.x).toBeLessThanOrEqual(ARENA_HALF)
  })
})

describe('stepPlayer 잽', () => {
  it('선딜 5프레임 뒤 3프레임 동안 판정을 내고 18프레임째에 끝난다', () => {
    const p = makePlayer()
    const queries = [stepPlayer(p, press(Btn.PunchL), DT)]
    for (let i = 1; i < 18; i++) queries.push(stepPlayer(p, IDLE_INPUT, DT))
    expect(p.action).toBe(Action.Jab)

    queries.push(stepPlayer(p, IDLE_INPUT, DT))
    expect(p.action).toBe(Action.Idle)
    expect(queries.flatMap((q, i) => (q ? [i] : []))).toEqual([5, 6, 7])
    expect(queries[5]?.first).toBe(true)
    expect(queries[6]?.first).toBe(false)
  })

  it('판정은 바라보는 방향 앞, 펀치 높이에 생긴다', () => {
    const p = makePlayer({ fx: 1, fz: 0 })
    stepPlayer(p, press(Btn.PunchL), DT)
    let query: HitQuery | null = null
    for (let i = 0; i < 5; i++) query = stepPlayer(p, IDLE_INPUT, DT)
    expect(query).toEqual({
      attack: 'jab', first: true,
      x: ATTACKS.jab.reach, y: ATTACKS.jab.height, z: 0, r: ATTACKS.jab.radius,
    })
  })

  it('공격 중에는 이동 입력을 무시한다', () => {
    const p = makePlayer()
    stepPlayer(p, press(Btn.PunchL), DT)
    run(p, RIGHT, 10)
    expect(p.x).toBe(0)
    expect(p.fz).toBe(1)
  })
})
