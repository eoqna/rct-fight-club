import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import { createPose, type GameSession, type Spark } from '../game/session.ts'
import { setListener } from '../game/sound.ts'
import type { EffectsSystem } from './effects.ts'

const pose = createPose()

/**
 * 타격 연출: 세션이 모은 명중(내 예측·서버 확정)이 나타날 때가 되면 스파크·가드 고리·히트스톱·흔들림을 낸다.
 * 입자 풀을 매 프레임 진행해 그린다
 */
export function Effects({ session, effects }: { session: GameSession; effects: EffectsSystem }) {
  const shown = useRef(new WeakSet<Spark>())

  useFrame(({ camera, size, viewport, gl }, delta) => {
    // 개발 빌드 전용: 자동 점검·성능 측정이 렌더러 통계(그리기 호출·메모리)를 읽는 창구
    if (import.meta.env.DEV) Object.assign(window, { __fightClubRenderer: gl })
    const now = performance.now()
    // 효과음은 내 캐릭터 자리에서 듣는다
    if (session.pose(session.myId, pose)) setListener(pose.x, pose.z)
    for (const spark of session.sparks) {
      // 남끼리의 명중은 보간 지연만큼 늦게 나타난다 (born이 미래)
      if (spark.born > now || shown.current.has(spark)) continue
      shown.current.add(spark)
      if (spark.guarded) effects.guard(spark.x, spark.y, spark.z)
      else effects.hit(spark.x, spark.y, spark.z, spark.heavy)
      effects.impact(spark.attacker, spark.victim, spark.heavy, spark.guarded, now)
    }
    const fov = (camera as PerspectiveCamera).fov
    effects.update(delta, (size.height * viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360)))
  })

  return (
    <>
      <primitive object={effects.dust.points} dispose={null} />
      <primitive object={effects.sparks.points} dispose={null} />
      <primitive object={effects.rings.points} dispose={null} />
    </>
  )
}
