import { createHash, timingSafeEqual } from 'node:crypto'
import type { Application, NextFunction, Request, Response } from 'express'
import { log } from '../log.ts'
import { CLIENT_KEY_HEADER, EXEMPT_KEY } from '../security/clientKey.ts'
import type { IpLimits } from '../store/limits.ts'
import type { MetricsSnapshot, Spread } from './metrics.ts'

/** 관리 화면 사용자 이름 (비밀번호는 ADMIN_PASSWORD) */
const ADMIN_USER = 'admin'

interface AdminOptions {
  /** 없으면(null) /admin을 열지 않는다 — 부를 때마다 읽는다 */
  password: () => string | null
  limits: () => IpLimits
  snapshot: () => MetricsSnapshot
}

/**
 * /admin — 운영용 읽기 전용 화면 (NFR-12, design §8.3). ADMIN_PASSWORD가 있을 때만 열고, Basic 인증으로 막는다.
 * 비밀번호는 IP마다 10분에 10번까지 틀릴 수 있다.
 * Colyseus 모니터는 GET 요청으로 경기장 상태를 고치고 접속을 끊는 기능까지 열어 두므로(브라우저에 저장된 인증으로
 * 다른 사이트가 대신 부를 수 있다) 쓰지 않고, 보기만 하는 화면을 따로 둔다
 */
export function mountAdmin(app: Application, options: AdminOptions) {
  const guard = requireAdmin(options)
  app.get('/admin', guard, (_req, res) => {
    res.type('html').send(page(options.snapshot()))
  })
  app.get('/admin/metrics', guard, (_req, res) => {
    res.json(options.snapshot())
  })
}

function requireAdmin({ password, limits }: AdminOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const expected = password()
    if (expected === null) {
      res.status(404).end()
      return
    }
    noStore(res)
    const key = String(req.headers[CLIENT_KEY_HEADER] ?? 'unknown')
    const counted = key !== EXEMPT_KEY
    if (counted && await limits().blocked('adminLogin', key)) {
      res.status(429).set('Retry-After', '600').send('로그인을 너무 많이 틀렸습니다. 10분 뒤 다시 시도해 주세요.')
      return
    }
    if (credentialsMatch(req.headers.authorization, expected)) {
      next()
      return
    }
    // 인증 없이 처음 연 요청(브라우저가 로그인 창을 띄우기 전)은 틀린 것으로 세지 않는다
    if (req.headers.authorization && counted) {
      await limits().hit('adminLogin', key)
      log.warn({ event: 'adminLoginFailed' })
    }
    res.status(401).set('WWW-Authenticate', 'Basic realm="Fight Club admin", charset="UTF-8"').send('인증이 필요합니다')
  }
}

function credentialsMatch(header: string | undefined, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon < 0) return false
  // 길이와 상관없이 같은 시간이 걸리게 해시끼리 비교한다
  const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))
  return same(decoded.slice(0, colon), ADMIN_USER) && same(decoded.slice(colon + 1), password)
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function noStore(res: Response): Response {
  // 관리 화면은 다른 사이트에서 읽을 일이 없다 — Colyseus가 모든 응답에 붙이는 CORS 헤더를 지운다
  // (남겨 두면 브라우저에 저장된 Basic 인증을 실어 다른 사이트가 지표를 읽어 갈 수 있다)
  res.removeHeader('Access-Control-Allow-Origin')
  res.removeHeader('Access-Control-Allow-Credentials')
  return res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  })
}

/** 5초마다 새로 고치는 표. 숫자만 들어간다 */
function page(s: MetricsSnapshot): string {
  const ms = (v: Spread) => `${v.avg} / ${v.p95} / ${v.max}`
  const rows = s.perArena
    .map((a) => `<tr><td>#${a.arenaNo}</td><td>${a.humans}</td><td>${a.bots}</td><td>${ms(a.tickMs)}</td><td>${ms(a.patchBytes)}</td></tr>`)
    .join('')
  const blocked = Object.entries(s.blocked).map(([reason, n]) => `${reason} ${n}`).join(' · ')
  return `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>Fight Club 운영</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; color: #1d2230 }
  table { border-collapse: collapse; margin-top: 12px }
  th, td { border: 1px solid #ccd; padding: 4px 10px; text-align: right }
</style>
<h1>Fight Club 운영</h1>
<p>접속 <b>${s.online}</b>명 · 경기장 <b>${s.arenas}</b>개 · 봇 ${s.bots} · 가동 ${Math.floor(s.uptimeSec / 60)}분</p>
<p>틱 처리 ms (평균 / p95 / 최대, 지난 1분): ${ms(s.tickMs)}</p>
<p>상태 패치 바이트 (평균 / p95 / 최대): ${ms(s.patchBytes)} · 한 사람이 받는 양 ${s.patchBytesPerPlayerPerSec} B/s</p>
<p>거절·차단 (시작 뒤 누적): ${blocked}</p>
<p>CPU ${s.cpuPercent.avg}% (최대 ${s.cpuPercent.max}%, 코어 하나 = 100%) · 메모리 ${s.memory.rssMb} MB (힙 ${s.memory.heapUsedMb} MB)</p>
<table>
  <tr><th>경기장</th><th>사람</th><th>봇</th><th>틱 ms</th><th>패치 바이트</th></tr>
  ${rows}
</table>
</html>`
}
