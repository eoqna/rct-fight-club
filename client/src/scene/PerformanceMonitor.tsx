import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { renderStats, type QualityTier } from './quality.ts'

/** 프레임 속도를 재는 구간 (초) */
const WINDOW = 1
/** 이보다 느리면 해상도를 한 단계 내리고, 이보다 빠른 구간이 RAISE_AFTER번 이어지면 한 단계 올린다 (fps) */
const LOWER_BELOW = 48
const RAISE_ABOVE = 57
const RAISE_AFTER = 5
const STEP = 0.25

/**
 * 프레임이 떨어지면 해상도 배율을 자동으로 내리고, 넉넉해지면 천천히 되돌린다 (design §7.8, NFR-01·02).
 * 바꾼 직후 한 구간은 재지 않는다 (배율을 바꾸는 순간의 끊김을 세지 않게)
 */
export function PerformanceMonitor({ tier }: { tier: QualityTier }) {
  const setDpr = useThree((state) => state.setDpr)
  const stats = useRef({ dpr: tier.maxDpr, time: 0, frames: 0, fast: 0, skip: true })

  useFrame((_, delta) => {
    const s = stats.current
    s.time += delta
    s.frames++
    if (s.time < WINDOW) return
    const fps = s.frames / s.time
    s.time = 0
    s.frames = 0
    renderStats.tier = tier.name
    renderStats.dpr = s.dpr
    renderStats.fps = fps
    // 개발 빌드 전용: 자동 점검·성능 측정 스크립트가 읽는 창구
    if (import.meta.env.DEV) Object.assign(window, { __fightClubQuality: renderStats })
    if (s.skip) {
      s.skip = false
      return
    }
    let next = s.dpr
    if (fps < LOWER_BELOW) {
      next = Math.max(tier.minDpr, s.dpr - STEP)
      s.fast = 0
    } else if (fps > RAISE_ABOVE && ++s.fast >= RAISE_AFTER) {
      next = Math.min(tier.maxDpr, s.dpr + STEP)
      s.fast = 0
    }
    if (next !== s.dpr) {
      s.dpr = next
      s.skip = true
      setDpr(next)
    }
  })
  return null
}
