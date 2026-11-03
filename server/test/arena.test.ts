import type { Room } from '@colyseus/core'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import {
  AFK_FRAMES, ARENA_CAPACITY, ARENA_HALF, Action, BODY_RADIUS, Btn, CHARACTER_COUNT, CloseCode, IDLE_INPUT, Msg, PROTOCOL_VERSION,
  PlayerInput, ROOM_NAME, SIM_FIELDS, SPAWN_INVULN_FRAMES, TICK_RATE, VARIANT_COUNT, WALK_SPEED, assembleName, stepPlayer,
  type ElimEvent, type HitEvent, type JoinOptions, type PlayerSim, type PlayerState, type ResultMsg,
} from '@fight-club/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { server, statsCache } from '../src/app.ts'
import { ArenaRoom } from '../src/rooms/ArenaRoom.ts'

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

/** 여러 클라이언트가 같은 틱에 입력을 하나씩 보낸다 */
async function sendTogether(room: TickingRoom, count: number, senders: [InputSender, (data: PlayerInput, i: number) => void][]) {
  for (let i = 0; i < count; i++) {
    for (const [input, stage] of senders) {
      stage(input.data, i)
      input.send()
    }
    await room.waitForNextTimestep()
  }
}

/** 원하는 자리·방향에 세우고 입장 무적을 없앤다 */
function place(p: PlayerState, x: number, z: number, fx = 0, fz = 1) {
  Object.assign(p, {
    x, y: 0, z, vx: 0, vy: 0, vz: 0, fx, fz, action: Action.Idle, actionFrame: 0, stun: 0, buffered: 0, invuln: 0,
    kickCooldown: 0, grabCooldown: 0,
  })
}

const press = (bits: number) => (data: PlayerInput, i: number) => { data.pressed = i === 0 ? bits : 0 }
const hold = (bits: number) => (data: PlayerInput) => { data.held = bits }
const leaveCode = (room: { onLeave(cb: (code: number) => void): unknown }) =>
  new Promise<number>((resolve) => room.onLeave((code) => resolve(code)))

function copySim(p: PlayerState): PlayerSim {
  return Object.fromEntries(SIM_FIELDS.map((f) => [f, p[f]])) as unknown as PlayerSim
}

describe('게임 서버', () => {
  let colyseus: ColyseusTestServer<typeof server>

  beforeAll(async () => {
    colyseus = await boot(server)
    statsCache.ttlMs = 0
  })
  afterAll(() => colyseus.shutdown())
  beforeEach(() => colyseus.cleanup())

  /** 입장 — 프로토콜 버전을 함께 보낸다 */
  const join = <R extends Room>(room: R, options: Partial<JoinOptions> = {}) =>
    colyseus.connectTo(room, { v: PROTOCOL_VERSION, ...options })

  it('헬스 체크에 응답한다', async () => {
    const res = await colyseus.http.get('/healthz')
    expect(res.data).toBe('ok')
  })

  it('입장한 클라이언트가 서버 틱을 계속 동기화받는다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await join(room)
    await client.waitForInitialState()
    const firstTick = client.state.tick

    await client.waitForNextPatch()
    await client.waitForNextPatch()

    expect(client.state.tick).toBeGreaterThan(firstTick)
    expect(client.state.tick).toBeLessThanOrEqual(room.state.tick)
  })

  it('입장하면 플레이어가 생기고 나가면 사라진다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await join(room)
    expect(room.state.players.get(client.sessionId)?.hp).toBe(100)

    await client.leave()
    await waitTicks(room, 2)
    expect(room.state.players.has(client.sessionId)).toBe(false)
  })

  describe('입장·매치메이킹', () => {
    it('프로토콜 버전이 다르거나 없으면 4002로 거절한다', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      await join(room) // 빈 방은 거절 뒤 바로 닫히므로 한 명을 둔다
      await expect(colyseus.connectTo(room, { v: PROTOCOL_VERSION + 1 })).rejects.toMatchObject({ code: CloseCode.VersionMismatch })
      await expect(colyseus.connectTo(room, {})).rejects.toMatchObject({ code: CloseCode.VersionMismatch })
      expect(room.state.players.size).toBe(1)
    })

    it('이름은 받은 인덱스로 서버가 조립하고, 같은 경기장에 같은 이름이 있으면 다시 뽑는다', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      const first = await join(room, { name: [0, 0, 0] })
      const second = await join(room, { name: [0, 0, 0] })
      const invalid = await join(room, { name: ['<b>x</b>', 0, 0] as unknown as JoinOptions['name'] })
      const [a, b, c] = [first, second, invalid].map((client) => room.state.players.get(client.sessionId)!.name)
      expect(a).toBe(assembleName([0, 0, 0]))
      expect(b).not.toBe(a)
      expect(b.startsWith('조용한 태양')).toBe(true) // 어미구만 다시 뽑는다
      expect(c).not.toContain('<')
      expect(c.length).toBeGreaterThan(0)
    })

    it('정원 16명이 차면 17번째는 새 경기장에 들어가고, 경기장 번호는 #1·#2 순이다', async () => {
      const first = []
      for (let i = 0; i < ARENA_CAPACITY; i++) first.push(await colyseus.sdk.joinOrCreate(ROOM_NAME, { v: PROTOCOL_VERSION }))
      expect(new Set(first.map((r) => r.roomId)).size).toBe(1)
      const seventeenth = await colyseus.sdk.joinOrCreate(ROOM_NAME, { v: PROTOCOL_VERSION })
      expect(seventeenth.roomId).not.toBe(first[0].roomId)
      expect(colyseus.getRoomById<ArenaRoom>(first[0].roomId).state.arenaNo).toBe(1)
      expect(colyseus.getRoomById<ArenaRoom>(seventeenth.roomId).state.arenaNo).toBe(2)
    })

    it('빈자리가 있는 경기장 중 사람이 가장 많은 곳에 넣는다', async () => {
      const small = await colyseus.createRoom(ROOM_NAME)
      const big = await colyseus.createRoom(ROOM_NAME)
      await join(small)
      for (let i = 0; i < 3; i++) await join(big)
      const joined = await colyseus.sdk.joinOrCreate(ROOM_NAME, { v: PROTOCOL_VERSION })
      expect(joined.roomId).toBe(big.roomId)
    })

    it('/api/stats: 경기장에 들어온 사람 수와 경기장 수', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      await join(room)
      await join(room)
      await colyseus.createRoom(ROOM_NAME)
      const res = await colyseus.http.get('/api/stats')
      expect(res.data).toEqual({ online: 2, arenas: 2 })
    })
  })

  it('고른 캐릭터로 입장하고, 같은 캐릭터끼리는 가장 적게 쓰인 색상 변형을 받는다', async () => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const looks: [number, number][] = []
    for (let i = 0; i < VARIANT_COUNT + 1; i++) {
      const client = await join(room, { characterId: 2 })
      const p = room.state.players.get(client.sessionId)!
      looks.push([p.characterId, p.variant])
    }
    const other = await join(room, { characterId: 4 })

    expect(looks).toEqual([[2, 0], [2, 1], [2, 2], [2, 3], [2, 0]])
    expect(room.state.players.get(other.sessionId)?.variant).toBe(0)
  })

  it.each([
    ['고르지 않으면', {}],
    ['범위를 벗어나면', { characterId: CHARACTER_COUNT }],
    ['정수가 아니면', { characterId: 1.5 }],
  ])('캐릭터를 %s 무작위로 정한다', async (_label, options) => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await join(room, options)
    const p = room.state.players.get(client.sessionId)!
    expect(Number.isInteger(p.characterId)).toBe(true)
    expect(p.characterId).toBeGreaterThanOrEqual(0)
    expect(p.characterId).toBeLessThan(CHARACTER_COUNT)
  })

  it.each([
    ['일정하게 도착하면', 0],
    ['가끔 3틱씩 늦게 도착해도', 5],
  ])('입력이 %s 공용 시뮬레이션과 똑같이 움직인다', async (_label, jitterEvery) => {
    const room = await colyseus.createRoom(ROOM_NAME)
    const client = await join(room)
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
    const client = await join(room)
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
    const client = await join(room)
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
    const walker = await join(room)
    const blocker = await join(room)
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
    const attacker = await join(room)
    const victim = await join(room)
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
    const client = await join(room)
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
    const client = await join(room)
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

  describe('전투 (P2)', () => {
    /** 두 명을 마주 보게 세운다: 공격자 (0,0)는 +z, 상대 (0,1)는 지정한 방향 */
    async function duel(fx = 0, fz = -1) {
      const room = await colyseus.createRoom(ROOM_NAME)
      const attacker = await join(room)
      const defender = await join(room)
      const a = room.state.players.get(attacker.sessionId)!
      const b = room.state.players.get(defender.sessionId)!
      place(a, 0, 0)
      place(b, 0, 1, fx, fz)
      // 새 위치가 되감기 기록을 채울 때까지 기다린다
      await waitTicks(room, 30)
      return { room, attacker, defender, a, b }
    }

    it('입장하면 3초 무적이고, 먼저 온 플레이어와 떨어진 곳에 선다', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      const first = await join(room)
      const second = await join(room)
      const a = room.state.players.get(first.sessionId)!
      const b = room.state.players.get(second.sessionId)!
      expect(b.invuln).toBeGreaterThan(SPAWN_INVULN_FRAMES - 30)
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(3)

      place(a, 0, 0)
      place(b, 0, 1)
      b.invuln = SPAWN_INVULN_FRAMES
      await waitTicks(room, 30)
      await sendEachTick(room, first.input({ type: PlayerInput, mode: 'reliable' }), 11, press(Btn.PunchL))
      expect(b.hp).toBe(100)
    })

    it.each([
      ['정면에서 오는 잽은 막아서 피해가 1', 0, -1, true, 99],
      ['옆에서 오는 잽은 막지 못해 피해가 5', 1, 0, false, 95],
    ])('가드: %s', async (_label, fx, fz, guarded, hp) => {
      const { room, attacker, defender, b } = await duel(fx, fz)
      const hit = attacker.waitForMessage(Msg.Hit) as Promise<HitEvent>
      await sendTogether(room, 12, [
        [attacker.input({ type: PlayerInput, mode: 'reliable' }), press(Btn.PunchL)],
        [defender.input({ type: PlayerInput, mode: 'reliable' }), hold(Btn.Guard)],
      ])
      expect(await hit).toMatchObject({ attack: 'jab', guarded })
      expect(b.hp).toBe(hp)
    })

    it('조준 보정: 비스듬히 선 상대 쪽으로 돌아 맞히고, 클라이언트가 예측한 방향과 똑같이 돈다', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      const attacker = await join(room)
      const victim = await join(room)
      const a = room.state.players.get(attacker.sessionId)!
      // 정면에서 약 40° 비껴 선 상대 — 보정이 없으면 잽이 빗나간다
      place(a, 0, 0)
      place(room.state.players.get(victim.sessionId)!, 0.85, 1)
      await waitTicks(room, 30)
      const predicted = copySim(a)

      const hit = attacker.waitForMessage(Msg.Hit) as Promise<HitEvent>
      await sendEachTick(room, attacker.input({ type: PlayerInput, mode: 'reliable' }), 11, press(Btn.PunchL))
      expect(await hit).toMatchObject({ victim: victim.sessionId, attack: 'jab' })

      // 클라이언트는 화면에 보이던 상대 위치로 같은 보정을 한다
      stepPlayer(predicted, { ...IDLE_INPUT, pressed: Btn.PunchL }, DT, { aimTargets: () => [{ x: 0.85, y: 0, z: 1 }] })
      expect(a.fx).toBe(predicted.fx)
      expect(a.fz).toBe(predicted.fz)
      expect(a.fx).toBeCloseTo(0.85 / Math.hypot(0.85, 1), 6)
    })

    it('잡기: 잡고 0.6초 지나면 바라보는 쪽으로 던지고, 던져진 쪽은 5m 날아가 다운된다', async () => {
      const { room, attacker, b } = await duel()
      const thrown = attacker.waitForMessage(Msg.Hit) as Promise<HitEvent>
      await sendEachTick(room, attacker.input({ type: PlayerInput, mode: 'reliable' }), 75, press(Btn.Grab))
      expect(await thrown).toMatchObject({ attack: 'throw', damage: 10, hp: 90 })
      await waitTicks(room, 50)
      expect(b.z).toBeGreaterThan(5)
      expect([Action.Knockdown, Action.Idle]).toContain(b.action)
    }, 10_000)

    it('잡기: 서로 동시에 잡으면 둘 다 헛잡는다', async () => {
      const { room, attacker, defender, a, b } = await duel()
      const ia = attacker.input({ type: PlayerInput, mode: 'reliable' })
      const ib = defender.input({ type: PlayerInput, mode: 'reliable' })
      let grabbed = false
      for (let i = 0; i < 40; i++) {
        for (const input of [ia, ib]) {
          input.data.pressed = i === 0 ? Btn.Grab : 0
          input.send()
        }
        await room.waitForNextTimestep()
        if ([a.action, b.action].some((action) => action === Action.Holding || action === Action.Grabbed)) grabbed = true
      }
      expect(grabbed).toBe(false)
      expect([a.action, b.action]).toEqual([Action.Idle, Action.Idle])
    })

    it('잡기: 잡은 쪽이 다른 사람에게 맞으면 잡기가 풀린다', async () => {
      const { room, attacker, a, b } = await duel()
      const third = await join(room)
      place(room.state.players.get(third.sessionId)!, -1, 0, 1, 0)
      await waitTicks(room, 30)

      const ia = attacker.input({ type: PlayerInput, mode: 'reliable' })
      const ic = third.input({ type: PlayerInput, mode: 'reliable' })
      let held = false
      for (let i = 0; i < 30; i++) {
        ia.data.pressed = i === 0 ? Btn.Grab : 0
        ia.send()
        ic.data.pressed = i === 10 ? Btn.PunchL : 0
        ic.send()
        await room.waitForNextTimestep()
        if (b.action === Action.Grabbed) held = true
      }
      expect(held).toBe(true)
      expect(a.hp).toBe(95)
      expect(b.action).not.toBe(Action.Grabbed)
    })

    it('KO: HP가 0이 되면 1초 뒤 탈락하고, 결과를 받은 뒤 연결이 끊기며, 때린 사람이 킬을 얻는다', async () => {
      const { room, attacker, defender, a, b } = await duel()
      room.state.players.get(defender.sessionId)!.hp = 5
      const names = { victimName: b.name, killerName: a.name }
      const elim = attacker.waitForMessage(Msg.Elim) as Promise<ElimEvent>
      const result = defender.waitForMessage(Msg.Result) as Promise<ResultMsg>
      const closed = leaveCode(defender)

      await sendEachTick(room, attacker.input({ type: PlayerInput, mode: 'reliable' }), 11, press(Btn.PunchL))
      // 탈락한 사람은 상태에서 사라지므로 이름이 함께 온다 (킬 피드)
      expect(await elim).toMatchObject({ victim: defender.sessionId, killer: attacker.sessionId, cause: 'ko', ...names })
      // 나중에 들어온 0킬이라 최고 순위는 2위
      expect(await result).toMatchObject({ cause: 'ko', killer: attacker.sessionId, killerName: names.killerName, kills: 0, bestRank: 2 })
      expect(await closed).toBe(CloseCode.Eliminated)
      expect(a.kills).toBe(1)
      expect(room.state.players.has(defender.sessionId)).toBe(false)
    })

    it('낙사: 맞고 떨어지면 마지막으로 때린 사람이 킬을 얻는다', async () => {
      const { room, attacker, defender, a, b } = await duel()
      place(a, 10, 0, 1, 0)
      place(b, 11, 0, -1, 0)
      await waitTicks(room, 30)

      const elim = attacker.waitForMessage(Msg.Elim) as Promise<ElimEvent>
      await sendEachTick(room, attacker.input({ type: PlayerInput, mode: 'reliable' }), 20, press(Btn.Kick))
      expect(await elim).toMatchObject({ victim: defender.sessionId, killer: attacker.sessionId, cause: 'ringout' })
      expect(a.kills).toBe(1)
    }, 10_000)

    it('자멸: 혼자 걸어 나가 떨어지면 킬 없이 탈락한다', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      const client = await join(room)
      place(room.state.players.get(client.sessionId)!, 11.5, 0, 1, 0)
      const result = client.waitForMessage(Msg.Result) as Promise<ResultMsg>
      await sendEachTick(room, client.input({ type: PlayerInput, mode: 'reliable' }), 20, (data) => { data.mx = 127 })
      const received = await result
      expect(received.cause).toBe('selfout')
      expect(received).not.toHaveProperty('killer')
    })

    it('개발용 지연 주입 중에도 결과가 연결 종료보다 먼저 도착한다', async () => {
      await colyseus.http.post('/dev/latency?ms=200')
      try {
        const room = await colyseus.createRoom(ROOM_NAME)
        const client = await join(room)
        let result: ResultMsg | undefined
        client.onMessage(Msg.Result, (message: ResultMsg) => { result = message })
        const closed = leaveCode(client)
        place(room.state.players.get(client.sessionId)!, ARENA_HALF + 0.5, 0)
        expect(await closed).toBe(CloseCode.Eliminated)
        expect(result).toMatchObject({ cause: 'selfout' })
      } finally {
        await colyseus.http.post('/dev/latency?ms=0')
      }
    })

    it('자리 비움: 정해진 시간 동안 아무 입력이 없으면 탈락한다', async () => {
      ArenaRoom.afkFrames = 30
      try {
        const room = await colyseus.createRoom(ROOM_NAME)
        const client = await join(room)
        const result = client.waitForMessage(Msg.Result) as Promise<ResultMsg>
        const received = await result
        expect(received).toMatchObject({ cause: 'afk', kills: 0 })
        // 30프레임 = 0.5초 버틴 셈이다
        expect(received.survivalMs).toBeGreaterThanOrEqual(400)
        expect(received.survivalMs).toBeLessThan(1500)
      } finally {
        ArenaRoom.afkFrames = AFK_FRAMES
      }
    })
  })
})
