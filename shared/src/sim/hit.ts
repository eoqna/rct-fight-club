import { BODY_HEIGHT, BODY_RADIUS } from '../constants.ts'

export interface Sphere {
  x: number
  y: number
  z: number
  r: number
}

/** 히트박스(구)가 발 위치 (x, y, z)에 선 몸통(원기둥)과 겹치는가 — design §4.5 */
export function hitsBody(s: Sphere, x: number, y: number, z: number): boolean {
  const dx = s.x - x
  const dz = s.z - z
  const reach = s.r + BODY_RADIUS
  if (dx * dx + dz * dz > reach * reach) return false
  return s.y + s.r >= y && s.y - s.r <= y + BODY_HEIGHT
}
