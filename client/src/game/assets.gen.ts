// 자동 생성 파일 — tools/assets/optimize.mjs (npm run assets:build). 직접 고치지 말 것

/**
 * 캐릭터 모델 (배열 번호 = PlayerState.characterId). 파일: /assets/characters/<key>.glb
 * variants: 색상 변형 1~3이 바꾸는 부위 — mode hue = 색상 회전(values: 각도°), tint = 색 곱하기(values: 색).
 * rects = 아틀라스 머티리얼의 UV 사각형 [u0, v0, u1, v1], parts = 함께 바꿀 단색 머티리얼 이름
 */
export const CHARACTER_MODELS = [
  {
    "key": "knight",
    "label": "전사",
    "idleClip": "Idle",
    "variants": [
      {
        "mode": "tint",
        "rects": [
          [0.375, 0, 0.5, 0.25],
          [0.875, 0, 1, 0.25],
          [0.25, 0.25, 0.375, 0.5]
        ],
        "parts": [],
        "values": ["#bcd4ff", "#ffc96b", "#7d8494"]
      },
      {
        "mode": "hue",
        "rects": [
          [0, 0.25, 0.125, 0.5]
        ],
        "parts": [],
        "values": [240, 120, 290]
      }
    ]
  },
  {
    "key": "bear",
    "label": "곰전사",
    "idleClip": "Idle",
    "variants": [
      {
        "mode": "tint",
        "rects": [
          [0.875, 0, 1, 0.25],
          [0.375, 0.5, 0.5, 0.75]
        ],
        "parts": [],
        "values": ["#5c5c5c", "#ffcf7a", "#b9c6dc"]
      },
      {
        "mode": "hue",
        "rects": [
          [0, 0.25, 0.125, 0.5],
          [0.125, 0.25, 0.25, 0.5]
        ],
        "parts": [],
        "values": [150, 240, 300]
      }
    ]
  },
  {
    "key": "pierrot",
    "label": "삐에로",
    "idleClip": "Idle",
    "variants": [
      {
        "mode": "hue",
        "rects": [
          [0, 0.75, 0.125, 1],
          [0.125, 0.75, 0.25, 1]
        ],
        "parts": ["pierrot_9a6bff"],
        "values": [120, 240, 60]
      }
    ]
  },
  {
    "key": "judoka",
    "label": "유도가",
    "idleClip": "Unarmed_Idle",
    "variants": [
      {
        "mode": "tint",
        "rects": [
          [0, 0.75, 0.125, 1],
          [0.25, 0.75, 0.375, 1],
          [0.625, 0.75, 0.75, 0.885]
        ],
        "parts": ["judoka_eef1f5", "judoka_eef1f6"],
        "values": ["#7da7ff", "#ff8f8f", "#ffd36b"]
      }
    ]
  },
  {
    "key": "ninja",
    "label": "닌자",
    "idleClip": "Idle",
    "variants": [
      {
        "mode": "hue",
        "rects": [
          [0.125, 0.25, 0.25, 0.5],
          [0, 0.25, 0.125, 0.5],
          [0.625, 0.5, 0.75, 0.75],
          [0.375, 0.5, 0.5, 0.75],
          [0.75, 0, 0.875, 0.25],
          [0.875, 0.25, 1, 0.5]
        ],
        "parts": [],
        "values": [120, 240, 60]
      }
    ]
  }
] as const

/** 공용 애니메이션 클립: 길이·타격 시점(초), 이동 클립의 원래 속도(메시 단위/초) — tools/assets/bake/edit.js analyzeClip이 잰 값 */
export const CLIP_INFO = {
  Unarmed_Idle: { duration: 1.0667 },
  Idle: { duration: 1.0667 },
  Walking_A: { duration: 1.0667, speed: 0.756 },
  Running_A: { duration: 0.8, speed: 1.5 },
  Jump_Start: { duration: 0.6 },
  Jump_Idle: { duration: 1.0667 },
  Jump_Land: { duration: 0.6667 },
  Unarmed_Melee_Attack_Punch_A: { duration: 1.4667, impact: 0.5 },
  Unarmed_Melee_Attack_Punch_B: { duration: 1.6667, impact: 0.5333 },
  Unarmed_Melee_Attack_Kick: { duration: 0.9333, impact: 0.3667 },
  '1H_Melee_Attack_Slice_Horizontal': { duration: 1.0667, impact: 0.2667 },
  '1H_Melee_Attack_Slice_Diagonal': { duration: 1, impact: 0.4 },
  '1H_Melee_Attack_Stab': { duration: 1.6, impact: 0.4667 },
  '1H_Melee_Attack_Chop': { duration: 1.0667, impact: 0.6667 },
  Blocking: { duration: 1.0667 },
  Block_Hit: { duration: 1.0667 },
  Interact: { duration: 1.3, impact: 0.4 },
  Hit_A: { duration: 0.6667 },
  Hit_B: { duration: 0.8667 },
  Lie_Down: { duration: 3 },
  Lie_Idle: { duration: 2.6667 },
  Lie_StandUp: { duration: 2.3333 },
  Death_A: { duration: 0.8 },
  Cheer: { duration: 1.6667 },
  Unarmed_Melee_Attack_Punch_Left: { duration: 1.4667, impact: 0.5 },
} as const satisfies Record<string, { duration: number, impact?: number, speed?: number }>

export type ClipName = keyof typeof CLIP_INFO
