import { CHARACTER_COUNT, VARIANT_COUNT } from '@fight-club/shared'
import { describe, expect, it } from 'vitest'
import { CHARACTER_MODELS, CLIP_INFO, type ClipName } from './assets.gen.ts'
import { CHARACTER_MOVES, characterAt } from './characters.ts'

const CLIPS: Record<ClipName, { duration: number; impact?: number }> = CLIP_INFO

describe('캐릭터 데이터', () => {
  it('생성된 모델·동작 표가 서버의 캐릭터 수와 같다', () => {
    expect(CHARACTER_MODELS).toHaveLength(CHARACTER_COUNT)
    expect(CHARACTER_MOVES).toHaveLength(CHARACTER_COUNT)
  })

  it('공격에 쓰는 클립은 모두 타격 시점이 재어져 있다', () => {
    const used = new Set<ClipName>([...CHARACTER_MOVES.flatMap((m) => [m.jab, m.straight, m.dash]), 'Unarmed_Melee_Attack_Kick', 'Interact'])
    for (const clip of used) expect(CLIPS[clip].impact, clip).toBeGreaterThan(0)
  })

  it('색상 변형 1~3마다 부위별 값이 있고, 아틀라스 사각형은 0~1 안에 있다', () => {
    for (const model of CHARACTER_MODELS) {
      expect(model.variants.length, model.key).toBeGreaterThan(0)
      for (const region of model.variants) {
        expect(region.values, model.key).toHaveLength(VARIANT_COUNT - 1)
        for (const [u0, v0, u1, v1] of region.rects) {
          expect(0 <= u0 && u0 < u1 && u1 <= 1 && 0 <= v0 && v0 < v1 && v1 <= 1, `${model.key} ${[u0, v0, u1, v1]}`).toBe(true)
        }
      }
    }
  })

  it('범위를 벗어난 캐릭터 번호는 0번으로 그린다', () => {
    expect(characterAt(99).model.key).toBe(CHARACTER_MODELS[0].key)
    expect(characterAt(3).model.key).toBe(CHARACTER_MODELS[3].key)
  })
})
