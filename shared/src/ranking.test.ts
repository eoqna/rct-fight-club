import { describe, expect, it } from 'vitest'
import { rankEntries } from './ranking.ts'

describe('순위', () => {
  it('킬 수 내림차순, 같으면 먼저 들어온 순', () => {
    const order = rankEntries([
      ['늦게 온 0킬', { kills: 0, joinTick: 300 }],
      ['2킬', { kills: 2, joinTick: 200 }],
      ['먼저 온 0킬', { kills: 0, joinTick: 100 }],
      ['5킬', { kills: 5, joinTick: 400 }],
    ]).map(([name]) => name)
    expect(order).toEqual(['5킬', '2킬', '먼저 온 0킬', '늦게 온 0킬'])
  })
})
