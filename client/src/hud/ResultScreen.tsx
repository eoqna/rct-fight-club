import { useEffect, useRef } from 'react'
import type { ElimCause, ResultMsg } from '@fight-club/shared'
import type { SessionEnd } from '../game/session.ts'

const CAUSE_TEXT: Record<ElimCause, string> = {
  ko: '쓰러졌습니다',
  ringout: '경기장 밖으로 날아갔습니다',
  selfout: '발을 헛디뎠습니다',
  afk: '자리를 비워 퇴장했습니다',
}

/** 탈락하는 순간 누르고 있던 키(Space 등)로 곧장 다시 입장하지 않도록 잠시 뒤에 버튼에 포커스를 준다 */
const FOCUS_DELAY_MS = 1000

/** 결과 화면 — 이름·캐릭터 선택으로 돌아가는 흐름은 P4에서 붙인다 (design §7.1) */
export function ResultScreen({ end, onRetry }: { end: SessionEnd; onRetry: () => void }) {
  const retry = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => retry.current?.focus(), FOCUS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <main className="connection">
      {end.kind === 'eliminated'
        ? <Summary result={end.result} />
        : <p role="alert">서버와 연결이 끊어졌습니다 (코드 {end.code})</p>}
      <button ref={retry} type="button" onClick={onRetry}>다시 입장</button>
    </main>
  )
}

function Summary({ result }: { result: ResultMsg }) {
  return (
    <>
      <h1>{CAUSE_TEXT[result.cause]}</h1>
      <dl className="result-stats">
        <dt>생존 시간</dt>
        <dd>{formatDuration(result.survivalMs)}</dd>
        <dt>킬</dt>
        <dd>{result.kills}</dd>
        {result.killer && (
          <>
            <dt>마지막 공격자</dt>
            <dd>{result.killer}</dd>
          </>
        )}
      </dl>
    </>
  )
}

/** m:ss */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
