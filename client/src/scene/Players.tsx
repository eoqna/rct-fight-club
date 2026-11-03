import { useFrame } from '@react-three/fiber'
import { use, useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPose, type GameSession } from '../game/session.ts'
import { loadCharacterAssets, type CharacterAssets } from './characterAssets.ts'
import { CharacterRig } from './CharacterRig.ts'
import type { EffectsSystem } from './effects.ts'

/** useFrame 콜백은 차례로 실행되므로 하나를 돌려써도 안전하다 */
const pose = createPose()
const partner = createPose()

/** 모든 플레이어의 3D 캐릭터. 에셋을 다 받을 때까지 Suspense로 기다린다 */
export function Players({ session, effects, shadows }: { session: GameSession; effects: EffectsSystem; shadows: boolean }) {
  const assets = use(loadCharacterAssets())
  const ids = useSyncExternalStore(session.subscribe, session.getPlayerIds)
  return ids.map((id) => <Player key={id} id={id} session={session} assets={assets} effects={effects} shadows={shadows} />)
}

interface PlayerProps {
  id: string
  session: GameSession
  assets: CharacterAssets
  effects: EffectsSystem
  /** 실시간 그림자를 쓰는 품질 단계인가 (내 캐릭터만 드리운다) */
  shadows: boolean
}

function Player({ id, session, assets, effects, shadows }: PlayerProps) {
  const { characterId, variant } = session.look(id)
  const rig = useMemo(() => new CharacterRig(assets, characterId, variant, id, effects), [assets, characterId, variant, id, effects])
  useEffect(() => {
    // 개발 빌드 전용: 브라우저 자동 점검 스크립트가 캐릭터 애니메이션 상태를 읽는 창구
    const debug = import.meta.env.DEV ? ((window as { __fightClubRigs?: Map<string, CharacterRig> }).__fightClubRigs ??= new Map()) : null
    debug?.set(id, rig)
    return () => {
      debug?.delete(id)
      // KO로 탈락해 사라지면 그 자리에 연기를 남긴다
      if (rig.knockedOut) effects.puff(rig.root.position.x, rig.root.position.z, 12, 0.6)
      rig.dispose()
    }
  }, [id, rig, effects])
  useEffect(() => rig.setShadowCaster(shadows && id === session.myId), [id, rig, session, shadows])

  useFrame((_, delta) => {
    if (session.pose(id, pose)) rig.update(pose, delta, performance.now(), session.throwPartner(id, pose, partner))
  })

  // 모델의 형상·텍스처는 모든 플레이어가 함께 쓰므로 R3F가 지우지 않게 한다
  return <primitive object={rig.root} dispose={null} />
}
