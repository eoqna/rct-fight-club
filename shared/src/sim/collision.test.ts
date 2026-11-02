import { describe, expect, it } from 'vitest'
import { ARENA_HALF, BODY_RADIUS, TICK_RATE } from '../constants.ts'
import { makePlayer } from './fixtures.ts'
import { IDLE_INPUT, stepPlayer, type InputLike } from './player.ts'

const DT = 1 / TICK_RATE
const GAP = BODY_RADIUS * 2
const RIGHT: InputLike = { mx: 127, mz: 0, held: 0, pressed: 0 }
const body = (x: number, z = 0, y = 0) => ({ x, y, z })

describe('몸끼리 부딪힘', () => {
  it('다른 몸을 통과하지 못하고 맞닿은 자리에서 멈춘다. 상대는 밀리지 않는다', () => {
    const p = makePlayer()
    const other = body(1.5)
    for (let i = 0; i < 60; i++) stepPlayer(p, RIGHT, DT, [other])
    expect(p.x).toBeCloseTo(1.5 - GAP, 9)
    expect(p.vx).toBeCloseTo(0, 9)
    expect(other.x).toBe(1.5)
  })

  it('비스듬히 부딪히면 겹치지 않고 옆으로 미끄러진다', () => {
    const p = makePlayer()
    const other = body(1)
    let closest = Infinity
    for (let i = 0; i < 30; i++) {
      stepPlayer(p, { mx: 127, mz: 127, held: 0, pressed: 0 }, DT, [other])
      closest = Math.min(closest, Math.hypot(p.x - other.x, p.z - other.z))
    }
    expect(closest).toBeGreaterThanOrEqual(GAP - 1e-9)
    expect(p.z).toBeGreaterThan(0.5)
  })

  it('이미 겹쳐 있으면 밀려나 떨어진다', () => {
    const p = makePlayer({ x: 0.2 })
    stepPlayer(p, IDLE_INPUT, DT, [body(0)])
    expect(p.x).toBeCloseTo(GAP, 9)
  })

  it('높이가 겹치지 않거나 바닥 아래로 떨어지는 몸과는 부딪히지 않는다', () => {
    const p = makePlayer()
    for (let i = 0; i < 30; i++) stepPlayer(p, RIGHT, DT, [body(0.5, 0, -3), body(0.6, 0, 2)])
    expect(p.x).toBeGreaterThan(1)
  })

  it('몸에 밀려도 경기장 밖으로 나가지 않는다', () => {
    const p = makePlayer({ x: ARENA_HALF - 0.1 })
    stepPlayer(p, IDLE_INPUT, DT, [body(ARENA_HALF - 0.3)])
    expect(p.x).toBeLessThanOrEqual(ARENA_HALF)
    expect(p.y).toBe(0)
  })
})
