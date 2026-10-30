import { Btn, type InputLike } from '@fight-club/shared'

const MOVE: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/** 누른 순간에만 의미가 있는 키 */
const PRESS: Record<string, number> = {
  KeyA: Btn.PunchL,
  KeyS: Btn.PunchR,
  KeyD: Btn.Kick,
  Space: Btn.Jump,
  KeyG: Btn.Grab,
}

/** 누르고 있는 동안 유지되는 키 */
const HOLD: Record<string, number> = {
  ShiftLeft: Btn.Run,
  ShiftRight: Btn.Run,
  KeyF: Btn.Guard,
}

/**
 * 키보드 → 스텝 입력. KeyboardEvent.code로 판단하므로 한/영 상태와 상관없이 동작한다 — design §7.4
 */
export class KeyboardInput {
  private readonly down = new Set<string>()
  /** 마지막 sample() 이후 새로 눌린 버튼. 스텝 사이에 눌렀다 뗀 키도 놓치지 않는다 */
  private pressed = 0
  private readonly target: Window

  constructor(target: Window = window) {
    this.target = target
    target.addEventListener('keydown', this.onKeyDown)
    target.addEventListener('keyup', this.onKeyUp)
    target.addEventListener('blur', this.release)
  }

  sample(): InputLike {
    let mx = 0
    let mz = 0
    let held = 0
    for (const code of this.down) {
      const move = MOVE[code]
      if (move) {
        mx += move[0]
        mz += move[1]
      }
      held |= HOLD[code] ?? 0
    }
    const pressed = this.pressed
    this.pressed = 0
    return { mx: mx * 127, mz: mz * 127, held, pressed }
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onKeyDown)
    this.target.removeEventListener('keyup', this.onKeyUp)
    this.target.removeEventListener('blur', this.release)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (!(e.code in MOVE || e.code in PRESS || e.code in HOLD)) return
    e.preventDefault()
    if (e.repeat) return
    this.down.add(e.code)
    this.pressed |= PRESS[e.code] ?? 0
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code)
  }

  /** 창이 포커스를 잃으면 모든 키를 뗀 것으로 본다 (키 눌림 고착 방지) */
  private release = () => {
    this.down.clear()
    this.pressed = 0
  }
}
