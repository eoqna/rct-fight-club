import type { AnimationClip, Group } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { CHARACTER_MODELS, type ClipName } from '../game/assets.gen.ts'

export interface CharacterAssets {
  /** characterId 순서의 모델 원본 — 플레이어마다 복제해서 쓴다 */
  models: Group[]
  clips: Map<ClipName, AnimationClip>
  /** 같은 클립을 다시 시작할 때(연타 등) 앞 재생과 섞기 위한 복제본 */
  altClips: Map<ClipName, AnimationClip>
}

const BASE = `${import.meta.env.BASE_URL}assets/`
let loading: Promise<CharacterAssets> | null = null

/** 캐릭터 GLB 5개와 공용 애니메이션을 한 번만 받는다. 시작 화면에서 미리 부르면 입장할 때 기다리지 않는다 (design §7.7) */
export function loadCharacterAssets(): Promise<CharacterAssets> {
  loading ??= load().catch((error: unknown) => {
    // 다음에 다시 시도할 수 있게 비운다
    loading = null
    throw error
  })
  return loading
}

async function load(): Promise<CharacterAssets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const [anims, ...models] = await Promise.all([
    loader.loadAsync(`${BASE}animations.glb`),
    ...CHARACTER_MODELS.map((model) => loader.loadAsync(`${BASE}characters/${model.key}.glb`)),
  ])
  const clips = new Map<ClipName, AnimationClip>()
  const altClips = new Map<ClipName, AnimationClip>()
  for (const clip of anims.animations) {
    clips.set(clip.name as ClipName, clip)
    altClips.set(clip.name as ClipName, clip.clone())
  }
  return { models: models.map((gltf) => gltf.scene), clips, altClips }
}
