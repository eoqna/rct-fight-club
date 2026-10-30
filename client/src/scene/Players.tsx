import { useFrame } from '@react-three/fiber'
import { useRef, useSyncExternalStore } from 'react'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { ATTACKS, Action, BODY_HEIGHT, BODY_RADIUS } from '@fight-club/shared'
import { createPose, type GameSession } from '../game/session.ts'

const COLORS = { me: '#ff8a3d', other: '#4da3ff', bot: '#9aa4b5' }
const JAB = ATTACKS.jab

/** useFrame 콜백은 차례로 실행되므로 하나를 돌려써도 안전하다 */
const pose = createPose()

export function Players({ session }: { session: GameSession }) {
  const ids = useSyncExternalStore(session.subscribe, session.getPlayerIds)
  return ids.map((id) => {
    const color = id === session.myId ? COLORS.me : session.isBot(id) ? COLORS.bot : COLORS.other
    return <PlayerBox key={id} id={id} session={session} color={color} />
  })
}

function PlayerBox({ id, session, color }: { id: string; session: GameSession; color: string }) {
  const root = useRef<Group>(null)
  const body = useRef<MeshStandardMaterial>(null)
  const fist = useRef<Mesh>(null)

  useFrame(() => {
    if (!root.current || !body.current || !fist.current || !session.pose(id, pose)) return
    root.current.position.set(pose.x, pose.y, pose.z)
    root.current.rotation.y = pose.facing
    body.current.emissiveIntensity = pose.action === Action.Hitstun ? 0.9 : 0
    const reach = jabReach(pose.action, pose.actionFrame)
    fist.current.visible = reach !== null
    if (reach !== null) fist.current.position.z = reach
  })

  return (
    <group ref={root}>
      <mesh position-y={BODY_HEIGHT / 2}>
        <boxGeometry args={[BODY_RADIUS * 2, BODY_HEIGHT, BODY_RADIUS * 2]} />
        <meshStandardMaterial ref={body} color={color} emissive="#ffffff" emissiveIntensity={0} />
      </mesh>
      {/* 눈 — 바라보는 방향 */}
      <mesh position={[0, BODY_HEIGHT * 0.82, BODY_RADIUS]}>
        <boxGeometry args={[0.36, 0.1, 0.06]} />
        <meshBasicMaterial color="#10131c" />
      </mesh>
      <mesh ref={fist} position={[0.18, JAB.height, 0]} visible={false}>
        <boxGeometry args={[0.22, 0.22, 0.22]} />
        <meshStandardMaterial color="#ffe08a" emissive="#ffb000" emissiveIntensity={0.5} />
      </mesh>
    </group>
  )
}

/** 잽 중 주먹의 앞쪽 거리: 선딜에 당기고, 판정 동안 끝까지 뻗고, 후딜에 거둔다 */
function jabReach(action: number, frame: number): number | null {
  if (action !== Action.Jab) return null
  if (frame < JAB.startup) return BODY_RADIUS - 0.1 * (frame / JAB.startup)
  if (frame < JAB.startup + JAB.active) return JAB.reach
  const t = Math.min(1, (frame - JAB.startup - JAB.active) / JAB.recovery)
  return JAB.reach + (BODY_RADIUS - JAB.reach) * t
}
