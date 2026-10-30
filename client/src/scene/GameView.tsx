import { Canvas, advance } from '@react-three/fiber'
import { useEffect } from 'react'
import type { GameSession } from '../game/session.ts'
import { DebugOverlay } from '../hud/DebugOverlay.tsx'
import { Hud } from '../hud/Hud.tsx'
import { Arena } from './Arena.tsx'
import { CameraRig } from './CameraRig.tsx'
import { DebugVisuals } from './DebugVisuals.tsx'
import { Players } from './Players.tsx'
import { Sparks } from './Sparks.tsx'

export function GameView({ session }: { session: GameSession }) {
  // 한 rAF 안에서 입력을 먼저 보내고(예측 진행) 그 다음에 그린다 — Predict의 권장 순서
  useEffect(() => {
    // 개발 빌드 전용: 브라우저 자동 점검 스크립트가 세션 상태를 읽는 창구
    if (import.meta.env.DEV) Object.assign(window, { __fightClub: session })
    let frame = requestAnimationFrame(function loop(now) {
      session.frame(now)
      advance(now)
      frame = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(frame)
  }, [session])

  return (
    <div className="game">
      <Canvas frameloop="never" dpr={[1, 2]} camera={{ fov: 40, near: 0.1, far: 200, position: [0, 13, 9] }}>
        <color attach="background" args={['#141927']} />
        <hemisphereLight args={['#dfe9ff', '#30283a', 1]} />
        <directionalLight position={[6, 14, 8]} intensity={1.6} />
        <Arena />
        <Players session={session} />
        <Sparks session={session} />
        <DebugVisuals session={session} />
        <CameraRig session={session} />
      </Canvas>
      <Hud session={session} />
      {import.meta.env.DEV && <DebugOverlay session={session} />}
    </div>
  )
}
