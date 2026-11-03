import { useCallback, useEffect, useState } from 'react'
import { MAX_HP } from '@fight-club/shared'
import { formatDuration } from '../game/format.ts'
import type { FeedEntry, GameSession } from '../game/session.ts'
import { isMuted, setMuted } from '../game/sound.ts'
import { ControlsGuide } from '../screens/ControlsGuide.tsx'
import { useTicker } from './useTicker.ts'

const GUIDE_SEEN_KEY = 'fight-club:guide-seen'

/** 게임 화면의 HUD — 내 상태(왼쪽 위), 경기장 정보(가운데 위), 킬 피드·순위표(오른쪽 위), 조작법 (design §7.6) */
export function Hud({ session }: { session: GameSession }) {
  useTicker(200)
  return (
    <>
      <MyStatus session={session} />
      <ArenaInfo session={session} />
      <MaintenanceBanner session={session} />
      <div className="hud-right">
        <KillFeed session={session} />
        <Leaderboard session={session} />
      </div>
      <GameGuide />
    </>
  )
}

/** HP·킬·생존 시간 (FR-42) */
function MyStatus({ session }: { session: GameSession }) {
  const hp = session.myHp()
  return (
    <div className="hud">
      <div className="hud-hp" aria-label={`HP ${hp}`}>
        <span className="hud-hp-bar"><i style={{ width: `${(hp / MAX_HP) * 100}%` }} /></span>
        <strong>{hp}</strong>
      </div>
      <p className="hud-line">킬 <strong>{session.myKills()}</strong> · 생존 <strong>{formatDuration(session.mySurvivalMs())}</strong></p>
      <p className="hud-keys">
        H 조작법 · Shift 달리기 · Space 점프
        {import.meta.env.DEV && ' · ` 디버그'}
      </p>
      <MuteButton />
    </div>
  )
}

/** `경기장 #3 · 12/16 · 32ms` (FR-05) */
function ArenaInfo({ session }: { session: GameSession }) {
  const { arenaNo, humans, capacity } = session.arenaInfo()
  return (
    <div className="hud-arena">
      경기장 #{arenaNo} · {humans}/{capacity} · {session.stats().rttMs}ms
    </div>
  )
}

/** 서버 점검(배포·재시작) 안내 — 몇 초 뒤 연결이 끊긴다 */
function MaintenanceBanner({ session }: { session: GameSession }) {
  const seconds = session.maintenanceSecondsLeft()
  if (seconds === null) return null
  return (
    <div className="maintenance-banner" role="alert">
      서버 점검으로 {seconds}초 뒤 연결이 끊깁니다. 잠시 뒤 다시 들어와 주세요.
    </div>
  )
}

/** 최근 탈락 소식 5개, 5초 동안 (FR-43). 나와 얽힌 줄은 눈에 띄게 */
function KillFeed({ session }: { session: GameSession }) {
  const feed = session.killFeed()
  if (feed.length === 0) return null
  return (
    <ol className="killfeed" aria-label="킬 피드">
      {feed.map((entry) => (
        <li key={`${entry.tick}:${entry.victim}`} className={entry.victim === session.myId || entry.killer === session.myId ? 'mine' : undefined}>
          {feedText(entry)}
        </li>
      ))}
    </ol>
  )
}

function feedText(e: FeedEntry) {
  const victim = <b>{e.victimName}</b>
  const killer = e.killerName ? <b>{e.killerName}</b> : null
  switch (e.cause) {
    case 'ko':
      return killer ? <>{killer} 👊 {victim}</> : <>💀 {victim} 쓰러짐</>
    case 'ringout':
      return killer ? <>{killer} 🌀 {victim} 밖으로</> : <>🌀 {victim} 추락</>
    case 'selfout':
      return <>🍃 {victim} 추락</>
    case 'afk':
      return <>💤 {victim} 자리 비움</>
  }
}

/** 순위표: 위쪽 5명과 내 순위 — 킬이 많을수록, 같으면 먼저 온 사람이 앞 (FR-44) */
function Leaderboard({ session }: { session: GameSession }) {
  const rows = session.leaderboard()
  return (
    <ol className="leaderboard" aria-label="순위표">
      {rows.map((row) => (
        <li key={row.id} className={row.me ? 'me' : undefined}>
          <span className="rank">{row.rank}</span>
          <span className="who">{row.isBot ? '🤖 ' : ''}{row.name}</span>
          <span className="kills">{row.kills}</span>
        </li>
      ))}
    </ol>
  )
}

/** 처음 입장할 때 조작법을 보여 주고, H 키로 다시 연다 (design §7.6) */
function GameGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_SEEN_KEY) !== '1'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, '1')
    } catch {
      // 저장소를 쓸 수 없으면 매번 보여 준다
    }
  }, [])
  useEffect(() => {
    if (open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyH' && !e.repeat) setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const close = useCallback(() => setOpen(false), [])
  return open ? <ControlsGuide onClose={close} /> : null
}

/** 소리 켜기·끄기 (M 키도 같다). 설정은 다음 방문에도 남는다 (design §7.9) */
function MuteButton() {
  const [muted, setMutedState] = useState(isMuted)
  const toggle = useCallback(() => {
    setMuted(!isMuted())
    setMutedState(isMuted())
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyM' && !e.repeat) toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
  // 누른 뒤에도 포커스를 가져가지 않는다 — 그래야 Space(점프)가 버튼을 다시 누르지 않는다
  return (
    <button type="button" className="hud-mute" tabIndex={-1} aria-pressed={muted} onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
      {muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'}
    </button>
  )
}
