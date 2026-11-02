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

/** 플레이어 상태. 앞쪽 필드(x ~ invuln)가 stepPlayer가 다루는 시뮬레이션 상태다 — design §5.8 */
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
  hp: t.uint8().default(MAX_HP),
  kills: t.uint16().default(0),
  /** 사람이 아닌 대상 (지금은 개발용 샌드백, P5부터 봇) */
  isBot: t.boolean().default(false),
}, 'PlayerState')

export type PlayerState = SchemaType<typeof PlayerState>

/** 클라이언트 예측(Reconciler)이 서버 값으로 맞추는 필드 — 시뮬레이션 상태 전부 (HP·킬 제외) */
export const SIM_FIELDS = [
  'x', 'y', 'z', 'vx', 'vy', 'vz', 'fx', 'fz', 'action', 'actionFrame', 'stun', 'buffered', 'invuln',
] as const satisfies readonly (keyof PlayerState)[]

export const ArenaState = schema({
  /** 서버 시뮬레이션 틱 */
  tick: t.uint32().default(0),
  /** 키는 sessionId */
  players: t.map(PlayerState),
}, 'ArenaState')

export type ArenaState = SchemaType<typeof ArenaState>
