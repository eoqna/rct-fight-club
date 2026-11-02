import { Room, type Client, type Rewind, type StepContext } from '@colyseus/core'
import {
  ALL_BUTTONS, ATTACKS, Action, ArenaState, FALL_OUT_Y, IDLE_INPUT, MAX_HP, MAX_REWIND_MS, Msg, PATCH_RATE,
  PlayerInput, PlayerState, TICK_RATE, applyHit, hitsBody, stepPlayer,
  type DevDummyCommand, type HitEvent, type HitQuery, type InputLike,
} from '@fight-club/shared'

/**
 * 입력 크레딧 상한 (스텝). 틱마다 1씩 쌓이고 입력 하나를 처리할 때 1씩 쓴다.
 * 지연으로 밀린 입력은 이만큼 한꺼번에 따라잡되, 입력을 빨리 보내도 빨라지지 않는다 — design §6.3
 */
const INPUT_CREDIT_CAP = 8

/** 이 틱 수만큼 입력이 없으면 서버가 빈 입력으로 진행한다 (100ms) — design §6.3 */
const IDLE_AFTER_TICKS = 6

/** 스폰 영역 반경 (m). 가장자리에서 떨어진 안쪽 — design §6.4 */
const SPAWN_HALF = 8

/** 개발용 샌드백: 요청한 플레이어 앞 거리, 집 위치 범위(왕복해도 경기장 안), 왕복 반경 (m) */
const DUMMY_DISTANCE = 2.5
const DUMMY_LIMIT = 8
const PATROL_HALF = 2.5

interface Pacing {
  credit: number
  /** 입력 없이 지나간 틱 수 */
  silent: number
}

interface PendingHit {
  attacker: string
  victim: string
  query: HitQuery
}

/** 개발용 샌드백 — P5의 봇이 들어오기 전, 혼자서도 때려 볼 대상 */
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

/** 모든 경기장의 모든 클라이언트에게 알린다 (개발 도구용) */
export function notifyAllArenas(type: string, message: unknown) {
  for (const arena of arenas) arena.broadcast(type, message)
}

export class ArenaRoom extends Room<{ state: ArenaState; input: PlayerInput }> {
  state = new ArenaState()
  patchRate = 1000 / PATCH_RATE
  inputs = this.defineInput(PlayerInput, {
    bufferMaxSize: INPUT_CREDIT_CAP,
    sanitize: { mx: [-127, 127], mz: [-127, 127], held: [0, ALL_BUTTONS], pressed: [0, ALL_BUTTONS] },
  })

  private rewind!: Rewind
  private pacing = new Map<string, Pacing>()
  /** 공격자별로 이번 공격에 이미 맞은 대상 — 한 번의 공격은 같은 상대를 한 번만 맞힌다 */
  private struck = new Map<string, Set<string>>()
  private dummies = new Map<string, Dummy>()
  private dummySeq = 0
  private readonly dummyInput: InputLike = { mx: 0, mz: 0, held: 0, pressed: 0 }

  onCreate() {
    arenas.add(this)
    this.rewind = this.allowRewindState({ maxRewindMs: MAX_REWIND_MS })
    this.rewind.attachAll(this.state.players, { fields: ['x', 'y', 'z'] })
    this.setFixedTimestep((ctx) => this.update(ctx), TICK_RATE)

    if (process.env.NODE_ENV !== 'production') {
      this.onMessage<DevDummyCommand>(Msg.DevDummy, (client, command) => this.commandDummy(client.sessionId, command))
    }
  }

  onJoin(client: Client) {
    const player = new PlayerState()
    respawn(player)
    this.state.players.set(client.sessionId, player)
    this.pacing.set(client.sessionId, { credit: 0, silent: 0 })
  }

  onLeave(client: Client) {
    this.removePlayer(client.sessionId)
  }

  onDispose() {
    arenas.delete(this)
  }

  private update(ctx: StepContext) {
    this.state.tick = ctx.tick
    const hits: PendingHit[] = []

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
        this.advancePlayer(id, player, input, ctx.dt, true, hits)
      }
      if (stepped) {
        pace.silent = 0
      } else if (++pace.silent >= IDLE_AFTER_TICKS) {
        // 입력이 오래 끊기면 빈 입력으로 진행한다 — 입력을 끊어 공중에 멈추는 악용 방지
        this.advancePlayer(id, player, IDLE_INPUT, ctx.dt, false, hits)
      }
    }

    for (const [id, dummy] of this.dummies) {
      const player = this.state.players.get(id)
      if (player) this.advancePlayer(id, player, this.steerDummy(player, dummy), ctx.dt, false, hits)
    }

    // 모두 움직인 뒤 한꺼번에 적용해야 처리 순서와 상관없이 서로 동시에 맞힐 수 있다
    for (const hit of hits) this.resolveHit(hit)

    for (const [id, player] of this.state.players) {
      if (player.y >= FALL_OUT_Y && player.hp > 0) continue
      // P1 임시 규칙: 탈락 대신 다시 시작한다 (탈락 흐름은 P2-7). 샌드백은 제자리로 돌아온다
      const dummy = this.dummies.get(id)
      if (dummy) placeDummy(player, dummy)
      else respawn(player)
    }
  }

  private advancePlayer(id: string, player: PlayerState, input: InputLike, dt: number, lagComp: boolean, hits: PendingHit[]) {
    const query = stepPlayer(player, input, dt, this.state.players.values())
    if (!query) return

    if (query.first) this.struck.set(id, new Set())
    const struck = this.struck.get(id) ?? new Set<string>()
    // 공격자가 보고 있던 시점으로 되감아 판정한다. 빈 입력에는 시점 정보가 없으므로 현재 위치를 쓴다
    const seen = lagComp ? this.rewind.lastSeenBy(id) : this.rewind.at(0)
    for (const [targetId, target] of this.state.players) {
      if (targetId === id || struck.has(targetId)) continue
      if (hitsBody(query, seen.value(target, 'x'), seen.value(target, 'y'), seen.value(target, 'z'))) {
        struck.add(targetId)
        hits.push({ attacker: id, victim: targetId, query })
      }
    }
  }

  private resolveHit({ attacker, victim, query }: PendingHit) {
    const from = this.state.players.get(attacker)
    const target = this.state.players.get(victim)
    if (!from || !target) return
    const attack = ATTACKS[query.attack]
    applyHit(target, from, attack)
    const event: HitEvent = {
      tick: this.state.tick, attacker, victim, attack: query.attack, damage: attack.damage, hp: target.hp,
    }
    this.broadcast(Msg.Hit, event)
  }

  private removePlayer(id: string) {
    this.state.players.delete(id)
    this.pacing.delete(id)
    this.struck.delete(id)
    this.dummies.delete(id)
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
    placeDummy(player, dummy)
    const id = `dummy:${++this.dummySeq}`
    this.state.players.set(id, player)
    this.dummies.set(id, dummy)
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

function resetAt(p: PlayerState, x: number, z: number, fx: number, fz: number) {
  p.x = x
  p.y = 0
  p.z = z
  p.vx = 0
  p.vy = 0
  p.vz = 0
  p.fx = fx
  p.fz = fz
  p.action = Action.Idle
  p.actionFrame = 0
  p.stun = 0
  p.hp = MAX_HP
}

function respawn(p: PlayerState) {
  resetAt(p, (Math.random() * 2 - 1) * SPAWN_HALF, (Math.random() * 2 - 1) * SPAWN_HALF, 0, 1)
}

function placeDummy(p: PlayerState, dummy: Dummy) {
  resetAt(p, dummy.homeX, dummy.homeZ, dummy.faceX, dummy.faceZ)
  dummy.targetX = dummy.homeX + PATROL_HALF
}
