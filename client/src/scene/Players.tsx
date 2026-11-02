import { useFrame } from '@react-three/fiber'
import { useRef, useSyncExternalStore } from 'react'
import { Color, DoubleSide, type Group, type Mesh, type MeshStandardMaterial } from 'three'
import { ATTACKS, Action, BODY_HEIGHT, BODY_RADIUS, GRAB, GUARD_FRONT_COS, THROW } from '@fight-club/shared'
import { createPose, type GameSession } from '../game/session.ts'

const COLORS = { me: '#ff8a3d', other: '#4da3ff', bot: '#9aa4b5' }
const HIT_FLASH = new Color('#ffffff')
const GUARD_FLASH = new Color('#5fb4ff')
/** 가드 중 몸이 은은하게 파란 정도 */
const GUARD_GLOW = 0.3
/** 가드가 막는 앞쪽 각도 (140°) — 방패를 이만큼의 호로 그린다 */
const GUARD_ARC = 2 * Math.acos(GUARD_FRONT_COS)
const SHIELD_RADIUS = BODY_RADIUS + 0.2
/** 무적 중 깜빡이는 주기 (ms) */
const BLINK_MS = 90

/** 팔다리가 쉬는 자리와 선딜에 당기는 거리 (몸 중심에서 앞으로, m) */
const REST = BODY_RADIUS
const WINDUP = 0.1
/** 잡은 상대는 몸이 맞닿는 거리(몸 지름)에 붙는다. 손은 그 상대의 양옆을 쥔다 */
const GRIP_REACH = BODY_RADIUS * 2
const GRIP_X = BODY_RADIUS + 0.06
const HAND_X = 0.18
const FOOT_X = 0.12
const FLYING = ATTACKS.flyingKick

/** useFrame 콜백은 차례로 실행되므로 하나를 돌려써도 안전하다 */
const pose = createPose()
/** 앞으로 뻗은 거리 (m). null이면 숨긴다 */
const limbs = { left: null as number | null, right: null as number | null, foot: null as number | null, handX: 0, handY: 0 }

export function Players({ session }: { session: GameSession }) {
  const ids = useSyncExternalStore(session.subscribe, session.getPlayerIds)
  return ids.map((id) => {
    const color = id === session.myId ? COLORS.me : session.isBot(id) ? COLORS.bot : COLORS.other
    return <PlayerBox key={id} id={id} session={session} color={color} />
  })
}

function PlayerBox({ id, session, color }: { id: string; session: GameSession; color: string }) {
  const root = useRef<Group>(null)
  const body = useRef<Group>(null)
  const skin = useRef<MeshStandardMaterial>(null)
  const left = useRef<Mesh>(null)
  const right = useRef<Mesh>(null)
  const foot = useRef<Mesh>(null)
  const shield = useRef<Mesh>(null)

  useFrame(() => {
    if (!root.current || !body.current || !skin.current || !left.current || !right.current || !foot.current || !shield.current) return
    if (!session.pose(id, pose)) return
    root.current.position.set(pose.x, pose.y, pose.z)
    root.current.rotation.y = pose.facing

    const { action, actionFrame: frame } = pose
    // 다운·KO·던져짐은 등 뒤로 눕고, 잡히거나 맞으면 뒤로 젖힌다
    const lying = action === Action.KO || action === Action.Knockdown || action === Action.Thrown
    body.current.rotation.x = lying ? -Math.PI / 2 : action === Action.Grabbed ? -0.35 : action === Action.Hitstun ? -0.12 : 0
    body.current.position.y = lying ? BODY_RADIUS : 0

    // 맞으면 하얗게, 가드로 막으면 파랗게 번쩍인다. 가드 중에는 은은하게 파랗다
    const guarding = action === Action.Guard || action === Action.GuardStun
    const flash = action === Action.Hitstun ? HIT_FLASH : guarding ? GUARD_FLASH : null
    if (flash) skin.current.emissive.copy(flash)
    skin.current.emissiveIntensity = action === Action.Guard ? GUARD_GLOW : flash ? 0.9 * Math.max(0.25, 1 - frame / 10) : 0
    // 무적이면 반투명하게 깜빡인다
    skin.current.opacity = pose.invuln > 0 && Math.floor(performance.now() / BLINK_MS) % 2 === 0 ? 0.3 : 1

    shield.current.visible = guarding

    poseLimbs(action, frame)
    placeLimb(left.current, limbs.left, limbs.handX, limbs.handY)
    placeLimb(right.current, limbs.right, -limbs.handX, limbs.handY)
    placeLimb(foot.current, limbs.foot, -FOOT_X, ATTACKS.kick.height)
  })

  return (
    <group ref={root}>
      <group ref={body}>
        <mesh position-y={BODY_HEIGHT / 2}>
          <boxGeometry args={[BODY_RADIUS * 2, BODY_HEIGHT, BODY_RADIUS * 2]} />
          <meshStandardMaterial ref={skin} color={color} emissive="#ffffff" emissiveIntensity={0} transparent />
        </mesh>
        {/* 눈 — 바라보는 방향 */}
        <mesh position={[0, BODY_HEIGHT * 0.82, BODY_RADIUS]}>
          <boxGeometry args={[0.36, 0.1, 0.06]} />
          <meshBasicMaterial color="#10131c" />
        </mesh>
        <mesh ref={left} visible={false}>
          <boxGeometry args={[0.22, 0.22, 0.22]} />
          <meshStandardMaterial color="#ffe08a" emissive="#ffb000" emissiveIntensity={0.5} />
        </mesh>
        <mesh ref={right} visible={false}>
          <boxGeometry args={[0.22, 0.22, 0.22]} />
          <meshStandardMaterial color="#ffe08a" emissive="#ffb000" emissiveIntensity={0.5} />
        </mesh>
        <mesh ref={foot} visible={false}>
          <boxGeometry args={[0.2, 0.2, 0.32]} />
          <meshStandardMaterial color="#ffcf7a" emissive="#ff7a00" emissiveIntensity={0.5} />
        </mesh>
        {/* 가드 — 막는 각도만큼 앞을 감싸는 반투명 호 */}
        <mesh ref={shield} position-y={1.0} visible={false}>
          <cylinderGeometry args={[SHIELD_RADIUS, SHIELD_RADIUS, 1.5, 16, 1, true, -GUARD_ARC / 2, GUARD_ARC]} />
          <meshStandardMaterial
            color="#5fb4ff" emissive="#2b7fd4" emissiveIntensity={0.6}
            transparent opacity={0.45} side={DoubleSide} depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  )
}

function placeLimb(mesh: Mesh, reach: number | null, x: number, y: number) {
  mesh.visible = reach !== null
  if (reach !== null) mesh.position.set(x, y, reach)
}

/** 동작과 프레임으로 팔다리를 얼마나 뻗을지 정한다 — 판정 프레임에는 판정 위치까지 뻗는다 */
function poseLimbs(action: number, frame: number) {
  limbs.left = limbs.right = limbs.foot = null
  limbs.handX = HAND_X
  limbs.handY = ATTACKS.jab.height
  switch (action) {
    case Action.Jab:
      limbs.left = swing(ATTACKS.jab, frame)
      break
    case Action.Straight:
      limbs.right = swing(ATTACKS.straight, frame)
      break
    case Action.Kick:
      limbs.foot = swing(ATTACKS.kick, frame)
      break
    case Action.FlyingKick:
      limbs.foot = swing(FLYING, frame)
      break
    case Action.Landing:
      limbs.foot = retract(FLYING.reach, frame / FLYING.recovery)
      break
    case Action.Dash:
      limbs.left = limbs.right = swing(ATTACKS.dash, frame)
      limbs.handY = ATTACKS.dash.height
      break
    case Action.GrabTry:
      limbs.left = limbs.right = swing(GRAB, frame)
      limbs.handY = GRAB.height
      break
    case Action.Holding:
      limbs.left = limbs.right = GRIP_REACH
      limbs.handX = GRIP_X
      limbs.handY = GRAB.height
      break
    case Action.Throwing:
      limbs.left = limbs.right = frame < THROW.release ? GRIP_REACH : retract(GRIP_REACH, (frame - THROW.release) / THROW.recovery)
      limbs.handX = GRIP_X
      limbs.handY = GRAB.height
      break
  }
}

/** 선딜에 살짝 당기고, 판정 동안 끝까지 뻗고, 후딜에 거둔다 */
function swing(def: { startup: number; active: number; recovery: number; reach: number }, frame: number): number {
  if (frame < def.startup) return REST - WINDUP * (frame / def.startup)
  if (frame < def.startup + def.active) return def.reach
  return retract(def.reach, (frame - def.startup - def.active) / def.recovery)
}

function retract(reach: number, t: number): number {
  return reach + (REST - reach) * Math.min(1, t)
}
