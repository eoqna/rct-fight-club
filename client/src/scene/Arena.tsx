import { ARENA_HALF } from '@fight-club/shared'

const SIZE = ARENA_HALF * 2
const THICKNESS = 1.2
const EDGE = 0.18

/** 가장자리 띠 [x, z, 너비, 깊이] — 낭떠러지 경계가 한눈에 보이게 한다 (FR-15) */
const EDGES = [
  [0, -ARENA_HALF + EDGE / 2, SIZE, EDGE],
  [0, ARENA_HALF - EDGE / 2, SIZE, EDGE],
  [-ARENA_HALF + EDGE / 2, 0, EDGE, SIZE],
  [ARENA_HALF - EDGE / 2, 0, EDGE, SIZE],
] as const

export function Arena() {
  return (
    <group>
      <mesh position-y={-THICKNESS / 2}>
        <boxGeometry args={[SIZE, THICKNESS, SIZE]} />
        <meshStandardMaterial color="#3b4252" />
      </mesh>
      <gridHelper args={[SIZE, SIZE / 2, '#59637d', '#4a5266']} position-y={0.004} />
      {EDGES.map(([x, z, width, depth]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.008, z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial color="#f2c14e" />
        </mesh>
      ))}
    </group>
  )
}
