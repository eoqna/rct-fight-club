import { Action, Btn } from '../actions.ts'
import { ATTACKS, type AttackId } from '../attacks.ts'
import {
  AIR_ACCEL, ARENA_HALF, BODY_HEIGHT, BODY_RADIUS, GRAVITY, JUMP_SPEED, KNOCKBACK_DECEL, MOVE_ACCEL, RUN_SPEED,
  WALK_SPEED,
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

/** 부딪힐 수 있는 다른 몸의 발 위치 */
export interface Body {
  x: number
  y: number
  z: number
}

/** 두 몸 중심 사이의 최소 거리 */
const BODY_GAP = BODY_RADIUS * 2

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
 *
 * bodies: 부딪힐 다른 몸들. p 자신이 섞여 있어도 된다 (같은 객체는 건너뛴다)
 */
export function stepPlayer(p: PlayerSim, input: InputLike, dt: number, bodies?: Iterable<Body>): HitQuery | null {
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

  integrate(p, dt, bodies)
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

function integrate(p: PlayerSim, dt: number, bodies: Iterable<Body> | undefined) {
  p.x += p.vx * dt
  p.z += p.vz * dt
  if (bodies) separate(p, bodies)
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

/**
 * 다른 몸을 통과하지 못하게 한다: 겹친 만큼 나를 밀어내고, 그쪽으로 향하던 속도를 없앤다
 * (비스듬히 부딪히면 옆으로 미끄러진다). 상대는 밀지 않는다 — design §4.3
 */
function separate(p: PlayerSim, bodies: Iterable<Body>) {
  // 바닥 아래로 떨어지는 몸은 아무것과도 부딪히지 않는다
  if (p.y < 0) return
  const wasInside = isInsideArena(p.x, p.z)
  for (const b of bodies) {
    if (b === p) continue
    // 상대 위치는 전송 정밀도(float32)로 읽는다 — 서버 값과 클라이언트가 받은 값이 같아져 예측이 정확히 맞는다
    const by = Math.fround(b.y)
    if (by < 0 || Math.abs(p.y - by) >= BODY_HEIGHT) continue
    const dx = p.x - Math.fround(b.x)
    const dz = p.z - Math.fround(b.z)
    const dist2 = dx * dx + dz * dz
    if (dist2 >= BODY_GAP * BODY_GAP) continue
    const dist = Math.sqrt(dist2)
    // 정확히 같은 자리면 정해진 방향(+x)으로 밀어낸다
    const nx = dist > 1e-9 ? dx / dist : 1
    const nz = dist > 1e-9 ? dz / dist : 0
    p.x += nx * (BODY_GAP - dist)
    p.z += nz * (BODY_GAP - dist)
    const toward = p.vx * nx + p.vz * nz
    if (toward < 0) {
      p.vx -= toward * nx
      p.vz -= toward * nz
    }
  }
  // 몸에 밀려서는 경기장 밖으로 나가지 않는다 (스스로 걸어 나간 경우는 그대로 떨어진다)
  if (wasInside && !isInsideArena(p.x, p.z)) {
    p.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, p.x))
    p.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, p.z))
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
