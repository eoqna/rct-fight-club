import { Action, Btn } from '../actions.ts'
import { ATTACKS, type AttackId } from '../attacks.ts'
import {
  AIR_ACCEL, ARENA_HALF, GRAVITY, JUMP_SPEED, KNOCKBACK_DECEL, MOVE_ACCEL, RUN_SPEED, WALK_SPEED,
} from '../constants.ts'

/** stepPlayer가 다루는 상태. 서버의 PlayerState와 클라이언트 예측 미러가 모두 이 모양이다 */
export interface PlayerSim {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** 바라보는 방향 (단위 벡터) */
  fx: number
  fz: number
  action: number
  /** 현재 동작의 경과 프레임 */
  actionFrame: number
  /** 피격 경직 길이 (프레임) */
  stun: number
}

/** 한 스텝의 입력. 이동은 -127..127, 화면 기준 → 가 +x, ↓ 가 +z */
export interface InputLike {
  mx: number
  mz: number
  held: number
  pressed: number
}

export const IDLE_INPUT: InputLike = Object.freeze({ mx: 0, mz: 0, held: 0, pressed: 0 })

/** 판정 프레임마다 반환되는 질의. 서버가 랙 보상으로 판정한다 — design §4.12 */
export interface HitQuery {
  attack: AttackId
  /** 이번 공격의 첫 판정 프레임 — 대상당 1회 명중 기록을 새로 시작하는 시점 */
  first: boolean
  x: number
  y: number
  z: number
  r: number
}

const ATTACK_OF: Partial<Record<number, AttackId>> = { [Action.Jab]: 'jab' }

export function isInsideArena(x: number, z: number): boolean {
  return Math.abs(x) <= ARENA_HALF && Math.abs(z) <= ARENA_HALF
}

/**
 * 플레이어를 고정 스텝 하나만큼 진행한다. 클라이언트 예측과 서버가 같은 함수를 부르므로
 * 사칙연산과 Math.sqrt만 쓴다 (엔진 간 결과 동일) — design §4.10
 */
export function stepPlayer(p: PlayerSim, input: InputLike, dt: number): HitQuery | null {
  const grounded = p.y === 0 && isInsideArena(p.x, p.z)
  const attack = ATTACK_OF[p.action]

  if (attack !== undefined) {
    const { startup, active, recovery } = ATTACKS[attack]
    p.actionFrame++
    if (p.actionFrame >= startup + active + recovery) finishAction(p, grounded)
    if (grounded) approach(p, 0, 0, MOVE_ACCEL * dt)
  } else if (p.action === Action.Hitstun) {
    p.actionFrame++
    if (p.actionFrame >= p.stun) finishAction(p, grounded)
    if (grounded) approach(p, 0, 0, KNOCKBACK_DECEL * dt)
  } else if (p.action !== Action.Falling) {
    control(p, input, grounded, dt)
  }

  integrate(p, dt)
  return activeHitbox(p)
}

function control(p: PlayerSim, input: InputLike, grounded: boolean, dt: number) {
  if (input.pressed & Btn.PunchL) {
    p.action = Action.Jab
    p.actionFrame = 0
    if (grounded) approach(p, 0, 0, MOVE_ACCEL * dt)
    return
  }

  const len = Math.sqrt(input.mx * input.mx + input.mz * input.mz)
  const dirX = len > 0 ? input.mx / len : 0
  const dirZ = len > 0 ? input.mz / len : 0

  // 공중에서도 입력 방향으로 바로 몸을 돌린다. 이동 방향은 공중 조작으로 천천히 바뀐다
  if (len > 0) {
    p.fx = dirX
    p.fz = dirZ
  }

  if (!grounded) {
    steerInAir(p, dirX, dirZ, AIR_ACCEL * dt)
    p.action = Action.Air
    return
  }

  const running = (input.held & Btn.Run) !== 0
  const speed = running ? RUN_SPEED : WALK_SPEED
  approach(p, dirX * speed, dirZ * speed, MOVE_ACCEL * dt)

  if (input.pressed & Btn.Jump) {
    p.vy = JUMP_SPEED
    p.action = Action.Air
  } else {
    p.action = len === 0 ? Action.Idle : running ? Action.Run : Action.Walk
  }
}

function finishAction(p: PlayerSim, grounded: boolean) {
  p.action = grounded ? Action.Idle : Action.Air
  p.actionFrame = 0
  p.stun = 0
}

/** 수평 속도를 목표 속도 쪽으로 최대 maxDelta만큼 바꾼다 */
function approach(p: PlayerSim, targetX: number, targetZ: number, maxDelta: number) {
  const dx = targetX - p.vx
  const dz = targetZ - p.vz
  const dist = Math.sqrt(dx * dx + dz * dz)
  if (dist <= maxDelta) {
    p.vx = targetX
    p.vz = targetZ
  } else {
    p.vx += (dx / dist) * maxDelta
    p.vz += (dz / dist) * maxDelta
  }
}

/** 공중 조작: 수평 속도는 유지하고, 입력 방향으로 가속하되 원래 속도나 걷기 속도를 넘지 않는다 */
function steerInAir(p: PlayerSim, dirX: number, dirZ: number, maxDelta: number) {
  if (dirX === 0 && dirZ === 0) return
  const before = Math.sqrt(p.vx * p.vx + p.vz * p.vz)
  const limit = before > WALK_SPEED ? before : WALK_SPEED
  p.vx += dirX * maxDelta
  p.vz += dirZ * maxDelta
  const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz)
  if (speed > limit) {
    p.vx = (p.vx / speed) * limit
    p.vz = (p.vz / speed) * limit
  }
}

function integrate(p: PlayerSim, dt: number) {
  p.x += p.vx * dt
  p.z += p.vz * dt
  if (p.y === 0 && p.vy === 0 && isInsideArena(p.x, p.z)) return

  // 등가속도 운동의 정확한 적분 — 점프 궤적이 스텝 크기에 흔들리지 않는다
  const prevY = p.y
  p.y += p.vy * dt - 0.5 * GRAVITY * dt * dt
  p.vy -= GRAVITY * dt

  if (prevY >= 0 && p.y <= 0 && isInsideArena(p.x, p.z)) {
    p.y = 0
    p.vy = 0
    if (p.action === Action.Air) p.action = Action.Idle
  } else if (p.y < 0 && p.action !== Action.Falling) {
    p.action = Action.Falling
    p.actionFrame = 0
    p.stun = 0
  }
}

/** 지금 판정 프레임이면 히트박스를, 아니면 null을 돌려준다 */
export function activeHitbox(p: PlayerSim): HitQuery | null {
  const attack = ATTACK_OF[p.action]
  if (attack === undefined) return null
  const def = ATTACKS[attack]
  const frame = p.actionFrame - def.startup
  if (frame < 0 || frame >= def.active) return null
  return {
    attack,
    first: frame === 0,
    x: p.x + p.fx * def.reach,
    y: p.y + def.height,
    z: p.z + p.fz * def.reach,
    r: def.radius,
  }
}
