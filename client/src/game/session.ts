import { Callbacks, Client, Predict, type InputHandle, type Reconciler } from '@colyseus/sdk'
import {
  ArenaState, INTERP_DELAY_MS, Msg, PlayerInput, ROOM_NAME, SIM_FIELDS,
  activeHitbox, hitsBody, stepPlayer,
  type DevDummyCommand, type DevDummyKind, type DevLatencyEvent, type HitEvent, type HitQuery, type PlayerState,
} from '@fight-club/shared'
import { SERVER_URL } from './config.ts'
import { KeyboardInput } from './keyboard.ts'
import { ActionTimeline } from './timeline.ts'

/** 이보다 크게 튀는 위치 변화는 보간하지 않고 순간이동으로 그린다 (리스폰 등, m) */
const TELEPORT_SNAP = 3
/** 예측이 서버와 어긋난 만큼을 이 시간에 걸쳐 부드럽게 지운다 (ms) */
const CORRECTION_SMOOTH_MS = 65
export const SPARK_LIFE_MS = 250

export interface Pose {
  x: number
  y: number
  z: number
  /** 바라보는 방향 (y축 회전, rad) */
  facing: number
  action: number
  actionFrame: number
}

export const createPose = (): Pose => ({ x: 0, y: 0, z: 0, facing: 0, action: 0, actionFrame: 0 })

const joinArena = () => new Client(SERVER_URL).joinOrCreate(ROOM_NAME, {}, ArenaState)
type ArenaRoom = Awaited<ReturnType<typeof joinArena>>

export interface Spark {
  x: number
  y: number
  z: number
  /** 나타나는 시각 (performance.now 기준) */
  born: number
}

export interface NetStats {
  rttMs: number
  jitterMs: number
  pendingInputs: number
  /** 마지막 예측 보정 크기 (cm) */
  correctionCm: number
  /** 보정 크기의 이동 평균 (cm) */
  driftCm: number
  /** 내 화면에서 맞힌 잽 / 서버가 확정한 잽 */
  predictedHits: number
  confirmedHits: number
  latencyMs: number | null
  /** 나를 뺀 플레이어·샌드백의 HP */
  targets: { label: string; hp: number }[]
}

/**
 * 게임 한 판의 연결과 넷코드 — React 밖에서 돈다.
 * 내 캐릭터는 Reconciler로 예측·보정하고, 다른 캐릭터는 Predict lerp로 INTERP_DELAY_MS만큼 늦게 보간한다.
 * 서버는 같은 지연으로 되감아 판정하므로 "보이는 대로 맞는다" — design §5
 */
export class GameSession {
  readonly room: ArenaRoom
  readonly sparks: Spark[] = []
  private readonly predict: Predict<ArenaState>
  private readonly input: InputHandle<PlayerInput>
  private me?: Reconciler<PlayerState>
  private readonly keyboard = new KeyboardInput()
  private readonly timeline = new ActionTimeline(INTERP_DELAY_MS)
  private readonly listeners = new Set<() => void>()
  private ids: string[] = []
  /** 이번 공격에 내 화면에서 이미 맞힌 상대 */
  private readonly struck = new Set<string>()
  private predictedHits = 0
  private confirmedHits = 0
  private latencyMs: number | null = null
  private disposed = false
  debugDraw = import.meta.env.DEV

  static async connect(): Promise<GameSession> {
    return new GameSession(await joinArena())
  }

  private constructor(room: ArenaRoom) {
    this.room = room
    this.predict = Predict.get(room, { mode: 'lerp', delay: INTERP_DELAY_MS })
    this.predict.attachAll('players', { mode: 'lerp', fields: ['x', 'y', 'z', 'fx', 'fz'], snap: TELEPORT_SNAP })
    this.input = room.input({ type: PlayerInput, mode: 'reliable' })

    const callbacks = Callbacks.get<ArenaState>(room)
    callbacks.onAdd('players', (player, id) => {
      if (id === room.sessionId) this.predictSelf(player)
      this.updateIds()
    })
    callbacks.onRemove('players', (_player, id) => {
      this.timeline.forget(id)
      this.updateIds()
    })
    room.onStateChange((state) => {
      const now = performance.now()
      for (const [id, p] of state.players) {
        if (id !== room.sessionId) this.timeline.record(id, p.action, p.actionFrame, now)
      }
    })
    room.onMessage(Msg.Hit, (event: HitEvent) => this.onHit(event))
    if (import.meta.env.DEV) {
      // 서버는 수신 지연을 입장할 때 묶고, SDK 시계는 RTT가 4배 넘게 뛰면 새 표본을 버린다.
      // 지연이 바뀌면 다시 입장해야 양방향 지연과 시계가 모두 새 값으로 맞는다
      room.onMessage(Msg.DevLatency, () => location.reload())
      void this.fetchLatency()
    }
  }

  get myId(): string {
    return this.room.sessionId
  }

  /** 렌더 프레임마다 호출: 지난 프레임 이후 밀린 고정 스텝만큼 입력을 보낸다 (보내는 즉시 예측된다) */
  frame(now: number) {
    const steps = this.predict.tick(now)
    for (let i = 0; i < steps; i++) {
      const sample = this.keyboard.sample()
      const data = this.input.data
      data.mx = sample.mx
      data.mz = sample.mz
      data.held = sample.held
      data.pressed = sample.pressed
      this.input.send()
    }
    while (this.sparks.length > 0 && this.sparks[0].born + SPARK_LIFE_MS < now) this.sparks.shift()
  }

  /** 그릴 위치·방향·동작. 위치는 보간·보정된 값, 내 동작은 예측값, 남의 동작은 위치와 같은 지연의 값이다 */
  pose(id: string, out: Pose): Pose | null {
    const p = this.room.state.players.get(id)
    if (!p) return null
    out.x = this.predict.value(p, 'x')
    out.y = this.predict.value(p, 'y')
    out.z = this.predict.value(p, 'z')
    if (id === this.myId && this.me) {
      const s = this.me.state
      out.facing = Math.atan2(s.fx, s.fz)
      out.action = s.action
      out.actionFrame = s.actionFrame
    } else {
      out.facing = Math.atan2(this.predict.value(p, 'fx'), this.predict.value(p, 'fz'))
      if (!this.timeline.at(id, performance.now(), out)) {
        out.action = p.action
        out.actionFrame = p.actionFrame
      }
    }
    return out
  }

  /** 디버그: 서버가 보낸 내 위치 그대로 (보정 전) */
  serverPose(out: Pose): Pose | null {
    const p = this.room.state.players.get(this.myId)
    if (!p) return null
    out.x = p.x
    out.y = p.y
    out.z = p.z
    return out
  }

  /** 디버그: 지금 내 공격 판정 범위 */
  myHitbox(): HitQuery | null {
    return this.me ? activeHitbox(this.me.state) : null
  }

  myHp(): number {
    return this.room.state.players.get(this.myId)?.hp ?? 0
  }

  stats(): NetStats {
    const clock = this.room.clock
    return {
      rttMs: Math.round(clock.smoothedRtt()),
      jitterMs: Math.round(clock.jitter()),
      pendingInputs: this.input.pendingCount,
      correctionCm: Math.round((this.me?.lastCorrectionMag ?? 0) * 100),
      driftCm: Math.round((this.me?.drift.ema ?? 0) * 100),
      predictedHits: this.predictedHits,
      confirmedHits: this.confirmedHits,
      latencyMs: this.latencyMs,
      targets: [...this.room.state.players]
        .filter(([id]) => id !== this.myId)
        .map(([id, p]) => ({ label: p.isBot ? `샌드백 ${id.slice('dummy:'.length)}` : '상대', hp: p.hp })),
    }
  }

  isBot(id: string): boolean {
    return this.room.state.players.get(id)?.isBot ?? false
  }

  /** 개발용: 내 앞에 샌드백을 세우거나(still·patrol) 모두 치운다(clear) */
  commandDummy(kind: DevDummyKind) {
    const command: DevDummyCommand = { kind }
    this.room.send(Msg.DevDummy, command)
  }

  /** 개발용: 서버에 왕복 지연을 주입한다 (S1 체감 시험). 적용되면 모든 탭이 다시 입장한다 */
  async setLatency(ms: number) {
    const res = await fetch(new URL(`/dev/latency?ms=${ms}`, SERVER_URL), { method: 'POST' })
    if (!res.ok) throw new Error(`지연 설정 실패 (${res.status})`)
  }

  private async fetchLatency() {
    const res = await fetch(new URL('/dev/latency', SERVER_URL)).catch(() => null)
    if (res?.ok) this.latencyMs = ((await res.json()) as DevLatencyEvent).latencyMs
  }

  toggleDebugDraw() {
    this.debugDraw = !this.debugDraw
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getPlayerIds = () => this.ids

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.keyboard.dispose()
    this.predict.dispose()
    void this.room.leave()
  }

  private predictSelf(player: PlayerState) {
    this.me = this.predict.reconciler(player, {
      input: this.input,
      fields: SIM_FIELDS,
      smoothMs: CORRECTION_SMOOTH_MS,
      step: (ctx, state, command) => {
        const query = stepPlayer(state, command, ctx.dt)
        // 다시 적용(replay)할 때는 이펙트를 또 띄우지 않는다
        if (query && !ctx.isReplay) this.predictHit(query)
      },
    })
  }

  /** 내 화면에 보이는 상대 위치로 명중을 미리 판단해 타격 이펙트를 바로 띄운다. 피해는 서버가 정한다 */
  private predictHit(query: HitQuery) {
    if (query.first) this.struck.clear()
    for (const [id, other] of this.room.state.players) {
      if (id === this.myId || this.struck.has(id)) continue
      const x = this.predict.value(other, 'x')
      const y = this.predict.value(other, 'y')
      const z = this.predict.value(other, 'z')
      if (!hitsBody(query, x, y, z)) continue
      this.struck.add(id)
      this.predictedHits++
      this.sparks.push({ x: query.x, y: query.y, z: query.z, born: performance.now() })
    }
  }

  private onHit(event: HitEvent) {
    // 내 공격은 이미 예측 이펙트를 띄웠다
    if (event.attacker === this.myId) {
      this.confirmedHits++
      return
    }
    const victim = this.room.state.players.get(event.victim)
    if (!victim) return
    const pose = this.pose(event.victim, createPose())
    if (!pose) return
    // 남끼리의 명중은 보간 지연만큼 늦게 보여줘야 화면 속 주먹과 맞는다
    const delay = event.victim === this.myId ? 0 : INTERP_DELAY_MS
    this.sparks.push({ x: pose.x, y: pose.y + 1.3, z: pose.z, born: performance.now() + delay })
  }

  private updateIds() {
    this.ids = [...this.room.state.players.keys()]
    for (const listener of this.listeners) listener()
  }
}
