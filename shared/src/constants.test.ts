import { describe, expect, it } from 'vitest'
import { PATCH_RATE, TICK_RATE } from './constants.ts'

describe('타이밍 상수', () => {
  it('상태 패치는 정확히 정수 틱마다 나간다', () => {
    expect(TICK_RATE % PATCH_RATE).toBe(0)
  })
})
