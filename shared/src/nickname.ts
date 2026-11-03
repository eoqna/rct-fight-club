/**
 * 닉네임 생성기 — `[형용사] [명사][어미구]` (design §4.11, FR-09~13)
 * 클라이언트는 인덱스 3개로 미리보기를 만들고 입장할 때 인덱스만 보낸다. 서버가 범위를 확인한 뒤 문자열을 조립한다.
 * 어미구의 `{와/과}`처럼 중괄호 안은 앞 명사의 받침에 따라 고르는 조사다
 */

export const ADJECTIVES = [
  '조용한', '용감한', '빛나는', '성난', '춤추는', '웃는', '잠든', '날쌘', '외로운', '푸른',
  '붉은', '거친', '작은', '커다란', '수줍은', '배고픈', '졸린', '노래하는', '떠도는', '지혜로운',
] as const

/** 자연 명사 — 받침이 있는 말과 없는 말을 섞는다 */
export const NOUNS = [
  '태양', '나무', '달빛', '바다', '바람', '구름', '늑대', '독수리', '곰', '여우', '사슴', '들소',
  '번개', '천둥', '강물', '산', '별', '들꽃', '바위', '안개', '노을', '이슬', '호랑이', '거북',
] as const

/** 어미구 — 명사 바로 뒤에 붙는다 (띄어 쓸 말은 공백으로 시작) */
export const ENDINGS = [
  '{와/과} 함께 춤을', '{은/는} 그림자 속에', '{을/를} 품은 자', '의 기상',
  '{이/가} 잠든 밤', '{을/를} 쫓는 자', '{와/과} 달리는 자', '{은/는} 울지 않는다',
  '{이/가} 부르는 노래', '의 마지막 주먹', '{을/를} 닮은 전사', '{와/과} 맞서는 자',
  '{이/가} 지켜본다', ' 아래 잠든 자', '{을/를} 부르는 자', '의 아이',
] as const

export const NAME_COMBINATIONS = ADJECTIVES.length * NOUNS.length * ENDINGS.length

/** [형용사, 명사, 어미구] 인덱스 */
export type NameIndex = readonly [number, number, number]

const SIZES = [ADJECTIVES.length, NOUNS.length, ENDINGS.length] as const
/** 받침 뒤에 오는 조사 */
const AFTER_FINAL = new Set(['과', '은', '이', '을'])

/** 마지막 글자가 받침이 있는 한글 음절인가 */
export function hasFinalConsonant(word: string): boolean {
  const code = word.charCodeAt(word.length - 1)
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0
}

/** 범위 안의 정수 3개인가 — 서버가 입장 옵션을 검증할 때 쓴다 */
export function isNameIndex(value: unknown): value is NameIndex {
  return Array.isArray(value) && value.length === 3
    && value.every((v, i) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < SIZES[i])
}

export function randomNameIndex(random: () => number = Math.random): NameIndex {
  return [Math.floor(random() * SIZES[0]), Math.floor(random() * SIZES[1]), Math.floor(random() * SIZES[2])]
}

export function assembleName([adjective, noun, ending]: NameIndex): string {
  const word = NOUNS[noun]
  const final = hasFinalConsonant(word)
  const tail = ENDINGS[ending].replace(/\{(.+?)\/(.+?)\}/, (_, a: string, b: string) => {
    const withFinal = AFTER_FINAL.has(a) ? a : b
    return final ? withFinal : withFinal === a ? b : a
  })
  return `${ADJECTIVES[adjective]} ${word}${tail}`
}

/** 다시 뽑는 횟수 상한: 어미구를 먼저 바꾸고, 그래도 겹치면 명사도 바꾼다 (design §4.11) */
const REROLLS = 10

/** 이미 쓰는 이름과 겹치지 않는 이름. 상한까지 겹치면 마지막 것을 그대로 쓴다 */
export function uniqueName(index: NameIndex, taken: ReadonlySet<string>, random: () => number = Math.random): { index: NameIndex; name: string } {
  let current = index
  let name = assembleName(current)
  for (let attempt = 0; attempt < REROLLS && taken.has(name); attempt++) {
    const [a, n] = current
    const noun = attempt < REROLLS / 2 ? n : Math.floor(random() * SIZES[1])
    current = [a, noun, Math.floor(random() * SIZES[2])]
    name = assembleName(current)
  }
  return { index: current, name }
}
