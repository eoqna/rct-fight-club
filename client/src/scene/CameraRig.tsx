import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { createPose, type GameSession } from '../game/session.ts'
import type { EffectsSystem } from './effects.ts'

const DISTANCE = 16
const PITCH = (55 * Math.PI) / 180
/** 쿼터뷰: 수평 회전 없이 +z 쪽 위에서 내려다본다 → 화면 ↑ = -z, → = +x (design §7.5) */
const OFFSET = new Vector3(0, DISTANCE * Math.sin(PITCH), DISTANCE * Math.cos(PITCH))
const FOLLOW_RATE = 6

const pose = createPose()
const focus = new Vector3()
const target = new Vector3()

export function CameraRig({ session, effects }: { session: GameSession; effects: EffectsSystem }) {
  useFrame(({ camera }, delta) => {
    // 떨어질 때 카메라가 따라 내려가지 않도록 높이는 바닥에 고정한다
    if (session.pose(session.myId, pose)) target.set(pose.x, 0, pose.z)
    focus.lerp(target, 1 - Math.exp(-delta * FOLLOW_RATE))
    camera.position.copy(focus).add(OFFSET)
    camera.lookAt(focus)
    // 강타·KO 때의 흔들림은 바라보는 방향을 바꾸지 않고 위치만 옮긴다
    camera.position.add(effects.shakeOffset)
  })
  return null
}
