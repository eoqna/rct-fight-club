import { TICK_RATE } from '@fight-club/shared'

interface Sample {
  t: number
  action: number
  actionFrame: number
  stun: number
}

export interface ActionPose {
  action: number
  actionFrame: number
  /** 그 동작의 경직 길이 (프레임) — 피격 동작을 경직 시간에 맞춰 재생한다 */
  stun: number
}

const KEEP_MS = 1000

/**
 * 원격 플레이어의 동작(action·actionFrame)을 위치 보간과 같은 지연으로 재생한다.
 * 위치는 Predict가 delay만큼 늦게 그리므로, 동작도 같은 시점 값을 보여줘야 공격 모션과 위치가 맞는다.
 */
export class ActionTimeline {
  private readonly samples = new Map<string, Sample[]>()
  private readonly delayMs: number

  constructor(delayMs: number) {
    this.delayMs = delayMs
  }

  record(id: string, action: number, actionFrame: number, stun: number, now: number) {
    let list = this.samples.get(id)
    if (!list) {
      list = []
      this.samples.set(id, list)
    }
    const last = list[list.length - 1]
    if (last && last.action === action && last.actionFrame === actionFrame) return
    list.push({ t: now, action, actionFrame, stun })
    while (list.length > 2 && list[1].t < now - KEEP_MS) list.shift()
  }

  /** now 기준 delay만큼 지난 시점의 동작. 샘플 사이는 틱 속도로 프레임을 앞으로 민다 */
  at(id: string, now: number, out: ActionPose): ActionPose | null {
    const list = this.samples.get(id)
    if (!list || list.length === 0) return null
    const target = now - this.delayMs
    let i = list.length - 1
    while (i > 0 && list[i].t > target) i--
    const sample = list[i]
    out.action = sample.action
    out.actionFrame = sample.actionFrame + Math.max(0, target - sample.t) * (TICK_RATE / 1000)
    out.stun = sample.stun
    return out
  }

  forget(id: string) {
    this.samples.delete(id)
  }
}
