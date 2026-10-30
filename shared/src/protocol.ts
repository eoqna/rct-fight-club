import type { AttackId } from './attacks.ts'

/** 경기장 방 이름 — 서버 `defineRoom`과 클라이언트 `joinOrCreate`가 함께 쓴다 */
export const ROOM_NAME = 'arena'

/** 게임 서버 기본 포트 */
export const DEFAULT_PORT = 2567

/** 메시지 이름 */
export const Msg = {
  /** 서버 → 모두: 명중 확정 */
  Hit: 'hit',
  /** 개발 전용, 서버 → 모두: 지연 주입이 바뀌었다 — 클라이언트는 다시 입장한다 */
  DevLatency: 'dev:latency',
  /** 개발 전용, 클라이언트 → 서버: 연습용 샌드백 소환·정리 */
  DevDummy: 'dev:dummy',
} as const

/** 명중 확정 — design §5.8 */
export interface HitEvent {
  tick: number
  attacker: string
  victim: string
  attack: AttackId
  damage: number
  hp: number
}

export interface DevLatencyEvent {
  /** 주입된 왕복 지연 (ms) */
  latencyMs: number
}

/** still: 서 있는 샌드백, patrol: 좌우로 왕복하는 샌드백, clear: 모두 치우기 */
export type DevDummyKind = 'still' | 'patrol' | 'clear'

export interface DevDummyCommand {
  kind: DevDummyKind
}
