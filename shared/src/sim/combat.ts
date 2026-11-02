import { Action } from '../actions.ts'
import { THROW, type StrikeDef } from '../attacks.ts'
import {
  GUARD_DAMAGE_RATE, GUARD_FRONT_COS, GUARD_KNOCKBACK_RATE, GUARD_STUN_FRAMES, KNOCKBACK_DECEL, TICK_RATE,
} from '../constants.ts'
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

export interface HitOptions {
  /** 정면 가드로 막았다 */
  guarded?: boolean
  /** 연속 피격으로 다운된다 */
  knockdown?: boolean
}

/**
 * 거리 d만큼 미끄러지게 하는 넉백 초속. 스텝마다 a·dt씩 감속하는 이산 적분이
 * 연속 공식보다 짧게 가는 만큼(반 스텝)을 보정한다 — design §4.6
 */
export function knockbackSpeed(distance: number): number {
  return Math.sqrt(2 * KNOCKBACK_DECEL * distance) + KNOCKBACK_DECEL / TICK_RATE / 2
}

/** 지금 맞을 수 있는가: 무적·다운·KO·낙하 중에는 맞지 않는다 — design §4.8 */
export function isHittable(p: PlayerSim): boolean {
  return p.invuln === 0 && p.action !== Action.Knockdown && p.action !== Action.KO && p.action !== Action.Falling
}

/** 지금 잡힐 수 있는가: 맞을 수 있고, 땅에 있고, 잡기에 얽혀 있지 않아야 한다 — design §4.7 */
export function isGrabbable(p: PlayerSim): boolean {
  return isHittable(p) && p.y === 0
    && p.action !== Action.Grabbed && p.action !== Action.Holding
    && p.action !== Action.Throwing && p.action !== Action.Thrown
}

/** 가드 중이고 공격자가 정면(바라보는 방향 ±70°)에 있는가 — design §4.5 */
export function isGuarding(p: { x: number; z: number; fx: number; fz: number; action: number }, fromX: number, fromZ: number): boolean {
  if (p.action !== Action.Guard && p.action !== Action.GuardStun) return false
  const dx = fromX - p.x
  const dz = fromZ - p.z
  const dist = Math.sqrt(dx * dx + dz * dz)
  if (dist < 1e-9) return true
  return (dx * p.fx + dz * p.fz) / dist >= GUARD_FRONT_COS
}

/**
 * 서버가 명중을 확정한 뒤 피격자에게 피해·넉백·경직을 적용하고, 준 피해를 돌려준다 — design §4.6
 * 가드면 피해 ×0.2(최소 1)·넉백 ×0.3·가드 경직, HP가 0이 되면 KO
 */
export function applyHit(target: Hittable, attacker: Attacker, strike: StrikeDef, options: HitOptions = {}): number {
  const damage = options.guarded ? Math.max(1, Math.round(strike.damage * GUARD_DAMAGE_RATE)) : strike.damage
  target.hp = Math.max(0, target.hp - damage)

  // 공격자 → 피격자 방향으로 민다. 겹쳐 서 있으면 공격자가 바라보는 방향으로
  let dx = target.x - attacker.x
  let dz = target.z - attacker.z
  if (dx * dx + dz * dz < 1e-12) {
    dx = attacker.fx
    dz = attacker.fz
  }
  push(target, dx, dz, options.guarded ? strike.knockback * GUARD_KNOCKBACK_RATE : strike.knockback)

  if (target.hp === 0) setState(target, Action.KO, 0)
  else if (target.action === Action.Falling) return damage
  else if (options.guarded) setState(target, Action.GuardStun, GUARD_STUN_FRAMES)
  else if (options.knockdown) setState(target, Action.Knockdown, 0)
  else setState(target, Action.Hitstun, strike.hitstun)
  return damage
}

/** 잡은 쪽이 바라보는 방향으로 던진다. 던져진 쪽은 미끄러진 뒤 다운된다 — design §4.7 */
export function applyThrow(target: Hittable, holder: Attacker): number {
  target.hp = Math.max(0, target.hp - THROW.damage)
  push(target, holder.fx, holder.fz, THROW.knockback)
  if (target.hp === 0) setState(target, Action.KO, 0)
  else setState(target, Action.Thrown, THROW.hitstun)
  return THROW.damage
}

function push(target: PlayerSim, dirX: number, dirZ: number, distance: number) {
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1
  const speed = knockbackSpeed(distance)
  target.vx = (dirX / len) * speed
  target.vz = (dirZ / len) * speed
}

function setState(target: PlayerSim, action: number, stun: number) {
  target.action = action
  target.actionFrame = 0
  target.stun = stun
  target.buffered = 0
}
