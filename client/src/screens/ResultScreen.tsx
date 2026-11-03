import { useEffect, useRef } from 'react'
import type { ResultMsg } from '@fight-club/shared/protocol'
import { formatDuration } from '../game/format.ts'
import { CAUSE_TITLES } from '../game/texts.ts'

/** 탈락하는 순간 누르고 있던 키(Space 등)로 곧장 다시 시작하지 않도록 잠시 뒤에 버튼에 포커스를 준다 */
const FOCUS_DELAY_MS = 1000

/** 결과 화면: 생존 시간·킬·탈락 원인(누구에게 졌는지)·최고 순위 (FR-39). 다시 하기 → 캐릭터 선택, 새 이름 (FR-40) */
export function ResultScreen({ result, onRetry }: { result: ResultMsg; onRetry: () => void }) {
  const retry = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => retry.current?.focus(), FOCUS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  const by = result.killerName && (result.cause === 'ko' || result.cause === 'ringout')
  return (
    <main className="screen result-screen">
      <h1 className="screen-title">{CAUSE_TITLES[result.cause]}</h1>
      {by && <p className="result-killer"><strong>{result.killerName}</strong>에게 졌습니다</p>}
      <dl className="result-stats">
        <dt>생존 시간</dt>
        <dd>{formatDuration(result.survivalMs)}</dd>
        <dt>킬</dt>
        <dd>{result.kills}</dd>
        <dt>최고 순위</dt>
        <dd>{result.bestRank}위</dd>
      </dl>
      <div className="screen-actions">
        <button ref={retry} type="button" className="primary" onClick={onRetry}>다시 하기</button>
      </div>
    </main>
  )
}
