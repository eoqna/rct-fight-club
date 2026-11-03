import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { assembleName, type NameIndex } from '@fight-club/shared/nickname'
import { CHARACTER_MODELS } from '../game/assets.gen.ts'
import { CHARACTER_BLURBS, NAME_STYLE } from '../game/texts.ts'

/** 3D 미리보기는 three를 쓰므로 따로 받는다 (시작 화면을 가볍게 — design §7.7) */
const CharacterPreview = lazy(() => import('../scene/CharacterPreview.tsx').then((m) => ({ default: m.CharacterPreview })))

const COUNT = CHARACTER_MODELS.length

interface Props {
  characterId: number
  name: NameIndex
  /** 입장 실패·연결 끊김 안내 */
  notice?: ReactNode
  onCharacter: (id: number) => void
  onReroll: () => void
  onJoin: () => void
}

/** 캐릭터 선택: 3D로 돌려 보며 고르고, 이름을 🎲로 다시 뽑은 뒤 입장 (FR-06·09~11, US-02) */
export function SelectScreen({ characterId, name, notice, onCharacter, onReroll, onJoin }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') onCharacter((characterId + COUNT - 1) % COUNT)
      else if (e.code === 'ArrowRight' || e.code === 'ArrowDown') onCharacter((characterId + 1) % COUNT)
      else if (e.code === 'KeyR') onReroll()
      // 버튼에 포커스가 있으면 Enter는 그 버튼이 처리한다
      else if (e.code === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) onJoin()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [characterId, onCharacter, onReroll, onJoin])

  return (
    <main className="screen select-screen">
      <h1 className="screen-title">캐릭터 선택</h1>
      <div className="select-layout">
        <Suspense fallback={<div className="preview preview-loading">캐릭터를 불러오는 중…</div>}>
          <CharacterPreview characterId={characterId} />
        </Suspense>
        <section className="select-panel">
          <div className="character-list" role="radiogroup" aria-label="캐릭터">
            {CHARACTER_MODELS.map((model, i) => (
              <button
                key={model.key} type="button" role="radio" aria-checked={i === characterId}
                className="character-card" onClick={() => onCharacter(i)}
              >
                <strong>{model.label}</strong>
                <span>{CHARACTER_BLURBS[i]}</span>
              </button>
            ))}
          </div>
          <p className="select-note">모든 캐릭터의 능력치는 같습니다. 겉모습과 동작만 다릅니다.</p>
          <div className="name-card">
            <span className="name-label">{NAME_STYLE}</span>
            <strong className="name-value" aria-live="polite">{assembleName(name)}</strong>
            <button type="button" className="dice" onClick={onReroll} aria-label="이름 다시 뽑기" title="이름 다시 뽑기 (R)">🎲</button>
          </div>
          {notice && <div role="alert" className="select-notice">{notice}</div>}
          <div className="screen-actions">
            <button type="button" className="primary" autoFocus onClick={onJoin}>입장</button>
          </div>
          <p className="select-keys">← → 캐릭터 · R 이름 다시 뽑기 · Enter 입장</p>
        </section>
      </div>
    </main>
  )
}
