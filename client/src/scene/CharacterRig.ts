import {
  AnimationMixer, CircleGeometry, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Quaternion, Vector3, type AnimationAction, type Object3D,
} from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ARENA_HALF, Action, BODY_RADIUS, GUARD_FRONT_COS, THROW, TICK_RATE } from '@fight-club/shared'
import {
  SEOI, THROWN_AIR_FRAMES, bowAngle, chooseClip, createClipChoice, createSeoiFlight, getupProgress, loadProgress, seoiFlight,
  type AnimInput, type ClipChoice,
} from '../game/animation.ts'
import type { ClipName } from '../game/assets.gen.ts'
import { MODEL_SCALE, characterAt, type CharacterModel } from '../game/characters.ts'
import type { Pose } from '../game/session.ts'
import type { CharacterAssets } from './characterAssets.ts'
import { cloneCharacterMaterial } from './characterMaterial.ts'
import type { EffectsSystem } from './effects.ts'

const HIT_FLASH = new Color('#ffffff')
const GUARD_FLASH = new Color('#5fb4ff')
/** 가드 중 몸이 은은하게 파란 정도 */
const GUARD_GLOW = 0.3
/** 무적 중 깜빡이는 주기 (ms)와 흐려질 때의 불투명도 */
const BLINK_MS = 90
const BLINK_OPACITY = 0.3
/** 이동 속도 추정을 따라가는 빠르기 (1/s)와 순간이동으로 볼 거리 (m) */
const SPEED_FOLLOW = 12
const TELEPORT = 3
/** 이 속도보다 빨리 오르면 점프 시작 동작 (m/s) */
const RISING_SPEED = 0.5
/** 던져진 쪽: 던진 쪽을 모를 때의 포물선 높이 (m)와, 공중제비·엎어치기의 회전 중심 높이 (m) */
const THROW_ARC_HEIGHT = 1.3
const FLIP_PIVOT = 0.9
/** 엎어치기 연출이 끊기거나 늦게 이어져 그림이 튈 때, 어긋난 만큼을 지우는 시간 (초) */
const SETTLE_TIME = 0.15
/** 잡혀 있는 자리를 새로 잡는 조건: 잡은 쪽이 바라보는 방향과의 차이 (rad) */
const HOLD_MATCH = 0.35
/** 연출에 쓰는 동작 프레임이 실제 프레임을 따라잡는 빠르기 (1/s) — 원격 프레임은 패치가 올 때마다 조금씩 튄다 */
const FOLLOW_RATE = 20
/** 던지는 쪽이 숙일 때 굽히는 뼈와 각도를 나눠 갖는 비율 */
const BOW_BONES: readonly (readonly [string, number])[] = [['spine', 0.45], ['chest', 0.55]]
const bowTurn = new Quaternion()
/** 가드가 막는 앞쪽 각도만큼의 반투명 호 */
const GUARD_ARC = 2 * Math.acos(GUARD_FRONT_COS)
/** 히트스톱 중 맞은 쪽이 떨리는 폭 (m) */
const STOP_JITTER = 0.05
/** 달릴 때 발밑 먼지 간격 (초)과, 밀려날 때 먼지를 남기는 속도 (m/s)·간격 (초) */
const STEP_DUST_EVERY = 0.24
const SLIDE_DUST_SPEED = 4
const SLIDE_DUST_EVERY = 0.07
/** 시작할 때 '휙' 소리가 나는 공격 */
const SWINGS: ReadonlySet<number> = new Set([Action.Jab, Action.Straight, Action.Kick, Action.Dash, Action.FlyingKick])
/** 맞는 쪽 동작 — 히트스톱 때 떨린다 */
const VICTIM_ACTIONS: ReadonlySet<number> = new Set([Action.Hitstun, Action.GuardStun, Action.Thrown, Action.Knockdown, Action.KO, Action.Grabbed])
const AIRBORNE: ReadonlySet<number> = new Set([Action.Air, Action.FlyingKick, Action.Falling])

/** 잡기·던지기 연출 단계: 잡혀 있음 · 업힘 · 엎어치기로 날아감 · 포물선(던진 쪽을 모를 때) · 등을 대고 누움 */
type ThrowPhase = 'none' | 'hold' | 'load' | 'seoi' | 'arc' | 'lie'

/** a에서 b로 가는 가장 짧은 각도 차 (−π, π] */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  else if (d <= -Math.PI) d += 2 * Math.PI
  return d
}

// 모든 캐릭터가 함께 쓰는 그림자·가드 표시
const shadowGeometry = new CircleGeometry(BODY_RADIUS * 1.1, 24).rotateX(-Math.PI / 2)
const shadowMaterial = new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false })
const shieldGeometry = new CylinderGeometry(BODY_RADIUS + 0.25, BODY_RADIUS + 0.25, 1.5, 16, 1, true, -GUARD_ARC / 2, GUARD_ARC)
const shieldMaterial = new MeshStandardMaterial({
  color: '#5fb4ff', emissive: '#2b7fd4', emissiveIntensity: 0.6, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false,
})

/**
 * 플레이어 한 명의 3D 캐릭터: 모델 복제, 애니메이션 구동, 피격·가드 번쩍임, 무적 깜빡임, 던져질 때의 포물선 — design §7.5
 * 애니메이션은 두 개까지 섞는다 (지금 클립 + 사라지는 앞 클립). 재생 위치는 동작·프레임에서 정한다 (animation.ts)
 */
export class CharacterRig {
  /** 시뮬레이션 위치·방향 */
  readonly root = new Group()
  /** 포물선·공중제비를 더하는 층 */
  private readonly flipper = new Group()
  private readonly model: Object3D
  private readonly mixer: AnimationMixer
  private readonly materials: MeshStandardMaterial[] = []
  private readonly shadow = new Mesh(shadowGeometry, shadowMaterial)
  private readonly shield = new Mesh(shieldGeometry, shieldMaterial)
  private readonly assets: CharacterAssets
  private readonly id: string
  private readonly effects: EffectsSystem
  private readonly look: CharacterModel
  private readonly choice: ClipChoice = createClipChoice()
  /** chooseClip에 넘길 값을 담아 돌려쓰는 그릇 (매 프레임 객체를 만들지 않는다) */
  private readonly input: AnimInput
  private current: AnimationAction | null = null
  private previous: AnimationAction | null = null
  private currentClip: ClipName | null = null
  private fade = 1
  private fadeSeconds = 0
  private lastAction = -1
  private lastFrame = 0
  private tracked = false
  private lastX = 0
  private lastY = 0
  private lastZ = 0
  private speed = 0
  private rising = false
  private translucent = false
  /** 실시간 그림자를 드리우면 발밑 원형 그림자는 끈다 */
  private castsShadow = false
  /** 다음 발밑 먼지까지 남은 시간 (초) */
  private dustTimer = 0
  /** 엎어치기: 잡혔을 때 잡은 쪽 방향, 업기 시작할 때 잡힌 쪽이 있던 방위·거리, 던져진 순간 던진 쪽 위치와 던진 방향 */
  private holdFacing = 0
  private swingFrom = 0
  private swingRadius = 0
  private throwX = 0
  private throwZ = 0
  private throwYaw = 0
  /** 지금 날아가는 모습: 엎어치기(던진 쪽을 앎) · 포물선(모름) */
  private flight: 'seoi' | 'arc' | null = null
  /** 던져져 누웠다 (다운이 끝날 때까지) — 던진 쪽으로 머리를 두고 눕는다 */
  private backDown = false
  /** 엎어치기로 떨어진 직후: 눕는 클립이 섞여 드는 만큼 공중의 회전을 푼다 */
  private unwinding = false
  private phase: ThrowPhase = 'none'
  /** 업히기·날아가기를 그리는 동작 프레임 (실제 프레임을 부드럽게 따라간다) */
  private frameShown = 0
  private readonly flightPose = createSeoiFlight()
  /** 단계가 바뀌며 그림이 튈 때 남겨 두었다가 지우는 차이, 바로 앞 프레임에 그린 모습 */
  private readonly settle = { x: 0, z: 0, yaw: 0, lift: 0, flip: 0, left: 0 }
  private readonly shown = { x: 0, z: 0, yaw: 0, lift: 0, flip: 0 }
  /** 던지는 쪽이 숙일 때 굽히는 뼈: 모델 옆 방향을 뼈 공간으로 옮긴 축, 굽히기 전 자세 */
  private readonly bowBones: { bone: Object3D; axis: Vector3; share: number; saved: Quaternion }[] = []
  private bow = 0
  private bent = false

  constructor(assets: CharacterAssets, characterId: number, variant: number, id: string, effects: EffectsSystem) {
    const { model, moves } = characterAt(characterId)
    const index = characterId >= 0 && characterId < assets.models.length ? characterId : 0
    this.assets = assets
    this.id = id
    this.effects = effects
    this.look = model
    this.input = { action: 0, actionFrame: 0, stun: 0, speed: 0, rising: false, idleClip: model.idleClip, moves }
    this.model = cloneSkinned(assets.models[index])
    this.model.scale.setScalar(MODEL_SCALE)
    this.model.position.y = -FLIP_PIVOT
    this.model.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      // 눕기·찌르기처럼 처음 자세의 경계를 벗어나는 동작이 있어 화면 밖 판정을 끈다
      mesh.frustumCulled = false
      const material = cloneCharacterMaterial(mesh.material as MeshStandardMaterial, model, variant)
      mesh.material = material
      this.materials.push(material)
    })
    this.flipper.position.y = FLIP_PIVOT
    this.flipper.add(this.model)
    this.shield.position.y = 1.0
    this.shield.visible = false
    this.root.add(this.flipper, this.shadow, this.shield)
    this.mixer = new AnimationMixer(this.model)
    // 숙이는 축: 기본 자세에서 모델의 옆 방향(+x)을 각 뼈 공간으로 옮겨 둔다 (+각도 = 앞으로 숙임)
    this.root.updateMatrixWorld(true)
    for (const [name, share] of BOW_BONES) {
      const bone = this.model.getObjectByName(name)
      if (!bone) continue
      const axis = new Vector3(1, 0, 0).applyQuaternion(bone.getWorldQuaternion(new Quaternion()).invert()).normalize()
      this.bowBones.push({ bone, axis, share, saved: new Quaternion() })
    }
  }

  /**
   * 렌더 프레임마다: pose를 그대로 그린다 (dt는 초, now는 performance.now).
   * partner는 잡혔거나 던져졌을 때 잡은 쪽의 자세 — 엎어치기 연출에 쓴다 (session.throwPartner)
   */
  update(pose: Pose, dt: number, now: number, partner: Pose | null = null) {
    this.track(pose, dt)
    this.root.position.set(pose.x, pose.y, pose.z)
    this.root.rotation.y = pose.facing
    if (pose.action === Action.Thrown) this.backDown = true
    else if (pose.action !== Action.Knockdown) this.backDown = false
    this.bow = pose.action === Action.Throwing ? bowAngle(pose.actionFrame) : 0

    const prevAction = this.lastAction, prevFrame = this.lastFrame
    // 히트스톱: 강타 직후 잠깐 자세를 멈추고(맞은 쪽은 떤다), 끝나면 지금 프레임의 자세로 이어진다
    const stopped = this.effects.isStopped(this.id, now)
    this.model.position.x = stopped && VICTIM_ACTIONS.has(pose.action) ? (Math.random() - 0.5) * 2 * STOP_JITTER : 0
    if (!stopped) {
      const input = this.input
      input.action = pose.action
      input.actionFrame = pose.actionFrame
      input.stun = pose.stun
      input.speed = this.speed
      input.rising = this.rising
      chooseClip(input, this.choice)
      // 같은 동작을 다시 시작하면(연타·연속 피격) 프레임이 되돌아간다 — 같은 클립이어도 처음부터 섞어 다시 튼다
      const restarted = pose.action === prevAction && pose.actionFrame < prevFrame - 0.5
      this.lastAction = pose.action
      this.lastFrame = pose.actionFrame
      if (this.choice.clip !== this.currentClip || restarted) this.switchTo(this.choice)
      this.advance(dt)
      this.emitEffects(pose, prevAction, prevFrame, dt)
    }

    this.place(pose, partner, dt)
    this.paint(pose, now)
    // 그림자는 바닥에 남는다. 경기장 밖이나 떨어지는 중에는 숨긴다
    const overFloor = Math.abs(pose.x) <= ARENA_HALF && Math.abs(pose.z) <= ARENA_HALF && pose.y > -0.5
    this.shadow.visible = overFloor && !this.castsShadow
    this.shadow.position.y = 0.02 - pose.y
    this.shadow.scale.setScalar(Math.max(0.45, 1 - pose.y / 4))
    this.shield.visible = pose.action === Action.Guard || pose.action === Action.GuardStun
  }

  /** 해의 실시간 그림자를 드리울지 (내 캐릭터만 — design §7.8) */
  setShadowCaster(on: boolean) {
    this.castsShadow = on
    this.model.traverse((object) => {
      if ((object as Mesh).isMesh) object.castShadow = on
    })
  }

  /** 개발용: 지금 재생 중인 클립과 위치 (브라우저 자동 점검이 읽는다) */
  debugState() {
    return {
      character: this.look.key, action: this.lastAction, frame: this.lastFrame, clip: this.currentClip,
      time: this.current?.time ?? null, fade: this.fade, lift: this.flipper.position.y - FLIP_PIVOT,
      opacity: this.materials[0]?.opacity ?? 1,
      phase: this.phase, x: this.root.position.x, z: this.root.position.z, yaw: this.root.rotation.y,
      flip: this.flipper.rotation.x, bow: this.bent ? this.bow : 0,
    }
  }

  /** 애니메이션을 멈추고 복제한 머티리얼을 놓아준다. 다시 update하면 처음부터 다시 튼다 (StrictMode의 재마운트) */
  dispose() {
    this.mixer.stopAllAction()
    this.current = this.previous = null
    this.currentClip = null
    for (const material of this.materials) material.dispose()
  }

  /** KO 상태였는지 — 사라질 때 연기를 남긴다 */
  get knockedOut(): boolean {
    return this.lastAction === Action.KO
  }

  /** 동작이 바뀌는 순간의 먼지·폭발 (착지, 돌진, 던져져 떨어짐, KO, 낭떠러지) */
  private emitEffects(pose: Pose, prevAction: number, prevFrame: number, dt: number) {
    const { x, z, action } = pose
    const effects = this.effects
    const grounded = pose.y <= 0.01 && !AIRBORNE.has(action)
    const started = action !== prevAction || pose.actionFrame < prevFrame - 0.5
    if (prevAction === -1) return
    if (AIRBORNE.has(prevAction) && prevAction !== Action.Falling && grounded) {
      effects.puff(x, z, 6, 0.5)
      effects.sound('land', x, z)
    }
    // 경기장 안에서 땅을 박차고 오른다 (가장자리 밖으로 걸어 나가 떨어지는 것과 구분)
    const overArena = Math.abs(x) <= ARENA_HALF && Math.abs(z) <= ARENA_HALF
    if (action === Action.Air && !AIRBORNE.has(prevAction) && overArena) effects.sound('jump', x, z)
    if (started && SWINGS.has(action)) effects.sound('whoosh', x, z)
    if (started && action === Action.GrabTry) effects.sound('grab', x, z)
    if (action === Action.Throwing && prevFrame < THROW.release && pose.actionFrame >= THROW.release) effects.sound('throw', x, z)
    if (action === Action.Dash && prevAction !== Action.Dash) effects.puff(x, z, 4, 0.3)
    if (action === Action.Thrown && prevFrame < THROWN_AIR_FRAMES && pose.actionFrame >= THROWN_AIR_FRAMES) {
      effects.puff(x, z, 10, 0.8)
      effects.sound('land', x, z)
      effects.shakeIfMe(this.id, 0.3)
    }
    if (action === Action.KO && prevAction !== Action.KO) {
      effects.ko(x, pose.y + 1, z)
      effects.shakeIfMe(this.id, 0.6)
    }
    if (action === Action.Falling && prevAction !== Action.Falling) {
      effects.puff(x, z, 3, 0.3)
      effects.sound('fall', x, z)
    }
    // 달리는 발밑, 세게 밀려나는 몸 밑에 먼지
    const sliding = grounded && this.speed > SLIDE_DUST_SPEED && VICTIM_ACTIONS.has(action)
    const running = grounded && action === Action.Run
    this.dustTimer -= dt
    if ((sliding || running) && this.dustTimer <= 0) {
      effects.puff(x, z, 1, 0.2)
      this.dustTimer = sliding ? SLIDE_DUST_EVERY : STEP_DUST_EVERY
    }
  }

  /** 그려진 위치의 변화로 수평 속도와 오르는 중인지를 잰다 (원격 캐릭터는 속도를 보간하지 않으므로) */
  private track(pose: Pose, dt: number) {
    const dx = pose.x - this.lastX, dy = pose.y - this.lastY, dz = pose.z - this.lastZ
    this.lastX = pose.x
    this.lastY = pose.y
    this.lastZ = pose.z
    if (dt <= 0) return
    if (!this.tracked || dx * dx + dz * dz > TELEPORT * TELEPORT) {
      this.tracked = true
      this.speed = 0
      this.rising = false
      return
    }
    this.speed += (Math.sqrt(dx * dx + dz * dz) / dt - this.speed) * Math.min(1, dt * SPEED_FOLLOW)
    this.rising = dy / dt > RISING_SPEED
  }

  private switchTo(choice: ClipChoice) {
    const main = this.assets.clips.get(choice.clip)
    const alt = this.assets.altClips.get(choice.clip)
    if (!main || !alt) return
    // 지금 재생 중인 것과 다른 복제본을 써야 둘을 섞을 수 있다
    const clip = this.current?.getClip() === main ? alt : main
    // 섞는 것은 두 개까지 — 사라지던 앞 클립은 바로 멈춘다
    this.previous?.stop()
    this.previous = this.current
    const next = this.mixer.clipAction(clip)
    next.reset()
    next.paused = true
    next.play()
    this.current = next
    this.currentClip = choice.clip
    this.fadeSeconds = choice.fade
    this.fade = this.previous ? 0 : 1
    next.weight = this.fade
  }

  /** 재생 위치를 정하고 섞는 비율을 진행한 뒤 자세를 계산한다. 시간은 직접 정하므로 mixer는 0초만큼만 돌린다 */
  private advance(dt: number) {
    const action = this.current
    if (!action) return
    const duration = action.getClip().duration
    const { time, loop, rate } = this.choice
    if (time !== null) action.time = Math.min(duration, Math.max(0, time))
    else {
      const next = action.time + dt * rate
      action.time = loop ? next % duration : Math.min(duration, next)
    }
    if (this.previous) {
      this.fade = this.fadeSeconds > 0 ? Math.min(1, this.fade + dt / this.fadeSeconds) : 1
      action.weight = this.fade
      this.previous.weight = 1 - this.fade
      if (this.fade >= 1) {
        this.previous.stop()
        this.previous = null
      }
    }
    // 지난 프레임에 숙인 뼈를 되돌린 뒤 자세를 계산한다 (이 클립이 움직이지 않는 뼈는 믹서가 덮어쓰지 않으므로)
    if (this.bent) for (const b of this.bowBones) b.bone.quaternion.copy(b.saved)
    this.mixer.update(0)
    // 던지는 쪽: 허리(척추·가슴)를 앞으로 숙인다
    this.bent = this.bow > 0
    if (this.bent) {
      for (const b of this.bowBones) {
        b.saved.copy(b.bone.quaternion)
        b.bone.quaternion.multiply(bowTurn.setFromAxisAngle(b.axis, this.bow * b.share))
      }
    }
  }

  /**
   * 잡기·던지기 연출 — 시뮬레이션 위치·방향(root)에 화면용 자리 옮김을, flipper에 높이·앞뒤 회전을 더한다 (animation.ts SEOI).
   * 잡혀 있으면 잡은 쪽을 마주 보고, 업히고, 어깨 너머로 날아가 등을 대고 눕는다. 던진 쪽을 모르면 예전처럼 포물선을 그린다.
   * 단계가 갑자기 바뀌어(잡기가 끊김, 내 화면에서 업히기 전에 던져짐) 그림이 튀면 어긋난 만큼을 SETTLE_TIME 동안 지운다
   */
  private place(pose: Pose, partner: Pose | null, dt: number) {
    const root = this.root
    const { action, actionFrame: f } = pose
    let phase: ThrowPhase = 'none'
    let lift = 0, flip = 0
    if (action !== Action.Thrown) this.flight = null
    const holding = partner?.action === Action.Holding || partner?.action === Action.Throwing
    if (action === Action.Grabbed && partner && holding) {
      const dx = pose.x - partner.x, dz = pose.z - partner.z
      if (partner.action === Action.Holding) {
        // 잡혀 있다: 잡은 쪽 앞 그 자리에서 잡은 쪽을 마주 본다. 서버는 던지는 순간 잡은 쪽을 던질 방향으로 돌리고
        // 잡힌 쪽을 그 앞으로 옮기는데, 남의 화면에서는 위치·방향과 동작의 보간 시점이 조금 달라 그 이동이
        // 잡혀 있는 동안 보일 수 있다 — 잡은 쪽은 잡고 있는 동안 돌 수 없으므로, 처음 잡았을 때 방향 그대로이고
        // 잡힌 쪽이 그 앞에 있을 때만 자리를 새로 잡는다
        phase = 'hold'
        const bearing = Math.atan2(dx, dz)
        if (this.phase !== 'hold') this.holdFacing = partner.facing
        const steady = Math.abs(angleDelta(this.holdFacing, partner.facing)) < HOLD_MATCH
          && Math.abs(angleDelta(bearing, partner.facing)) < HOLD_MATCH
        if (this.phase !== 'hold' || steady) {
          this.swingFrom = bearing
          this.swingRadius = Math.max(SEOI.backGap, Math.hypot(dx, dz))
        }
        root.position.x = partner.x + Math.sin(this.swingFrom) * this.swingRadius
        root.position.z = partner.z + Math.cos(this.swingFrom) * this.swingRadius
        root.rotation.y = this.swingFrom + Math.PI
      } else {
        // 업힌다: 잡은 쪽 둘레를 돌아 등 뒤로 가서, 들려 올라 앞으로 기댄다
        phase = 'load'
        const s = loadProgress(this.follow(phase, partner.actionFrame, dt))
        const bearing = this.swingFrom + angleDelta(this.swingFrom, partner.facing + Math.PI) * s
        const r = this.swingRadius + (SEOI.backGap - this.swingRadius) * s
        root.position.x = partner.x + Math.sin(bearing) * r
        root.position.z = partner.z + Math.cos(bearing) * r
        root.rotation.y = bearing + Math.PI
        lift = (SEOI.backPivot - FLIP_PIVOT) * s
        flip = SEOI.drape * s
      }
    } else if (action === Action.Thrown && f < THROWN_AIR_FRAMES) {
      if (this.flight === null) this.startFlight(pose, partner)
      if (this.flight === 'seoi') {
        // 어깨 너머로: 던진 쪽 등 뒤 출발점에서 시뮬레이션 위치로 옮겨 가며 앞으로 3/4바퀴 돈다
        phase = 'seoi'
        const k = seoiFlight(this.follow(phase, f, dt) / THROWN_AIR_FRAMES, this.flightPose)
        const ax = this.throwX - Math.sin(this.throwYaw) * SEOI.backGap
        const az = this.throwZ - Math.cos(this.throwYaw) * SEOI.backGap
        root.position.x = ax + (pose.x - ax) * k.merge
        root.position.z = az + (pose.z - az) * k.merge
        root.rotation.y = this.throwYaw
        lift = k.pivot - FLIP_PIVOT
        flip = k.pitch
      } else {
        phase = 'arc'
        const t = f / THROWN_AIR_FRAMES
        lift = THROW_ARC_HEIGHT * 4 * t * (1 - t)
        flip = -2 * Math.PI * t
      }
    } else if (this.backDown && (action === Action.Thrown || action === Action.Knockdown)) {
      // 등을 대고 누웠다: 던진 쪽으로 머리를 두고, 일어나면서 원래 바라보던 방향으로 돈다
      phase = 'lie'
      if (this.phase === 'seoi') this.unwinding = true
      const up = action === Action.Knockdown ? getupProgress(f) : 0
      root.rotation.y = this.throwYaw + angleDelta(this.throwYaw, pose.facing) * up
      // 떨어진 직후: 눕는 클립이 섞여 드는 만큼 공중의 회전(3/4바퀴 = 뒤로 1/4바퀴)과 높이를 푼다
      if (this.unwinding) {
        const rest = 1 - this.fade
        lift = (SEOI.lieHeight - FLIP_PIVOT) * rest
        flip = (SEOI.land - 2 * Math.PI) * rest
        if (this.fade >= 1) this.unwinding = false
      }
    }
    if (phase !== 'lie') this.unwinding = false

    const settle = this.settle, shown = this.shown
    if (phase !== this.phase) {
      settle.x = shown.x - root.position.x
      settle.z = shown.z - root.position.z
      settle.yaw = angleDelta(root.rotation.y, shown.yaw)
      settle.lift = shown.lift - lift
      settle.flip = angleDelta(flip, shown.flip)
      settle.left = SETTLE_TIME
    }
    if (settle.left > 0) {
      const k = settle.left / SETTLE_TIME
      root.position.x += settle.x * k
      root.position.z += settle.z * k
      root.rotation.y += settle.yaw * k
      lift += settle.lift * k
      flip += settle.flip * k
      settle.left -= dt
    }
    this.phase = phase
    shown.x = root.position.x
    shown.z = root.position.z
    shown.yaw = root.rotation.y
    shown.lift = lift
    shown.flip = flip
    this.flipper.position.y = FLIP_PIVOT + lift
    this.flipper.rotation.x = flip
  }

  /**
   * 연출에 쓸 동작 프레임: 단계에 처음 들어오면 그대로, 그 뒤로는 제 속도(초당 틱 수)로 나아가며 실제 프레임 쪽으로
   * 조금씩 당겨진다. 원격 캐릭터의 프레임은 패치가 올 때마다 1프레임 안팎 튀는데, 빠르게 움직이는 연출에서는 그만큼 끊겨 보인다
   */
  private follow(phase: ThrowPhase, frame: number, dt: number): number {
    if (this.phase !== phase) this.frameShown = frame
    else {
      this.frameShown += dt * TICK_RATE
      this.frameShown += (frame - this.frameShown) * Math.min(1, dt * FOLLOW_RATE)
    }
    return this.frameShown
  }

  /** 던져진 첫 프레임: 던진 쪽을 알면 엎어치기, 모르면 포물선. 던진 방향은 던지는 동작 중인 쪽의 방향, 아니면 그쪽에서 나를 향한 방향 */
  private startFlight(pose: Pose, partner: Pose | null) {
    if (!partner) {
      this.flight = 'arc'
      this.throwYaw = pose.facing
      return
    }
    // 서버는 놓는 순간 잡힌 쪽을 던지는 쪽 앞(던진 방향) 0.8m에 두고 그 방향으로 민다
    const dx = pose.x - partner.x, dz = pose.z - partner.z
    const apart = dx * dx + dz * dz > 0.01
    this.flight = 'seoi'
    this.throwX = partner.x
    this.throwZ = partner.z
    this.throwYaw = partner.action === Action.Throwing || !apart ? partner.facing : Math.atan2(dx, dz)
  }

  /** 맞으면 하얗게, 가드로 막으면 파랗게 번쩍인다. 가드 중에는 은은하게 파랗고, 무적이면 반투명하게 깜빡인다 */
  private paint(pose: Pose, now: number) {
    const { action, actionFrame } = pose
    const guarding = action === Action.Guard || action === Action.GuardStun
    const flash = action === Action.Hitstun ? HIT_FLASH : guarding ? GUARD_FLASH : null
    const intensity = action === Action.Guard ? GUARD_GLOW : flash ? 0.9 * Math.max(0.25, 1 - actionFrame / 10) : 0
    const translucent = pose.invuln > 0
    const opacity = translucent && Math.floor(now / BLINK_MS) % 2 === 0 ? BLINK_OPACITY : 1
    for (const material of this.materials) {
      if (flash) material.emissive.copy(flash)
      material.emissiveIntensity = intensity
      material.opacity = opacity
      if (translucent !== this.translucent) {
        material.transparent = translucent
        material.needsUpdate = true
      }
    }
    this.translucent = translucent
  }
}
