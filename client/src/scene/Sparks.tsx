import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Color, type Mesh, type MeshBasicMaterial } from 'three'
import { SPARK_LIFE_MS, type GameSession } from '../game/session.ts'

const POOL_SIZE = 16
const HIT_COLOR = new Color('#fff3b0')
const GUARD_COLOR = new Color('#8fd0ff')

/** 타격 이펙트 — 미리 만든 메시를 돌려쓴다. 가드로 막은 타격은 파랗다 */
export function Sparks({ session }: { session: GameSession }) {
  const meshes = useRef<(Mesh | null)[]>([])

  useFrame(() => {
    const now = performance.now()
    let used = 0
    for (const spark of session.sparks) {
      const age = now - spark.born
      if (age < 0 || age > SPARK_LIFE_MS || used >= POOL_SIZE) continue
      const mesh = meshes.current[used++]
      if (!mesh) continue
      const t = age / SPARK_LIFE_MS
      const material = mesh.material as MeshBasicMaterial
      mesh.visible = true
      mesh.position.set(spark.x, spark.y, spark.z)
      mesh.scale.setScalar(0.15 + 0.45 * t)
      material.color.copy(spark.guarded ? GUARD_COLOR : HIT_COLOR)
      material.opacity = 1 - t
    }
    for (let i = used; i < POOL_SIZE; i++) {
      const mesh = meshes.current[i]
      if (mesh) mesh.visible = false
    }
  })

  return Array.from({ length: POOL_SIZE }, (_, i) => (
    <mesh key={i} ref={(mesh) => { meshes.current[i] = mesh }} visible={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color={HIT_COLOR} transparent depthWrite={false} />
    </mesh>
  ))
}
