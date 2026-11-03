import type { StrikeId } from './attacks.ts'
import type { NameIndex } from './nickname.ts'

/** 경기장 방 이름 — 서버 `defineRoom`과 클라이언트 `joinOrCreate`가 함께 쓴다 */
export const ROOM_NAME = 'arena'

/** 게임 서버 기본 포트 */
export const DEFAULT_PORT = 2567

/** 프로토콜 버전 — 입장할 때 보내고, 서버와 다르면 4002로 거절한다 (클라이언트는 새로고침을 안내) */
export const PROTOCOL_VERSION = 1

/** 메시지 이름 */
export const Msg = {
  /** 서버 → 모두: 명중 확정 */
  Hit: 'hit',
  /** 서버 → 모두: 누군가 탈락했다 */
  Elim: 'elim',
  /** 서버 → 탈락한 본인: 결과. 직후 CloseCode.Eliminated로 연결이 끊긴다 */
  Result: 'result',
  /** 개발 전용, 서버 → 모두: 지연 주입이 바뀌었다 — 클라이언트는 다시 입장한다 */
  DevLatency: 'dev:latency',
  /** 개발 전용, 클라이언트 → 서버: 연습용 샌드백 소환·정리 */
  DevDummy: 'dev:dummy',
} as const

/** 입장 요청 — design §5.3. 캐릭터·이름이 없거나 범위를 벗어나면 서버가 무작위로 정한다 */
export interface JoinOptions {
  /** PROTOCOL_VERSION */
  v: number
  characterId?: number
  /** 이름은 인덱스만 보낸다. 문자열은 서버가 조립한다 (design §4.11) */
  name?: NameIndex
}

/** GET /api/stats — 시작 화면의 접속자 수 (5초 캐시) */
export interface StatsResponse {
  /** 경기장에 들어와 있는 사람 수 (봇 제외) */
  online: number
  arenas: number
}

/** 서버가 연결을 끊을 때 쓰는 종료 코드 — design §5.8 */
export const CloseCode = {
  /** 탈락 → 결과 화면 */
  Eliminated: 4001,
  /** 클라이언트 버전이 서버와 다르다 → 새로고침 안내 */
  VersionMismatch: 4002,
} as const

/** 명중 확정 — design §5.8 */
export interface HitEvent {
  tick: number
  attacker: string
  victim: string
  attack: StrikeId
  /** 정면 가드로 막았다 */
  guarded: boolean
  damage: number
  hp: number
}

/** ko: HP 0, ringout: 맞고 떨어짐, selfout: 혼자 떨어짐, afk: 자리 비움 — design §4.9 */
export type ElimCause = 'ko' | 'ringout' | 'selfout' | 'afk'

export interface ElimEvent {
  tick: number
  victim: string
  victimName: string
  /** 킬을 얻은 플레이어 (없으면 생략) */
  killer?: string
  killerName?: string
  cause: ElimCause
}

export interface ResultMsg {
  survivalMs: number
  kills: number
  cause: ElimCause
  killer?: string
  killerName?: string
  /** 경기장에서 오른 최고 순위 (1부터) — FR-39 */
  bestRank: number
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
