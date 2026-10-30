import { schema, t, type SchemaType } from '@colyseus/schema'

export const ArenaState = schema({
  /** 서버 시뮬레이션 틱. 보간·랙 보상의 기준 시각 — design §5.8 */
  tick: t.uint32().default(0),
}, 'ArenaState')

export type ArenaState = SchemaType<typeof ArenaState>
