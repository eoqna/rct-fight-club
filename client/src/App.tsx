import { useEffect, useState } from 'react'
import { GameSession, type SessionEnd } from './game/session.ts'
import { ResultScreen } from './hud/ResultScreen.tsx'
import { GameView } from './scene/GameView.tsx'

type Screen =
  | { status: 'connecting' }
  | { status: 'playing'; session: GameSession }
  | { status: 'ended'; end: SessionEnd }
  | { status: 'error'; message: string }

function App() {
  /** 다시 입장할 때마다 1씩 늘려 새 연결을 연다 */
  const [attempt, setAttempt] = useState(0)
  const [screen, setScreen] = useState<Screen>({ status: 'connecting' })

  useEffect(() => {
    let disposed = false
    const connecting = GameSession.connect()

    connecting
      .then((session) => {
        if (disposed) return session.dispose()
        session.onEnd((end) => {
          // 결과 화면에서는 게임이 키 입력을 가로채지 않도록 바로 정리한다
          session.dispose()
          setScreen({ status: 'ended', end })
        })
        setScreen({ status: 'playing', session })
      })
      .catch((error: unknown) => {
        if (!disposed) setScreen({ status: 'error', message: String(error) })
      })

    return () => {
      disposed = true
      connecting.then((session) => session.dispose()).catch(() => {})
    }
  }, [attempt])

  const retry = () => {
    setScreen({ status: 'connecting' })
    setAttempt((n) => n + 1)
  }

  if (screen.status === 'playing') return <GameView session={screen.session} />
  if (screen.status === 'ended') return <ResultScreen end={screen.end} onRetry={retry} />

  return (
    <main className="connection">
      <h1>Fight Club</h1>
      {screen.status === 'connecting'
        ? <p>서버에 연결하는 중…</p>
        : (
            <>
              <p role="alert">연결 실패: {screen.message}</p>
              <button type="button" onClick={retry}>다시 시도</button>
            </>
          )}
    </main>
  )
}

export default App
