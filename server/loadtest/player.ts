// 부하 시험의 가짜 플레이어들 (run.ts가 프로세스로 띄운다) — 사람처럼 돌아다니고 때리고, 탈락하면 다시 들어온다
import { Client, type InputHandle } from '@colyseus/sdk'
import {
  ARENA_HALF, ArenaState, Btn, CHARACTER_COUNT, PROTOCOL_VERSION, PlayerInput, ROOM_NAME, TICK_RATE, randomNameIndex,
  type JoinOptions,
} from '@fight-club/shared'

export interface PlayerJob {
  url: string
  origin: string
  /** 이 프로세스가 맡은 플레이어 수와, 전체에서 몇 번째부터인지 (입장을 전체에서 한 줄로 세운다) */
  count: number
  first: number
  /** 전체 입장 간격 (ms) */
  joinGapMs: number
}

export interface PlayerReport {
  connected: number
  joins: number
  rejoins: number
  /** 입장 실패 (코드별) */
  failures: Record<string, number>
  /** 받은 바이트 (상태 패치 + 메시지), 보낸 입력 수 — 지난 보고 뒤로 */
  bytesIn: number
  inputs: number
}

/** 가장자리에서 이만큼 안쪽을 넘으면 가운데로 돌아간다 (m) */
const EDGE = ARENA_HALF - 3
/** 한 프레임에 몰아 보낼 수 있는 입력 수 — 브라우저 SDK와 같다 */
const MAX_STEPS = 5

const joinArena = (client: Client, options: JoinOptions) => client.joinOrCreate(ROOM_NAME, options, ArenaState)
type ArenaRoom = Awaited<ReturnType<typeof joinArena>>

class FakePlayer {
  private room: ArenaRoom | null = null
  private input: InputHandle<PlayerInput> | null = null
  private heading = Math.random() * Math.PI * 2
  private turnAt = 0
  private running = false
  private guarding = false
  private readonly client: Client
  private readonly report: PlayerReport

  constructor(job: PlayerJob, report: PlayerReport) {
    this.client = new Client(job.url, { headers: { Origin: job.origin } })
    this.report = report
  }

  async join(rejoin: boolean) {
    try {
      const options = { v: PROTOCOL_VERSION, characterId: Math.floor(Math.random() * CHARACTER_COUNT), name: randomNameIndex() }
      const room = await joinArena(this.client, options)
      this.room = room
      this.input = room.input({ type: PlayerInput, mode: 'reliable' })
      // 명중·탈락·결과 메시지는 받기만 한다 (처리기가 없으면 SDK가 메시지마다 경고를 찍는다)
      room.onMessage('*', () => {})
      // 받은 양을 잰다 — SDK가 쓰는 WebSocket에 귀를 단다
      const socket = (room as unknown as { connection: { transport: { ws: WebSocket } } }).connection.transport.ws
      socket.addEventListener('message', (event: { data: ArrayBuffer }) => { this.report.bytesIn += event.data.byteLength })
      room.onLeave(() => {
        this.room = null
        this.input = null
        this.report.connected--
        // 탈락하거나 끊기면 잠시 뒤 다시 들어온다 (실제 사람처럼)
        if (!stopping) setTimeout(() => void this.join(true), 1000 + Math.random() * 2000)
      })
      this.report.connected++
      if (rejoin) this.report.rejoins++
      else this.report.joins++
    } catch (error) {
      const code = String((error as { code?: unknown }).code ?? 'error')
      this.report.failures[code] = (this.report.failures[code] ?? 0) + 1
      if (!stopping) setTimeout(() => void this.join(rejoin), 3000)
    }
  }

  /** 한 스텝의 입력 — 대체로 걷고, 가끔 달리고·막고·때리고·뛴다 */
  step(now: number) {
    const room = this.room
    const input = this.input
    if (!room || !input) return
    const me = room.state.players.get(room.sessionId)
    if (now >= this.turnAt) {
      this.heading += (Math.random() - 0.5) * Math.PI
      this.turnAt = now + 500 + Math.random() * 1500
      this.running = Math.random() < 0.25
      this.guarding = Math.random() < 0.08
    }
    if (me && (Math.abs(me.x) > EDGE || Math.abs(me.z) > EDGE)) this.heading = Math.atan2(-me.z, -me.x)
    const data = input.data
    data.mx = Math.round(Math.cos(this.heading) * 127)
    data.mz = Math.round(Math.sin(this.heading) * 127)
    data.held = (this.running ? Btn.Run : 0) | (this.guarding ? Btn.Guard : 0)
    const roll = Math.random()
    data.pressed = roll < 0.006 ? Btn.PunchL : roll < 0.010 ? Btn.PunchR : roll < 0.013 ? Btn.Kick
      : roll < 0.014 ? Btn.Grab : roll < 0.016 ? Btn.Jump : 0
    input.send()
    this.report.inputs++
  }

  async leave() {
    await this.room?.leave().catch(() => {})
  }
}

let stopping = false

process.on('message', (job: PlayerJob) => {
  const report: PlayerReport = { connected: 0, joins: 0, rejoins: 0, failures: {}, bytesIn: 0, inputs: 0 }
  const players = Array.from({ length: job.count }, () => new FakePlayer(job, report))
  // 전체 입장 순서를 한 줄로: 이 프로세스의 i번째는 전체에서 first + i번째
  players.forEach((player, i) => setTimeout(() => void player.join(false), (job.first + i) * job.joinGapMs))

  // 60Hz 입력 — 밀린 만큼 보내되 한 번에 5스텝까지 (브라우저 SDK와 같다)
  const stepMs = 1000 / TICK_RATE
  const started = performance.now()
  let sent = 0
  const loop = setInterval(() => {
    const now = performance.now()
    const due = Math.min(MAX_STEPS, Math.floor((now - started) / stepMs) - sent)
    for (let s = 0; s < due; s++) for (const player of players) player.step(now)
    sent = Math.floor((now - started) / stepMs)
  }, 4)

  const reporter = setInterval(() => {
    process.send?.({ ...report, failures: { ...report.failures } })
    report.bytesIn = 0
    report.inputs = 0
  }, 5000)

  process.on('disconnect', async () => {
    stopping = true
    clearInterval(loop)
    clearInterval(reporter)
    await Promise.all(players.map((player) => player.leave()))
    process.exit(0)
  })
})
