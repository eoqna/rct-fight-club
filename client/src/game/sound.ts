import { Howl, Howler } from 'howler'
import { SFX_SPRITE, type SfxName } from './sfx.gen.ts'

const MUTE_KEY = 'fight-club:muted'
/** 이 거리(m)까지 들리고, 멀수록 작아진다 */
const HEARING = 18
/** 같은 소리가 이 간격(ms)보다 잦으면 건너뛴다 — 여럿이 한꺼번에 때려도 소리가 뭉개지지 않게 */
const MIN_GAP_MS = 35

let howl: Howl | null = null
let muted: boolean | null = null
const lastPlayed = new Map<SfxName, number>()
/** 듣는 위치 — 내 캐릭터 */
const listener = { x: 0, z: 0 }

/**
 * 효과음 스프라이트를 받기 시작한다 (시작 화면에서 부른다).
 * 브라우저의 오디오 잠금은 Howler가 첫 클릭·터치·키 입력에서 푼다 (design §7.9)
 */
export function loadSounds() {
  if (howl) return
  const sprite = Object.fromEntries(Object.entries(SFX_SPRITE).map(([name, [start, length]]) => [name, [start, length] as [number, number]]))
  howl = new Howl({ src: [`${import.meta.env.BASE_URL}assets/sfx/sfx.wav`], sprite, preload: true })
  Howler.mute(isMuted())
}

export function setListener(x: number, z: number) {
  listener.x = x
  listener.z = z
}

/** 소리를 낸다. 위치를 주면 내 캐릭터에서 멀수록 작고 좌우로 나뉘어 들린다 */
export function playSound(name: SfxName, x?: number, z?: number) {
  if (!howl || isMuted()) return
  const now = performance.now()
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_GAP_MS) return
  let volume = 1, pan = 0
  if (x !== undefined && z !== undefined) {
    const d = Math.hypot(x - listener.x, z - listener.z)
    if (d > HEARING) return
    volume = 1 - 0.8 * (d / HEARING)
    pan = Math.max(-0.7, Math.min(0.7, (x - listener.x) / 12))
  }
  lastPlayed.set(name, now)
  const id = howl.play(name)
  howl.volume(volume, id)
  if (pan !== 0) howl.stereo(pan, id)
}

export function isMuted(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      muted = false
    }
  }
  return muted
}

/** 음소거를 바꾸고 다음 방문에도 기억한다 */
export function setMuted(value: boolean) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // 저장소를 쓸 수 없으면 이번 방문 동안만 유지한다
  }
  Howler.mute(value)
}
