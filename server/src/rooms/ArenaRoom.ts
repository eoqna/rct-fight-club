import {
  CloseCode as ColyseusCloseCode, Room, ServerError,
  type AuthContext, type Client, type ClientPrivate, type Rewind, type RoomException, type RoomMethodName, type StepContext,
} from '@colyseus/core'
import {
  AFK_FRAMES, ALL_BUTTONS, ARENA_CAPACITY, ARENA_HALF, ATTACKS, Action, ArenaState, BODY_RADIUS, CHARACTER_COUNT,
  COMBO_KNOCKDOWN_HITS, COMBO_WINDOW_FRAMES, CloseCode, FALL_OUT_Y, IDLE_INPUT, KO_FRAMES, MAX_HP, MAX_REWIND_MS, Msg,
  OUT_OF_BOUNDS, PATCH_RATE, PROTOCOL_VERSION, PlayerInput, PlayerState, RINGOUT_CREDIT_FRAMES, SPAWN_INVULN_FRAMES,
  TICK_RATE, VARIANT_COUNT, applyHit, applyThrow, hitsBody, isGrabbable, isGuarding, isHittable, isNameIndex,
  randomNameIndex, rankEntries, stepPlayer, uniqueName,
  type AttackId, type Body, type DevDummyCommand, type ElimCause, type ElimEvent, type HitEvent, type InputLike,
  type JoinOptions, type ResultMsg, type StatsResponse, type StrikeId,
} from '@fight-club/shared'
import { BotBrain, type BotWorld } from '../bots/brain.ts'
import { config } from '../config.ts'
import { log } from '../log.ts'
import { ArenaMeter, countBlocked, type MeteredArena } from '../ops/metrics.ts'
import { CLIENT_KEY_HEADER, EXEMPT_KEY } from '../security/clientKey.ts'
import { store } from '../store/index.ts'

/**
 * 입력 크레딧 상한 (스텝). 틱마다 1씩 쌓이고 입력 하나를 처리할 때 1씩 쓴다.
 * 지연으로 밀린 입력은 이만큼 한꺼번에 따라잡되, 입력을 빨리 보내도 빨라지지 않는다 — design §6.3
 */
const INPUT_CREDIT_CAP = 8

/** 이 틱 수만큼 입력이 없으면 서버가 빈 입력으로 진행한다 (100ms) — design §6.3 */
const IDLE_AFTER_TICKS = 6

/**
 * 한 클라이언트가 1초에 보낼 수 있는 메시지 수. 정상은 입력 60개(틱마다 하나, 밀려도 한 프레임에 5개까지)다.
 * 넘으면 Colyseus가 연결을 끊는다 (종료 코드 4002) — design §6.3
 */
const MAX_MESSAGES_PER_SECOND = 120

/** 같은 곳(onJoin, 틱 처리 …)에서 난 처리하지 못한 오류는 1초에 한 번만 로그에 남긴다 (ms) */
const ERROR_LOG_INTERVAL_MS = 1000

/** 스폰: 가장자리에서 떨어진 안쪽 영역에서 후보를 뽑아 다른 플레이어와 가장 먼 곳에 세운다 — design §6.4 */
const SPAWN_HALF = 8
const SPAWN_CANDIDATES = 12

/** 잡힌 쪽을 붙여 두는 거리 — 몸끼리 맞닿는 거리라 서로 밀어내지 않는다 */
const GRAB_GAP = BODY_RADIUS * 2

/** 봇: 사람이 1~3명이면 모두 이만큼이 되도록 채운다. 탈락하거나 사람이 나가 모자라면 이만큼 뒤에 채운다 (프레임) — design §6.5 */
const BOT_FILL = 4
const BOT_REFILL_FRAMES = 3 * TICK_RATE

/** 판정에 쓰는 세계: 공격자가 보던 시점(되감기) 또는 지금 */
interface SeenWorld {
  value(entity: PlayerState, field: 'x' | 'y' | 'z' | 'fx' | 'fz' | 'action'): number
}

/** 되감지 않고 지금 값을 읽는다 — 보던 시점이 따로 없는 입력(빈 입력·샌드백·봇)용 */
const LIVE: SeenWorld = { value: (entity, field) => entity[field] }

/** 개발용 샌드백: 요청한 플레이어 앞 거리, 집 위치 범위(왕복해도 경기장 안), 왕복 반경 (m) */
const DUMMY_DISTANCE = 2.5
const DUMMY_LIMIT = 8
const PATROL_HALF = 2.5

interface Pacing {
  credit: number
  /** 입력 없이 지나간 틱 수 */
  silent: number
  /** 마지막으로 의미 있는 입력을 한 틱 (자리 비움 판정) */
  lastActive: number
}

interface PendingHit {
  attacker: string
  victim: string
  attack: AttackId
  /** 공격자가 보던 시점에 정면 가드 중이었다 */
  guardedAtView: boolean
}

interface PendingGrab {
  holder: string
  target: string
}

/** onAuth가 돌려주고 onJoin이 받는 입장 정보 — 앞문(security/gate.ts)이 붙인 IP 해시 키 */
interface JoinTicket {
  clientKey: string
}

/** 개발용 샌드백 — 혼자서도 때려 볼 대상. 봇과 달리 스스로 싸우지 않고, 쓰러지거나 떨어지면 제자리로 돌아온다 */
interface Dummy {
  homeX: number
  homeZ: number
  faceX: number
  faceZ: number
  patrol: boolean
  /** 움직이는 샌드백이 지금 향하는 x */
  targetX: number
}

/** 이 프로세스에 열려 있는 경기장 */
const arenas = new Set<ArenaRoom>()

/** 지표용: 이 프로세스의 경기장들 */
export function listArenas(): Iterable<MeteredArena> {
  return arenas
}

/** 모든 경기장의 모든 클라이언트에게 알린다 (개발 도구용) */
export function notifyAllArenas(type: string, message: unknown) {
  for (const arena of arenas) arena.broadcast(type, message)
}

/** 이 프로세스의 접속자·경기장 수 (봇은 클라이언트가 아니므로 세지 않는다) — /api/stats */
export function arenaStats(): StatsResponse {
  let online = 0
  for (const arena of arenas) online += arena.clients.length
  return { online, arenas: arenas.size }
}

export class ArenaRoom extends Room<{ state: ArenaState; input: PlayerInput }> implements MeteredArena {
  /** 자리 비움으로 퇴장시키는 무입력 시간 (프레임). 테스트에서 줄일 수 있다 */
  static afkFrames = AFK_FRAMES
  /** 탈락자에게 결과를 보낸 뒤 연결을 끊기까지 기다리는 시간 (ms). 개발용 지연 주입 중에만 쓴다 (app.ts가 정한다) */
  static closeDelayMs = 0
  /** 봇으로 채우는 전체 인원. 0이면 봇이 없다 — 테스트·자동 점검은 끈다 (서버 환경 변수 BOTS=0) */
  static botFill = BOT_FILL

  state = new ArenaState()
  maxClients = ARENA_CAPACITY
  patchRate = 1000 / PATCH_RATE
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND
  /** 지난 1분의 틱 처리 시간·패치 크기 */
  readonly meter = new ArenaMeter()
  inputs = this.defineInput(PlayerInput, {
    bufferMaxSize: INPUT_CREDIT_CAP,
    sanitize: { mx: [-127, 127], mz: [-127, 127], held: [0, ALL_BUTTONS], pressed: [0, ALL_BUTTONS] },
  })

  private rewind!: Rewind
  private pacing = new Map<string, Pacing>()
  private joinedAt = new Map<string, number>()
  /** 공격자별로 이번 공격에 이미 맞은 대상 — 한 번의 공격은 같은 상대를 한 번만 맞힌다 */
  private struck = new Map<string, Set<string>>()
  /** 잡은 쪽 → 잡힌 쪽 */
  private grabs = new Map<string, string>()
  /** 연속 피격 수 — design §4.6 */
  private combos = new Map<string, { count: number; lastTick: number }>()
  /** 마지막으로 때린 사람 — 낙사 킬 인정 */
  private lastHitBy = new Map<string, { attacker: string; tick: number }>()
  private pendingHits: PendingHit[] = []
  private pendingGrabs: PendingGrab[] = []
  private pendingThrows: string[] = []
  private dummies = new Map<string, Dummy>()
  /** 이번 판에서 오른 최고 순위 (1부터) — 결과 화면 */
  private bestRank = new Map<string, number>()
  private dummySeq = 0
  private readonly dummyInput: InputLike = { mx: 0, mz: 0, held: 0, pressed: 0 }
  /** 봇 두뇌 (넣은 순서 — 가장 최근 것부터 뺀다) */
  private botBrains = new Map<string, BotBrain>()
  private botSeq = 0
  /** 봇을 다시 채울 틱 (-1이면 예정 없음) */
  private botRefillAt = -1
  /** 상대별로 지금 쫓고 있는 봇 수 — 한 사람에게 몰리지 않게 */
  private chaserCounts = new Map<string, number>()
  private botWorld!: BotWorld
  /** 사람 → 동시 접속 제한에 센 IP 키 (나갈 때 돌려준다) */
  private connectionKeys = new Map<string, string>()
  /** 오류를 마지막으로 로그에 남긴 시각 (곳마다) */
  private errorLoggedAt = new Map<RoomMethodName, number>()

  get arenaNo(): number {
    return this.state.arenaNo
  }

  get humans(): number {
    return this.pacing.size
  }

  get bots(): number {
    return this.botBrains.size
  }

  async onCreate() {
    this.rewind = this.allowRewindState({ maxRewindMs: MAX_REWIND_MS })
    this.rewind.attachAll(this.state.players, { fields: ['x', 'y', 'z'] })
    // 가드 판정은 공격자가 보던 시점의 동작·방향도 본다. 이어지는 값이 아니므로 보간하지 않는다
    this.rewind.attachAll(this.state.players, { fields: ['action', 'fx', 'fz'], interpolate: 'step' })
    this.setFixedTimestep((ctx) => this.update(ctx), TICK_RATE)
    this.botWorld = {
      tick: 0,
      players: this.state.players,
      isHuman: (id) => this.pacing.has(id),
      chasers: (id) => this.chaserCounts.get(id) ?? 0,
    }

    if (!config.production) {
      this.onMessage<DevDummyCommand>(Msg.DevDummy, (client, command) => this.commandDummy(client.sessionId, command))
    }
    this.measurePatches()

    // 쓰고 있지 않은 가장 작은 번호 (design §6.1)
    this.state.arenaNo = await store.arenaNumbers.claim()
    arenas.add(this)
  }

  /**
   * 입장 허가 (design §6.7): 프로토콜 버전이 다르면 들이지 않는다 — 클라이언트는 새로고침을 안내한다.
   * 앞문이 붙인 IP 키를 넘겨 onJoin이 동시 접속을 센다
   */
  onAuth(_client: Client, options: Partial<JoinOptions> | undefined, context: AuthContext): JoinTicket {
    if (options?.v !== PROTOCOL_VERSION) {
      countBlocked('version')
      throw new ServerError(CloseCode.VersionMismatch, '게임이 새 버전으로 바뀌었습니다')
    }
    return { clientKey: context.headers.get(CLIENT_KEY_HEADER) ?? 'unknown' }
  }

  async onJoin(client: Client, options?: Partial<JoinOptions>) {
    // 동시 접속은 여기서 센다 — onAuth에서 세면, 인증 직후 끊긴 연결은 onLeave가 불리지 않아 자리가 샌다
    if (!(await this.openConnection(client.sessionId, (client.auth as JoinTicket).clientKey))) {
      countBlocked('connections')
      throw new ServerError(CloseCode.TooManyConnections, `같은 곳에서 동시에 ${config.maxConnectionsPerIp}명까지만 들어올 수 있습니다`)
    }
    const player = new PlayerState()
    this.assignLook(player, options?.characterId)
    this.assignName(player, options?.name)
    const spot = this.spawnPoint()
    resetAt(player, spot.x, spot.z, 0, 1)
    player.invuln = SPAWN_INVULN_FRAMES
    player.joinTick = this.state.tick
    this.state.players.set(client.sessionId, player)
    this.pacing.set(client.sessionId, { credit: 0, silent: 0, lastActive: this.state.tick })
    this.joinedAt.set(client.sessionId, this.clock.elapsedTime)
    this.updateRanks()
    this.syncBots(true)
    log.info({ event: 'join', arena: this.arenaNo, session: client.sessionId, humans: this.humans })
  }

  onLeave(client: Client, code?: number) {
    this.closeConnection(client.sessionId)
    // 탈락한 사람은 eliminate()가 먼저 지웠다 (탈락 로그가 따로 있다)
    const playing = this.pacing.has(client.sessionId)
    this.removePlayer(client.sessionId)
    this.syncBots(false)
    if (!playing) return
    // 메시지를 너무 많이 보내 Colyseus가 끊었으면 따로 센다
    const flood = code === ColyseusCloseCode.WITH_ERROR
      && ((client as Client & ClientPrivate)._numMessagesLastSecond ?? 0) > this.maxMessagesPerSecond
    if (flood) countBlocked('flood')
    log.info({ event: 'leave', arena: this.arenaNo, session: client.sessionId, code, flood, humans: this.humans })
  }

  async onDispose() {
    arenas.delete(this)
    await store.arenaNumbers.release(this.arenaNo)
  }

  /**
   * 처리하지 못한 오류는 경기장을 멈추지 않고 로그에 남긴다 (같은 곳의 오류는 1초에 한 번).
   * 일부러 거절한 입장(ServerError)은 오류가 아니므로 남기지 않는다
   */
  onUncaughtException(error: RoomException, method: RoomMethodName) {
    if (error.cause instanceof ServerError) return
    const now = Date.now()
    if (now - (this.errorLoggedAt.get(method) ?? 0) < ERROR_LOG_INTERVAL_MS) return
    this.errorLoggedAt.set(method, now)
    log.error({ event: 'error', arena: this.arenaNo, method, err: error.cause ?? error }, '경기장 처리 중 오류')
  }

  /** IP 제한에서 뺀 접속(개발 중 같은 컴퓨터)은 세지 않는다. 제한 저장소가 고장 나면 들여보낸다 (막는 것보다 덜 나쁘다) */
  private async openConnection(sessionId: string, key: string): Promise<boolean> {
    if (key === EXEMPT_KEY) return true
    try {
      if (!(await store.limits.openConnection(key))) return false
    } catch (error) {
      log.error({ event: 'error', err: error }, '동시 접속 수를 확인하지 못했습니다')
      return true
    }
    this.connectionKeys.set(sessionId, key)
    return true
  }

  private closeConnection(sessionId: string) {
    const key = this.connectionKeys.get(sessionId)
    if (key === undefined) return
    this.connectionKeys.delete(sessionId)
    store.limits.closeConnection(key).catch((error: unknown) => log.error({ event: 'error', err: error }, '동시 접속 수를 줄이지 못했습니다'))
  }

  /**
   * 상태 패치 크기를 잰다 (P6-3). 공개 API가 없어 Colyseus가 패치를 만들 때 부르는 인코더의 encode를 감싼다 —
   * 전체 상태(입장할 때)는 다른 함수로 만들므로 섞이지 않는다. 내부가 바뀌어 찾지 못하면 재지 않을 뿐이다
   */
  private measurePatches() {
    type Encode = (...args: unknown[]) => Uint8Array
    const encoder = (this as unknown as { _serializer?: { encoder?: { encode?: Encode } } })._serializer?.encoder
    const encode = encoder?.encode
    if (!encoder || typeof encode !== 'function') {
      log.warn({ event: 'config' }, '상태 패치 크기를 잴 수 없습니다 (Colyseus 내부가 바뀌었습니다)')
      return
    }
    encoder.encode = (...args) => {
      const bytes = encode.apply(encoder, args)
      this.meter.patchBytes.push(bytes.byteLength)
      return bytes
    }
  }

  /** 한 틱 처리 — 걸린 시간을 지표에 남긴다 (design §8.3) */
  private update(ctx: StepContext) {
    const started = performance.now()
    this.step(ctx)
    this.meter.tickMs.push(performance.now() - started)
  }

  private step(ctx: StepContext) {
    this.state.tick = ctx.tick
    this.pendingHits.length = 0
    this.pendingGrabs.length = 0
    this.pendingThrows.length = 0

    for (const [id, player] of this.state.players) {
      const pace = this.pacing.get(id)
      if (!pace) continue
      const inputs = this.inputs.get(id)
      pace.credit = Math.min(INPUT_CREDIT_CAP, pace.credit + 1)
      let stepped = false
      while (pace.credit >= 1 && inputs.size > 0) {
        const input = inputs.next()
        if (!input) break
        pace.credit--
        stepped = true
        if (input.mx || input.mz || input.held || input.pressed) pace.lastActive = ctx.tick
        this.advance(id, player, input, ctx.dt, true)
      }
      if (stepped) {
        pace.silent = 0
      } else if (++pace.silent >= IDLE_AFTER_TICKS) {
        // 입력이 오래 끊기면 빈 입력으로 진행한다 — 입력을 끊어 공중에 멈추는 악용 방지
        this.advance(id, player, IDLE_INPUT, ctx.dt, false)
      }
    }

    if (this.botRefillAt >= 0 && ctx.tick >= this.botRefillAt) this.syncBots(true)
    this.stepBots(ctx.tick, ctx.dt)

    for (const [id, dummy] of this.dummies) {
      const player = this.state.players.get(id)
      if (player) this.advance(id, player, this.steerDummy(player, dummy), ctx.dt, false)
    }

    // 모두 움직인 뒤 한꺼번에 적용해야 처리 순서와 상관없이 서로 동시에 맞힐 수 있다
    for (const hit of this.pendingHits) this.resolveHit(hit)
    this.resolveGrabs()
    for (const holder of this.pendingThrows) this.resolveThrow(holder)
    this.holdGrabs()
    this.checkEliminations()
  }

  /** 한 스텝 진행하고, 공격·잡기 판정은 공격자가 보던 시점으로 되감아 검사해 모아 둔다 */
  private advance(id: string, player: PlayerState, input: InputLike, dt: number, lagComp: boolean) {
    const event = stepPlayer(player, input, dt, {
      bodies: this.state.players.values(),
      aimTargets: () => this.seenBodies(id, lagComp),
    })
    if (!event) return
    if (event.kind === 'throw') {
      this.pendingThrows.push(id)
      return
    }

    if (event.first) this.struck.set(id, new Set())
    const struck = this.struck.get(id) ?? new Set<string>()
    const seen = this.view(id, lagComp)
    let grabTarget: string | undefined
    let grabDistance = Infinity
    for (const [targetId, target] of this.state.players) {
      if (targetId === id || struck.has(targetId)) continue
      const x = seen.value(target, 'x')
      const z = seen.value(target, 'z')
      if (!hitsBody(event, x, seen.value(target, 'y'), z)) continue
      if (event.kind === 'hit') {
        struck.add(targetId)
        const pose = { x, z, fx: seen.value(target, 'fx'), fz: seen.value(target, 'fz'), action: seen.value(target, 'action') }
        this.pendingHits.push({ attacker: id, victim: targetId, attack: event.attack, guardedAtView: isGuarding(pose, player.x, player.z) })
      } else {
        // 잡기는 판정 안의 가장 가까운 한 명만
        const distance = (x - player.x) ** 2 + (z - player.z) ** 2
        if (distance < grabDistance) {
          grabDistance = distance
          grabTarget = targetId
        }
      }
    }
    if (grabTarget) {
      struck.add(grabTarget)
      this.pendingGrabs.push({ holder: id, target: grabTarget })
    }
  }

  /** 공격자가 보던 시점의 세계 (빈 입력·샌드백·봇은 보던 시점이 없으므로 지금) */
  private view(id: string, lagComp: boolean): SeenWorld {
    return lagComp ? this.rewind.lastSeenBy(id) : LIVE
  }

  /** 조준 보정 대상: 공격자가 보던 시점의 맞을 수 있는 상대 위치 */
  private seenBodies(id: string, lagComp: boolean): Body[] {
    const seen = this.view(id, lagComp)
    const bodies: Body[] = []
    for (const [otherId, other] of this.state.players) {
      if (otherId === id || !isHittable(other)) continue
      bodies.push({ x: seen.value(other, 'x'), y: seen.value(other, 'y'), z: seen.value(other, 'z') })
    }
    return bodies
  }

  private resolveHit({ attacker, victim, attack, guardedAtView }: PendingHit) {
    const from = this.state.players.get(attacker)
    const target = this.state.players.get(victim)
    if (!from || !target || !isHittable(target)) return
    // 공격자가 보던 시점과 지금 중 한 번이라도 정면 가드였으면 막은 것으로 친다 (방어자 우대) — design §5.6
    const guarded = guardedAtView || isGuarding(target, from.x, from.z)
    const knockdown = !guarded && this.countCombo(victim) >= COMBO_KNOCKDOWN_HITS
    const damage = applyHit(target, from, ATTACKS[attack], { guarded, knockdown })
    if (knockdown) this.combos.delete(victim)
    this.lastHitBy.set(victim, { attacker, tick: this.state.tick })
    this.broadcastHit(attacker, victim, attack, guarded, damage, target.hp)
  }

  /** 마지막 피격 후 1.5초 안에 다시 맞으면 연속 피격 수가 늘어난다 */
  private countCombo(id: string): number {
    const tick = this.state.tick
    const combo = this.combos.get(id)
    const count = combo && tick - combo.lastTick <= COMBO_WINDOW_FRAMES ? combo.count + 1 : 1
    this.combos.set(id, { count, lastTick: tick })
    return count
  }

  private resolveGrabs() {
    for (const { holder, target } of this.pendingGrabs) {
      // 서로 동시에 잡으면 둘 다 헛잡기
      if (this.pendingGrabs.some((g) => g.holder === target && g.target === holder)) continue
      const a = this.state.players.get(holder)
      const b = this.state.players.get(target)
      // 잡는 동작 중에 맞았으면 잡기는 끊긴다. 가드 중인 상대는 잡힌다
      if (!a || !b || a.action !== Action.GrabTry || !isGrabbable(b) || this.inGrab(target)) continue
      setAction(a, Action.Holding)
      setAction(b, Action.Grabbed)
      a.vx = a.vz = b.vx = b.vz = 0
      this.grabs.set(holder, target)
      this.attach(a, b)
    }
  }

  private resolveThrow(holderId: string) {
    const targetId = this.grabs.get(holderId)
    this.grabs.delete(holderId)
    const holder = this.state.players.get(holderId)
    const target = targetId ? this.state.players.get(targetId) : undefined
    if (!holder || !targetId || !target || target.action !== Action.Grabbed) return
    const damage = applyThrow(target, holder)
    this.combos.delete(targetId)
    this.lastHitBy.set(targetId, { attacker: holderId, tick: this.state.tick })
    this.broadcastHit(holderId, targetId, 'throw', false, damage, target.hp)
  }

  /** 잡힌 쪽을 잡은 쪽 앞에 붙여 둔다. 어느 한쪽이 맞거나 사라지면 잡기가 풀린다 */
  private holdGrabs() {
    for (const [holderId, targetId] of this.grabs) {
      const holder = this.state.players.get(holderId)
      const target = this.state.players.get(targetId)
      const holding = holder?.action === Action.Holding || holder?.action === Action.Throwing
      const held = target?.action === Action.Grabbed
      if (holder && target && holding && held) {
        this.attach(holder, target)
        continue
      }
      this.grabs.delete(holderId)
      if (target && held) setAction(target, Action.Idle)
      if (holder?.action === Action.Holding) setAction(holder, Action.Idle)
    }
  }

  private attach(holder: PlayerState, target: PlayerState) {
    // 잡힌 쪽은 경기장 위에 둔다 — 떨어뜨리는 건 던지기의 몫
    target.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, holder.x + holder.fx * GRAB_GAP))
    target.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, holder.z + holder.fz * GRAB_GAP))
    target.y = holder.y
  }

  private inGrab(id: string): boolean {
    if (this.grabs.has(id)) return true
    for (const grabbed of this.grabs.values()) if (grabbed === id) return true
    return false
  }

  /** KO·낙사·자리 비움 — 샌드백은 탈락 대신 제자리로 돌아온다 — design §4.9 */
  private checkEliminations() {
    const tick = this.state.tick
    const out: [string, ElimCause, string | undefined][] = []
    for (const [id, p] of this.state.players) {
      const fell = p.y < FALL_OUT_Y || Math.abs(p.x) > OUT_OF_BOUNDS || Math.abs(p.z) > OUT_OF_BOUNDS
      const knockedOut = p.action === Action.KO && (p.actionFrame >= KO_FRAMES || fell)
      const dummy = this.dummies.get(id)
      if (dummy) {
        if (fell || knockedOut) placeDummy(p, dummy)
      } else if (knockedOut) {
        out.push([id, 'ko', this.lastHitBy.get(id)?.attacker])
      } else if (fell && p.action !== Action.KO) {
        const last = this.lastHitBy.get(id)
        const credited = last && tick - last.tick <= RINGOUT_CREDIT_FRAMES ? last.attacker : undefined
        out.push([id, credited ? 'ringout' : 'selfout', credited])
      } else if (tick - (this.pacing.get(id)?.lastActive ?? tick) >= ArenaRoom.afkFrames) {
        out.push([id, 'afk', undefined])
      }
    }
    for (const [id, cause, killer] of out) this.eliminate(id, cause, killer)
    if (out.length > 0) this.syncBots(false)
  }

  /** 모두에게 알리고, 본인에게 결과를 보낸 뒤 연결을 끊는다 */
  private eliminate(id: string, cause: ElimCause, killer?: string) {
    const player = this.state.players.get(id)
    if (!player) return
    const killerState = killer ? this.state.players.get(killer) : undefined
    if (killerState) {
      killerState.kills++
      this.updateRanks()
    }

    // 탈락한 사람은 곧 상태에서 사라지므로 이름을 함께 보낸다 (킬 피드·결과 화면)
    const credit = killer && killerState ? { killer, killerName: killerState.name } : killer ? { killer } : {}
    const event: ElimEvent = { tick: this.state.tick, victim: id, victimName: player.name, cause, ...credit }
    this.broadcast(Msg.Elim, event)
    log.info({ event: 'elim', arena: this.arenaNo, session: id, bot: player.isBot, cause, killer })
    const client = this.clients.getById(id)
    if (client) {
      const result: ResultMsg = {
        survivalMs: Math.round(this.clock.elapsedTime - (this.joinedAt.get(id) ?? this.clock.elapsedTime)),
        kills: player.kills,
        cause,
        ...credit,
        bestRank: this.bestRank.get(id) ?? this.state.players.size,
      }
      client.send(Msg.Result, result)
      const close = () => client.leave(CloseCode.Eliminated)
      if (ArenaRoom.closeDelayMs > 0) this.clock.setTimeout(close, ArenaRoom.closeDelayMs)
      else close()
    }
    this.removePlayer(id)
  }

  private broadcastHit(attacker: string, victim: string, attack: StrikeId, guarded: boolean, damage: number, hp: number) {
    const event: HitEvent = { tick: this.state.tick, attacker, victim, attack, guarded, damage, hp }
    this.broadcast(Msg.Hit, event)
  }

  /** 잡기에 얽혀 있던 상대는 다음 틱의 holdGrabs가 풀어 준다 */
  private removePlayer(id: string) {
    this.state.players.delete(id)
    this.pacing.delete(id)
    this.joinedAt.delete(id)
    this.struck.delete(id)
    this.combos.delete(id)
    this.lastHitBy.delete(id)
    this.dummies.delete(id)
    this.botBrains.delete(id)
    this.bestRank.delete(id)
    // 앞선 사람이 나가면 뒷사람들의 순위가 오른다
    this.updateRanks()
  }

  /** 지금 순위로 각자의 최고 순위를 갱신한다 (킬·입장·퇴장 때만 바뀐다) */
  private updateRanks() {
    rankEntries(this.state.players.entries()).forEach(([id], i) => {
      const best = this.bestRank.get(id)
      if (best === undefined || i + 1 < best) this.bestRank.set(id, i + 1)
    })
  }

  /**
   * 봇 수 맞추기 (design §6.5): 사람이 1~3명이면 모두 botFill명이 되도록 봇을 둔다. 많으면 가장 최근에 넣은 봇부터 빼고,
   * 모자라면 바로(사람이 들어왔을 때) 또는 3초 뒤(봇이 탈락했거나 사람이 나갔을 때) 새 이름의 봇으로 채운다
   */
  private syncBots(now: boolean) {
    const humans = this.pacing.size
    const want = humans > 0 ? Math.max(0, ArenaRoom.botFill - humans) : 0
    const ids = [...this.botBrains.keys()]
    while (ids.length > want) this.removePlayer(ids.pop()!)
    if (ids.length >= want) {
      this.botRefillAt = -1
    } else if (now) {
      for (let n = ids.length; n < want; n++) this.addBot()
      this.botRefillAt = -1
    } else if (this.botRefillAt < 0) {
      this.botRefillAt = this.state.tick + BOT_REFILL_FRAMES
    }
  }

  /** 사람처럼 무작위 캐릭터·이름으로, 다른 사람과 먼 곳에 3초 무적으로 들어온다 */
  private addBot() {
    const player = new PlayerState()
    player.isBot = true
    this.assignLook(player, undefined)
    this.assignName(player, undefined)
    const spot = this.spawnPoint()
    resetAt(player, spot.x, spot.z, 0, 1)
    player.invuln = SPAWN_INVULN_FRAMES
    player.joinTick = this.state.tick
    const id = `bot:${++this.botSeq}`
    this.state.players.set(id, player)
    this.botBrains.set(id, new BotBrain())
    this.updateRanks()
  }

  /** 봇마다 두뇌가 만든 입력으로 한 스텝 (보던 시점이 따로 없으므로 되감지 않는다) */
  private stepBots(tick: number, dt: number) {
    if (this.botBrains.size === 0) return
    this.chaserCounts.clear()
    for (const brain of this.botBrains.values()) {
      if (brain.target) this.chaserCounts.set(brain.target, (this.chaserCounts.get(brain.target) ?? 0) + 1)
    }
    this.botWorld.tick = tick
    for (const [id, brain] of this.botBrains) {
      const player = this.state.players.get(id)
      if (player) this.advance(id, player, brain.think(id, player, this.botWorld), dt, false)
    }
  }

  /** 받은 인덱스(없거나 잘못되면 무작위)로 이름을 조립하고, 이 경기장에서 겹치면 다시 뽑는다 (design §4.11) */
  private assignName(player: PlayerState, requested: unknown) {
    const taken = new Set([...this.state.players.values()].map((p) => p.name))
    player.name = uniqueName(isNameIndex(requested) ? requested : randomNameIndex(), taken).name
  }

  /** 안쪽 영역의 후보 중 다른 플레이어와의 최소 거리가 가장 큰 곳 — design §6.4 */
  private spawnPoint() {
    let best = { x: 0, z: 0 }
    let bestGap = -1
    for (let i = 0; i < SPAWN_CANDIDATES; i++) {
      const x = (Math.random() * 2 - 1) * SPAWN_HALF
      const z = (Math.random() * 2 - 1) * SPAWN_HALF
      let gap = Infinity
      for (const other of this.state.players.values()) gap = Math.min(gap, Math.hypot(other.x - x, other.z - z))
      if (gap > bestGap) {
        bestGap = gap
        best = { x, z }
      }
    }
    return best
  }

  /** 개발용: 요청한 플레이어 앞에 샌드백을 세우거나 모두 치운다 */
  private commandDummy(requester: string, command: DevDummyCommand) {
    if (command?.kind === 'clear') {
      for (const id of [...this.dummies.keys()]) this.removePlayer(id)
      return
    }
    if (command?.kind !== 'still' && command?.kind !== 'patrol') return
    const near = this.state.players.get(requester)
    if (!near) return

    const homeX = clamp(near.x + near.fx * DUMMY_DISTANCE, DUMMY_LIMIT)
    const dummy: Dummy = {
      homeX,
      homeZ: clamp(near.z + near.fz * DUMMY_DISTANCE, DUMMY_LIMIT),
      faceX: -near.fx,
      faceZ: -near.fz,
      patrol: command.kind === 'patrol',
      targetX: homeX + PATROL_HALF,
    }
    const player = new PlayerState()
    player.isBot = true
    // 샌드백은 캐릭터를 차례로 바꿔 가며 세운다 — 모든 캐릭터를 한 화면에서 볼 수 있다
    this.assignLook(player, this.dummySeq % CHARACTER_COUNT)
    this.assignName(player, undefined)
    placeDummy(player, dummy)
    player.joinTick = this.state.tick
    const id = `dummy:${++this.dummySeq}`
    this.state.players.set(id, player)
    this.dummies.set(id, dummy)
    this.updateRanks()
  }

  /**
   * 캐릭터(고르지 않았거나 범위 밖이면 무작위)와 색상 변형을 정한다.
   * 색상은 같은 캐릭터를 쓰는 사람들 사이에서 가장 적게 쓰인 것 — design §6.6
   */
  private assignLook(player: PlayerState, requested: unknown) {
    const characterId = typeof requested === 'number' && Number.isInteger(requested) && requested >= 0 && requested < CHARACTER_COUNT
      ? requested
      : Math.floor(Math.random() * CHARACTER_COUNT)
    const counts = new Array<number>(VARIANT_COUNT).fill(0)
    for (const other of this.state.players.values()) {
      if (other.characterId === characterId) counts[other.variant]++
    }
    player.characterId = characterId
    player.variant = counts.indexOf(Math.min(...counts))
  }

  /** 움직이는 샌드백은 집을 중심으로 좌우로 왕복한다. 맞아서 밀려나도 다시 걸어서 돌아간다 */
  private steerDummy(p: PlayerState, dummy: Dummy): InputLike {
    const input = this.dummyInput
    input.mx = 0
    if (dummy.patrol) {
      if (Math.abs(dummy.targetX - p.x) < 0.15) {
        dummy.targetX = dummy.targetX > dummy.homeX ? dummy.homeX - PATROL_HALF : dummy.homeX + PATROL_HALF
      }
      input.mx = dummy.targetX > p.x ? 127 : -127
    }
    return input
  }
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function setAction(p: PlayerState, action: number) {
  p.action = action
  p.actionFrame = 0
  p.stun = 0
  p.buffered = 0
}

function resetAt(p: PlayerState, x: number, z: number, fx: number, fz: number) {
  p.x = x
  p.y = 0
  p.z = z
  p.vx = 0
  p.vy = 0
  p.vz = 0
  p.fx = fx
  p.fz = fz
  setAction(p, Action.Idle)
  p.invuln = 0
  p.kickCooldown = 0
  p.grabCooldown = 0
  p.hp = MAX_HP
}

function placeDummy(p: PlayerState, dummy: Dummy) {
  resetAt(p, dummy.homeX, dummy.homeZ, dummy.faceX, dummy.faceZ)
  dummy.targetX = dummy.homeX + PATROL_HALF
}
