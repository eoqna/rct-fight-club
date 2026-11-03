import type { Room } from '@colyseus/core'
import { ColyseusTestServer } from '@colyseus/testing'
import {
  CloseCode, JoinRejectStatus, MAX_CONNECTIONS_PER_IP, PROTOCOL_VERSION, ROOM_NAME, type JoinOptions,
} from '@fight-club/shared'
import { randomBytes } from 'node:crypto'
import http, { type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../src/app.ts'
import { config } from '../src/config.ts'
import { log, logSink } from '../src/log.ts'
import { snapshot, startMetricsLog } from '../src/ops/metrics.ts'
import { ArenaRoom, listArenas } from '../src/rooms/ArenaRoom.ts'
import { store } from '../src/store/index.ts'
import { MemoryIpLimits } from '../src/store/limits.ts'

// 입장 요청만 보내고 접속하지 않은 좌석 예약은 경기장이 닫히는 것을 막는다 (기본 15초) — 테스트 사이 정리가 기다리지 않게 줄인다.
// Colyseus가 처음 불러올 때 읽으므로 import보다 먼저 정한다
vi.hoisted(() => {
  process.env.COLYSEUS_SEAT_RESERVATION_TIME = '1'
})

/** 게임 서버 테스트(arena.test.ts, 2568)와 나란히 돌 수 있게 다른 포트를 쓴다 */
const PORT = 2569
const DEFAULTS = { ...config }
const ADMIN_PASSWORD = 'correct horse battery staple'

interface Reply {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/** 브라우저가 붙이는 헤더(Origin 등)를 마음대로 정해 보내는 HTTP 요청 */
function request(method: string, path: string, headers: OutgoingHttpHeaders = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** SDK가 보내는 것과 같은 입장 요청 */
function matchmake(headers: OutgoingHttpHeaders = {}, method = 'joinOrCreate', options: Partial<JoinOptions> = { v: PROTOCOL_VERSION }) {
  const body = JSON.stringify(options)
  return request('POST', `/matchmake/${method}/${ROOM_NAME}`, {
    'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers,
  }, body)
}

/** WebSocket 업그레이드를 시도한다 — 받아 주면 101, 거절하면 HTTP 상태 코드 */
function upgrade(headers: OutgoingHttpHeaders = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/',
      headers: {
        connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'), ...headers,
      },
    })
    req.on('upgrade', (_res, socket) => {
      socket.destroy()
      resolve(101)
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`

/** 로그를 모은다 (테스트 동안만) */
function captureLogs(level = 'debug') {
  const lines: string[] = []
  const write = logSink.write
  const before = log.level
  logSink.write = (line) => { lines.push(line) }
  log.level = level
  return {
    lines,
    events: () => lines.map((line) => JSON.parse(line) as { event?: string; msg?: string }),
    restore: () => {
      logSink.write = write
      log.level = before
    },
  }
}

describe('보안·운영 (P6)', () => {
  let colyseus: ColyseusTestServer<typeof server>

  beforeAll(async () => {
    await server.listen(PORT)
    colyseus = new ColyseusTestServer(server)
    ArenaRoom.botFill = 0
  })
  afterAll(() => colyseus.shutdown())
  beforeEach(async () => {
    await colyseus.cleanup()
    // 테스트 클라이언트는 모두 같은 컴퓨터(127.0.0.1)에서 온다 — 운영처럼 IP 제한을 켠다
    Object.assign(config, DEFAULTS, { exemptLoopback: false })
    store.limits = new MemoryIpLimits(config)
  })
  afterEach(() => {
    Object.assign(config, DEFAULTS)
  })

  const join = <R extends Room>(room: R, options: Partial<JoinOptions> = {}) =>
    colyseus.connectTo(room, { v: PROTOCOL_VERSION, ...options })

  describe('앞문 (P6-1)', () => {
    it('출처 허용 목록: 다른 사이트에서 온 입장 요청과 WebSocket 연결은 403으로 거절한다', async () => {
      config.allowedOrigins = ['https://fight.example']
      const evil = await matchmake({ origin: 'https://evil.example' })
      expect(evil.status).toBe(JoinRejectStatus.Forbidden)
      // 거절한 사이트의 스크립트는 이유도 읽지 못한다
      expect(evil.headers['access-control-allow-origin']).toBeUndefined()
      expect((await matchmake()).status).toBe(JoinRejectStatus.Forbidden)
      const good = await matchmake({ origin: 'https://fight.example' })
      expect(good.status).toBe(200)
      expect(good.headers['access-control-allow-origin']).toBe('https://fight.example')
      // 다른 경로에서도 허용하지 않은 출처를 되돌려 주지 않는다 (자격 증명을 실은 응답을 읽지 못한다)
      const health = await request('GET', '/healthz', { origin: 'https://evil.example' })
      expect(health.headers['access-control-allow-origin']).not.toBe('https://evil.example')

      expect(await upgrade({ origin: 'https://evil.example' })).toBe(403)
      expect(await upgrade()).toBe(403)
      expect(await upgrade({ origin: 'https://fight.example' })).toBe(101)
      // 공개 정보는 어디서나 읽는다
      expect((await request('GET', '/api/stats', { origin: 'https://evil.example' })).status).toBe(200)
    })

    it('서버 종류·버전을 알리지 않는다 (X-Powered-By, Colyseus 첫 화면 응답)', async () => {
      const root = await request('GET', '/')
      expect(root.status).toBe(404)
      expect(root.body).not.toContain('Colyseus')
      expect(root.headers['x-powered-by']).toBeUndefined()
      expect((await request('GET', '/api/stats')).headers['x-powered-by']).toBeUndefined()
    })

    it('운영 설정에서는 joinOrCreate만 받는다 — create로 빈 경기장을 마구 만들 수 없다', async () => {
      config.matchmakeMethods = ['joinOrCreate']
      const created = await matchmake({}, 'create')
      expect(created.status).toBe(JoinRejectStatus.Forbidden)
      expect([...listArenas()]).toHaveLength(0)
      expect((await matchmake({}, 'joinById')).status).toBe(JoinRejectStatus.Forbidden)
      expect((await matchmake()).status).toBe(200)
      expect([...listArenas()]).toHaveLength(1)
    })

    it('입장 요청 본문은 1KB까지 받는다 (길이를 밝히지 않은 요청도 거절)', async () => {
      const big = await matchmake({}, 'joinOrCreate', { v: PROTOCOL_VERSION, filler: 'x'.repeat(2000) } as Partial<JoinOptions>)
      expect(big.status).toBe(413)
      const chunked = await request('POST', `/matchmake/joinOrCreate/${ROOM_NAME}`, {
        'content-type': 'application/json', 'transfer-encoding': 'chunked',
      }, JSON.stringify({ v: PROTOCOL_VERSION }))
      expect(chunked.status).toBe(411)
    })

    it('같은 IP의 입장 요청은 1분에 10번까지 — 11번째는 429, 1분이 지나면 다시 받는다', async () => {
      let now = 1_000_000
      store.limits = new MemoryIpLimits(config, () => now)
      for (let i = 0; i < config.joinsPerMinute; i++) expect((await matchmake()).status).toBe(200)
      const limited = await matchmake()
      expect(limited.status).toBe(JoinRejectStatus.TooManyRequests)
      expect(limited.headers['retry-after']).toBe('60')
      // 브라우저(SDK)가 이유를 읽어 안내할 수 있다
      expect(limited.headers['access-control-allow-origin']).toBe('*')
      expect(JSON.parse(limited.body)).toMatchObject({ code: 429, error: expect.stringContaining('1분') })
      // SDK로 들어오려 해도 같은 코드로 거절된다
      await expect(colyseus.sdk.joinOrCreate(ROOM_NAME, { v: PROTOCOL_VERSION })).rejects.toMatchObject({ code: 429 })

      now += 60_001
      expect((await matchmake()).status).toBe(200)
    })

    it('X-Forwarded-For는 TRUST_PROXY만큼만 믿는다 — 헤더를 바꿔 보내도 횟수 제한을 피하지 못한다', async () => {
      // 프록시 없이 직접 받는 서버: 헤더를 보지 않는다
      for (let i = 0; i < config.joinsPerMinute; i++) {
        expect((await matchmake({ 'x-forwarded-for': `203.0.113.${i}` })).status).toBe(200)
      }
      expect((await matchmake({ 'x-forwarded-for': '203.0.113.200' })).status).toBe(JoinRejectStatus.TooManyRequests)

      // 프록시 한 대 뒤: 맨 오른쪽(프록시가 붙인 값)만 믿는다
      config.trustProxy = 1
      store.limits = new MemoryIpLimits(config)
      for (let i = 0; i < config.joinsPerMinute; i++) {
        expect((await matchmake({ 'x-forwarded-for': `10.9.9.${i}, 198.51.100.7` })).status).toBe(200)
      }
      expect((await matchmake({ 'x-forwarded-for': '10.9.9.99, 198.51.100.7' })).status).toBe(JoinRejectStatus.TooManyRequests)
      expect((await matchmake({ 'x-forwarded-for': '198.51.100.8' })).status).toBe(200)
    })

    it(`같은 IP에서 동시에 ${MAX_CONNECTIONS_PER_IP}명까지 — 넘으면 4103으로 거절하고, 하나가 나가면 다시 들어온다`, async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      const clients = []
      for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i++) clients.push(await join(room))
      await expect(join(room)).rejects.toMatchObject({ code: CloseCode.TooManyConnections })
      // 다른 경기장이어도 같은 IP면 센다
      const other = await colyseus.createRoom(ROOM_NAME)
      await expect(join(other)).rejects.toMatchObject({ code: CloseCode.TooManyConnections })
      expect(room.state.players.size).toBe(MAX_CONNECTIONS_PER_IP)

      await clients[0].leave()
      await expect.poll(() => room.state.players.size).toBe(MAX_CONNECTIONS_PER_IP - 1)
      clients[0] = await join(room)
      expect(room.state.players.size).toBe(MAX_CONNECTIONS_PER_IP)

      // 모두 나가면 센 것이 남지 않는다 (거절된 연결·버전이 다른 연결도 자리를 차지하지 않았다)
      await expect(join(room, { v: PROTOCOL_VERSION + 1 })).rejects.toMatchObject({ code: CloseCode.VersionMismatch })
      for (const client of clients) await client.leave()
      const open = (store.limits as unknown as { connections: Map<string, number> }).connections
      await expect.poll(() => open.size).toBe(0)
    })

    it('개발 설정(루프백 제외)에서는 같은 컴퓨터의 탭이 몇 개든 들어온다', async () => {
      config.exemptLoopback = true
      const room = await colyseus.createRoom(ROOM_NAME)
      for (let i = 0; i < MAX_CONNECTIONS_PER_IP + 2; i++) await join(room)
      for (let i = 0; i < config.joinsPerMinute + 2; i++) expect((await matchmake()).status).toBe(200)
      expect(room.state.players.size).toBe(MAX_CONNECTIONS_PER_IP + 2)
    })

    it('클라이언트가 내부 IP 키 헤더를 직접 보내도 앞문이 소켓 주소로 다시 계산해 덮어쓴다', async () => {
      // '제외' 키나 매번 다른 키를 보내 제한을 피하려 해도 소용없다
      for (let i = 0; i < config.joinsPerMinute; i++) {
        const spoofed = i % 2 === 0 ? 'exempt' : `fake-${i}`
        expect((await matchmake({ 'x-fight-club-client': spoofed })).status).toBe(200)
      }
      expect((await matchmake({ 'x-fight-club-client': 'exempt' })).status).toBe(JoinRejectStatus.TooManyRequests)
    })
  })

  describe('관리 화면 (P6-3)', () => {
    it('ADMIN_PASSWORD가 없으면 /admin은 없다', async () => {
      expect((await request('GET', '/admin')).status).toBe(404)
      expect((await request('GET', '/admin/metrics', { authorization: basic('admin', 'anything') })).status).toBe(404)
    })

    it('Basic 인증: 맞으면 지표를 보여 주고, 틀리면 401 — 10번 틀리면 10분 동안 맞아도 막는다', async () => {
      config.adminPassword = ADMIN_PASSWORD
      const room = await colyseus.createRoom(ROOM_NAME)
      await join(room)

      const challenge = await request('GET', '/admin')
      expect(challenge.status).toBe(401)
      expect(challenge.headers['www-authenticate']).toContain('Basic')

      const ok = await request('GET', '/admin', { authorization: basic('admin', ADMIN_PASSWORD) })
      expect(ok.status).toBe(200)
      expect(ok.headers['cache-control']).toBe('no-store')
      expect(ok.body).toContain('접속 <b>1</b>명')
      const metrics = await request('GET', '/admin/metrics', { authorization: basic('admin', ADMIN_PASSWORD) })
      expect(JSON.parse(metrics.body)).toMatchObject({ online: 1, arenas: 1 })

      // 다른 사이트가 브라우저에 저장된 인증을 실어 지표를 읽지 못한다 — CORS 헤더가 없다
      const crossSite = await request('GET', '/admin/metrics', { authorization: basic('admin', ADMIN_PASSWORD), origin: 'https://evil.example' })
      expect(crossSite.headers['access-control-allow-origin']).toBeUndefined()
      expect(crossSite.headers['access-control-allow-credentials']).toBeUndefined()

      expect((await request('GET', '/admin', { authorization: basic('root', ADMIN_PASSWORD) })).status).toBe(401)
      for (let i = 1; i < 10; i++) {
        expect((await request('GET', '/admin', { authorization: basic('admin', `guess-${i}`) })).status).toBe(401)
      }
      expect((await request('GET', '/admin', { authorization: basic('admin', ADMIN_PASSWORD) })).status).toBe(429)
    })
  })

  describe('관측 (P6-3)', () => {
    it('경기장마다 틱 처리 시간과 상태 패치 크기를 잰다', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      await join(room)
      await join(room)
      for (let i = 0; i < 30; i++) await room.waitForNextTimestep()
      const s = snapshot(listArenas())
      expect(s).toMatchObject({ online: 2, arenas: 1, bots: 0 })
      expect(s.tickMs.avg).toBeGreaterThan(0)
      expect(s.tickMs.p95).toBeGreaterThanOrEqual(s.tickMs.avg)
      expect(s.patchBytes.avg).toBeGreaterThan(0)
      expect(s.patchBytesPerPlayerPerSec).toBeGreaterThan(0)
      expect(s.perArena[0]).toMatchObject({ arenaNo: 1, humans: 2, bots: 0 })
    })

    it('지표를 주기마다 로그 한 줄로 남긴다 (운영에서는 1분마다)', async () => {
      const room = await colyseus.createRoom(ROOM_NAME)
      await join(room)
      const logs = captureLogs('info')
      const stop = startMetricsLog(listArenas, 50)
      try {
        await expect.poll(() => logs.events().filter((e) => e.event === 'metrics').length, { timeout: 2000 }).toBeGreaterThanOrEqual(2)
      } finally {
        stop()
        logs.restore()
      }
      const line = logs.events().find((e) => e.event === 'metrics') as unknown as Record<string, unknown>
      expect(line).toMatchObject({ online: 1, arenas: 1, tickMs: expect.any(Object), patchBytes: expect.any(Object), blocked: expect.any(Object) })
    })
  })

  describe('개인정보 (P6-5)', () => {
    it('입장·퇴장·거절·로그인 실패 로그 어디에도 IP가 남지 않는다', async () => {
      config.trustProxy = 1
      config.adminPassword = ADMIN_PASSWORD
      const logs = captureLogs('debug')
      try {
        const room = await colyseus.createRoom(ROOM_NAME)
        const client = await join(room)
        for (let i = 0; i <= config.joinsPerMinute; i++) await matchmake({ 'x-forwarded-for': '203.0.113.77' })
        await request('GET', '/admin', { authorization: basic('admin', 'wrong'), 'x-forwarded-for': '203.0.113.77' })
        await client.leave()
        await expect.poll(() => logs.events().some((e) => e.event === 'leave')).toBe(true)
      } finally {
        logs.restore()
      }
      const text = logs.lines.join('')
      expect(logs.events().map((e) => e.event)).toEqual(expect.arrayContaining(['join', 'blocked', 'adminLoginFailed', 'leave']))
      for (const ip of ['203.0.113.77', '127.0.0.1', '::1']) expect(text).not.toContain(ip)
    })

    it('제한을 세는 저장소에도 IP 원문이 없다 (해시한 키만 있다)', async () => {
      config.trustProxy = 1
      await matchmake({ 'x-forwarded-for': '203.0.113.88' })
      const room = await colyseus.createRoom(ROOM_NAME)
      await join(room)
      const limits = store.limits as unknown as { hits: Map<string, unknown>; connections: Map<string, unknown> }
      const keys = JSON.stringify([...limits.hits.keys(), ...limits.connections.keys()])
      expect(limits.hits.size + limits.connections.size).toBeGreaterThan(0)
      for (const ip of ['203.0.113.88', '127.0.0.1']) expect(keys).not.toContain(ip)
    })
  })
})
