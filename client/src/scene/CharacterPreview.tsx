import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, use, useEffect, useMemo, useRef, type PointerEvent } from 'react'
import { AnimationMixer, LoopOnce, type Mesh, type MeshStandardMaterial, type Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MODEL_SCALE, characterAt } from '../game/characters.ts'
import { loadCharacterAssets, type CharacterAssets } from './characterAssets.ts'
import { cloneCharacterMaterial } from './characterMaterial.ts'

/** 가만히 둘 때 도는 빠르기 (rad/s), 끌어 돌리는 감도 (rad/px), 손을 뗀 뒤 관성이 줄어드는 빠르기 (1/s) */
const AUTO_SPIN = 0.35
const DRAG_SPEED = 0.012
const INERTIA_DECAY = 3
/** 미리보기 동작이 끝나고 대기 동작으로 넘어가는 시간 (초) */
const FADE = 0.3

/** 끌어 돌리는 상태 — 캔버스 밖 DOM 이벤트와 R3F 프레임이 함께 쓴다 */
class Spin {
  private angle = 0.4
  private velocity = 0
  private dragging = false
  private lastX = 0

  press(x: number) {
    this.dragging = true
    this.lastX = x
  }

  drag(x: number) {
    if (!this.dragging) return
    const dx = x - this.lastX
    this.lastX = x
    this.angle += dx * DRAG_SPEED
    this.velocity = dx * DRAG_SPEED * 30
  }

  release() {
    this.dragging = false
  }

  /** dt초 뒤의 각도 — 손을 떼면 관성이 줄어들며 천천히 저절로 돈다 */
  advance(dt: number): number {
    if (!this.dragging) {
      this.velocity *= Math.exp(-INERTIA_DECAY * dt)
      this.angle += (AUTO_SPIN + this.velocity) * dt
    }
    return this.angle
  }
}

/** 캐릭터 선택 화면의 3D 미리보기 — 끌어서 돌리고, 가만히 두면 천천히 돈다 (FR-06) */
export function CharacterPreview({ characterId }: { characterId: number }) {
  const spin = useMemo(() => new Spin(), [])
  const down = (e: PointerEvent<HTMLDivElement>) => {
    spin.press(e.clientX)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => spin.drag(e.clientX)
  const up = () => spin.release()

  return (
    <div className="preview" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <Canvas flat dpr={[1, 2]} camera={{ fov: 30, near: 0.1, far: 50, position: [0, 1.3, 5.4] }} onCreated={({ camera }) => camera.lookAt(0, 0.85, 0)}>
        <hemisphereLight args={['#dfe9ff', '#4a4150', 1.2]} />
        <directionalLight position={[3, 6, 5]} intensity={2} />
        <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
          <circleGeometry args={[1.15, 48]} />
          <meshStandardMaterial color="#2b3042" />
        </mesh>
        <Suspense fallback={null}>
          <PreviewModel characterId={characterId} spin={spin} />
        </Suspense>
      </Canvas>
    </div>
  )
}

function PreviewModel({ characterId, spin }: { characterId: number; spin: Spin }) {
  const assets = use(loadCharacterAssets())
  const view = useMemo(() => createPreview(assets, characterId), [assets, characterId])
  const root = useRef<Object3D>(null)
  useEffect(() => () => view.dispose(), [view])

  useFrame((_, dt) => {
    const angle = spin.advance(dt)
    if (root.current) root.current.rotation.y = angle
    view.mixer.update(dt)
  })

  return <primitive ref={root} object={view.root} dispose={null} />
}

/** 모델을 복제해 그 캐릭터의 A 동작을 한 번 보여 준 뒤 대기 동작으로 넘어간다 */
function createPreview(assets: CharacterAssets, characterId: number) {
  const { model, moves } = characterAt(characterId)
  const root = cloneSkinned(assets.models[Math.min(Math.max(0, characterId), assets.models.length - 1)])
  root.scale.setScalar(MODEL_SCALE)
  const materials: MeshStandardMaterial[] = []
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.frustumCulled = false
    const material = cloneCharacterMaterial(mesh.material as MeshStandardMaterial, model, 0)
    mesh.material = material
    materials.push(material)
  })
  const mixer = new AnimationMixer(root)
  const idle = mixer.clipAction(assets.clips.get(model.idleClip)!)
  const show = mixer.clipAction(assets.clips.get(moves.jab)!)
  show.setLoop(LoopOnce, 1)
  show.clampWhenFinished = true
  idle.play().setEffectiveWeight(0)
  show.play()
  mixer.addEventListener('finished', () => {
    idle.setEffectiveWeight(1)
    show.crossFadeTo(idle, FADE, false)
  })
  return {
    root,
    mixer,
    dispose() {
      mixer.stopAllAction()
      for (const material of materials) material.dispose()
    },
  }
}
