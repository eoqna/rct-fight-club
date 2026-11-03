import { ARENA_HALF, ATTACKS, Action, Btn, isHittable, type InputLike, type PlayerState } from '@fight-club/shared'

/** 봇 행동 수치 — design §6.5 */
export const BOT = {
  /** 이 거리 안의 상대를 쫓는다 (m) */
  sight: 8,
  /** 이 거리 안이면 공격한다 (몸 중심 사이, m) */
  reach: 1.2,
  /** 공격 전 반응 지연 (프레임) — 250~450ms */
  reactMin: 15,
  reactMax: 27,
  /** 공격 고르기: 잽 50% · 스트레이트 30% · 나머지 발차기 (쿨타임 중이면 펀치) */
  jabChance: 0.5,
  straightChance: 0.3,
  /** 이 거리 안의 상대가 나를 보고 선딜 중이면 이 확률로 가드한다. 가드 시간 (프레임) */
  threatRange: 2.5,
  guardChance: 0.3,
  guardFrames: 30,
  /** 상대가 가드 중이면 이 확률로 잡는다. 잡기를 노리는 거리 (m) — 잡기 판정은 앞 0.8m·반경 0.4m */
  grabChance: 0.2,
  grabRange: 1.1,
  /** 가장자리에서 이 거리 안이면 중앙 쪽으로 돌아간다 (m) — 스스로 떨어지지 않는다 */
  edge: 2,
  /** 배회 지점 범위 (중앙에서, m), 도착으로 보는 거리, 지점마다 쉬는 시간·포기하는 시간 (프레임) */
  wanderHalf: 8,
  arrive: 0.5,
  restMin: 30,
  restMax: 90,
  wanderGiveUp: 300,
  /** 상대를 다시 고르는 간격 (프레임) */
  retarget: 30,
  /** 한 상대를 쫓는 봇 수 상한 — 사람 우선이지만 한 사람에게 셋이 몰리지 않게 */
  maxChasers: 2,
  /** 상대가 이보다 멀면 달려서 쫓는다 (m). 가까이서는 걷는다 — 달리며 공격하면 돌진 공격이 나간다 */
  runFrom: 5,
  /** 공격 직전 상대 쪽으로 몸을 돌리는 각도 기준 (cos) — 이보다 어긋나 있으면 한 걸음 돌아선다 */
  faceCos: 0.9,
  /** 잡은 뒤 던질 방향을 고르기까지 (프레임) — 그동안 입력이 없으면 서버는 0.6초 뒤 바라보는 쪽으로 던진다 */
  throwMin: 12,
  throwMax: 24,
} as const

/** 선딜을 보고 가드할 공격과 그 선딜 (프레임) — 잡기는 가드로 막을 수 없으므로 뺀다 */
const STARTUP: ReadonlyMap<number, number> = new Map([
  [Action.Jab, ATTACKS.jab.startup],
  [Action.Straight, ATTACKS.straight.startup],
  [Action.Kick, ATTACKS.kick.startup],
  [Action.Dash, ATTACKS.dash.startup],
  [Action.FlyingKick, ATTACKS.flyingKick.startup],
])

/** 봇이 스스로 움직이고 고를 수 있는 동작 (공격·경직·잡힘 중에는 빈 입력) */
const FREE: ReadonlySet<number> = new Set([Action.Idle, Action.Walk, Action.Run, Action.Guard])

/** 봇이 보는 경기장 */
export interface BotWorld {
  tick: number
  readonly players: { get(id: string): PlayerState | undefined; [Symbol.iterator](): Iterator<[string, PlayerState]> }
  isHuman(id: string): boolean
  /** 그 상대를 지금 쫓고 있는 봇 수 */
  chasers(id: string): number
}

/**
 * 봇 한 명의 두뇌 — 매 틱 사람과 같은 입력을 만든다 (design §6.5).
 * 복귀(가장자리 2m 안이면 중앙으로) > 가드 유지 > 방어(선딜을 보고 30% 가드) > 잡기(가드 중인 상대에게 20%)
 * > 공격(1.2m 안, 반응 지연 뒤 잽·스트레이트·발차기) > 추격(8m 안, 사람 우선) > 배회
 */
export class BotBrain {
  /** 지금 쫓는 상대 */
  target: string | null = null
  private readonly random: () => number
  private readonly input: InputLike = { mx: 0, mz: 0, held: 0, pressed: 0 }
  private nextRetarget = 0
  private wander: { x: number; z: number; until: number } | null = null
  private restUntil = 0
  private attackAt = -1
  private guardUntil = -1
  private throwAt = -1
  /** 이미 확률을 굴린 상대의 동작 (상대·종류 → 그 동작이 시작된 틱) — 같은 동작에 두 번 굴리지 않는다 */
  private readonly judged = new Map<string, number>()

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  think(id: string, self: PlayerState, world: BotWorld): InputLike {
    const input = this.input
    input.mx = 0
    input.mz = 0
    input.held = 0
    input.pressed = 0
    const tick = world.tick

    if (self.action === Action.Holding) return this.throwOut(self, tick)
    this.throwAt = -1
    if (self.action === Action.GuardStun && tick < this.guardUntil) {
      input.held = Btn.Guard
      return input
    }
    if (!FREE.has(self.action)) {
      this.attackAt = -1
      return input
    }

    // 복귀: 가장자리 가까이면 무엇보다 먼저 중앙 쪽으로
    const safe = ARENA_HALF - BOT.edge
    if (Math.abs(self.x) > safe || Math.abs(self.z) > safe) {
      this.guardUntil = -1
      this.attackAt = -1
      this.steer(-self.x, -self.z)
      return input
    }

    if (tick < this.guardUntil) {
      input.held = Btn.Guard
      return input
    }

    // 방어: 나를 보고 선딜 중인 상대가 가까이 있으면 30% 확률로 그쪽을 보고 0.5초 가드
    const threat = this.threat(id, self, world)
    if (threat) {
      this.guardUntil = tick + BOT.guardFrames
      this.attackAt = -1
      this.steer(threat.x - self.x, threat.z - self.z)
      input.held = Btn.Guard
      return input
    }

    const target = this.pickTarget(id, self, world)
    if (!target) return this.roam(self, tick)
    const [targetId, foe] = target
    const dx = foe.x - self.x, dz = foe.z - self.z
    const dist = Math.hypot(dx, dz)

    // 상대가 가드 중이면 20% 확률로 잡는다 (잡기는 가드를 무시한다)
    const guarding = foe.action === Action.Guard || foe.action === Action.GuardStun
    if (guarding && dist <= BOT.grabRange && self.grabCooldown === 0
      && this.roll(`grab:${targetId}`, tick - foe.actionFrame, BOT.grabChance)) {
      this.attackAt = -1
      this.steer(dx, dz)
      input.pressed = Btn.Grab
      return input
    }

    if (dist <= BOT.reach) {
      // 공격 거리: 상대 쪽을 보고 서서 반응 지연을 기다렸다가 친다
      if ((dx * self.fx + dz * self.fz) / Math.max(dist, 1e-6) < BOT.faceCos) this.steer(dx, dz)
      if (this.attackAt < 0) this.attackAt = tick + this.between(BOT.reactMin, BOT.reactMax)
      if (tick >= this.attackAt) {
        this.attackAt = -1
        this.steer(dx, dz)
        input.pressed = this.chooseAttack(self)
      }
      return input
    }

    this.attackAt = -1
    this.steer(dx, dz)
    if (dist > BOT.runFrom) input.held |= Btn.Run
    return input
  }

  /** 잡았으면 잠깐 뒤 가장 가까운 가장자리 쪽으로 던진다 (경기장 밖으로 던져 낼 수 있게) */
  private throwOut(self: PlayerState, tick: number): InputLike {
    const input = this.input
    if (this.throwAt < 0) this.throwAt = tick + this.between(BOT.throwMin, BOT.throwMax)
    if (tick < this.throwAt) return input
    if (Math.abs(self.x) >= Math.abs(self.z)) input.mx = self.x >= 0 ? 127 : -127
    else input.mz = self.z >= 0 ? 127 : -127
    return input
  }

  /** 나를 보고(정면 ±60°) 선딜 중인 가까운 상대 — 같은 공격에는 한 번만 확률을 굴린다 */
  private threat(id: string, self: PlayerState, world: BotWorld): PlayerState | null {
    for (const [otherId, other] of world.players) {
      if (otherId === id) continue
      const startup = STARTUP.get(other.action)
      if (startup === undefined || other.actionFrame >= startup) continue
      const dx = self.x - other.x, dz = self.z - other.z
      const dist = Math.hypot(dx, dz)
      if (dist > BOT.threatRange || (dx * other.fx + dz * other.fz) / Math.max(dist, 1e-6) < 0.5) continue
      if (this.roll(`guard:${otherId}`, world.tick - other.actionFrame, BOT.guardChance)) return other
    }
    return null
  }

  /**
   * 쫓을 상대: 8m 안의 맞을 수 있는 상대 중 사람을 먼저, 그다음 가까운 순. 다른 봇이 이미 둘 쫓는 상대는 피한다.
   * 0.5초마다 다시 고르고, 그 사이에는 지금 상대가 아직 쫓을 만하면 그대로 쫓는다
   */
  private pickTarget(id: string, self: PlayerState, world: BotWorld): [string, PlayerState] | null {
    const keep = this.target ? world.players.get(this.target) : undefined
    if (this.target && keep && world.tick < this.nextRetarget && this.chaseable(self, keep)) return [this.target, keep]
    this.nextRetarget = world.tick + BOT.retarget
    let best: [string, PlayerState] | null = null
    let bestScore = Infinity
    for (const [otherId, other] of world.players) {
      if (otherId === id || !this.chaseable(self, other)) continue
      const others = world.chasers(otherId) - (this.target === otherId ? 1 : 0)
      if (others >= BOT.maxChasers) continue
      const score = Math.hypot(other.x - self.x, other.z - self.z) - (world.isHuman(otherId) ? BOT.sight : 0)
      if (score < bestScore) {
        bestScore = score
        best = [otherId, other]
      }
    }
    this.target = best ? best[0] : null
    return best
  }

  private chaseable(self: PlayerState, other: PlayerState): boolean {
    return isHittable(other) && Math.hypot(other.x - self.x, other.z - self.z) <= BOT.sight
  }

  /** 배회: 안쪽의 임의 지점으로 걸어가 잠깐 쉬고, 다시 다른 지점으로 */
  private roam(self: PlayerState, tick: number): InputLike {
    this.attackAt = -1
    if (tick < this.restUntil) return this.input
    const arrived = this.wander && Math.hypot(this.wander.x - self.x, this.wander.z - self.z) < BOT.arrive
    if (this.wander && (arrived || tick >= this.wander.until)) {
      this.wander = null
      this.restUntil = tick + this.between(BOT.restMin, BOT.restMax)
      return this.input
    }
    this.wander ??= {
      x: (this.random() * 2 - 1) * BOT.wanderHalf,
      z: (this.random() * 2 - 1) * BOT.wanderHalf,
      until: tick + BOT.wanderGiveUp,
    }
    this.steer(this.wander.x - self.x, this.wander.z - self.z)
    return this.input
  }

  private chooseAttack(self: PlayerState): number {
    const r = this.random()
    if (r < BOT.jabChance) return Btn.PunchL
    if (r < BOT.jabChance + BOT.straightChance) return Btn.PunchR
    if (self.kickCooldown === 0) return Btn.Kick
    return this.random() < BOT.jabChance / (BOT.jabChance + BOT.straightChance) ? Btn.PunchL : Btn.PunchR
  }

  /** 그 방향으로 이동 입력 (몸도 그쪽으로 바로 돈다) */
  private steer(dx: number, dz: number) {
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) return
    this.input.mx = Math.round((dx / len) * 127)
    this.input.mz = Math.round((dz / len) * 127)
  }

  /** 같은 상대의 같은 동작(시작 틱)에는 한 번만 확률을 굴린다 */
  private roll(key: string, startedAt: number, chance: number): boolean {
    if (this.judged.get(key) === startedAt) return false
    this.judged.set(key, startedAt)
    return this.random() < chance
  }

  private between(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1))
  }
}
