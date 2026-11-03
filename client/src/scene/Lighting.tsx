import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Vector3, type DirectionalLight } from 'three'
import { createPose, type GameSession } from '../game/session.ts'

/** 해는 오른쪽 위 앞에서 비춘다 (캐릭터 승인 때의 미리보기와 같은 방향·세기) */
const SUN_OFFSET = new Vector3(6, 14, 8)
/** 실시간 그림자를 그리는 범위 (내 캐릭터 둘레, m) — 좁을수록 그림자가 또렷하다 */
const SHADOW_HALF = 5

const pose = createPose()
const focus = new Vector3()

/**
 * 조명: 하늘·땅 반사광과 해. 해는 내 캐릭터를 따라다니며 내 캐릭터의 그림자만 실시간으로 드리운다 (모바일은 끈다).
 * 다른 캐릭터는 발밑의 원형 그림자를 쓴다 (design §7.8)
 */
export function Lighting({ session, shadows }: { session: GameSession; shadows: boolean }) {
  const sun = useRef<DirectionalLight>(null)

  useFrame(() => {
    const light = sun.current
    if (!light) return
    if (session.pose(session.myId, pose)) focus.set(pose.x, 0, pose.z)
    light.position.copy(focus).add(SUN_OFFSET)
    light.target.position.copy(focus)
    light.target.updateMatrixWorld()
  })

  return (
    <>
      <hemisphereLight args={['#dfe9ff', '#4a4150', 1.2]} />
      <directionalLight
        ref={sun}
        intensity={2}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
    </>
  )
}
