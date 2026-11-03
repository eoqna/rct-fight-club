import { useEffect, useState, type MouseEvent } from 'react'
import type { DevDummyKind } from '@fight-club/shared'
import type { GameSession } from '../game/session.ts'
import { renderStats } from '../scene/quality.ts'
import { useTicker } from './useTicker.ts'

/** CP1 체감 시험에 쓰는 왕복 지연 (ms) */
const LATENCIES = [0, 150, 300]

const DUMMY_BUTTONS: { kind: DevDummyKind; label: string }[] = [
  { kind: 'still', label: '샌드백' },
  { kind: 'patrol', label: '왕복 샌드백' },
  { kind: 'clear', label: '치우기' },
]

/** 개발용 넷코드 디버그 (` 키로 켜고 끈다) — S1 */
export function DebugOverlay({ session }: { session: GameSession }) {
  const [open, setOpen] = useState(session.debugDraw)
  const [error, setError] = useState<string | null>(null)
  useTicker(250)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Backquote') return
      session.toggleDebugDraw()
      setOpen(session.debugDraw)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [session])

  if (!open) return null

  const stats = session.stats()
  // 포커스가 남으면 Space(점프)가 버튼을 다시 누르므로 누르자마자 포커스를 뺀다
  const chooseLatency = (ms: number) => (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur()
    setError(null)
    session.setLatency(ms).catch((err: unknown) => setError(String(err)))
  }
  const commandDummy = (kind: DevDummyKind) => (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur()
    session.commandDummy(kind)
  }

  return (
    <aside className="debug" aria-label="넷코드 디버그">
      <h2>넷코드 디버그</h2>
      <dl>
        <dt>화면</dt>
        <dd>{Math.round(renderStats.fps)}fps · 배율 {renderStats.dpr} ({renderStats.tier === 'pc' ? 'PC' : '모바일'})</dd>
        <dt>RTT</dt>
        <dd>{stats.rttMs}ms · 지터 {stats.jitterMs}ms</dd>
        <dt>확인 대기 입력</dt>
        <dd>{stats.pendingInputs}</dd>
        <dt>예측 보정</dt>
        <dd>마지막 {stats.correctionCm}cm · 평균 {stats.driftCm}cm</dd>
        <dt>공격 명중</dt>
        <dd>내 화면 {stats.predictedHits} · 서버 확정 {stats.confirmedHits}</dd>
        <dt>내 동작</dt>
        <dd>{stats.myAction}</dd>
        <dt>대상 HP</dt>
        <dd>{stats.targets.length > 0 ? stats.targets.map((t) => `${t.label} ${t.hp}`).join(' · ') : '없음'}</dd>
        <dt>최근 탈락</dt>
        <dd>
          {stats.recentElims.length > 0
            ? stats.recentElims.map((e) => `${e.victim} ${e.cause}${e.killer ? ` ← ${e.killer}` : ''}`).join(' · ')
            : '없음'}
        </dd>
      </dl>
      <div className="debug-buttons" role="group" aria-label="왕복 지연 주입">
        {LATENCIES.map((ms) => (
          <button key={ms} type="button" aria-pressed={stats.latencyMs === ms} onClick={chooseLatency(ms)}>
            {ms}ms
          </button>
        ))}
      </div>
      <div className="debug-buttons" role="group" aria-label="연습용 샌드백">
        {DUMMY_BUTTONS.map(({ kind, label }) => (
          <button key={kind} type="button" onClick={commandDummy(kind)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="debug-hint">
        초록 상자: 서버가 본 내 위치 · 빨간 구: 내 공격 판정 · 보라 구: 잡기 판정
        <br />
        샌드백은 내 앞에 생깁니다. 지연을 바꾸면 다시 접속하니 다시 세워 주세요
      </p>
    </aside>
  )
}
