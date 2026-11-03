import { describe, expect, it } from 'vitest'
import {
  ADJECTIVES, ENDINGS, NOUNS, NAME_COMBINATIONS, assembleName, hasFinalConsonant, isNameIndex, randomNameIndex, uniqueName,
  type NameIndex,
} from './nickname.ts'

/** 조사 앞 글자의 받침으로 맞는 조사인지 */
function particleFits(noun: string, particle: string): boolean {
  const final = hasFinalConsonant(noun)
  const pairs: Record<string, boolean> = { 과: true, 와: false, 은: true, 는: false, 이: true, 가: false, 을: true, 를: false }
  return pairs[particle] === final
}

describe('닉네임 생성기', () => {
  it('받침을 판정한다 (한글 음절의 마지막 글자)', () => {
    expect(hasFinalConsonant('태양')).toBe(true)
    expect(hasFinalConsonant('나무')).toBe(false)
    expect(hasFinalConsonant('달빛')).toBe(true)
    expect(hasFinalConsonant('바다')).toBe(false)
  })

  it('조사를 받침에 맞춰 고른다 (요구사항 예: 태양과 · 나무는 · 달빛은)', () => {
    const name = (noun: (typeof NOUNS)[number], ending: (typeof ENDINGS)[number]) =>
      assembleName([ADJECTIVES.indexOf('조용한'), NOUNS.indexOf(noun), ENDINGS.indexOf(ending)])
    expect(name('태양', '{와/과} 함께 춤을')).toBe('조용한 태양과 함께 춤을')
    expect(name('나무', '{은/는} 그림자 속에')).toBe('조용한 나무는 그림자 속에')
    expect(name('달빛', '{은/는} 그림자 속에')).toBe('조용한 달빛은 그림자 속에')
    expect(name('바다', '{을/를} 품은 자')).toBe('조용한 바다를 품은 자')
  })

  it('모든 조합에서 조사가 받침에 맞고 빈칸·중괄호가 남지 않는다', () => {
    let count = 0
    for (let a = 0; a < ADJECTIVES.length; a++) {
      for (let n = 0; n < NOUNS.length; n++) {
        for (let e = 0; e < ENDINGS.length; e++) {
          const name = assembleName([a, n, e])
          const noun = NOUNS[n]
          expect(name.startsWith(`${ADJECTIVES[a]} ${noun}`)).toBe(true)
          expect(name).not.toMatch(/[{}/]|\s{2}|\s$/)
          const rest = name.slice(`${ADJECTIVES[a]} ${noun}`.length)
          if (/^[과와은는이가을를]/.test(rest) && ENDINGS[e].startsWith('{')) expect(particleFits(noun, rest[0])).toBe(true)
          count++
        }
      }
    }
    expect(count).toBe(NAME_COMBINATIONS)
  })

  it('단어 수는 형용사 20 · 명사 24 · 어미구 16이고 조합은 1,000개 이상이다 (FR-13)', () => {
    expect([ADJECTIVES.length, NOUNS.length, ENDINGS.length]).toEqual([20, 24, 16])
    expect(NAME_COMBINATIONS).toBeGreaterThanOrEqual(1000)
    expect(new Set(ADJECTIVES).size + new Set(NOUNS).size + new Set(ENDINGS).size).toBe(60)
  })

  it('명사에는 받침이 있는 것과 없는 것이 섞여 있다 (조사 처리를 실제로 쓰도록)', () => {
    const finals = NOUNS.filter(hasFinalConsonant).length
    expect(finals).toBeGreaterThan(4)
    expect(NOUNS.length - finals).toBeGreaterThan(4)
  })

  it('인덱스는 범위 안의 정수 3개만 받는다 — 클라이언트가 임의의 문자열을 넣을 수 없다', () => {
    expect(isNameIndex([0, 0, 0])).toBe(true)
    expect(isNameIndex([19, 23, 15])).toBe(true)
    for (const bad of [[20, 0, 0], [0, 24, 0], [0, 0, 16], [-1, 0, 0], [0.5, 0, 0], [0, 0], [0, 0, 0, 0], ['0', 0, 0], 'abc', null, undefined]) {
      expect(isNameIndex(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('같은 경기장에 같은 이름이 있으면 어미구부터 다시 뽑아 겹치지 않게 한다 (FR-12)', () => {
    const index: NameIndex = [0, 0, 0]
    const taken = new Set([assembleName(index)])
    let k = 0
    const random = () => [0.1, 0.7, 0.3, 0.9][k++ % 4]
    const result = uniqueName(index, taken, random)
    expect(taken.has(result.name)).toBe(false)
    expect(result.name).toBe(assembleName(result.index))
    expect(result.index.slice(0, 2)).toEqual([0, 0]) // 형용사·명사는 그대로, 어미구만 바뀜
    expect(uniqueName(index, new Set()).name).toBe(assembleName(index)) // 겹치지 않으면 그대로
  })

  it('무작위 인덱스는 늘 범위 안이다', () => {
    let calls = 0
    const random = () => [0, 0.999999, 0.5][calls++ % 3]
    for (let i = 0; i < 9; i++) {
      const index: NameIndex = randomNameIndex(random)
      expect(isNameIndex(index)).toBe(true)
    }
  })
})
