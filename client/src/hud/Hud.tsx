import type { GameSession } from '../game/session.ts'
import { useTicker } from './useTicker.ts'

export function Hud({ session }: { session: GameSession }) {
  useTicker(100)
  return (
    <div className="hud">
      <p className="hud-hp">
        HP <strong>{session.myHp()}</strong>
      </p>
      <p className="hud-keys">
        ← ↑ → ↓ 이동 · Shift 달리기 · Space 점프 · A 잽{import.meta.env.DEV && ' · ` 디버그'}
      </p>
    </div>
  )
}
