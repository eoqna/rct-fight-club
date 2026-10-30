import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, Mesh } from 'three'
import { BODY_HEIGHT, BODY_RADIUS } from '@fight-club/shared'
import { createPose, type GameSession } from '../game/session.ts'

const pose = createPose()

/** 디버그: 서버가 본 내 위치(초록 상자)와 내 잽 판정(빨간 구) */
export function DebugVisuals({ session }: { session: GameSession }) {
  const ghost = useRef<Group>(null)
  const hitbox = useRef<Mesh>(null)

  useFrame(() => {
    if (!ghost.current || !hitbox.current) return
    const server = session.debugDraw ? session.serverPose(pose) : null
    ghost.current.visible = server !== null
    if (server) ghost.current.position.set(server.x, server.y, server.z)

    const box = session.debugDraw ? session.myHitbox() : null
    hitbox.current.visible = box !== null
    if (box) {
      hitbox.current.position.set(box.x, box.y, box.z)
      hitbox.current.scale.setScalar(box.r)
    }
  })

  return (
    <>
      <group ref={ghost} visible={false}>
        <mesh position-y={BODY_HEIGHT / 2}>
          <boxGeometry args={[BODY_RADIUS * 2, BODY_HEIGHT, BODY_RADIUS * 2]} />
          <meshBasicMaterial color="#7cffb2" wireframe />
        </mesh>
      </group>
      <mesh ref={hitbox} visible={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#ff4d6d" transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </>
  )
}
