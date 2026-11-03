import { Action, Btn } from '../actions.ts'
import { ATTACKS, DASH_DISTANCE, GRAB, KICK_COOLDOWN, THROW, type AttackId } from '../attacks.ts'
import {
  AIM_ASSIST_COS, AIM_ASSIST_RANGE, AIR_ACCEL, ARENA_HALF, BODY_HEIGHT, BODY_RADIUS, GETUP_INVULN_FRAMES, GRAVITY,
  INPUT_BUFFER_FRAMES, JUMP_SPEED, KNOCKBACK_DECEL, KNOCKDOWN_FRAMES, MOVE_ACCEL, RUN_SPEED, WALK_SPEED,
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
  /** 경직 길이 (프레임) */
  stun: number
  /** 선입력된 다음 동작 (0 = 없음) */
  buffered: number
  /** 남은 무적 프레임 */
  invuln: number
  /** 다시 찰 수 있을 때까지 남은 프레임 (발차기·날아차기) */
  kickCooldown: number
  /** 다시 잡을 수 있을 때까지 남은 프레임 */
  grabCooldown: number
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

export interface StepEnv {
  /** 부딪힐 다른 몸들. p 자신이 섞여 있어도 된다 (같은 객체는 건너뛴다) */
  bodies?: Iterable<Body>
  /** 조준 보정에 쓸 상대 위치. 공격·잡기를 시작하는 스텝에서만 부른다 */
  aimTargets?: () => Iterable<Body>
}

/** 공격 판정 프레임마다 나온다. 서버가 랙 보상으로 판정한다 — design §4.12 */
export interface HitQuery {
  kind: 'hit'
  attack: AttackId
  /** 이번 공격의 첫 판정 프레임 — 대상당 1회 명중 기록을 새로 시작하는 시점 */
  first: boolean
  x: number
  y: number
  z: number
  r: number
}

/** 잡기 판정 프레임마다 나온다 */
export interface GrabQuery {
  kind: 'grab'
  first: boolean
  x: number
  y: number
  z: number
  r: number
}

/** 던지는 동작에서 상대를 놓는 순간 */
export interface ThrowRelease {
  kind: 'throw'
}

export type StepEvent = HitQuery | GrabQuery | ThrowRelease

/** 두 몸 중심 사이의 최소 거리 */
const BODY_GAP = BODY_RADIUS * 2

const ATTACK_OF: Partial<Record<number, AttackId>> = {
  [Action.Jab]: 'jab',
  [Action.Straight]: 'straight',
  [Action.Kick]: 'kick',
  [Action.Dash]: 'dash',
  [Action.FlyingKick]: 'flyingKick',
}

export function attackOf(action: number): AttackId | undefined {
  return ATTACK_OF[action]
}

export function isInsideArena(x: number, z: number): boolean {
  return Math.abs(x) <= ARENA_HALF && Math.abs(z) <= ARENA_HALF
}

/**
 * 플레이어를 고정 스텝 하나만큼 진행한다. 클라이언트 예측과 서버가 같은 함수를 부르므로
 * 사칙연산과 Math.sqrt만 쓴다 (엔진 간 결과 동일) — design §4.10
 *
 * 다른 플레이어에게 미치는 효과(명중·잡기·던지기)는 이벤트로 돌려주고 서버가 적용한다.
 */
export function stepPlayer(p: PlayerSim, input: InputLike, dt: number, env: StepEnv = {}): StepEvent | null {
  const grounded = p.y === 0 && isInsideArena(p.x, p.z)
  if (p.invuln > 0) p.invuln--
  if (p.kickCooldown > 0) p.kickCooldown--
  if (p.grabCooldown > 0) p.grabCooldown--
  let event: StepEvent | null = null

  switch (p.action) {
    case Action.Jab:
    case Action.Straight:
    case Action.Kick:
    case Action.Dash:
      stepAttack(p, input, grounded, dt, env)
      break
    case Action.FlyingKick:
      // 공중에서 내지른 방향 그대로 날아간다. 착지는 integrate가 처리한다
      p.actionFrame++
      break
    case Action.Landing:
      p.actionFrame++
      bufferAction(p, input, ATTACKS.flyingKick.recovery - p.actionFrame)
      if (grounded) approach(p, 0, 0, MOVE_ACCEL * dt)
      if (p.actionFrame >= ATTACKS.flyingKick.recovery) finish(p, grounded, dt, env)
      break
    case Action.Guard:
      if (grounded && input.held & Btn.Guard) {
        p.actionFrame++
        approach(p, 0, 0, MOVE_ACCEL * dt)
      } else {
        p.action = grounded ? Action.Idle : Action.Air
        p.actionFrame = 0
        control(p, input, grounded, dt, env)
      }
      break
    case Action.GuardStun:
      p.actionFrame++
      if (grounded) approach(p, 0, 0, KNOCKBACK_DECEL * dt)
      if (p.actionFrame >= p.stun) {
        p.action = grounded && input.held & Btn.Guard ? Action.Guard : Action.Idle
        p.actionFrame = 0
        p.stun = 0
      }
      break
    case Action.GrabTry:
      p.actionFrame++
      bufferAction(p, input, GRAB.startup + GRAB.active + GRAB.recovery - p.actionFrame)
      if (grounded) approach(p, 0, 0, MOVE_ACCEL * dt)
      if (p.actionFrame >= GRAB.startup + GRAB.active + GRAB.recovery) finish(p, grounded, dt, env)
      break
    case Action.Holding: {
      p.actionFrame++
      approach(p, 0, 0, MOVE_ACCEL * dt)
      // 방향을 고르면 그쪽으로, 시간이 지나면 바라보는 쪽으로 던진다
      const len = Math.sqrt(input.mx * input.mx + input.mz * input.mz)
      if (len > 0) {
        p.fx = input.mx / len
        p.fz = input.mz / len
      }
      if (len > 0 || p.actionFrame >= GRAB.holdFrames) {
        p.action = Action.Throwing
        p.actionFrame = 0
      }
      break
    }
    case Action.Throwing:
      p.actionFrame++
      approach(p, 0, 0, MOVE_ACCEL * dt)
      if (p.actionFrame === THROW.release) event = { kind: 'throw' }
      if (p.actionFrame >= THROW.release + THROW.recovery) finish(p, grounded, dt, env)
      break
    case Action.Grabbed:
      // 위치는 서버가 잡은 쪽 앞에 붙여 둔다
      p.actionFrame++
      p.vx = 0
      p.vz = 0
      break
    case Action.Thrown:
      p.actionFrame++
      if (grounded) approach(p, 0, 0, KNOCKBACK_DECEL * dt)
      if (p.actionFrame >= p.stun) {
        p.action = Action.Knockdown
        p.actionFrame = 0
        p.stun = 0
      }
      break
    case Action.Hitstun:
      p.actionFrame++
      if (grounded) approach(p, 0, 0, KNOCKBACK_DECEL * dt)
      if (p.actionFrame >= p.stun) finish(p, grounded, dt, env)
      break
    case Action.Knockdown:
      p.actionFrame++
      if (grounded) approach(p, 0, 0, KNOCKBACK_DECEL * dt)
      if (p.actionFrame >= KNOCKDOWN_FRAMES) {
        p.action = Action.Idle
        p.actionFrame = 0
        p.invuln = GETUP_INVULN_FRAMES
      }
      break
    case Action.KO:
      p.actionFrame++
      if (grounded) approach(p, 0, 0, KNOCKBACK_DECEL * dt)
      break
    case Action.Falling:
      break
    default:
      control(p, input, grounded, dt, env)
  }

  integrate(p, dt, env.bodies)
  return event ?? activeBox(p)
}

/** 지상·공중 이동과 행동 시작 (Idle·Walk·Run·Air) */
function control(p: PlayerSim, input: InputLike, grounded: boolean, dt: number, env: StepEnv) {
  const len = Math.sqrt(input.mx * input.mx + input.mz * input.mz)
  const dirX = len > 0 ? input.mx / len : 0
  const dirZ = len > 0 ? input.mz / len : 0

  // 공중에서도 입력 방향으로 바로 몸을 돌린다. 이동 방향은 공중 조작으로 천천히 바뀐다
  if (len > 0) {
    p.fx = dirX
    p.fz = dirZ
  }

  // 가드는 누르고 있는 동안 다른 행동보다 앞선다 (가드 중 공격 키는 무시)
  if (grounded && input.held & Btn.Guard) {
    p.action = Action.Guard
    p.actionFrame = 0
    approach(p, 0, 0, MOVE_ACCEL * dt)
    return
  }

  const next = pickAction(p, input.pressed, grounded, p.action === Action.Run)
  if (next) {
    startAction(p, next, grounded, dt, env)
    return
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

/**
 * 누른 버튼으로 시작할 행동. 여러 개면 잡기 > 발차기 > 오른손 > 왼손 순 — design §4.4
 * 달리는 중 공격은 돌진, 공중 발차기는 날아차기. 공중에서는 잡을 수 없다.
 * 쿨타임 중인 잡기·발차기는 없는 것으로 보고 다음 순서로 넘어간다
 */
function pickAction(p: PlayerSim, pressed: number, grounded: boolean, running: boolean): number {
  if (pressed & Btn.Grab && grounded && p.grabCooldown === 0) return Action.GrabTry
  if (pressed & Btn.Kick) {
    if (grounded && running) return Action.Dash
    if (p.kickCooldown === 0) return grounded ? Action.Kick : Action.FlyingKick
  }
  if (pressed & Btn.PunchR) return grounded && running ? Action.Dash : Action.Straight
  if (pressed & Btn.PunchL) return grounded && running ? Action.Dash : Action.Jab
  return 0
}

function startAction(p: PlayerSim, action: number, grounded: boolean, dt: number, env: StepEnv) {
  p.action = action
  p.actionFrame = 0
  p.stun = 0
  p.buffered = 0
  // 공격·잡기를 하면 무적이 풀린다 — design §4.8
  p.invuln = 0
  if (action === Action.Kick || action === Action.FlyingKick) p.kickCooldown = KICK_COOLDOWN
  if (action === Action.GrabTry) p.grabCooldown = GRAB.cooldown
  aimAtNearest(p, env)
  if (action === Action.Dash) {
    const speed = dashSpeed(dt)
    p.vx = p.fx * speed
    p.vz = p.fz * speed
  } else if (grounded) {
    approach(p, 0, 0, MOVE_ACCEL * dt)
  }
}

function stepAttack(p: PlayerSim, input: InputLike, grounded: boolean, dt: number, env: StepEnv) {
  const def = ATTACKS[ATTACK_OF[p.action] as AttackId]
  const total = def.startup + def.active + def.recovery
  p.actionFrame++
  bufferAction(p, input, total - p.actionFrame)
  if (p.action === Action.Dash) {
    // 선딜·판정 동안 내달리고, 판정이 끝나면 그 자리에 선다
    const speed = p.actionFrame < def.startup + def.active ? dashSpeed(dt) : 0
    p.vx = p.fx * speed
    p.vz = p.fz * speed
  } else if (grounded) {
    approach(p, 0, 0, MOVE_ACCEL * dt)
  }
  if (p.actionFrame >= total) finish(p, grounded, dt, env)
}

/** 후딜 마지막 몇 프레임 안에 누른 공격·잡기를 기억해 둔다 */
function bufferAction(p: PlayerSim, input: InputLike, remaining: number) {
  if (remaining <= 0 || remaining > INPUT_BUFFER_FRAMES || !input.pressed) return
  const next = pickAction(p, input.pressed, true, false)
  if (next) p.buffered = next
}

/** 동작을 끝낸다. 선입력이 있으면 바로 이어서 시작한다 */
function finish(p: PlayerSim, grounded: boolean, dt: number, env: StepEnv) {
  const next = p.buffered
  p.action = grounded ? Action.Idle : Action.Air
  p.actionFrame = 0
  p.stun = 0
  p.buffered = 0
  if (next) startAction(p, next, grounded, dt, env)
}

function dashSpeed(dt: number) {
  return DASH_DISTANCE / ((ATTACKS.dash.startup + ATTACKS.dash.active) * dt)
}

/** 조준 보정: 앞쪽 ±45°, 2m 안의 가장 가까운 상대 쪽으로 몸을 돌린다 — design §4.5 */
function aimAtNearest(p: PlayerSim, env: StepEnv) {
  if (!env.aimTargets) return
  let best = AIM_ASSIST_RANGE * AIM_ASSIST_RANGE
  let aimX = 0
  let aimZ = 0
  for (const t of env.aimTargets()) {
    if (t === p) continue
    const dx = t.x - p.x
    const dz = t.z - p.z
    const dist2 = dx * dx + dz * dz
    if (dist2 > best || dist2 < 1e-12) continue
    const dist = Math.sqrt(dist2)
    if ((dx * p.fx + dz * p.fz) / dist < AIM_ASSIST_COS) continue
    best = dist2
    aimX = dx / dist
    aimZ = dz / dist
  }
  if (aimX !== 0 || aimZ !== 0) {
    p.fx = aimX
    p.fz = aimZ
  }
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
    if (p.action === Action.Air) {
      p.action = Action.Idle
    } else if (p.action === Action.FlyingKick) {
      p.action = Action.Landing
      p.actionFrame = 0
    }
  } else if (p.y < 0 && p.action !== Action.Falling && p.action !== Action.KO) {
    p.action = Action.Falling
    p.actionFrame = 0
    p.stun = 0
    p.buffered = 0
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

/** 지금 판정 프레임이면 공격·잡기 판정을, 아니면 null을 돌려준다 */
export function activeBox(p: PlayerSim): HitQuery | GrabQuery | null {
  if (p.action === Action.GrabTry) {
    const frame = p.actionFrame - GRAB.startup
    if (frame < 0 || frame >= GRAB.active) return null
    return {
      kind: 'grab', first: frame === 0,
      x: p.x + p.fx * GRAB.reach, y: p.y + GRAB.height, z: p.z + p.fz * GRAB.reach, r: GRAB.radius,
    }
  }
  const attack = ATTACK_OF[p.action]
  if (attack === undefined) return null
  const def = ATTACKS[attack]
  const frame = p.actionFrame - def.startup
  if (frame < 0 || frame >= def.active) return null
  return {
    kind: 'hit', attack, first: frame === 0,
    x: p.x + p.fx * def.reach, y: p.y + def.height, z: p.z + p.fz * def.reach, r: def.radius,
  }
}
