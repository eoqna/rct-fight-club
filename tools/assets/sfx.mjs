// 효과음 합성: 짧은 소리 10종을 계산으로 만들어 스프라이트 WAV 하나로 묶는다 (내려받는 소리 없음 → 라이선스 걱정 없음)
// - client/public/assets/sfx/sfx.wav  : 22.05kHz 16비트 모노, 소리 사이에 짧은 무음
// - client/src/game/sfx.gen.ts        : 소리마다 [시작 ms, 길이 ms] (Howler sprite)
// 나중에 녹음한 소리로 바꾸려면 같은 이름·위치로 WAV를 만들면 된다
// 사용법: npm run assets:build (또는 node tools/assets/sfx.mjs)
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RATE = 22050
const GAP = 0.1

/** 매번 같은 잡음 (-1~1) */
function noiseSource(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 31 - 1
  }
}

const samples = (seconds) => new Float32Array(Math.round(seconds * RATE))
/** 빠르게 올라가 지수로 줄어드는 소리 크기 */
const env = (t, attack, decay) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay))

/** RBJ 쿡북 2차 필터 (bandpass·lowpass·highpass) — 중심 주파수가 바뀌어도 되게 매 표본 계수를 다시 구한다 */
function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x, freq, q) => {
    const w = (2 * Math.PI * freq) / RATE, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q)
    let b0, b1, b2
    if (type === 'band') [b0, b1, b2] = [alpha, 0, -alpha]
    else if (type === 'low') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
    else [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
    const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
  }
}

/** 낮게 떨어지는 사인파 '쿵' (주파수 f0 → f1) */
function thump(seconds, f0, f1, decay) {
  const out = samples(seconds)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    phase += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / (decay * 0.6)))) / RATE
    out[i] = Math.sin(phase) * env(t, 0.002, decay)
  }
  return out
}

/** 띠 잡음 '탁' (짧고 날카로운 타격 질감) */
function crack(seconds, center, decay, seed) {
  const out = samples(seconds), noise = noiseSource(seed), band = biquad('band')
  for (let i = 0; i < out.length; i++) out[i] = band(noise(), center, 0.9) * 3 * env(i / RATE, 0.001, decay)
  return out
}

/** 낮은 잡음을 일그러뜨린 '퍽' (강타의 묵직함) */
function crunch(seconds, decay, seed) {
  const out = samples(seconds), noise = noiseSource(seed), low = biquad('low')
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(low(noise(), 500, 0.7) * 6) * env(i / RATE, 0.002, decay)
  return out
}

/** 쇳소리 '칭' — 배음이 맞지 않는 사인 몇 개가 따로 줄어든다 */
function bell(seconds, freqs, decay) {
  const out = samples(seconds)
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    let v = 0
    freqs.forEach((f, k) => { v += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / (decay / (1 + k * 0.5))) })
    out[i] = (v / freqs.length) * Math.min(1, t / 0.001)
  }
  return out
}

/** 휘두르는 바람 소리 '휙' — 중심 주파수가 f0 → f1로 쓸리는 띠 잡음, 가운데가 가장 크다 */
function sweep(seconds, f0, f1, seed) {
  const out = samples(seconds), noise = noiseSource(seed), band = biquad('band')
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length
    out[i] = band(noise(), f0 * Math.pow(f1 / f0, u), 2.5) * 4 * Math.sin(Math.PI * u) ** 2
  }
  return out
}

/** 주파수가 미끄러지는 사인 (점프 '뿅', 떨어지는 '휘이이') */
function chirp(seconds, f0, f1, attack) {
  const out = samples(seconds)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length
    phase += (2 * Math.PI * (f0 + (f1 - f0) * u)) / RATE
    out[i] = Math.sin(phase) * Math.min(1, u / attack) * (1 - u) ** 1.5
  }
  return out
}

/** 착지 '툭' — 낮은 잡음과 낮은 사인 */
function thud(seconds, seed) {
  const out = samples(seconds), noise = noiseSource(seed), low = biquad('low')
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE
    out[i] = (low(noise(), 260, 0.8) * 2.5 + Math.sin(2 * Math.PI * 90 * t) * 0.6) * env(t, 0.002, 0.035)
  }
  return out
}

/** 옷깃 스치는 '스윽' (잡기) */
function rustle(seconds, seed) {
  const out = samples(seconds), noise = noiseSource(seed), high = biquad('high')
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length
    out[i] = high(noise(), 2500, 0.7) * Math.sin(Math.PI * u) * 0.9
  }
  return out
}

/** 여러 소리를 같은 시작점에 겹친다 (길이는 가장 긴 것) */
function mix(...parts) {
  const out = new Float32Array(Math.max(...parts.map(([s]) => s.length)))
  for (const [s, gain] of parts) for (let i = 0; i < s.length; i++) out[i] += s[i] * gain
  return out
}

/** 가장 큰 값이 peak가 되게 맞춘다 */
function normalize(s, peak) {
  let max = 0
  for (const v of s) max = Math.max(max, Math.abs(v))
  return s.map((v) => (v / (max || 1)) * peak)
}

/** 이름 → 소리. 크기(peak)는 자주 나는 소리일수록 작게 */
const SOUNDS = {
  hit: () => normalize(mix([thump(0.14, 190, 70, 0.05), 0.9], [crack(0.08, 1900, 0.02, 1), 0.6]), 0.75),
  hitHeavy: () => normalize(mix([thump(0.3, 150, 40, 0.09), 1], [crack(0.14, 1300, 0.035, 2), 0.7], [crunch(0.18, 0.05, 3), 0.6]), 0.95),
  guard: () => normalize(mix([bell(0.35, [1180, 1770, 2490, 3390], 0.12), 0.9], [crack(0.05, 3200, 0.01, 4), 0.5]), 0.7),
  whoosh: () => normalize(sweep(0.17, 450, 1900, 5), 0.4),
  throw: () => normalize(mix([sweep(0.32, 280, 1500, 6), 0.8], [thump(0.2, 120, 50, 0.06), 0.4]), 0.7),
  jump: () => normalize(chirp(0.13, 330, 680, 0.08), 0.3),
  land: () => normalize(thud(0.12, 7), 0.5),
  grab: () => normalize(rustle(0.09, 8), 0.4),
  ko: () => normalize(mix([thump(0.7, 120, 26, 0.22), 1], [crack(0.2, 900, 0.05, 9), 0.7], [bell(0.9, [660, 990, 1320], 0.35), 0.35]), 1),
  fall: () => normalize(chirp(0.8, 1400, 260, 0.05), 0.35),
}

/** 끝 8ms를 0으로 줄인다 — 잘린 자리에서 '틱' 소리가 나지 않게 */
function fadeTail(s, seconds = 0.008) {
  const n = Math.min(s.length, Math.round(seconds * RATE))
  for (let i = 0; i < n; i++) s[s.length - 1 - i] *= i / n
  return s
}

const sprite = {}
const chunks = []
let cursor = 0
for (const [name, make] of Object.entries(SOUNDS)) {
  const s = fadeTail(make())
  sprite[name] = [Math.round((cursor / RATE) * 1000), Math.round((s.length / RATE) * 1000)]
  chunks.push(s, new Float32Array(Math.round(GAP * RATE)))
  cursor += s.length + Math.round(GAP * RATE)
}

// 16비트 PCM 모노 WAV
const pcm = Buffer.alloc(cursor * 2)
let offset = 0
for (const chunk of chunks) {
  for (const v of chunk) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), offset)
    offset += 2
  }
}
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(RATE, 24)
header.writeUInt32LE(RATE * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)

const wav = join(repo, 'client', 'public', 'assets', 'sfx', 'sfx.wav')
await mkdir(dirname(wav), { recursive: true })
await writeFile(wav, Buffer.concat([header, pcm]))
const gen = join(repo, 'client', 'src', 'game', 'sfx.gen.ts')
await writeFile(gen, [
  '// 자동 생성 파일 — tools/assets/sfx.mjs (npm run assets:build). 직접 고치지 말 것',
  '',
  '/** 효과음 스프라이트: 소리마다 [시작 ms, 길이 ms] — 파일 /assets/sfx/sfx.wav */',
  'export const SFX_SPRITE = {',
  ...Object.entries(sprite).map(([name, [start, length]]) => `  ${name}: [${start}, ${length}],`),
  '} as const satisfies Record<string, readonly [number, number]>',
  '',
  'export type SfxName = keyof typeof SFX_SPRITE',
  '',
].join('\n'))
console.log(`합성  sfx.wav ${Object.keys(sprite).length}종 ${(cursor / RATE).toFixed(2)}초 (${((44 + pcm.length) / 1024).toFixed(0)}KB) → ${gen.slice(repo.length + 1)}`)
