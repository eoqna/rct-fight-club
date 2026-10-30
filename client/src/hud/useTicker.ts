import { useEffect, useState } from 'react'

/** intervalMs마다 다시 그린다 — 게임 루프가 계속 바꾸는 값을 HUD에 가볍게 보여줄 때 쓴다 */
export function useTicker(intervalMs: number) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
}
