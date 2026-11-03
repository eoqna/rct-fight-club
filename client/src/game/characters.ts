import { BODY_HEIGHT } from '@fight-club/shared'
import { CHARACTER_MODELS, type ClipName } from './assets.gen.ts'

/** 원본 모델의 몸 키(약 2.2) → 게임 속 키 1.8m */
export const MODEL_SCALE = BODY_HEIGHT / 2.2

/** 캐릭터마다 다른 공격 동작 — 무기를 든 캐릭터는 무기 동작을 하지만 판정 거리·피해는 모두 같다 (FR-07) */
export interface CharacterMoves {
  /** A: 왼손 펀치 자리 */
  jab: ClipName
  /** S: 오른손 펀치 자리 */
  straight: ClipName
  /** 달리며 공격 */
  dash: ClipName
}

/** CHARACTER_MODELS와 같은 순서 (characterId) */
export const CHARACTER_MOVES: readonly CharacterMoves[] = [
  // 전사: 가로 베기 · 찌르기
  { jab: '1H_Melee_Attack_Slice_Horizontal', straight: '1H_Melee_Attack_Stab', dash: '1H_Melee_Attack_Stab' },
  // 곰전사: 내려찍기 · 대각선 베기
  { jab: '1H_Melee_Attack_Chop', straight: '1H_Melee_Attack_Slice_Diagonal', dash: '1H_Melee_Attack_Stab' },
  // 삐에로: 대각선 베기 · 찌르기
  { jab: '1H_Melee_Attack_Slice_Diagonal', straight: '1H_Melee_Attack_Stab', dash: '1H_Melee_Attack_Stab' },
  // 유도가: 왼손 정권찌르기 · 오른손 어퍼컷 (왼손은 오른손 정권을 좌우로 뒤집어 굽는다 — tools/assets/recipes.js)
  { jab: 'Unarmed_Melee_Attack_Punch_Left', straight: 'Unarmed_Melee_Attack_Punch_B', dash: 'Unarmed_Melee_Attack_Punch_A' },
  // 닌자: 찌르기 · 가로 베기
  { jab: '1H_Melee_Attack_Stab', straight: '1H_Melee_Attack_Slice_Horizontal', dash: '1H_Melee_Attack_Stab' },
]

export type CharacterModel = (typeof CHARACTER_MODELS)[number]

/** 서버가 보낸 번호가 범위를 벗어나도 그릴 수 있게 0번으로 */
export function characterAt(id: number): { model: CharacterModel; moves: CharacterMoves } {
  const index = id >= 0 && id < CHARACTER_MODELS.length ? id : 0
  return { model: CHARACTER_MODELS[index], moves: CHARACTER_MOVES[index] }
}
