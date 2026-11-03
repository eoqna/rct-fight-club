/** 순위를 매길 값 — 킬 수와 들어온 틱 */
export interface Rankable {
  kills: number
  joinTick: number
}

/** 킬 수가 많을수록, 같으면 먼저 들어온(오래 살아남은) 사람이 앞선다 — FR-44, design §7.6 */
export function compareRank(a: Rankable, b: Rankable): number {
  return b.kills - a.kills || a.joinTick - b.joinTick
}

/** 순위 순서로 줄 세운 [키, 값] 목록 */
export function rankEntries<K, T extends Rankable>(entries: Iterable<[K, T]>): [K, T][] {
  return [...entries].sort(([, a], [, b]) => compareRank(a, b))
}
