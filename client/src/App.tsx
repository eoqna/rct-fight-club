import { useEffect, useState } from 'react'
import { GameSession } from './game/session.ts'
import { GameView } from './scene/GameView.tsx'

type Connection =
  | { status: 'connecting' }
  | { status: 'connected'; session: GameSession }
  | { status: 'error'; message: string }

function App() {
  const [connection, setConnection] = useState<Connection>({ status: 'connecting' })

  useEffect(() => {
    let disposed = false
    const connecting = GameSession.connect()

    connecting
      .then((session) => {
        if (disposed) session.dispose()
        else setConnection({ status: 'connected', session })
      })
      .catch((error: unknown) => {
        if (!disposed) setConnection({ status: 'error', message: String(error) })
      })

    return () => {
      disposed = true
      connecting.then((session) => session.dispose()).catch(() => {})
    }
  }, [])

  if (connection.status === 'connected') return <GameView session={connection.session} />

  return (
    <main className="connection">
      <h1>Fight Club</h1>
      {connection.status === 'connecting'
        ? <p>서버에 연결하는 중…</p>
        : <p role="alert">연결 실패: {connection.message}</p>}
    </main>
  )
}

export default App
