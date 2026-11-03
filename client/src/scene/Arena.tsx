import { useEffect, useMemo } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import { ARENA_HALF } from '@fight-club/shared'
import { createHazardTexture, createStoneTexture, seededRandom } from './arenaTextures.ts'

const SIZE = ARENA_HALF * 2
/** 바닥 타일 한 변 (m) */
const TILE = 2
/** 가장자리 띠 너비 (m) — 띠의 바깥 끝이 곧 낭떠러지다 */
const BAND = 0.4

/** 띠 [x, z, 너비, 깊이, 회전] — 줄무늬가 띠의 길이 방향으로 흐르게 돌린다 */
const EDGES = [
  [0, -ARENA_HALF + BAND / 2, SIZE, BAND, 0],
  [0, ARENA_HALF - BAND / 2, SIZE, BAND, 0],
  [-ARENA_HALF + BAND / 2, 0, SIZE, BAND, Math.PI / 2],
  [ARENA_HALF - BAND / 2, 0, SIZE, BAND, Math.PI / 2],
] as const

/** 하늘에 떠 있는 돌 경기장 — 돌 타일 바닥, 노랑·검정 가장자리 띠, 아래로 좁아지는 바위 밑동 (design §7.5) */
export function Arena() {
  const floor = useMemo(() => createStoneTexture(SIZE / TILE), [])
  const hazard = useMemo(() => {
    const t = createHazardTexture()
    t.repeat.set(SIZE / (BAND * 4), 1)
    return t
  }, [])
  const rock = useMemo(() => createRockGeometry(), [])
  useEffect(() => () => {
    floor.dispose()
    hazard.dispose()
    rock.dispose()
  }, [floor, hazard, rock])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[SIZE, SIZE]} />
        <meshStandardMaterial map={floor} roughness={0.95} />
      </mesh>
      {EDGES.map(([x, z, width, depth, rotation]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.01, z]} rotation={[-Math.PI / 2, 0, rotation]} receiveShadow>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial map={hazard} roughness={0.8} />
        </mesh>
      ))}
      <mesh geometry={rock}>
        <meshStandardMaterial vertexColors flatShading roughness={1} />
      </mesh>
    </group>
  )
}

/** 바위 밑동의 층: 깊이(m), 경기장 반 너비에 대한 비율, 흔들림(m), 색 */
const LAYERS = [
  { y: 0, scale: 1, jitter: 0, color: '#bfae92' },
  { y: -0.7, scale: 1, jitter: 0, color: '#a8977c' },
  { y: -1.8, scale: 0.9, jitter: 0.5, color: '#857766' },
  { y: -3.4, scale: 0.72, jitter: 0.8, color: '#6e6258' },
  { y: -5.2, scale: 0.5, jitter: 0.9, color: '#5c524b' },
  { y: -7.0, scale: 0.26, jitter: 0.7, color: '#4c4440' },
] as const
const TIP_Y = -9
/** 둘레를 나누는 점 수 (변마다) */
const SEGMENTS = 8

/**
 * 경기장 아래의 바위: 맨 위 두 층은 경기장 네모 그대로(돌판 두께), 그 아래는 둥글게 좁아지며 울퉁불퉁하다.
 * 면마다 평평하게 칠해 캐릭터와 같은 로우폴리 느낌을 낸다
 */
function createRockGeometry(): BufferGeometry {
  const rand = seededRandom(3)
  const perimeter = SEGMENTS * 4
  const rings = LAYERS.map((layer, k) => {
    const round = k / (LAYERS.length - 1)
    return Array.from({ length: perimeter }, (_, i) => {
      // 네모 둘레 위의 점과 같은 각도의 원 위의 점을 깊이에 따라 섞는다
      const side = Math.floor(i / SEGMENTS), t = (i % SEGMENTS) / SEGMENTS
      const edge = -1 + 2 * t
      const [sx, sz] = [[edge, -1], [1, edge], [-edge, 1], [-1, -edge]][side]
      const angle = Math.atan2(sz, sx)
      const half = ARENA_HALF * layer.scale
      const x = (sx * (1 - round) + Math.cos(angle) * Math.SQRT2 * round * 0.8) * half + (rand() - 0.5) * 2 * layer.jitter
      const z = (sz * (1 - round) + Math.sin(angle) * Math.SQRT2 * round * 0.8) * half + (rand() - 0.5) * 2 * layer.jitter
      return [x, layer.y + (k > 1 ? (rand() - 0.5) * layer.jitter : 0), z]
    })
  })
  const positions: number[] = []
  const colors: number[] = []
  const tint = new Color()
  const push = (p: number[], color: string) => {
    positions.push(p[0], p[1], p[2])
    tint.set(color)
    colors.push(tint.r, tint.g, tint.b)
  }
  for (let k = 0; k < rings.length - 1; k++) {
    const a = rings[k], b = rings[k + 1]
    for (let i = 0; i < perimeter; i++) {
      const j = (i + 1) % perimeter
      // 바깥에서 볼 때 반시계 (둘레는 위에서 볼 때 -x-z → +x-z → +x+z 순)
      for (const p of [a[i], a[j], b[i], a[j], b[j], b[i]]) push(p, LAYERS[k].color)
    }
  }
  const last = rings[rings.length - 1]
  const tip = [0, TIP_Y, 0]
  for (let i = 0; i < perimeter; i++) {
    for (const p of [last[i], last[(i + 1) % perimeter], tip]) push(p, LAYERS[LAYERS.length - 1].color)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}
