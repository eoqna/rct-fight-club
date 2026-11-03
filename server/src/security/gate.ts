import { JoinRejectStatus } from '@fight-club/shared'
import { Server, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { ServerConfig } from '../config.ts'
import type { log as serverLog } from '../log.ts'
import { countBlocked, type BlockReason } from '../ops/metrics.ts'
import type { IpLimits } from '../store/limits.ts'
import { CLIENT_KEY_HEADER, EXEMPT_KEY, clientIp, clientKey, inRanges, isLoopback } from './clientKey.ts'

/** 입장 요청 본문 상한 (바이트) — JoinOptions는 100바이트 남짓이다 */
const MAX_JOIN_BODY_BYTES = 1024

/** /matchmake/:method/:roomName */
const MATCHMAKE_PATH = /^\/matchmake\/([^/?]+)\//

export interface GateOptions {
  config: ServerConfig
  /** 테스트가 저장소를 바꿔 끼울 수 있게 부를 때마다 가져온다 */
  limits: () => IpLimits
  log: typeof serverLog
}

/**
 * 앞문을 단 HTTP 서버 — Colyseus·Express보다 먼저 모든 요청과 WebSocket 업그레이드를 본다 (design §6.7).
 *  - 보낸 쪽 IP를 해시 키로 바꿔 내부 헤더에 싣는다. 경기장은 이 키로 동시 접속을 센다 (IP 자체는 넘기지 않는다)
 *  - 입장 요청(/matchmake): 출처 → 입장 방식 → 본문 크기 → 1분 횟수 순으로 검사한다
 *  - WebSocket 업그레이드: 출처를 검사한다
 * Colyseus는 매치메이킹 경로를 Express보다 먼저 처리하고 그 앞에 끼울 공식 훅이 없어서, 서버의 emit을 가로챈다
 */
export function createGatedServer(options: GateOptions): Server {
  return new GatedServer(options)
}

class GatedServer extends Server {
  private readonly gate: GateOptions
  private warnedProxy = false

  constructor(gate: GateOptions) {
    super()
    this.gate = gate
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    const forward = () => super.emit(event as string, ...args)
    if (event === 'request') {
      this.screenRequest(args[0] as IncomingMessage, args[1] as ServerResponse, forward)
      return true
    }
    if (event === 'upgrade') {
      this.screenUpgrade(args[0] as IncomingMessage, args[1] as Duplex, forward)
      return true
    }
    return forward()
  }

  private screenRequest(req: IncomingMessage, res: ServerResponse, pass: () => void) {
    const key = this.stamp(req)
    const method = MATCHMAKE_PATH.exec(req.url ?? '')?.[1]
    if (method === undefined) return pass()

    const { config, limits, log } = this.gate
    const reject = (reason: BlockReason, status: number, message: string, headers: OutgoingHttpHeaders = {}) => {
      countBlocked(reason)
      // 허용한 페이지라면 브라우저가 거절 이유를 읽을 수 있게 CORS 헤더를 붙인다
      const cors = reason === 'origin' ? {} : { 'access-control-allow-origin': '*' }
      sendJson(res, status, { code: status, error: message }, { ...cors, ...headers })
    }

    if (!this.originAllowed(req)) return reject('origin', JoinRejectStatus.Forbidden, '허용하지 않는 페이지에서 온 입장 요청입니다')
    if (config.matchmakeMethods && !config.matchmakeMethods.includes(method)) {
      return reject('method', JoinRejectStatus.Forbidden, '허용하지 않는 입장 방식입니다')
    }
    // CORS 사전 요청과 POST가 아닌 요청(Colyseus가 받지 않는다)은 입장으로 세지 않는다
    if (req.method !== 'POST') return pass()

    const length = Number(req.headers['content-length'])
    if (!Number.isInteger(length) || length < 0) return reject('body', 411, '본문 길이(Content-Length)가 필요합니다')
    if (length > MAX_JOIN_BODY_BYTES) return reject('body', 413, '입장 요청이 너무 큽니다')
    if (key === EXEMPT_KEY) return pass()

    limits().hit('join', key).then(
      (ok) => ok
        ? pass()
        : reject('joinRate', JoinRejectStatus.TooManyRequests, '입장 요청이 너무 잦습니다. 1분 뒤 다시 시도해 주세요.', { 'retry-after': '60' }),
      (error: unknown) => {
        // 제한 저장소가 고장 나도 게임은 들어갈 수 있게 한다 (막는 것보다 덜 나쁘다)
        log.error({ event: 'error', err: error }, '입장 횟수를 확인하지 못했습니다')
        pass()
      },
    )
  }

  private screenUpgrade(req: IncomingMessage, socket: Duplex, pass: () => void) {
    this.stamp(req)
    if (this.originAllowed(req)) return pass()
    countBlocked('origin')
    socket.on('error', () => socket.destroy())
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  }

  /** 보낸 쪽 IP를 해시 키로 바꿔 내부 헤더에 싣는다 (클라이언트가 같은 이름으로 보낸 헤더는 덮어쓴다) */
  private stamp(req: IncomingMessage): string {
    const { config, log } = this.gate
    if (config.trustProxy === 0 && req.headers['x-forwarded-for'] !== undefined && !this.warnedProxy) {
      this.warnedProxy = true
      log.warn({ event: 'config' }, 'X-Forwarded-For가 붙은 요청이 왔지만 TRUST_PROXY=0이라 무시합니다 — 프록시 뒤라면 TRUST_PROXY=1로 두세요 (아니면 모든 접속이 프록시 주소 하나로 세어집니다)')
    }
    const ip = clientIp(req, config.trustProxy)
    // 개발 중 같은 컴퓨터의 탭, 부하 시험을 보내는 컴퓨터(IP_LIMIT_EXEMPT)는 IP 제한에서 뺀다
    const exempt = (config.exemptLoopback && isLoopback(ip)) || inRanges(ip, config.ipLimitExempt)
    const key = exempt ? EXEMPT_KEY : clientKey(ip)
    req.headers[CLIENT_KEY_HEADER] = key
    return key
  }

  private originAllowed(req: IncomingMessage): boolean {
    return originAllowed(this.gate.config, req.headers.origin)
  }
}

/** 허용 목록이 비어 있으면(개발) 모두 받는다. 목록이 있으면 Origin이 없는 요청도 거절한다 */
export function originAllowed(config: Pick<ServerConfig, 'allowedOrigins'>, origin: string | undefined): boolean {
  return config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin ?? '')
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: OutgoingHttpHeaders) {
  const json = JSON.stringify(body)
  // 읽지 않은 본문이 남아 있을 수 있으므로 연결을 닫는다
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    connection: 'close',
    ...headers,
  })
  res.end(json)
}
