import { useEffect, useState } from 'react'
import { Client } from '@colyseus/sdk'
import { DEFAULT_PORT, ROOM_NAME } from '@fight-club/shared'

const SERVER_URL =
  import.meta.env.VITE_GAME_SERVER_URL ?? `http://${location.hostname}:${DEFAULT_PORT}`

type Connection =
  | { status: 'connecting' }
  | { status: 'connected'; tick: number }
  | { status: 'error'; message: string }

function App() {
  const [connection, setConnection] = useState<Connection>({ status: 'connecting' })

  useEffect(() => {
    const client = new Client(SERVER_URL)
    const joining = client.joinOrCreate<{ tick: number }>(ROOM_NAME)
    let disposed = false

    joining
      .then((room) => {
        if (disposed) return
        room.onStateChange((state) => {
          setConnection({ status: 'connected', tick: state.tick })
        })
      })
      .catch((error: unknown) => {
        if (!disposed) setConnection({ status: 'error', message: String(error) })
      })

    return () => {
      disposed = true
      joining.then((room) => room.leave()).catch(() => {})
    }
  }, [])

  return (
    <main className="connection">
      <h1>Fight Club</h1>
      {connection.status === 'connecting' && <p>서버에 연결하는 중…</p>}
      {connection.status === 'connected' && (
        <p>
          연결됨 · 서버 틱 <strong data-testid="tick">{connection.tick}</strong>
        </p>
      )}
      {connection.status === 'error' && <p role="alert">연결 실패: {connection.message}</p>}
    </main>
  )
}

export default App
