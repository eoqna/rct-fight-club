/** 플레이어 동작 상태. 값이 그대로 네트워크로 전송된다 — design §4.2 */
export const Action = {
  Idle: 0,
  Walk: 1,
  Run: 2,
  Air: 3,
  Jab: 10,
  Straight: 11,
  Kick: 12,
  Dash: 13,
  FlyingKick: 14,
  /** 날아차기 착지 후딜 */
  Landing: 15,
  Guard: 20,
  GuardStun: 21,
  GrabTry: 30,
  Holding: 31,
  Throwing: 32,
  Grabbed: 33,
  Thrown: 34,
  Hitstun: 40,
  Knockdown: 41,
  KO: 60,
  Falling: 61,
} as const

export type Action = (typeof Action)[keyof typeof Action]

/** 입력 버튼 비트 — design §5.8 */
export const Btn = {
  PunchL: 1 << 0,
  PunchR: 1 << 1,
  Kick: 1 << 2,
  Jump: 1 << 3,
  Run: 1 << 4,
  Guard: 1 << 5,
  Grab: 1 << 6,
} as const

/** 정의된 모든 버튼 비트 — 입력 값 범위 검증에 쓴다 */
export const ALL_BUTTONS = Object.values(Btn).reduce((bits, bit) => bits | bit, 0)
