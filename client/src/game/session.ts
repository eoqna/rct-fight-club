import { Callbacks, Client, Predict, type InputHandle, type Reconciler } from '@colyseus/sdk'
import {
  ARENA_CAPACITY, ATTACKS, Action, ArenaState, INTERP_DELAY_MS, Msg, PlayerInput, ROOM_NAME, SIM_FIELDS, TICK_RATE,
  activeBox, hitsBody, isGuarding, isHittable, rankEntries, stepPlayer,
  type Body, type DevDummyCommand, type DevDummyKind, type DevLatencyEvent, type ElimEvent, type GrabQuery,
  type HitEvent, type HitQuery, type JoinOptions, type PlayerSim, type PlayerState, type ResultMsg, type StrikeId,
} from '@fight-club/shared'
import { SEOI } from './animation.ts'
import { SERVER_URL } from './config.ts'
import { KeyboardInput } from './keyboard.ts'
import { ActionTimeline, type ActionPose } from './timeline.ts'

/** 이보다 크게 튀는 위치 변화는 보간하지 않고 순간이동으로 그린다 (리스폰 등, m) */
const TELEPORT_SNAP = 3
/** 잡힌 사람의 상대를 찾는 거리 (m) — 서버는 잡은 쪽 앞 0.8m에 붙여 두고, 보간이 조금 늦을 수 있다 */
const PARTNER_RANGE = 1.6
/** 예측이 서버와 어긋난 만큼을 이 시간에 걸쳐 부드럽게 지운다 (ms) */
const CORRECTION_SMOOTH_MS = 65
export const SPARK_LIFE_MS = 250
/** 디버그 패널에 보여줄 최근 탈락 수 */
const RECENT_ELIMS = 3
/** 킬 피드: 최근 몇 개를 몇 초 동안 보여준다 (FR-43) */
const FEED_SIZE = 5
export const FEED_LIFE_MS = 5000
/** 순위표에 보여줄 위쪽 사람 수 (FR-44) */
const LEADERBOARD_TOP = 5

export interface Pose {
  x: number
  y: number
  z: number
  /** 바라보는 방향 (y축 회전, rad) */
  facing: number
  action: number
  actionFrame: number
  /** 피격·던져짐 경직 길이 (프레임) */
  stun: number
  /** 남은 무적 프레임 — 깜빡여 보인다 */
  invuln: number
}

export const createPose = (): Pose => ({ x: 0, y: 0, z: 0, facing: 0, action: 0, actionFrame: 0, stun: 0, invuln: 0 })

/** 캐릭터와 색상 변형 — 입장할 때 서버가 정하고 바뀌지 않는다 */
export interface Look {
  characterId: number
  variant: number
}

const joinArena = (options: JoinOptions) => new Client(SERVER_URL).joinOrCreate(ROOM_NAME, options, ArenaState)
type ArenaRoom = Awaited<ReturnType<typeof joinArena>>

export interface Spark {
  x: number
  y: number
  z: number
  /** 나타나는 시각 (performance.now 기준) */
  born: number
  /** 가드로 막은 타격 */
  guarded: boolean
  /** 세게 맞힌 타격 (발차기·돌진·날아차기·던지기) — 히트스톱·카메라 흔들림을 준다 */
  heavy: boolean
  attacker: string
  victim: string
}

/** 이만큼 이상 밀어내는 타격을 강타로 본다 (m) */
const HEAVY_KNOCKBACK = 2
const isHeavy = (attack: StrikeId) => attack === 'throw' || ATTACKS[attack].knockback >= HEAVY_KNOCKBACK

/** 탈락해 결과를 받았거나, 그 밖의 이유로 연결이 끊겼다 */
/**
 * 탈락해 결과를 받았거나, 연결이 끊겼거나, (개발용) 지연 주입이 바뀌어 같은 설정으로 다시 들어가야 한다.
 * 다시 입장하면 새 Client로 연결하므로 SDK 시계도 새 지연에 맞춰 처음부터 잰다
 */
export type SessionEnd =
  | { kind: 'eliminated'; result: ResultMsg }
  | { kind: 'disconnected'; code: number }
  | { kind: 'rejoin' }

/** 킬 피드 한 줄 — 받은 시각과 함께 */
export interface FeedEntry extends ElimEvent {
  at: number
}

/** 순위표 한 줄 */
export interface RankRow {
  id: string
  rank: number
  name: string
  kills: number
  isBot: boolean
  me: boolean
}

export interface NetStats {
  rttMs: number
  jitterMs: number
  pendingInputs: number
  /** 마지막 예측 보정 크기 (cm) */
  correctionCm: number
  /** 보정 크기의 이동 평균 (cm) */
  driftCm: number
  /** 내 화면에서 맞힌 공격 / 서버가 확정한 공격 */
  predictedHits: number
  confirmedHits: number
  latencyMs: number | null
  /** 나를 뺀 플레이어·샌드백의 HP */
  targets: { label: string; hp: number }[]
  /** 내 동작 이름과 경과 프레임 */
  myAction: string
  /** 최근 탈락 소식 (새것이 앞) */
  recentElims: ElimEvent[]
}

const ACTION_NAMES = new Map<number, string>(Object.entries(Action).map(([name, value]) => [value, name]))

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
  private readonly endListeners = new Set<(end: SessionEnd) => void>()
  private ids: string[] = []
  /** 내 예측이 부딪히는 다른 몸들. 서버가 마지막으로 보낸 위치를 그대로 쓴다 (서버 판정과 가장 가깝다) */
  private readonly others: PlayerState[] = []
  /** 이번 공격에 내 화면에서 이미 맞힌 상대 */
  private readonly struck = new Set<string>()
  private readonly shownAction: ActionPose = { action: 0, actionFrame: 0, stun: 0 }
  private readonly elims: ElimEvent[] = []
  private readonly feed: FeedEntry[] = []
  /** 잡힌 사람 → 잡은 사람 (엎어치기 연출). 서버는 짝을 보내지 않으므로 가까이 있는 잡는 사람으로 찾는다 */
  private readonly partners = new Map<string, string>()
  private ended = false
  private predictedHits = 0
  private confirmedHits = 0
  private latencyMs: number | null = null
  private disposed = false
  debugDraw = import.meta.env.DEV

  static async connect(options: JoinOptions): Promise<GameSession> {
    return new GameSession(await joinArena(options))
  }

  private constructor(room: ArenaRoom) {
    this.room = room
    this.predict = Predict.get(room, { mode: 'lerp', delay: INTERP_DELAY_MS })
    this.predict.attachAll('players', { mode: 'lerp', fields: ['x', 'y', 'z', 'fx', 'fz'], snap: TELEPORT_SNAP })
    this.input = room.input({ type: PlayerInput, mode: 'reliable' })

    const callbacks = Callbacks.get<ArenaState>(room)
    callbacks.onAdd('players', (player, id) => {
      if (id === room.sessionId) this.predictSelf(player)
      else this.others.push(player)
      this.updateIds()
    })
    callbacks.onRemove('players', (player, id) => {
      const index = this.others.indexOf(player)
      if (index >= 0) this.others.splice(index, 1)
      this.timeline.forget(id)
      this.updateIds()
    })
    room.onStateChange((state) => {
      const now = performance.now()
      for (const [id, p] of state.players) {
        if (id !== room.sessionId) this.timeline.record(id, p.action, p.actionFrame, p.stun, now)
      }
    })
    room.onMessage(Msg.Hit, (event: HitEvent) => this.onHit(event))
    room.onMessage(Msg.Elim, (event: ElimEvent) => {
      this.elims.unshift(event)
      this.elims.length = Math.min(this.elims.length, RECENT_ELIMS)
      this.feed.unshift({ ...event, at: performance.now() })
      this.feed.length = Math.min(this.feed.length, FEED_SIZE)
    })
    // 결과 직후 서버가 연결을 끊는다(CloseCode.Eliminated). 결과가 오면 기다리지 않고 바로 끝낸다
    room.onMessage(Msg.Result, (result: ResultMsg) => this.finish({ kind: 'eliminated', result }))
    room.onLeave((code) => this.finish({ kind: 'disconnected', code }))
    if (import.meta.env.DEV) {
      // 서버는 수신 지연을 입장할 때 묶고, SDK 시계는 RTT가 4배 넘게 뛰면 새 표본을 버린다.
      // 지연이 바뀌면 다시 입장해야 양방향 지연과 시계가 모두 새 값으로 맞는다
      room.onMessage(Msg.DevLatency, () => this.finish({ kind: 'rejoin' }))
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
      out.stun = s.stun
      out.invuln = s.invuln
    } else {
      out.facing = Math.atan2(this.predict.value(p, 'fx'), this.predict.value(p, 'fz'))
      if (!this.timeline.at(id, performance.now(), out)) {
        out.action = p.action
        out.actionFrame = p.actionFrame
        out.stun = p.stun
      }
      out.invuln = p.invuln
    }
    return out
  }

  /**
   * 엎어치기 연출용: 잡혔거나 던져진 사람의 상대(잡은 사람) 자세. 잡힌 동안 가장 가까운 잡는 사람(Holding·Throwing)을
   * 찾아 기억하고, 던져진 뒤에도 같은 사람을 쓴다. 상대가 없으면 null
   */
  throwPartner(id: string, pose: Pose, out: Pose): Pose | null {
    if (pose.action === Action.Grabbed) {
      let best: string | null = null
      let bestDist = PARTNER_RANGE * PARTNER_RANGE
      for (const other of this.ids) {
        if (other === id || !this.pose(other, out)) continue
        if (out.action !== Action.Holding && out.action !== Action.Throwing) continue
        const d = (out.x - pose.x) ** 2 + (out.z - pose.z) ** 2
        if (d < bestDist) {
          bestDist = d
          best = other
        }
      }
      if (best) this.partners.set(id, best)
    } else if (pose.action !== Action.Thrown) {
      this.partners.delete(id)
      return null
    }
    const partner = this.partners.get(id)
    return partner ? this.pose(partner, out) : null
  }

  /** 그 플레이어의 캐릭터와 색상 변형 */
  look(id: string): Look {
    const p = this.room.state.players.get(id)
    return { characterId: p?.characterId ?? 0, variant: p?.variant ?? 0 }
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

  /** 디버그: 지금 내 공격·잡기 판정 범위 */
  myHitbox(): HitQuery | GrabQuery | null {
    return this.me ? activeBox(this.me.state) : null
  }

  myHp(): number {
    return this.room.state.players.get(this.myId)?.hp ?? 0
  }

  myKills(): number {
    return this.room.state.players.get(this.myId)?.kills ?? 0
  }

  /** 들어온 뒤 지난 시간 (ms) — 서버 틱으로 센다 */
  mySurvivalMs(): number {
    const me = this.room.state.players.get(this.myId)
    return me ? ((this.room.state.tick - me.joinTick) * 1000) / TICK_RATE : 0
  }

  /** `경기장 #3 · 12/16` (FR-05) — 사람만 센다 (샌드백·봇은 정원에 들지 않는다) */
  arenaInfo(): { arenaNo: number; humans: number; capacity: number } {
    let humans = 0
    for (const p of this.room.state.players.values()) if (!p.isBot) humans++
    return { arenaNo: this.room.state.arenaNo, humans, capacity: ARENA_CAPACITY }
  }

  /** 순위표: 위쪽 5명과, 그 밖이면 내 줄 (FR-44) */
  leaderboard(): RankRow[] {
    const rows = rankEntries<string, PlayerState>(this.room.state.players.entries()).map(([id, p], i): RankRow => ({
      id, rank: i + 1, name: p.name, kills: p.kills, isBot: p.isBot, me: id === this.myId,
    }))
    const top = rows.slice(0, LEADERBOARD_TOP)
    const mine = rows.find((row) => row.me)
    return mine && mine.rank > LEADERBOARD_TOP ? [...top, mine] : top
  }

  /** 아직 보여줄 킬 피드 (새것이 위) */
  killFeed(): FeedEntry[] {
    const now = performance.now()
    return this.feed.filter((entry) => now - entry.at < FEED_LIFE_MS)
  }

  /** 이름표에 쓸 이름 (봇은 🤖) */
  nameOf(id: string): string {
    const p = this.room.state.players.get(id)
    return p ? `${p.isBot ? '🤖 ' : ''}${p.name}` : ''
  }

  hpOf(id: string): number {
    return this.room.state.players.get(id)?.hp ?? 0
  }

  /** 내 발차기·잡기를 다시 쓸 수 있을 때까지 남은 프레임 (예측값 — 누르는 즉시 줄어들기 시작한다) */
  myCooldown(kind: 'kick' | 'grab'): number {
    const s = this.me?.state
    if (!s) return 0
    return kind === 'kick' ? s.kickCooldown : s.grabCooldown
  }

  stats(): NetStats {
    const clock = this.room.clock
    const me = this.me?.state
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
      myAction: me ? `${ACTION_NAMES.get(me.action) ?? me.action} (${me.actionFrame})` : '-',
      recentElims: this.elims,
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

  /** 탈락하거나 연결이 끊기면 한 번 불린다 (dispose로 직접 나간 경우는 제외) */
  onEnd(listener: (end: SessionEnd) => void) {
    this.endListeners.add(listener)
    return () => {
      this.endListeners.delete(listener)
    }
  }

  private finish(end: SessionEnd) {
    if (this.ended || this.disposed) return
    this.ended = true
    for (const listener of this.endListeners) listener(end)
  }

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
        const event = stepPlayer(state, command, ctx.dt, {
          bodies: this.others,
          // 조준 보정은 화면에 보이던 상대 위치로 계산하고, 다시 적용할 때는 그때 값을 그대로 쓴다
          aimTargets: () => ctx.memo('aim', () => this.visibleTargets()) ?? [],
        })
        // 다시 적용(replay)할 때는 이펙트를 또 띄우지 않는다
        if (event?.kind === 'hit' && !ctx.isReplay) this.predictHit(event, state)
      },
    })
  }

  /** 지금 화면에 그려진, 맞을 수 있는 상대 위치 */
  private visibleTargets(): Body[] {
    const bodies: Body[] = []
    for (const other of this.others) {
      if (!isHittable(other)) continue
      bodies.push({ x: this.predict.value(other, 'x'), y: this.predict.value(other, 'y'), z: this.predict.value(other, 'z') })
    }
    return bodies
  }

  /**
   * 내 화면에 보이는 상대로 명중과 가드를 미리 판단해 타격 이펙트를 바로 띄운다. 피해는 서버가 정한다.
   * 서버도 내가 보던 시점의 상대로 판정하므로 대부분 맞는다 (서버는 지금 가드 중인지도 보므로 가드는 더 후하다)
   */
  private predictHit(query: HitQuery, from: PlayerSim) {
    if (query.first) this.struck.clear()
    const now = performance.now()
    for (const [id, other] of this.room.state.players) {
      if (id === this.myId || this.struck.has(id) || !isHittable(other)) continue
      const x = this.predict.value(other, 'x')
      const y = this.predict.value(other, 'y')
      const z = this.predict.value(other, 'z')
      if (!hitsBody(query, x, y, z)) continue
      this.struck.add(id)
      this.predictedHits++
      const shown = this.timeline.at(id, now, this.shownAction)?.action ?? other.action
      const guarded = isGuarding(
        { x, z, fx: this.predict.value(other, 'fx'), fz: this.predict.value(other, 'fz'), action: shown },
        from.x, from.z,
      )
      this.sparks.push({ x: query.x, y: query.y, z: query.z, born: now, guarded, heavy: isHeavy(query.attack), attacker: this.myId, victim: id })
    }
  }

  private onHit(event: HitEvent) {
    // 내 공격(던지기 제외)은 이미 예측 이펙트를 띄웠다
    if (event.attacker === this.myId && event.attack !== 'throw') {
      this.confirmedHits++
      return
    }
    const pose = this.pose(event.victim, createPose())
    if (!pose) return
    // 남끼리의 명중은 보간 지연만큼 늦게 보여줘야 화면 속 주먹과 맞는다
    const delay = event.victim === this.myId || event.attacker === this.myId ? 0 : INTERP_DELAY_MS
    // 엎어치기: 놓는 순간 잡힌 쪽은 던지는 쪽 등에 업혀 있다
    const thrower = event.attack === 'throw' ? this.pose(event.attacker, createPose()) : null
    const at = thrower ?? pose
    const back = thrower ? -SEOI.backGap : 0
    this.sparks.push({
      x: at.x + Math.sin(at.facing) * back, y: at.y + 1.3, z: at.z + Math.cos(at.facing) * back,
      born: performance.now() + delay, guarded: event.guarded,
      heavy: isHeavy(event.attack), attacker: event.attacker, victim: event.victim,
    })
  }

  private updateIds() {
    this.ids = [...this.room.state.players.keys()]
    for (const [victim, holder] of this.partners) {
      if (!this.room.state.players.has(victim) || !this.room.state.players.has(holder)) this.partners.delete(victim)
    }
    for (const listener of this.listeners) listener()
  }
}
