import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh, MeshBasicMaterial } from 'three'
import { SPARK_LIFE_MS, type GameSession } from '../game/session.ts'

const POOL_SIZE = 16

/** 타격 이펙트 — 미리 만든 메시를 돌려쓴다 */
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
      mesh.visible = true
      mesh.position.set(spark.x, spark.y, spark.z)
      mesh.scale.setScalar(0.15 + 0.45 * t)
      ;(mesh.material as MeshBasicMaterial).opacity = 1 - t
    }
    for (let i = used; i < POOL_SIZE; i++) {
      const mesh = meshes.current[i]
      if (mesh) mesh.visible = false
    }
  })

  return Array.from({ length: POOL_SIZE }, (_, i) => (
    <mesh key={i} ref={(mesh) => { meshes.current[i] = mesh }} visible={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#fff3b0" transparent depthWrite={false} />
    </mesh>
  ))
}
