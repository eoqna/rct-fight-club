import { boot, type ColyseusTestServer } from '@colyseus/testing'
import { ROOM_NAME } from '@fight-club/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../src/app.ts'

describe('게임 서버', () => {
  let colyseus: ColyseusTestServer<typeof server>

  beforeAll(async () => {
    colyseus = await boot(server)
  })
  afterAll(() => colyseus.shutdown())
  beforeEach(() => colyseus.cleanup())

  it('헬스 체크에 응답한다', async () => {
    const res = await colyseus.http.get('/healthz')
    expect(res.data).toBe('ok')
  })

  it('입장한 클라이언트가 서버 틱을 계속 동기화받는다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await colyseus.connectTo(room)
    await client.waitForInitialState()
    const firstTick = client.state.tick

    await client.waitForNextPatch()
    await client.waitForNextPatch()

    expect(client.state.tick).toBeGreaterThan(firstTick)
    expect(client.state.tick).toBeLessThanOrEqual(room.state.tick)
  })
})
