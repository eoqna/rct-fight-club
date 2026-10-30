import { Action } from '../actions.ts'
import type { AttackDef } from '../attacks.ts'
import { KNOCKBACK_DECEL, TICK_RATE } from '../constants.ts'
import type { PlayerSim } from './player.ts'

export interface Hittable extends PlayerSim {
  hp: number
}

export interface Attacker {
  x: number
  z: number
  fx: number
  fz: number
}

/**
 * 거리 d만큼 미끄러지게 하는 넉백 초속. 스텝마다 a·dt씩 감속하는 이산 적분이
 * 연속 공식보다 짧게 가는 만큼(반 스텝)을 보정한다 — design §4.6
 */
export function knockbackSpeed(distance: number): number {
  return Math.sqrt(2 * KNOCKBACK_DECEL * distance) + KNOCKBACK_DECEL / TICK_RATE / 2
}

/** 서버가 명중을 확정한 뒤 피격자에게 피해·넉백·경직을 적용한다 — design §4.6 */
export function applyHit(target: Hittable, attacker: Attacker, attack: AttackDef): void {
  target.hp = Math.max(0, target.hp - attack.damage)

  let dx = target.x - attacker.x
  let dz = target.z - attacker.z
  let dist = Math.sqrt(dx * dx + dz * dz)
  if (dist < 1e-6) {
    dx = attacker.fx
    dz = attacker.fz
    dist = Math.sqrt(dx * dx + dz * dz) || 1
  }
  const speed = knockbackSpeed(attack.knockback)
  target.vx = (dx / dist) * speed
  target.vz = (dz / dist) * speed

  if (target.action !== Action.Falling) {
    target.action = Action.Hitstun
    target.actionFrame = 0
    target.stun = attack.hitstun
  }
}
