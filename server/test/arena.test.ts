import { boot, type ColyseusTestServer } from '@colyseus/testing'
import {
  Action, BODY_RADIUS, Btn, IDLE_INPUT, Msg, PlayerInput, ROOM_NAME, SIM_FIELDS, TICK_RATE, WALK_SPEED, stepPlayer,
  type HitEvent, type PlayerSim, type PlayerState,
} from '@fight-club/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../src/app.ts'

const DT = 1 / TICK_RATE

type TickingRoom = { waitForNextTimestep(): Promise<void> }
type InputSender = { data: PlayerInput; send(): number }

async function waitTicks(room: TickingRoom, n: number) {
  for (let i = 0; i < n; i++) await room.waitForNextTimestep()
}

/** 실제 클라이언트처럼 틱마다 입력 하나를 보낸다. jitterEvery마다 3틱씩 늦게 보낸다 */
async function sendEachTick(
  room: TickingRoom, input: InputSender, count: number,
  stage: (data: PlayerInput, i: number) => void, jitterEvery = 0,
) {
  for (let i = 0; i < count; i++) {
    stage(input.data, i)
    input.send()
    const late = jitterEvery > 0 && i % jitterEvery === jitterEvery - 1
    await waitTicks(room, late ? 3 : 1)
  }
}

function place(p: PlayerState, x: number, z: number) {
  Object.assign(p, { x, y: 0, z, vx: 0, vy: 0, vz: 0, fx: 0, fz: 1, action: Action.Idle, actionFrame: 0 })
}

function copySim(p: PlayerState): PlayerSim {
  return Object.fromEntries(SIM_FIELDS.map((f) => [f, p[f]])) as unknown as PlayerSim
}

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

  it('입장하면 플레이어가 생기고 나가면 사라진다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await colyseus.connectTo(room)
    expect(room.state.players.get(client.sessionId)?.hp).toBe(100)

    await client.leave()
    await waitTicks(room, 2)
    expect(room.state.players.has(client.sessionId)).toBe(false)
  })

  it.each([
    ['일정하게 도착하면', 0],
    ['가끔 3틱씩 늦게 도착해도', 5],
  ])('입력이 %s 공용 시뮬레이션과 똑같이 움직인다', async (_label, jitterEvery) => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await colyseus.connectTo(room)
    await client.waitForInitialState()
    const player = room.state.players.get(client.sessionId)!
    const expected = copySim(player)

    const input = client.input({ type: PlayerInput, mode: 'reliable' })
    await sendEachTick(room, input, 30, (data) => { data.mx = 127 }, jitterEvery)
    await waitTicks(room, 40)

    for (let i = 0; i < 30; i++) stepPlayer(expected, { ...IDLE_INPUT, mx: 127 }, DT)
    for (let i = 0; i < 30; i++) stepPlayer(expected, IDLE_INPUT, DT)
    expect(player.x).toBeCloseTo(expected.x, 6)
    expect(player.z).toBeCloseTo(expected.z, 6)
  })

  it('입력을 실제보다 빨리 보내도 캐릭터가 빨라지지 않는다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await colyseus.connectTo(room)
    await client.waitForInitialState()
    const player = room.state.players.get(client.sessionId)!
    place(player, -10, 0)

    const input = client.input({ type: PlayerInput, mode: 'reliable' })
    const ticks = 20
    for (let t = 0; t < ticks; t++) {
      for (let i = 0; i < 4; i++) {
        input.data.mx = 127
        input.send()
      }
      await room.waitForNextTimestep()
    }

    // 정상 속도라면 (틱 수 + 크레딧 상한 8) 스텝을 넘게 걸을 수 없다. 4배로 보내면 약 3배 거리를 간다
    const maxDistance = (ticks + 8) * WALK_SPEED * DT
    expect(player.x + 10).toBeLessThanOrEqual(maxDistance)
  })

  it('입력이 끊겨도 서버는 시뮬레이션을 계속 진행한다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await colyseus.connectTo(room)
    await client.waitForInitialState()
    const player = room.state.players.get(client.sessionId)!

    const input = client.input({ type: PlayerInput, mode: 'reliable' })
    input.data.pressed = Btn.Jump
    input.send()
    await waitTicks(room, 5)
    expect(player.y).toBeGreaterThan(0)

    await waitTicks(room, 90)
    expect(player.y).toBe(0)
    expect(player.action).toBe(Action.Idle)
  })

  it('다른 플레이어를 통과하지 못하고 맞닿은 자리에서 멈춘다. 서 있는 쪽은 밀리지 않는다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const walker = await colyseus.connectTo(room)
    const blocker = await colyseus.connectTo(room)
    const a = room.state.players.get(walker.sessionId)!
    const b = room.state.players.get(blocker.sessionId)!
    place(a, 0, 0)
    place(b, 2, 0)

    const input = walker.input({ type: PlayerInput, mode: 'reliable' })
    await sendEachTick(room, input, 60, (data) => { data.mx = 127 })

    expect(a.x).toBeCloseTo(2 - BODY_RADIUS * 2, 3)
    expect(b.x).toBeCloseTo(2, 6)
  })

  it('잽은 바로 앞 상대를 맞히고 공격자 반대쪽으로 밀어낸다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const attacker = await colyseus.connectTo(room)
    const victim = await colyseus.connectTo(room)
    const a = room.state.players.get(attacker.sessionId)!
    const b = room.state.players.get(victim.sessionId)!
    place(a, 0, 0)
    place(b, 0, 1)
    // 새 위치가 되감기 기록(최대 300ms)을 채울 때까지 기다린다
    await waitTicks(room, 30)

    const hit = attacker.waitForMessage(Msg.Hit) as Promise<HitEvent>
    const input = attacker.input({ type: PlayerInput, mode: 'reliable' })
    await sendEachTick(room, input, 11, (data, i) => { data.pressed = i === 0 ? Btn.PunchL : 0 })

    expect(await hit).toMatchObject({
      attacker: attacker.sessionId, victim: victim.sessionId, attack: 'jab', damage: 5, hp: 95,
    })
    await waitTicks(room, 30)
    expect(b.hp).toBe(95)
    expect(b.z).toBeCloseTo(1.4, 1)
  })

  it('개발용 샌드백은 요청한 플레이어 앞에 서고, 치우면 사라진다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await colyseus.connectTo(room)
    await client.waitForInitialState()
    place(room.state.players.get(client.sessionId)!, 0, 0)

    client.send(Msg.DevDummy, { kind: 'still' })
    await waitTicks(room, 3)
    const dummies = [...room.state.players.values()].filter((p) => p.isBot)
    expect(dummies).toHaveLength(1)
    expect(dummies[0]).toMatchObject({ x: 0, z: 2.5, hp: 100 })

    client.send(Msg.DevDummy, { kind: 'clear' })
    await waitTicks(room, 3)
    expect([...room.state.players.values()].some((p) => p.isBot)).toBe(false)
  })

  it('움직이는 샌드백은 제자리를 중심으로 좌우로 왕복한다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await colyseus.connectTo(room)
    await client.waitForInitialState()
    place(room.state.players.get(client.sessionId)!, 0, 0)

    client.send(Msg.DevDummy, { kind: 'patrol' })
    await waitTicks(room, 3)
    const dummy = [...room.state.players.values()].find((p) => p.isBot)!
    let minX = dummy.x
    let maxX = dummy.x
    for (let i = 0; i < 150; i++) {
      await room.waitForNextTimestep()
      minX = Math.min(minX, dummy.x)
      maxX = Math.max(maxX, dummy.x)
    }
    expect(maxX).toBeGreaterThan(2)
    expect(minX).toBeLessThan(-1)
  })

  it('개발용 지연 주입 API는 값을 검증하고 현재 값을 알려준다', async () => {
    const ok = await colyseus.http.post('/dev/latency?ms=0')
    expect(ok.data).toEqual({ latencyMs: 0 })
    await expect(colyseus.http.post('/dev/latency?ms=5000')).rejects.toMatchObject({ statusCode: 400 })
    const current = await colyseus.http.get('/dev/latency')
    expect(current.data).toEqual({ latencyMs: 0 })
  })
})
