import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { clientIp, clientKey, isLoopback, limitScope } from '../src/security/clientKey.ts'
import { MemoryArenaNumbers } from '../src/store/arenaNumbers.ts'
import { MemoryIpLimits } from '../src/store/limits.ts'

const LIMITS = { joinsPerMinute: 10, maxConnectionsPerIp: 3 }

/** 소켓 주소와 X-Forwarded-For만 있는 요청 */
function request(remoteAddress: string, forwardedFor?: string): IncomingMessage {
  const headers = forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage
}

describe('IP별 제한 (P6-1)', () => {
  it('입장 요청: 1분에 10번까지 센다. 넘은 요청은 세지 않고, 1분이 지난 기록부터 풀린다', async () => {
    let now = 0
    const limits = new MemoryIpLimits(LIMITS, () => now)
    for (let i = 0; i < 10; i++) {
      now = i * 1000
      expect(await limits.hit('join', 'a')).toBe(true)
    }
    now = 30_000
    expect(await limits.hit('join', 'a')).toBe(false)
    expect(await limits.blocked('join', 'a')).toBe(true)
    // 다른 키는 따로 센다
    expect(await limits.hit('join', 'b')).toBe(true)
    // 0초에 센 첫 기록만 창을 벗어났다 — 하나만 다시 된다
    now = 60_000
    expect(await limits.hit('join', 'a')).toBe(true)
    expect(await limits.hit('join', 'a')).toBe(false)
  })

  it('동시 연결: 3개까지 열 수 있고, 하나를 닫으면 다시 열 수 있다', async () => {
    const limits = new MemoryIpLimits(LIMITS)
    for (let i = 0; i < 3; i++) expect(await limits.openConnection('a')).toBe(true)
    expect(await limits.openConnection('a')).toBe(false)
    expect(await limits.openConnection('b')).toBe(true)
    await limits.closeConnection('a')
    expect(await limits.openConnection('a')).toBe(true)
    // 모두 닫으면 기억하지 않는다
    for (let i = 0; i < 3; i++) await limits.closeConnection('a')
    await limits.closeConnection('b')
    expect(limits.size).toBe(0)
  })

  it('관리 화면 로그인은 10분에 10번 틀리면 잠기고, 10분이 지나면 풀린다', async () => {
    let now = 0
    const limits = new MemoryIpLimits(LIMITS, () => now)
    for (let i = 0; i < 10; i++) expect(await limits.hit('adminLogin', 'a')).toBe(true)
    expect(await limits.blocked('adminLogin', 'a')).toBe(true)
    // 입장 요청과는 따로 센다
    expect(await limits.blocked('join', 'a')).toBe(false)
    now = 10 * 60_000 + 1
    expect(await limits.blocked('adminLogin', 'a')).toBe(false)
  })

  it('다시 오지 않는 키의 기록은 창이 지나면 치운다 (메모리가 쌓이지 않는다)', async () => {
    let now = 0
    const limits = new MemoryIpLimits(LIMITS, () => now)
    for (let i = 0; i < 500; i++) await limits.hit('join', `k${i}`)
    expect(limits.size).toBe(500)
    now = 2 * 60_000
    await limits.hit('join', 'later')
    expect(limits.size).toBe(1)
  })
})

describe('보낸 쪽 IP와 제한 키', () => {
  it('TRUST_PROXY=0이면 X-Forwarded-For를 보지 않는다 — 헤더를 속여 보내도 소켓 주소로 센다', () => {
    expect(clientIp(request('198.51.100.1', '203.0.113.9'), 0)).toBe('198.51.100.1')
  })

  it('TRUST_PROXY=1이면 맨 오른쪽(우리 프록시가 붙인 값)을 쓴다 — 왼쪽에 속인 값을 붙여도 소용없다', () => {
    expect(clientIp(request('10.0.0.2', '203.0.113.9'), 1)).toBe('203.0.113.9')
    expect(clientIp(request('10.0.0.2', '1.2.3.4, 5.6.7.8, 203.0.113.9'), 1)).toBe('203.0.113.9')
    // 프록시 두 대(CDN → Caddy)면 오른쪽에서 두 번째
    expect(clientIp(request('10.0.0.2', '1.2.3.4, 203.0.113.9, 172.16.0.5'), 2)).toBe('203.0.113.9')
    // 헤더가 없으면 소켓 주소
    expect(clientIp(request('10.0.0.2'), 1)).toBe('10.0.0.2')
  })

  it('IPv4-mapped IPv6는 IPv4로 보고, IPv6는 /64 대역을 한 사람으로 센다', () => {
    expect(clientIp(request('::ffff:127.0.0.1'), 0)).toBe('127.0.0.1')
    expect(clientIp(request('fe80::1%en0'), 0)).toBe('fe80::1')
    expect(limitScope('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64')
    expect(limitScope('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64')
    expect(limitScope('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(limitScope('::1.2.3.4')).toBe('0:0:0:0::/64')
    expect(clientKey('2001:db8:1:2::1')).toBe(clientKey('2001:db8:1:2:dead:beef::9'))
    expect(clientKey('2001:db8:1:3::1')).not.toBe(clientKey('2001:db8:1:2::1'))
    expect(limitScope('203.0.113.9')).toBe('203.0.113.9')
  })

  it('키는 IP를 비밀값으로 해시한 것이라 IP가 드러나지 않는다 (NFR-10)', () => {
    const key = clientKey('203.0.113.7')
    expect(key).toMatch(/^[\w-]{22}$/)
    expect(key).not.toContain('203')
    expect(clientKey('203.0.113.7')).toBe(key)
    expect(clientKey('203.0.113.8')).not.toBe(key)
  })

  it('루프백(같은 컴퓨터)을 알아본다', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('192.168.0.10')).toBe(false)
  })
})

describe('서버 설정', () => {
  it('운영에서는 ALLOWED_ORIGINS 없이 시작하지 않는다', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ALLOWED_ORIGINS/)
  })

  it('운영에서는 루프백 제외를 끄고, 입장 방식은 joinOrCreate만 받는다', () => {
    const config = loadConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://fight.example.com, https://www.fight.example.com' })
    expect(config.allowedOrigins).toEqual(['https://fight.example.com', 'https://www.fight.example.com'])
    expect(config.exemptLoopback).toBe(false)
    expect(config.matchmakeMethods).toEqual(['joinOrCreate'])
    expect(config.trustProxy).toBe(0)
    expect(config.adminPassword).toBeNull()
  })

  it('개발에서는 출처를 검사하지 않고, 같은 컴퓨터의 탭은 IP 제한에서 뺀다', () => {
    const config = loadConfig({})
    expect(config.allowedOrigins).toEqual([])
    expect(config.exemptLoopback).toBe(true)
    expect(config.matchmakeMethods).toBeNull()
  })

  it('값이 잘못되면 알아보기 쉬운 오류로 멈춘다', () => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: 'https://fight.example.com/' })).toThrow(/출처가 아닙니다/)
    expect(() => loadConfig({ ALLOWED_ORIGINS: 'fight.example.com' })).toThrow(/출처가 아닙니다/)
    expect(() => loadConfig({ TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/)
    expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
    expect(() => loadConfig({ ADMIN_PASSWORD: 'short' })).toThrow(/12자/)
    expect(loadConfig({ TRUST_PROXY: '1', ADMIN_PASSWORD: 'long-enough-secret' })).toMatchObject({ trustProxy: 1, adminPassword: 'long-enough-secret' })
  })
})

describe('경기장 번호 (P6-4)', () => {
  it('쓰지 않는 가장 작은 번호를 주고, 돌려받은 번호는 다시 쓴다', async () => {
    const numbers = new MemoryArenaNumbers()
    expect([await numbers.claim(), await numbers.claim(), await numbers.claim()]).toEqual([1, 2, 3])
    await numbers.release(2)
    expect(await numbers.claim()).toBe(2)
    expect(await numbers.claim()).toBe(4)
  })
})
