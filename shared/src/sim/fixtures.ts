import { Action } from '../actions.ts'
import type { PlayerSim } from './player.ts'

/** 테스트용: 원점에서 +z를 바라보고 선 플레이어 */
export function makePlayer(overrides: Partial<PlayerSim> = {}): PlayerSim {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fz: 1,
    action: Action.Idle, actionFrame: 0, stun: 0,
    ...overrides,
  }
}
