import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { GameSession } from '../game/session.ts'
import type { TagRegistry } from './tagRegistry.ts'

/**
 * 모든 캐릭터 머리 위의 닉네임과 HP 바 (FR-41) — DOM 층 하나에 요소를 두고 위치는 transform만 바꾼다.
 * 한글을 시스템 글꼴로 그리므로 3D 글꼴을 받을 필요가 없다 (design §7.6)
 */
export function NameTagLayer({ session, tags }: { session: GameSession; tags: TagRegistry }) {
  const ids = useSyncExternalStore(session.subscribe, session.getPlayerIds)
  return (
    <div className="nametags" aria-hidden="true">
      {ids.map((id) => <NameTag key={id} id={id} session={session} tags={tags} />)}
    </div>
  )
}

function NameTag({ id, session, tags }: { id: string; session: GameSession; tags: TagRegistry }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    tags.add(id, el)
    return () => tags.remove(id)
  }, [id, tags])
  return (
    <div ref={ref} className={id === session.myId ? 'nametag me' : 'nametag'}>
      <span className="nametag-name">{session.nameOf(id)}</span>
      <span className="nametag-hp"><i /></span>
    </div>
  )
}

/** 캔버스 안: 매 프레임 이름표를 옮긴다 */
export function NameTagProjector({ session, tags }: { session: GameSession; tags: TagRegistry }) {
  useFrame(({ camera, size }) => tags.place(session, camera, size.width, size.height))
  return null
}
