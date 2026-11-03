import { schema, t, type SchemaType } from '@colyseus/schema'
import { Action } from './actions.ts'
import { MAX_HP } from './constants.ts'

/** 클라이언트 → 서버 입력. 60Hz 스텝마다 하나씩 보낸다 — design §5.8 */
export const PlayerInput = schema({
  mx: t.int8().default(0),
  mz: t.int8().default(0),
  held: t.uint8().default(0),
  pressed: t.uint8().default(0),
}, 'PlayerInput')

export type PlayerInput = SchemaType<typeof PlayerInput>

/** 플레이어 상태. 앞쪽 필드(x ~ grabCooldown)가 stepPlayer가 다루는 시뮬레이션 상태다 — design §5.8 */
export const PlayerState = schema({
  x: t.float32().default(0),
  y: t.float32().default(0),
  z: t.float32().default(0),
  vx: t.float32().default(0),
  vy: t.float32().default(0),
  vz: t.float32().default(0),
  fx: t.float32().default(0),
  fz: t.float32().default(1),
  action: t.uint8().default(Action.Idle),
  actionFrame: t.uint16().default(0),
  /** 경직 길이 (프레임) */
  stun: t.uint8().default(0),
  /** 선입력된 다음 동작 (0 = 없음) */
  buffered: t.uint8().default(0),
  /** 남은 무적 프레임 */
  invuln: t.uint8().default(0),
  /** 다시 찰 수 있을 때까지 남은 프레임 (발차기·날아차기) */
  kickCooldown: t.uint16().default(0),
  /** 다시 잡을 수 있을 때까지 남은 프레임 */
  grabCooldown: t.uint16().default(0),
  hp: t.uint8().default(MAX_HP),
  kills: t.uint16().default(0),
  /** 사람이 아닌 대상 (지금은 개발용 샌드백, P5부터 봇) */
  isBot: t.boolean().default(false),
  /** 닉네임 — 서버가 인덱스로 조립한다 */
  name: t.string().default(''),
  /** 들어온 틱 — 순위가 같으면 먼저 온 사람이 앞선다 */
  joinTick: t.uint32().default(0),
  /** 캐릭터 번호 (0 ~ CHARACTER_COUNT-1) */
  characterId: t.uint8().default(0),
  /** 색상 변형 (0 ~ VARIANT_COUNT-1) — 같은 캐릭터끼리 가장 적게 쓰인 것 */
  variant: t.uint8().default(0),
}, 'PlayerState')

export type PlayerState = SchemaType<typeof PlayerState>

/** 클라이언트 예측(Reconciler)이 서버 값으로 맞추는 필드 — 시뮬레이션 상태 전부 (HP·킬 제외) */
export const SIM_FIELDS = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'fx', 'fz', 'action', 'actionFrame', 'stun', 'buffered', 'invuln', 'kickCooldown', 'grabCooldown',
] as const satisfies readonly (keyof PlayerState)[]

export const ArenaState = schema({
  /** 서버 시뮬레이션 틱 */
  tick: t.uint32().default(0),
  /** 경기장 번호 — 쓰고 있지 않은 가장 작은 번호 (#1, #2 …) */
  arenaNo: t.uint16().default(0),
  /** 키는 sessionId */
  players: t.map(PlayerState),
}, 'ArenaState')

export type ArenaState = SchemaType<typeof ArenaState>
