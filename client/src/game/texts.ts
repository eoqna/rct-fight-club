import { CloseCode, JoinRejectStatus, MAX_CONNECTIONS_PER_IP, type ElimCause } from '@fight-club/shared/protocol'

/** 화면에 나오는 닉네임 기능의 이름 — 바꾸기 쉽게 한곳에 둔다 (design §4.11, R6) */
export const NAME_STYLE = '인디언식 이름'

/** 캐릭터 소개 (CHARACTER_MODELS 순서) — 능력치는 모두 같다 (FR-07) */
export const CHARACTER_BLURBS = [
  '장검을 든 기사',
  '도끼를 멘 곰 모자 전사',
  '풍선검을 휘두르는 광대',
  '맨손의 유도 고수',
  '단검을 쥔 그림자',
] as const

/** 결과 화면 제목 (탈락 원인별) */
export const CAUSE_TITLES: Record<ElimCause, string> = {
  ko: '쓰러졌습니다',
  ringout: '경기장 밖으로 날아갔습니다',
  selfout: '발을 헛디뎠습니다',
  afk: '자리를 비워 퇴장했습니다',
}

/** 서버 점검(배포·재시작) 중 — 경기 중에 끊겼을 때와 들어가지 못했을 때 */
export const MAINTENANCE_TEXT = '서버를 점검하고 있습니다. 잠시 뒤 다시 들어와 주세요.'

/** 경기 중에 서버와 연결이 끊겼을 때의 안내 */
export function disconnectText(code: number): string {
  if (code === CloseCode.Maintenance) return MAINTENANCE_TEXT
  return `서버와 연결이 끊어졌습니다 (코드 ${code}). 다시 입장해 주세요.`
}

/** 경기장에 들어가지 못했을 때의 안내 — 서버가 거절한 이유별 (design §6.7). detail은 알 수 없는 오류일 때 덧붙인다 */
export function joinFailureText(code: number | undefined, detail: string): string {
  switch (code) {
    case CloseCode.TooManyConnections:
      return `같은 인터넷 연결에서는 동시에 ${MAX_CONNECTIONS_PER_IP}명까지만 들어올 수 있습니다. 다른 창을 닫고 다시 시도해 주세요.`
    case JoinRejectStatus.TooManyRequests:
      return '입장 시도가 너무 잦습니다. 1분쯤 뒤에 다시 시도해 주세요.'
    case JoinRejectStatus.Forbidden:
      return '이 페이지에서는 게임 서버에 들어갈 수 없습니다.'
    // 서버가 종료 중(503)이거나 다시 시작하는 동안 Caddy가 돌려주는 응답(502·504)
    case 502:
    case 503:
    case 504:
      return MAINTENANCE_TEXT
    default:
      return `경기장에 들어가지 못했습니다. 잠시 뒤 다시 시도해 주세요. (${detail})`
  }
}
