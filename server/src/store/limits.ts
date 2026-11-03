/** 횟수를 세는 동작: 입장 요청, 관리 화면 로그인 실패 */
export type LimitedAction = 'join' | 'adminLogin'

/** 관리 화면 로그인은 10분에 10번까지 틀릴 수 있다 */
const ADMIN_LOGIN_WINDOW = { limit: 10, ms: 10 * 60_000 }

/** 오래된 기록을 이 간격마다 한 번 치운다 (ms) */
const SWEEP_EVERY_MS = 60_000

/**
 * IP별 남용 제한 (NFR-06, design §6.7). 키는 IP가 아니라 clientKey()로 만든 해시다.
 * Redis 구현(design §8.2 2단계)으로 바꿀 수 있게 모두 비동기다
 */
export interface IpLimits {
  /** 창 안에서 상한에 닿지 않았으면 한 번 세고 true, 닿았으면 세지 않고 false */
  hit(action: LimitedAction, key: string): Promise<boolean>
  /** 이미 상한에 닿았는지 (세지 않는다) */
  blocked(action: LimitedAction, key: string): Promise<boolean>
  /** 동시 연결 하나를 연다. 이미 상한이면 열지 않고 false */
  openConnection(key: string): Promise<boolean>
  closeConnection(key: string): Promise<void>
}

/** 이 프로세스의 메모리에 두는 구현 — 서버 프로세스가 하나일 때 */
export class MemoryIpLimits implements IpLimits {
  /** `동작:키` → 창 안에서 센 시각들 (오래된 것부터) */
  private readonly hits = new Map<string, number[]>()
  private readonly connections = new Map<string, number>()
  private readonly limits: { joinsPerMinute: number; maxConnectionsPerIp: number }
  private readonly now: () => number
  private sweptAt = 0

  /** 상한은 부를 때마다 limits에서 읽는다 — 테스트가 설정을 바꿀 수 있게 */
  constructor(limits: { joinsPerMinute: number; maxConnectionsPerIp: number }, now: () => number = Date.now) {
    this.limits = limits
    this.now = now
  }

  async hit(action: LimitedAction, key: string): Promise<boolean> {
    const now = this.now()
    this.sweep(now)
    const { limit } = this.window(action)
    const times = this.recent(action, key, now)
    if (times.length >= limit) return false
    times.push(now)
    this.hits.set(`${action}:${key}`, times)
    return true
  }

  async blocked(action: LimitedAction, key: string): Promise<boolean> {
    return this.recent(action, key, this.now()).length >= this.window(action).limit
  }

  async openConnection(key: string): Promise<boolean> {
    const open = this.connections.get(key) ?? 0
    if (open >= this.limits.maxConnectionsPerIp) return false
    this.connections.set(key, open + 1)
    return true
  }

  async closeConnection(key: string): Promise<void> {
    const open = (this.connections.get(key) ?? 0) - 1
    if (open > 0) this.connections.set(key, open)
    else this.connections.delete(key)
  }

  /** 지금 기억하고 있는 키 수 — 쌓이지 않고 치워지는지 확인하는 용도 */
  get size(): number {
    return this.hits.size + this.connections.size
  }

  private window(action: LimitedAction) {
    return action === 'join' ? { limit: this.limits.joinsPerMinute, ms: 60_000 } : ADMIN_LOGIN_WINDOW
  }

  /** 창 안에 남은 기록 (창이 지난 것은 버린다) */
  private recent(action: LimitedAction, key: string, now: number): number[] {
    const times = this.hits.get(`${action}:${key}`) ?? []
    const from = now - this.window(action).ms
    while (times.length > 0 && times[0] <= from) times.shift()
    return times
  }

  /** 다시 오지 않는 키의 기록이 쌓이지 않게 창이 다 지난 키를 지운다 */
  private sweep(now: number) {
    if (now - this.sweptAt < SWEEP_EVERY_MS) return
    this.sweptAt = now
    for (const [id, times] of this.hits) {
      const action = id.slice(0, id.indexOf(':')) as LimitedAction
      if (times.length === 0 || times[times.length - 1] <= now - this.window(action).ms) this.hits.delete(id)
    }
  }
}
