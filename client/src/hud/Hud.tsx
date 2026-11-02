import type { GameSession } from '../game/session.ts'
import { useTicker } from './useTicker.ts'

export function Hud({ session }: { session: GameSession }) {
  useTicker(100)
  return (
    <div className="hud">
      <p className="hud-hp">
        HP <strong>{session.myHp()}</strong> · 킬 <strong>{session.myKills()}</strong>
      </p>
      <p className="hud-keys">
        ← ↑ → ↓ 이동 · Shift 달리기 · Space 점프 · A·S 펀치 · D 발차기 · F 가드 · G 잡기
        {import.meta.env.DEV && ' · ` 디버그'}
      </p>
      <p className="hud-keys">달리며 공격 = 돌진 · 점프 중 D = 날아차기 · 잡은 뒤 방향키 = 던지기</p>
    </div>
  )
}
