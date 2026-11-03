import { useEffect } from 'react'

const CONTROLS: [string, string][] = [
  ['← ↑ → ↓', '이동 (두 키를 함께 누르면 대각선)'],
  ['Shift', '누르는 동안 달리기'],
  ['Space', '점프'],
  ['A · S', '기본 · 특수 공격 — 특수는 더 세지만 느리다'],
  ['D', '발차기 — 쿨타임 3초'],
  ['F', '누르는 동안 가드 (정면 공격을 막는다)'],
  ['G', '잡기 — 잡은 뒤 방향키로 던지기 · 쿨타임 5초'],
  ['달리며 공격', '돌진 공격'],
  ['점프 중 D', '날아차기'],
  ['M', '소리 켜기·끄기'],
  ['H', '이 안내 열기·닫기'],
]

/** 조작법 안내 — 시작 화면의 "조작법"과 게임 중 H 키 (FR-02, design §7.6). Esc·H·바깥 클릭으로 닫는다 */
export function ControlsGuide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyH') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="guide-backdrop" onClick={onClose}>
      <section className="guide" role="dialog" aria-label="조작법" onClick={(e) => e.stopPropagation()}>
        <h2>조작법</h2>
        <dl>
          {CONTROLS.map(([key, text]) => (
            <div key={key}>
              <dt><kbd>{key}</kbd></dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p className="guide-note">HP가 0이 되거나 경기장 밖으로 떨어지면 탈락합니다. 맞고 5초 안에 떨어지면 마지막으로 때린 사람이 킬을 얻습니다.</p>
        <button type="button" className="secondary" onClick={onClose}>닫기</button>
      </section>
    </div>
  )
}
