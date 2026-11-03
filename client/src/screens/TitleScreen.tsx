import { useEffect, useState } from 'react'
import type { StatsResponse } from '@fight-club/shared/protocol'
import { SERVER_URL } from '../game/config.ts'
import { ControlsGuide } from './ControlsGuide.tsx'

/** 접속자 수를 다시 묻는 간격 (ms) — 서버도 5초 동안 같은 값을 준다 */
const STATS_EVERY_MS = 5000

/** 시작 화면: 제목, 지금 접속자 수, 시작·조작법 (FR-02). 3D 없이 바로 뜬다 */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  const stats = useServerStats()
  const [guide, setGuide] = useState(false)

  return (
    <main className="screen title-screen">
      <h1 className="title-logo">Fight Club</h1>
      <p className="title-tagline">주먹과 발차기로 겨루는 실시간 난투 — 마지막까지 경기장에 서 있으세요</p>
      <p className="title-online" aria-live="polite">
        {stats === null ? '접속자 수를 불러오는 중…'
          : stats === 'error' ? '서버에 연결할 수 없습니다'
          : <>지금 <strong>{stats.online}</strong>명이 싸우는 중 · 경기장 {stats.arenas}개</>}
      </p>
      <div className="screen-actions">
        <button type="button" className="primary" autoFocus onClick={onStart}>시작</button>
        <button type="button" className="secondary" onClick={() => setGuide(true)}>조작법</button>
      </div>
      {guide && <ControlsGuide onClose={() => setGuide(false)} />}
    </main>
  )
}

/** /api/stats를 주기적으로 읽는다. 아직 모르면 null, 실패하면 'error' */
function useServerStats(): StatsResponse | 'error' | null {
  const [stats, setStats] = useState<StatsResponse | 'error' | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      fetch(new URL('/api/stats', SERVER_URL))
        .then((res) => (res.ok ? (res.json() as Promise<StatsResponse>) : Promise.reject(new Error(String(res.status)))))
        .then((value) => alive && setStats(value))
        .catch(() => alive && setStats('error'))
    }
    load()
    const timer = setInterval(load, STATS_EVERY_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return stats
}
