import { PATCH_RATE, TICK_RATE } from '@fight-club/shared'
import { log } from '../log.ts'

/** 지표는 지난 1분을 본다 (s) */
const WINDOW_SECONDS = 60

/** 경고 기준: 경기장 틱 처리 p95 (ms), 프로세스 CPU (%) — design §8.3 */
const TICK_P95_WARN_MS = 4
const CPU_WARN_PERCENT = 70

/** 지표 로그 간격 (ms) */
const LOG_EVERY_MS = 60_000

/** CPU 사용률을 재는 간격 (ms) — 지난 1분은 12번 */
const CPU_SAMPLE_MS = 5_000

/** 거절·차단 이유 — design §6.7 (flood: 메시지를 너무 많이 보내 연결을 끊었다) */
export type BlockReason = 'origin' | 'method' | 'body' | 'joinRate' | 'connections' | 'version' | 'flood'

/** 가장 최근 값 n개만 남기는 고리 버퍼 */
class Recent {
  private readonly values: Float64Array
  private count = 0

  constructor(size: number) {
    this.values = new Float64Array(size)
  }

  push(value: number) {
    this.values[this.count++ % this.values.length] = value
  }

  toArray(): number[] {
    return Array.from(this.values.subarray(0, Math.min(this.count, this.values.length)))
  }
}

/**
 * 이 프로세스의 CPU 사용률 (%, 코어 하나 = 100) — 5초마다 잰다. 게임 루프는 스레드 하나에서 돌므로
 * 100%에 가까워지면 틱이 밀린다 (경고 기준 70%, design §8.3)
 */
const cpuSamples = new Recent(LOG_EVERY_MS / CPU_SAMPLE_MS)
let cpuMark = { usage: process.cpuUsage(), at: performance.now() }

function sampleCpu() {
  const now = performance.now()
  const used = process.cpuUsage(cpuMark.usage)
  cpuSamples.push(((used.user + used.system) / 1000 / (now - cpuMark.at)) * 100)
  cpuMark = { usage: process.cpuUsage(), at: now }
}

/** 경기장 하나의 지난 1분 기록: 틱 처리 시간(ms)과 상태 패치 크기(바이트) */
export class ArenaMeter {
  readonly tickMs = new Recent(TICK_RATE * WINDOW_SECONDS)
  readonly patchBytes = new Recent(PATCH_RATE * WINDOW_SECONDS)
}

/** 지표에 잡히는 경기장 */
export interface MeteredArena {
  readonly arenaNo: number
  readonly humans: number
  readonly bots: number
  readonly meter: ArenaMeter
}

/** 평균·p95·최대 */
export interface Spread {
  avg: number
  p95: number
  max: number
}

export interface MetricsSnapshot {
  /** 접속한 사람 (봇 제외) */
  online: number
  arenas: number
  bots: number
  /** 경기장 틱 처리 시간 (ms, 모든 경기장의 지난 1분) */
  tickMs: Spread
  /** 상태 패치 한 번의 크기 (바이트) */
  patchBytes: Spread
  /** 플레이어 한 명이 받는 상태 패치 양 (바이트/초, 가장 많은 경기장 기준) */
  patchBytesPerPlayerPerSec: number
  /** 서버가 시작된 뒤 거절하거나 끊은 수 (이유별) */
  blocked: Record<BlockReason, number>
  /** 프로세스 CPU 사용률 (%, 코어 하나 = 100, 지난 1분) — 지표 로그를 켠 뒤부터 잰다 */
  cpuPercent: Spread
  memory: { rssMb: number; heapUsedMb: number }
  uptimeSec: number
  perArena: { arenaNo: number; humans: number; bots: number; tickMs: Spread; patchBytes: Spread }[]
}

const blocked: Record<BlockReason, number> = { origin: 0, method: 0, body: 0, joinRate: 0, connections: 0, version: 0, flood: 0 }

/** 거절·차단은 한 줄씩 남기면 공격 중에 로그가 넘치므로 수만 세어 1분 지표에 싣는다 (하나하나는 debug 수준) */
export function countBlocked(reason: BlockReason) {
  blocked[reason]++
  log.debug({ event: 'blocked', reason })
}

export function snapshot(arenas: Iterable<MeteredArena>): MetricsSnapshot {
  const perArena: MetricsSnapshot['perArena'] = []
  const ticks: number[] = []
  const patches: number[] = []
  let online = 0
  let bots = 0
  let busiest = 0
  for (const arena of arenas) {
    const arenaTicks = arena.meter.tickMs.toArray()
    const arenaPatches = arena.meter.patchBytes.toArray()
    ticks.push(...arenaTicks)
    patches.push(...arenaPatches)
    online += arena.humans
    bots += arena.bots
    const patchBytes = spread(arenaPatches)
    // 패치는 2틱마다 경기장의 모든 사람에게 같은 것이 간다
    busiest = Math.max(busiest, Math.round(patchBytes.avg * PATCH_RATE))
    perArena.push({ arenaNo: arena.arenaNo, humans: arena.humans, bots: arena.bots, tickMs: spread(arenaTicks), patchBytes })
  }
  perArena.sort((a, b) => a.arenaNo - b.arenaNo)
  const memory = process.memoryUsage()
  return {
    online,
    arenas: perArena.length,
    bots,
    tickMs: spread(ticks),
    patchBytes: spread(patches),
    patchBytesPerPlayerPerSec: busiest,
    blocked: { ...blocked },
    cpuPercent: spread(cpuSamples.toArray()),
    memory: { rssMb: round(memory.rss / 2 ** 20), heapUsedMb: round(memory.heapUsed / 2 ** 20) },
    uptimeSec: Math.round(process.uptime()),
    perArena,
  }
}

/** 지표를 로그 한 줄로 남긴다. 틱 처리 p95나 CPU가 경고 기준을 넘으면 warn */
export function logMetrics(arenas: Iterable<MeteredArena>) {
  const s = snapshot(arenas)
  const level = s.tickMs.p95 > TICK_P95_WARN_MS || s.cpuPercent.avg > CPU_WARN_PERCENT ? 'warn' : 'info'
  log[level]({ event: 'metrics', ...s }, '1분 지표')
}

/** 1분마다 지표 로그 (P6-3), 5초마다 CPU 측정. 멈추는 함수를 돌려준다 */
export function startMetricsLog(arenas: () => Iterable<MeteredArena>, everyMs = LOG_EVERY_MS): () => void {
  cpuMark = { usage: process.cpuUsage(), at: performance.now() }
  const cpu = setInterval(sampleCpu, Math.min(CPU_SAMPLE_MS, everyMs))
  const timer = setInterval(() => logMetrics(arenas()), everyMs)
  cpu.unref()
  timer.unref()
  return () => {
    clearInterval(cpu)
    clearInterval(timer)
  }
}

function spread(values: number[]): Spread {
  if (values.length === 0) return { avg: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, v) => sum + v, 0)
  return {
    avg: round(total / sorted.length),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max: round(sorted[sorted.length - 1]),
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
