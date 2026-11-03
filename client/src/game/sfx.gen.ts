// 자동 생성 파일 — tools/assets/sfx.mjs (npm run assets:build). 직접 고치지 말 것

/** 효과음 스프라이트: 소리마다 [시작 ms, 길이 ms] — 파일 /assets/sfx/sfx.wav */
export const SFX_SPRITE = {
  hit: [0, 140],
  hitHeavy: [240, 300],
  guard: [640, 350],
  whoosh: [1090, 170],
  throw: [1360, 320],
  jump: [1780, 130],
  land: [2010, 120],
  grab: [2230, 90],
  ko: [2420, 900],
  fall: [3420, 800],
} as const satisfies Record<string, readonly [number, number]>

export type SfxName = keyof typeof SFX_SPRITE
