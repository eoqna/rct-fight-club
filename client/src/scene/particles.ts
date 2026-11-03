import { BufferAttribute, BufferGeometry, CanvasTexture, Points, SRGBColorSpace, ShaderMaterial, type Blending, type Color } from 'three'

/** 입자 하나의 처음 상태 (m, m/s, 초) */
export interface ParticleSpec {
  x: number
  y: number
  z: number
  vx?: number
  vy?: number
  vz?: number
  /** 지름 (m)과 초당 커지는 양 (m/s) */
  size: number
  grow?: number
  life: number
  color: Color
  alpha?: number
  /** 아래로 끌어당기는 가속도 (m/s²)와 속도가 줄어드는 비율 (1/s) */
  gravity?: number
  drag?: number
}

const vertexShader = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`
const fragmentShader = /* glsl */ `
uniform sampler2D map;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  #include <colorspace_fragment>
}
`

/**
 * 고정 크기 입자 풀 — 그리기 호출 1번, 화면을 향한 점 스프라이트. 가득 차면 가장 오래된 입자 자리에 새로 쓴다.
 * 오래 플레이해도 객체가 늘지 않는다 (design §7.5)
 */
export class ParticlePool {
  readonly points: Points
  private readonly capacity: number
  private readonly positions: Float32Array
  private readonly sizes: Float32Array
  private readonly colors: Float32Array
  private readonly velocity: Float32Array
  private readonly state: Float32Array
  private readonly material: ShaderMaterial
  private next = 0

  constructor(capacity: number, map: CanvasTexture, blending: Blending) {
    this.capacity = capacity
    this.positions = new Float32Array(capacity * 3)
    this.sizes = new Float32Array(capacity)
    this.colors = new Float32Array(capacity * 4)
    this.velocity = new Float32Array(capacity * 3)
    // 입자마다 [남은 수명, 전체 수명, 커지는 양, 중력, 감속, 처음 불투명도]
    this.state = new Float32Array(capacity * 6)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    geometry.setAttribute('aSize', new BufferAttribute(this.sizes, 1))
    geometry.setAttribute('aColor', new BufferAttribute(this.colors, 4))
    this.material = new ShaderMaterial({
      uniforms: { map: { value: map }, uScale: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending,
    })
    this.points = new Points(geometry, this.material)
    this.points.frustumCulled = false
  }

  spawn(p: ParticleSpec) {
    const i = this.next
    this.next = (this.next + 1) % this.capacity
    const v = i * 3, c = i * 4, s = i * 6
    this.positions[v] = p.x
    this.positions[v + 1] = p.y
    this.positions[v + 2] = p.z
    this.velocity[v] = p.vx ?? 0
    this.velocity[v + 1] = p.vy ?? 0
    this.velocity[v + 2] = p.vz ?? 0
    this.sizes[i] = p.size
    this.colors[c] = p.color.r
    this.colors[c + 1] = p.color.g
    this.colors[c + 2] = p.color.b
    this.colors[c + 3] = p.alpha ?? 1
    this.state[s] = this.state[s + 1] = p.life
    this.state[s + 2] = p.grow ?? 0
    this.state[s + 3] = p.gravity ?? 0
    this.state[s + 4] = p.drag ?? 0
    this.state[s + 5] = p.alpha ?? 1
  }

  /** dt초만큼 움직이고 흐리게 한다. scale = 화면 높이(픽셀) / (2·tan(시야각/2)) */
  update(dt: number, scale: number) {
    this.material.uniforms.uScale.value = scale
    const { positions, velocity, sizes, colors, state } = this
    for (let i = 0; i < this.capacity; i++) {
      const s = i * 6
      if (state[s] <= 0) continue
      state[s] -= dt
      if (state[s] <= 0) {
        sizes[i] = 0
        colors[i * 4 + 3] = 0
        continue
      }
      const v = i * 3
      const damp = Math.max(0, 1 - state[s + 4] * dt)
      velocity[v] *= damp
      velocity[v + 1] = velocity[v + 1] * damp - state[s + 3] * dt
      velocity[v + 2] *= damp
      positions[v] += velocity[v] * dt
      positions[v + 1] += velocity[v + 1] * dt
      positions[v + 2] += velocity[v + 2] * dt
      sizes[i] += state[s + 2] * dt
      // 수명의 뒤 절반 동안 사라진다
      colors[i * 4 + 3] = state[s + 5] * Math.min(1, (2 * state[s]) / state[s + 1])
    }
    const geometry = this.points.geometry
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aColor.needsUpdate = true
  }

  /** 살아 있는 입자 수 (점검용) */
  alive(): number {
    let n = 0
    for (let i = 0; i < this.capacity; i++) if (this.state[i * 6] > 0) n++
    return n
  }

  dispose() {
    this.points.geometry.dispose()
    this.material.dispose()
  }
}

/** 입자 모양: 별빛(타격), 부드러운 덩어리(먼지), 고리(가드) — 흰색으로 그리고 입자 색을 곱한다 */
export function createParticleTexture(kind: 'spark' | 'puff' | 'ring'): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다')
  const c = size / 2
  if (kind === 'ring') {
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(c, c, c - 6, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c)
    glow.addColorStop(0, 'rgb(255 255 255 / 1)')
    glow.addColorStop(kind === 'spark' ? 0.25 : 0.5, `rgb(255 255 255 / ${kind === 'spark' ? 0.7 : 0.8})`)
    glow.addColorStop(1, 'rgb(255 255 255 / 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, size, size)
    if (kind === 'spark') {
      // 네 갈래 빛줄기
      ctx.fillStyle = 'white'
      ctx.beginPath()
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        ctx.moveTo(c + dy * 3, c - dx * 3)
        ctx.lineTo(c + dx * (c - 2), c + dy * (c - 2))
        ctx.lineTo(c - dy * 3, c + dx * 3)
      }
      ctx.fill()
    }
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}
