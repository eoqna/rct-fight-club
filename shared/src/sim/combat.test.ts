import { describe, expect, it } from 'vitest'
import { Action } from '../actions.ts'
import { ATTACKS } from '../attacks.ts'
import { BODY_HEIGHT, BODY_RADIUS, TICK_RATE } from '../constants.ts'
import { applyHit, type Hittable } from './combat.ts'
import { hitsBody } from './hit.ts'
import { makePlayer } from './fixtures.ts'
import { IDLE_INPUT, stepPlayer } from './player.ts'

const DT = 1 / TICK_RATE

const target = (overrides: Partial<Hittable> = {}): Hittable => ({ ...makePlayer(), hp: 100, ...overrides })

function slide(p: Hittable) {
  for (let i = 0; i < 120 && (p.vx !== 0 || p.vz !== 0); i++) stepPlayer(p, IDLE_INPUT, DT)
}

describe('applyHit', () => {
  it('맞으면 HP가 줄고 공격자 반대쪽으로 정해진 거리만큼 밀려난다', () => {
    const p = target()
    applyHit(p, { x: 0, z: -1, fx: 0, fz: 1 }, ATTACKS.jab)
    expect(p.hp).toBe(100 - ATTACKS.jab.damage)
    expect(p.action).toBe(Action.Hitstun)

    slide(p)
    expect(p.z).toBeCloseTo(ATTACKS.jab.knockback, 2)
    expect(p.x).toBe(0)
  })

  it('경직 동안에는 입력을 무시하고, 끝나면 다시 움직인다', () => {
    const p = target()
    applyHit(p, { x: 0, z: -1, fx: 0, fz: 1 }, ATTACKS.jab)
    const right = { mx: 127, mz: 0, held: 0, pressed: 0 }
    for (let i = 0; i < ATTACKS.jab.hitstun - 1; i++) stepPlayer(p, right, DT)
    expect(p.action).toBe(Action.Hitstun)
    expect(p.vx).toBe(0)

    stepPlayer(p, right, DT)
    expect(p.action).toBe(Action.Idle)
    stepPlayer(p, right, DT)
    expect(p.vx).toBeGreaterThan(0)
  })

  it('겹쳐 서 있으면 공격자가 바라보는 방향으로 밀린다', () => {
    const p = target()
    applyHit(p, { x: 0, z: 0, fx: 1, fz: 0 }, ATTACKS.jab)
    expect(p.vx).toBeGreaterThan(0)
    expect(p.vz).toBe(0)
  })

  it('HP는 0 아래로 내려가지 않는다', () => {
    const p = target({ hp: 3 })
    applyHit(p, { x: 0, z: -1, fx: 0, fz: 1 }, ATTACKS.jab)
    expect(p.hp).toBe(0)
  })
})

describe('hitsBody', () => {
  const sphere = { x: 0, y: 1.3, z: 0.9, r: 0.35 }

  it('수평 거리가 두 반지름의 합 안이면 맞는다', () => {
    expect(hitsBody(sphere, 0, 0, 0.9 + sphere.r + BODY_RADIUS - 0.01)).toBe(true)
    expect(hitsBody(sphere, 0, 0, 0.9 + sphere.r + BODY_RADIUS + 0.01)).toBe(false)
  })

  it('높이 범위가 겹치지 않으면 맞지 않는다', () => {
    expect(hitsBody(sphere, 0, 1.3 + sphere.r + 0.01, 0.9)).toBe(false)
    expect(hitsBody(sphere, 0, 1.3 - sphere.r - BODY_HEIGHT - 0.01, 0.9)).toBe(false)
    expect(hitsBody(sphere, 0, 0.5, 0.9)).toBe(true)
  })
})
