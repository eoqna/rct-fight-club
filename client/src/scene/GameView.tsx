import { Canvas, advance } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import type { GameSession } from '../game/session.ts'
import { playSound } from '../game/sound.ts'
import { DebugOverlay } from '../hud/DebugOverlay.tsx'
import { Hud } from '../hud/Hud.tsx'
import { KeyGuide } from '../hud/KeyGuide.tsx'
import { NameTagLayer, NameTagProjector } from '../hud/NameTags.tsx'
import { TagRegistry } from '../hud/tagRegistry.ts'
import { Arena } from './Arena.tsx'
import { CameraRig } from './CameraRig.tsx'
import { DebugVisuals } from './DebugVisuals.tsx'
import { Effects } from './Effects.tsx'
import { EffectsSystem } from './effects.ts'
import { Lighting } from './Lighting.tsx'
import { PerformanceMonitor } from './PerformanceMonitor.tsx'
import { Players } from './Players.tsx'
import { detectQuality } from './quality.ts'
import { FOG } from './fog.ts'
import { Sky } from './Sky.tsx'

export function GameView({ session }: { session: GameSession }) {
  const tier = useMemo(() => detectQuality(), [])
  const tags = useMemo(() => new TagRegistry(), [])
  const effects = useMemo(() => new EffectsSystem(session.myId, playSound, tier.particles), [session, tier])
  useEffect(() => () => effects.dispose(), [effects])

  // 한 rAF 안에서 입력을 먼저 보내고(예측 진행) 그 다음에 그린다 — Predict의 권장 순서
  useEffect(() => {
    // 개발 빌드 전용: 브라우저 자동 점검 스크립트가 세션 상태를 읽는 창구
    if (import.meta.env.DEV) Object.assign(window, { __fightClub: session, __fightClubEffects: effects })
    let frame = requestAnimationFrame(function loop(now) {
      session.frame(now)
      // frameloop="never"에서는 넘긴 시각의 단위가 그대로 useFrame의 delta가 된다 — 초로 넘긴다
      advance(now / 1000)
      frame = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(frame)
  }, [session, effects])

  return (
    <div className="game">
      <AssetErrorBoundary>
        {/* flat: 톤 매핑 없이 — 캐릭터를 승인한 미리보기와 같은 색으로 보인다. 품질 단계는 design §7.8 */}
        <Canvas
          frameloop="never" flat shadows={tier.shadows} dpr={tier.maxDpr} gl={{ antialias: tier.antialias }}
          camera={{ fov: 40, near: 0.1, far: 200, position: [0, 13, 9] }}
        >
          <PerformanceMonitor tier={tier} />
          <fog attach="fog" args={[FOG.color, FOG.near, FOG.far]} />
          <Sky />
          <Lighting session={session} shadows={tier.shadows} />
          <Arena />
          <Suspense fallback={null}>
            <Players session={session} effects={effects} shadows={tier.shadows} />
          </Suspense>
          <Effects session={session} effects={effects} />
          <DebugVisuals session={session} />
          <CameraRig session={session} effects={effects} />
          <NameTagProjector session={session} tags={tags} />
        </Canvas>
      </AssetErrorBoundary>
      <NameTagLayer session={session} tags={tags} />
      <Hud session={session} />
      <KeyGuide session={session} />
      {import.meta.env.DEV && <DebugOverlay session={session} />}
    </div>
  )
}

/** 캐릭터 에셋을 받지 못하면 3D 화면 대신 안내를 보여준다 (입장 화면의 오류 안내는 P4) */
class AssetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return <p role="alert" className="scene-error">캐릭터를 불러오지 못했습니다. 새로고침해 주세요.</p>
    return this.props.children
  }
}
