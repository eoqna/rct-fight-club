import type { ElimCause } from '@fight-club/shared/protocol'

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
