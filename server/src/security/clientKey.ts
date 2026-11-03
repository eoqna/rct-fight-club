import { createHmac, randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { isIPv6 } from 'node:net'

/**
 * 앞문(gate.ts)이 요청마다 붙이는 내부 헤더 — 보낸 쪽 IP를 해시한 키. 클라이언트가 같은 이름으로 보낸 값은 덮어쓴다.
 * 경기장은 이 키로 동시 접속을 센다 (IP 자체는 앞문 밖으로 나가지 않는다)
 */
export const CLIENT_KEY_HEADER = 'x-fight-club-client'

/** IP 제한에서 빼는 접속(개발 중 같은 컴퓨터)의 키. 해시 키(base64url 22자)와 겹칠 수 없다 */
export const EXEMPT_KEY = 'exempt'

/**
 * 요청을 보낸 쪽 IP. X-Forwarded-For는 믿는 프록시 수(trustProxy)만큼만 오른쪽부터 거슬러 읽는다 —
 * 맨 오른쪽 값은 우리 프록시가 붙인 것이고, 그보다 왼쪽은 클라이언트가 마음대로 적어 보낼 수 있다
 */
export function clientIp(req: IncomingMessage, trustProxy: number): string {
  const peer = req.socket.remoteAddress ?? ''
  if (trustProxy <= 0) return plainIp(peer)
  const header = req.headers['x-forwarded-for']
  const hops = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (hops.length === 0) return plainIp(peer)
  return plainIp(hops[Math.max(0, hops.length - trustProxy)])
}

export function isLoopback(ip: string): boolean {
  return ip === '::1' || ip.startsWith('127.')
}

/** 이 프로세스에서만 쓰는 비밀값 — 재시작하면 바뀐다. 서버 프로세스가 여럿이 되면(design §8.2) 환경 변수로 함께 나눠야 한다 */
const secret = randomBytes(32)

/**
 * 제한을 세는 키: IP를 비밀값으로 해시한다 — 메모리에도 IP 원문을 두지 않는다 (NFR-10).
 * IPv6는 /64 대역으로 묶는다 — 가정 하나가 /64를 통째로 받아 주소를 얼마든지 바꿀 수 있기 때문이다
 */
export function clientKey(ip: string): string {
  return createHmac('sha256', secret).update(limitScope(ip)).digest('base64url').slice(0, 22)
}

/** IPv4-mapped IPv6(::ffff:1.2.3.4)는 IPv4로, 링크 로컬의 영역 표시(%eth0)는 떼어 낸다 */
function plainIp(ip: string): string {
  const bare = ip.split('%')[0]
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)
  return mapped ? mapped[1] : bare.toLowerCase()
}

/** 같은 사람으로 셀 범위: IPv4는 주소 하나, IPv6는 앞 64비트 */
export function limitScope(ip: string): string {
  if (!isIPv6(ip)) return ip
  const [head, tail = ''] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  // 끝에 IPv4를 붙인 꼴(…:1.2.3.4)은 16비트 두 칸을 차지한다
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0)
  const missing = ip.includes('::') ? 8 - width(left) - width(right) : 0
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right]
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`
}
