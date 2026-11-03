import { AdditiveBlending, Color, NormalBlending, Vector3 } from 'three'
import type { SfxName } from '../game/sfx.gen.ts'
import { ParticlePool, createParticleTexture, type ParticleSpec } from './particles.ts'

const HIT_COLOR = new Color('#fff1a8')
const HEAVY_COLOR = new Color('#ffb347')
const GUARD_COLOR = new Color('#8fd0ff')
const DUST_COLOR = new Color('#d8c7a8')
const KO_COLOR = new Color('#ffe066')

/** 히트스톱: 강타에 공격자·피격자의 동작을 이만큼 멈춘다 (약 5프레임, ms) — design §7.5 */
const HITSTOP_MS = 85
/** 카메라 흔들림: 최대 흔들림 (m)과 줄어드는 빠르기 (1/s) */
const SHAKE_MAX = 0.6
const SHAKE_DECAY = 2.2

/**
 * 연출 모음: 타격·가드 스파크, 먼지, KO 폭발, 히트스톱, 카메라 흔들림.
 * 입자는 고정 크기 풀을 돌려쓰므로 오래 플레이해도 객체가 늘지 않는다 (design §7.5)
 */
export class EffectsSystem {
  readonly sparks = new ParticlePool(96, createParticleTexture('spark'), AdditiveBlending)
  readonly dust = new ParticlePool(64, createParticleTexture('puff'), NormalBlending)
  readonly rings = new ParticlePool(16, createParticleTexture('ring'), AdditiveBlending)
  /** 카메라에 더할 흔들림 — update가 매 프레임 쓴다 */
  readonly shakeOffset = new Vector3()
  private readonly stops = new Map<string, number>()
  private readonly myId: string
  private trauma = 0
  private time = 0
  /** spawn에 넘길 값을 담아 돌려쓰는 그릇 (입자마다 객체를 만들지 않는다) */
  private readonly p: ParticleSpec = { x: 0, y: 0, z: 0, size: 0, life: 0, color: HIT_COLOR }
  private readonly onSound: (name: SfxName, x: number, z: number) => void
  /** 입자 수 배율 (모바일 품질 단계는 절반) */
  private readonly density: number

  /** onSound: 효과음을 내는 쪽 (없으면 소리 없이 그림만), density: 입자 수 배율 */
  constructor(myId: string, onSound: (name: SfxName, x: number, z: number) => void = () => {}, density = 1) {
    this.myId = myId
    this.onSound = onSound
    this.density = density
  }

  /** 품질 단계에 맞춘 입자 수 (적어도 1개) */
  private count(n: number): number {
    return Math.max(1, Math.round(n * this.density))
  }

  /** 그 자리에서 효과음 */
  sound(name: SfxName, x: number, z: number) {
    this.onSound(name, x, z)
  }

  /** 맞은 자리: 번쩍임과 사방으로 튀는 불티. 강타는 크고 주황빛이다 */
  hit(x: number, y: number, z: number, heavy: boolean) {
    this.sound(heavy ? 'hitHeavy' : 'hit', x, z)
    const color = heavy ? HEAVY_COLOR : HIT_COLOR
    this.emit(this.sparks, x, y, z, 0, 0, 0, heavy ? 1.9 : 1.2, 2, 0.12, color, 1, 0, 0)
    for (let i = 0, n = this.count(heavy ? 10 : 6); i < n; i++) this.shard(this.sparks, x, y, z, heavy ? 7 : 5, color)
  }

  /** 가드로 막은 자리: 파란 고리가 퍼지고 불티가 조금 튄다 */
  guard(x: number, y: number, z: number) {
    this.sound('guard', x, z)
    this.emit(this.rings, x, y, z, 0, 0, 0, 0.5, 5, 0.22, GUARD_COLOR, 1, 0, 0)
    this.emit(this.sparks, x, y, z, 0, 0, 0, 0.9, 1, 0.1, GUARD_COLOR, 1, 0, 0)
    for (let i = 0, n = this.count(4); i < n; i++) this.shard(this.sparks, x, y, z, 4, GUARD_COLOR)
  }

  /** 발밑 먼지 count덩이 (착지·돌진·미끄러짐) */
  puff(x: number, z: number, count: number, spread = 0.4) {
    for (let i = 0, n = this.count(count); i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread
      const speed = 0.4 + Math.random() * 0.8
      this.emit(this.dust, x + Math.cos(a) * r, 0.15, z + Math.sin(a) * r,
        Math.cos(a) * speed, 0.3 + Math.random() * 0.4, Math.sin(a) * speed,
        0.45 + Math.random() * 0.35, 1.1, 0.45 + Math.random() * 0.35, DUST_COLOR, 0.55, 0, 2.5)
    }
  }

  /** KO: 큰 번쩍임, 노란 불티, 둥글게 퍼지는 먼지 */
  ko(x: number, y: number, z: number) {
    this.sound('ko', x, z)
    this.emit(this.sparks, x, y, z, 0, 0, 0, 3, 4, 0.2, KO_COLOR, 1, 0, 0)
    this.emit(this.rings, x, y, z, 0, 0, 0, 1, 9, 0.3, KO_COLOR, 1, 0, 0)
    for (let i = 0, n = this.count(16); i < n; i++) this.shard(this.sparks, x, y, z, 8, KO_COLOR)
    this.puff(x, z, 10, 0.8)
  }

  /** 명중: 강타면 공격자·피격자의 동작을 잠깐 멈춘다. 내가 맞았거나 내 강타면 화면을 흔든다 */
  impact(attacker: string, victim: string, heavy: boolean, guarded: boolean, now: number) {
    if (heavy && !guarded) {
      this.stops.set(attacker, now + HITSTOP_MS)
      this.stops.set(victim, now + HITSTOP_MS)
    }
    if (victim === this.myId) this.shake(guarded ? 0.15 : heavy ? 0.55 : 0.3)
    else if (attacker === this.myId && heavy) this.shake(guarded ? 0.1 : 0.3)
  }

  /** 히트스톱 중인가 */
  isStopped(id: string, now: number): boolean {
    return (this.stops.get(id) ?? 0) > now
  }

  /** 화면 흔들림을 더한다 (0~1) */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  /** 그 캐릭터가 나라면 화면을 흔든다 */
  shakeIfMe(id: string, amount: number) {
    if (id === this.myId) this.shake(amount)
  }

  /** 매 프레임: 입자를 진행하고 흔들림을 줄인다. scale = 화면 높이(픽셀) / (2·tan(시야각/2)) */
  update(dt: number, scale: number) {
    this.sparks.update(dt, scale)
    this.dust.update(dt, scale)
    this.rings.update(dt, scale)
    this.time += dt
    this.trauma = Math.max(0, this.trauma - SHAKE_DECAY * dt)
    // 흔들림은 세기의 제곱으로 — 약한 흔들림은 아주 작게, 강한 흔들림은 크게
    const amp = SHAKE_MAX * this.trauma * this.trauma
    const t = this.time
    this.shakeOffset.set(
      amp * (Math.sin(t * 61) * 0.6 + Math.sin(t * 97 + 1.7) * 0.4),
      amp * 0.6 * (Math.sin(t * 73 + 0.5) * 0.6 + Math.sin(t * 111 + 2.3) * 0.4),
      amp * (Math.sin(t * 67 + 2.9) * 0.6 + Math.sin(t * 89 + 0.8) * 0.4),
    )
  }

  /** 살아 있는 입자 수 (점검용) */
  alive() {
    return { sparks: this.sparks.alive(), dust: this.dust.alive(), rings: this.rings.alive() }
  }

  dispose() {
    this.sparks.dispose()
    this.dust.dispose()
    this.rings.dispose()
  }

  /** 위로 치우쳐 사방으로 튀는 불티 하나 */
  private shard(pool: ParticlePool, x: number, y: number, z: number, speed: number, color: Color) {
    const a = Math.random() * Math.PI * 2
    const up = 0.2 + Math.random() * 0.8
    const v = speed * (0.6 + Math.random() * 0.4)
    const flat = v * (1 - up * 0.5)
    this.emit(pool, x, y, z, Math.cos(a) * flat, up * v, Math.sin(a) * flat, 0.16 + Math.random() * 0.08, -0.2, 0.22 + Math.random() * 0.18, color, 1, 12, 1.5)
  }

  private emit(
    pool: ParticlePool, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    size: number, grow: number, life: number, color: Color, alpha: number, gravity: number, drag: number,
  ) {
    const p = this.p
    p.x = x
    p.y = y
    p.z = z
    p.vx = vx
    p.vy = vy
    p.vz = vz
    p.size = size
    p.grow = grow
    p.life = life
    p.color = color
    p.alpha = alpha
    p.gravity = gravity
    p.drag = drag
    pool.spawn(p)
  }
}
