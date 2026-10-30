/** 시뮬레이션 틱 (Hz). 프레임 데이터의 기준 — design §5.2 */
export const TICK_RATE = 60

/** 상태 패치 전송 빈도 (Hz). 2틱마다 한 번 — design §5.2 */
export const PATCH_RATE = 30

/** 원격 캐릭터 보간 지연 (ms). 서버 랙 보상도 이 시점으로 되감는다 — design §5.2 */
export const INTERP_DELAY_MS = 100

/** 랙 보상 최대 되감기 (ms) — design §5.2 */
export const MAX_REWIND_MS = 300

// 경기장·몸 (m) — design §4.3
export const ARENA_HALF = 12
export const BODY_RADIUS = 0.4
export const BODY_HEIGHT = 1.8
export const FALL_OUT_Y = -6

// 이동 (m/s, m/s²) — design §4.3
export const WALK_SPEED = 4
export const RUN_SPEED = 6.5
export const MOVE_ACCEL = 40
export const AIR_ACCEL = 10
export const JUMP_SPEED = 7
export const GRAVITY = 20

// 전투 — design §4.6
export const MAX_HP = 100
export const KNOCKBACK_DECEL = 20
