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
/** 이 범위를 벗어나면 떨어진 것으로 본다 (m) — design §4.9 */
export const OUT_OF_BOUNDS = 30

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
/** 후딜 마지막 몇 프레임 안에 누른 공격은 후딜이 끝나자마자 나간다 */
export const INPUT_BUFFER_FRAMES = 6

// 조준 보정: 공격 첫 프레임에 앞쪽 ±45°, 2m 안의 가장 가까운 상대 쪽으로 돈다 — design §4.5
export const AIM_ASSIST_RANGE = 2
export const AIM_ASSIST_COS = Math.SQRT1_2

// 가드 — design §4.5·§4.6
/** 정면 판정: 바라보는 방향과 공격자 쪽 사이 각도가 70° 이내 (cos 70°) */
export const GUARD_FRONT_COS = 0.342
export const GUARD_DAMAGE_RATE = 0.2
export const GUARD_KNOCKBACK_RATE = 0.3
export const GUARD_STUN_FRAMES = 8

// 연속 피격 → 다운 → 기상 무적 (프레임) — design §4.6
export const COMBO_WINDOW_FRAMES = 90
export const COMBO_KNOCKDOWN_HITS = 4
export const KNOCKDOWN_FRAMES = 48
export const GETUP_INVULN_FRAMES = 60

// 입장 무적·KO (프레임) — design §4.4·§4.9
export const SPAWN_INVULN_FRAMES = 180
export const KO_FRAMES = 60

// 탈락 (프레임) — design §4.9
/** 낙사 직전 이 시간 안에 마지막으로 때린 사람이 킬을 얻는다 */
export const RINGOUT_CREDIT_FRAMES = 300
/** 이 시간 동안 의미 있는 입력이 없으면 자리 비움으로 퇴장 */
export const AFK_FRAMES = 3600
