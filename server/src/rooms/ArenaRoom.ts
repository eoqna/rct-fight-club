import { Room } from '@colyseus/core'
import { PATCH_RATE, TICK_RATE } from '@fight-club/shared'
import { ArenaState } from './state.ts'

export class ArenaRoom extends Room<{ state: ArenaState }> {
  state = new ArenaState()
  patchRate = 1000 / PATCH_RATE

  onCreate() {
    this.setFixedTimestep((ctx) => {
      this.state.tick = ctx.tick
    }, TICK_RATE)
  }
}
