import { DEFAULT_PORT } from '@fight-club/shared/protocol'

/**
 * 게임 서버 주소 (http/https). VITE_GAME_SERVER_URL이 없으면 개발 중에는 현재 호스트의 기본 포트,
 * 운영 빌드는 화면과 같은 주소다 — 같은 VM의 Caddy가 화면과 게임 서버를 한 도메인으로 내보낸다 (design §8.1)
 */
export const SERVER_URL =
  import.meta.env.VITE_GAME_SERVER_URL ?? (import.meta.env.DEV ? `http://${location.hostname}:${DEFAULT_PORT}` : location.origin)
