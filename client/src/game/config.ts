import { DEFAULT_PORT } from '@fight-club/shared/protocol'

/** 게임 서버 주소 (http/https). 없으면 현재 호스트의 기본 포트로 접속한다 */
export const SERVER_URL =
  import.meta.env.VITE_GAME_SERVER_URL ?? `http://${location.hostname}:${DEFAULT_PORT}`
