/** 맞았을 때의 효과 — 공격과 던지기가 함께 쓴다 */
export interface StrikeDef {
  damage: number
  /** 넉백 거리 (m) */
  knockback: number
  /** 피격 경직 (프레임) */
  hitstun: number
}

export interface AttackDef extends StrikeDef {
  /** 선딜·판정·후딜 (프레임) */
  startup: number
  active: number
  recovery: number
  /** 공격자 발 위치에서 히트박스 중심까지의 수평 거리 (m) */
  reach: number
  /** 히트박스 반지름 (m) */
  radius: number
  /** 히트박스 중심 높이 (m) */
  height: number
}

/**
 * 공격 프레임 데이터 — design §4.4 (플레이테스트로 조정)
 * - dash: 선딜+판정 동안 2m를 내달린 뒤 그 자리에 선다
 * - flyingKick: 판정은 착지할 때까지(최대 active), 후딜은 착지 뒤
 */
export const ATTACKS = {
  jab: {
    startup: 5, active: 3, recovery: 10,
    damage: 5, reach: 0.9, radius: 0.35, height: 1.3, knockback: 0.4, hitstun: 12,
  },
  straight: {
    startup: 8, active: 3, recovery: 16,
    damage: 8, reach: 1.0, radius: 0.35, height: 1.3, knockback: 1.0, hitstun: 18,
  },
  kick: {
    startup: 14, active: 4, recovery: 22,
    damage: 12, reach: 1.3, radius: 0.45, height: 0.9, knockback: 2.5, hitstun: 30,
  },
  dash: {
    startup: 6, active: 8, recovery: 26,
    damage: 12, reach: 1.0, radius: 0.5, height: 1.1, knockback: 2.5, hitstun: 30,
  },
  flyingKick: {
    startup: 6, active: 30, recovery: 18,
    damage: 14, reach: 1.2, radius: 0.5, height: 0.9, knockback: 3.0, hitstun: 33,
  },
} as const satisfies Record<string, AttackDef>

export type AttackId = keyof typeof ATTACKS

/** 맞힌 공격 종류 (던지기 포함) */
export type StrikeId = AttackId | 'throw'

/** 돌진 공격이 내달리는 거리 (m) */
export const DASH_DISTANCE = 2

/** 잡기: 선딜·판정·헛잡기 후딜 (프레임), 판정 위치 — design §4.7 */
export const GRAB = {
  startup: 6, active: 3, recovery: 24,
  reach: 0.8, radius: 0.4, height: 1.1,
  /** 잡은 뒤 방향 입력을 기다리는 시간. 지나면 바라보는 방향으로 던진다 */
  holdFrames: 36,
} as const

/** 던지기: 던지는 동작 중 놓는 프레임, 놓은 뒤 후딜, 맞은 쪽 효과 — design §4.7 */
export const THROW = {
  release: 10, recovery: 12,
  damage: 10, knockback: 5, hitstun: 42,
} as const satisfies StrikeDef & { release: number; recovery: number }
