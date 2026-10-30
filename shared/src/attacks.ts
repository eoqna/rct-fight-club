export interface AttackDef {
  /** 선딜·판정·후딜 (프레임) */
  startup: number
  active: number
  recovery: number
  damage: number
  /** 공격자 발 위치에서 히트박스 중심까지의 수평 거리 (m) */
  reach: number
  /** 히트박스 반지름 (m) */
  radius: number
  /** 히트박스 중심 높이 (m) */
  height: number
  /** 넉백 거리 (m) */
  knockback: number
  /** 피격 경직 (프레임) */
  hitstun: number
}

/** 공격 프레임 데이터 — design §4.4 (플레이테스트로 조정) */
export const ATTACKS = {
  jab: {
    startup: 5, active: 3, recovery: 10,
    damage: 5, reach: 0.9, radius: 0.35, height: 1.3,
    knockback: 0.4, hitstun: 12,
  },
} as const satisfies Record<string, AttackDef>

export type AttackId = keyof typeof ATTACKS
