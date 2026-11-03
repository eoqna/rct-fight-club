// 부하 시험 (design §9, P7-4) — 사람처럼 움직이고 때리는 가짜 플레이어를 붙여 놓고 서버 지표(/admin/metrics)를 본다.
// 서버는 운영 설정으로 띄우고, 이 컴퓨터의 IP를 IP_LIMIT_EXEMPT에 넣는다 (같은 IP에서 수백 명이 들어가므로).
//
//   npm run loadtest -- --url https://fightclub.duckdns.org --admin <비밀번호> [--players 192] [--seconds 300]
//
// 목표 (design §9): 경기장 12개 × 16명에서 경기장 틱 처리 p95 < 1ms, 서버 프로세스 CPU < 70%
import { fork, type ChildProcess } from 'node:child_process'
import { parseArgs } from 'node:util'
import type { MetricsSnapshot } from '../src/ops/metrics.ts'
import type { PlayerJob, PlayerReport } from './player.ts'

const TICK_P95_TARGET_MS = 1
const CPU_TARGET_PERCENT = 70
/** 지표를 읽는 간격 (ms) */
const POLL_MS = 5000

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:2567' },
    // 입장 요청에 붙일 출처 — 서버의 ALLOWED_ORIGINS에 든 값. 기본은 url과 같은 출처 (Caddy 뒤 운영 구성)
    origin: { type: 'string' },
    players: { type: 'string', default: '192' },
    workers: { type: 'string', default: '4' },
    seconds: { type: 'string', default: '120' },
    // 모두 들어간 뒤 재기 시작할 때까지 (s) — 지표는 지난 1분을 보므로 1분은 둔다
    warmup: { type: 'string', default: '60' },
    // /admin/metrics 비밀번호 — 없으면 서버 쪽 지표 없이 플레이어만 붙인다
    admin: { type: 'string' },
    // 전체 입장 간격 (ms) — 한 줄로 들어가야 경기장이 16명씩 찬다
    'join-gap': { type: 'string', default: '40' },
  },
})
const url = values.url
const origin = values.origin ?? new URL(url).origin
const players = Number(values.players)
const workers = Math.min(Number(values.workers), players)
const seconds = Number(values.seconds)
const warmup = Number(values.warmup)
const joinGapMs = Number(values['join-gap'])

const reports = new Map<ChildProcess, PlayerReport>()
const children: ChildProcess[] = []
for (let w = 0, first = 0; w < workers; w++) {
  const count = Math.floor(players / workers) + (w < players % workers ? 1 : 0)
  // Node 22의 내장 WebSocket(undici)은 TLS 너머 Caddy와의 업그레이드에 실패한다 — 끄면 SDK가 ws 패키지를 쓴다 (브라우저는 문제없다)
  const child = fork(new URL('./player.ts', import.meta.url).pathname, { execArgv: ['--import', 'tsx', '--no-experimental-websocket'] })
  child.on('message', (report: PlayerReport) => reports.set(child, report))
  const job: PlayerJob = { url, origin, count, first, joinGapMs }
  child.send(job)
  children.push(child)
  first += count
}

/** 받은 보고를 더한다 */
function total() {
  const sum = { connected: 0, joins: 0, rejoins: 0, bytesIn: 0, inputs: 0, failures: {} as Record<string, number> }
  for (const r of reports.values()) {
    sum.connected += r.connected
    sum.joins += r.joins
    sum.rejoins += r.rejoins
    sum.bytesIn += r.bytesIn
    sum.inputs += r.inputs
    for (const [code, n] of Object.entries(r.failures)) sum.failures[code] = (sum.failures[code] ?? 0) + n
  }
  return sum
}

async function serverMetrics(): Promise<MetricsSnapshot | null> {
  if (!values.admin) return null
  try {
    const res = await fetch(new URL('/admin/metrics', url), {
      headers: { authorization: `Basic ${Buffer.from(`admin:${values.admin}`).toString('base64')}` },
    })
    return res.ok ? (await res.json()) as MetricsSnapshot : null
  } catch {
    return null
  }
}

const started = Date.now()
const joinSeconds = (players * joinGapMs) / 1000
const endAt = started + (joinSeconds + warmup + seconds) * 1000
console.log(`▶ ${url} 에 ${players}명 (프로세스 ${workers}개) — 입장 ${joinSeconds.toFixed(0)}초 + 준비 ${warmup}초 + 측정 ${seconds}초`)

interface Sample { metrics: MetricsSnapshot; perClientBytesPerSec: number }
const samples: Sample[] = []
while (Date.now() < endAt) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  const sum = total()
  const metrics = await serverMetrics()
  const elapsed = Math.round((Date.now() - started) / 1000)
  // 플레이어 보고는 5초마다 비워진다 — 5초 동안 받은 양
  const perClient = sum.connected > 0 ? Math.round(sum.bytesIn / 5 / sum.connected) : 0
  const measuring = Date.now() >= started + (joinSeconds + warmup) * 1000
  if (metrics && measuring) samples.push({ metrics, perClientBytesPerSec: perClient })
  const failures = Object.keys(sum.failures).length > 0 ? ` 실패 ${JSON.stringify(sum.failures)}` : ''
  const server = metrics
    ? ` | 서버: 접속 ${metrics.online} 경기장 ${metrics.arenas} 틱 p95 ${metrics.tickMs.p95}ms CPU ${metrics.cpuPercent.avg}%`
    : ''
  console.log(`${measuring ? '●' : '○'} ${elapsed}s 연결 ${sum.connected} (입장 ${sum.joins} · 재입장 ${sum.rejoins}) 1인당 수신 ${(perClient / 1024).toFixed(1)}KB/s${failures}${server}`)
}

for (const child of children) child.disconnect()

const sum = total()
console.log('\n== 결과 ==')
console.log(`입장 ${sum.joins} · 재입장 ${sum.rejoins} · 실패 ${JSON.stringify(sum.failures)}`)
if (samples.length === 0) {
  console.log('서버 지표 없음 — --admin 비밀번호를 주고, 측정 시간을 넉넉히 주세요')
  process.exit(sum.joins < players ? 1 : 0)
}
const worst = (pick: (s: Sample) => number) => Math.max(...samples.map(pick))
const avg = (pick: (s: Sample) => number) => samples.reduce((n, s) => n + pick(s), 0) / samples.length
const tickP95 = worst((s) => s.metrics.tickMs.p95)
const cpuAvg = avg((s) => s.metrics.cpuPercent.avg)
const cpuMax = worst((s) => s.metrics.cpuPercent.max)
const last = samples[samples.length - 1].metrics
console.log(`동시 접속 최대 ${worst((s) => s.metrics.online)} · 경기장 ${last.arenas}개`)
console.log(`틱 처리 p95 (지난 1분, 측정 중 가장 나쁜 값) ${tickP95}ms — 목표 < ${TICK_P95_TARGET_MS}ms ${tickP95 < TICK_P95_TARGET_MS ? '✅' : '❌'}`)
console.log(`서버 CPU 평균 ${cpuAvg.toFixed(1)}% · 최대 ${cpuMax}% (코어 하나 = 100%) — 목표 < ${CPU_TARGET_PERCENT}% ${cpuMax < CPU_TARGET_PERCENT ? '✅' : '❌'}`)
console.log(`한 사람이 받는 양: 서버 기준 패치 ${last.patchBytesPerPlayerPerSec} B/s · 클라이언트 실측 ${Math.round(avg((s) => s.perClientBytesPerSec))} B/s`)
console.log(`메모리 ${last.memory.rssMb}MB (힙 ${last.memory.heapUsedMb}MB)`)
process.exit(tickP95 < TICK_P95_TARGET_MS && cpuMax < CPU_TARGET_PERCENT ? 0 : 1)
