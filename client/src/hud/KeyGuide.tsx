import { useEffect, useRef, useState } from 'react'
import { GRAB, KICK_COOLDOWN, TICK_RATE } from '@fight-club/shared'
import type { GameSession } from '../game/session.ts'

type CooldownKind = 'kick' | 'grab'

interface ActionKey {
  code: string
  key: string
  icon: string
  label: string
  cooldown?: CooldownKind
}

/** 왼쪽: 공격·방어 키 (키보드 가운데 줄 순서 그대로) */
const ACTION_KEYS: ActionKey[] = [
  { code: 'KeyA', key: 'A', icon: '🤛', label: '기본' },
  { code: 'KeyS', key: 'S', icon: '🤜', label: '특수' },
  { code: 'KeyD', key: 'D', icon: '🦵', label: '발차기', cooldown: 'kick' },
  { code: 'KeyF', key: 'F', icon: '🛡️', label: '가드' },
  { code: 'KeyG', key: 'G', icon: '✊', label: '잡기', cooldown: 'grab' },
]

/** 오른쪽: 방향키 (뒤집힌 T자) */
const ARROW_KEYS = [
  { code: 'ArrowUp', glyph: '▲', area: 'up' },
  { code: 'ArrowLeft', glyph: '◀', area: 'left' },
  { code: 'ArrowDown', glyph: '▼', area: 'down' },
  { code: 'ArrowRight', glyph: '▶', area: 'right' },
]

const TRACKED = new Set([...ACTION_KEYS.map((k) => k.code), ...ARROW_KEYS.map((k) => k.code)])
const COOLDOWN_FRAMES: Record<CooldownKind, number> = { kick: KICK_COOLDOWN, grab: GRAB.cooldown }

/**
 * 화면 아래 양쪽의 키보드 그림 — 왼쪽은 A·S·D·F·G, 오른쪽은 방향키. 누르는 동안 키가 눌려 들어가 보이고,
 * 쿨타임 중인 발차기·잡기 키에는 남은 시간이 표시된다. 터치 기기에서는 숨긴다 (모바일 조작은 추후 개발)
 */
export function KeyGuide({ session }: { session: GameSession }) {
  const pressed = usePressedKeys()
  return (
    <>
      <div className="keys keys-left" aria-label="공격 키">
        {ACTION_KEYS.map((k) => (
          <div key={k.code} className="key-slot">
            <div className="keycap" data-pressed={pressed.has(k.code)}>
              <span className="keycap-letter">{k.key}</span>
              <span className="keycap-icon" aria-hidden="true">{k.icon}</span>
              {k.cooldown && <Cooldown session={session} kind={k.cooldown} />}
            </div>
            <span className="key-label">{k.label}</span>
          </div>
        ))}
      </div>
      <div className="keys keys-right" aria-label="이동 키">
        {ARROW_KEYS.map((k) => (
          <div key={k.code} className="keycap keycap-arrow" style={{ gridArea: k.area }} data-pressed={pressed.has(k.code)}>
            {k.glyph}
          </div>
        ))}
        <span className="key-label" style={{ gridArea: 'label' }}>이동</span>
      </div>
    </>
  )
}

/** 지금 눌려 있는 키 (KeyboardEvent.code). 창이 포커스를 잃으면 모두 뗀 것으로 본다 */
function usePressedKeys(): ReadonlySet<string> {
  const [pressed, setPressed] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const set = (code: string, down: boolean) => {
      if (!TRACKED.has(code)) return
      setPressed((prev) => {
        if (prev.has(code) === down) return prev
        const next = new Set(prev)
        if (down) next.add(code)
        else next.delete(code)
        return next
      })
    }
    const onDown = (e: KeyboardEvent) => set(e.code, true)
    const onUp = (e: KeyboardEvent) => set(e.code, false)
    const onBlur = () => setPressed(new Set())
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
  return pressed
}

/**
 * 쿨타임 그림자: 남은 만큼 시계 방향으로 어둡고, 가운데에 남은 초.
 * 화면 프레임마다 확인하되 값이 바뀔 때만 DOM을 고친다 (React 다시 그리기 없음, 쿨타임이 없으면 아무것도 안 바뀜)
 */
function Cooldown({ session, kind }: { session: GameSession; kind: CooldownKind }) {
  const shade = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let shownLeft = 0
    let shownText = ''
    let frame = requestAnimationFrame(function loop() {
      const el = shade.current
      const left = session.myCooldown(kind)
      if (el && left !== shownLeft) {
        if ((left > 0) !== (shownLeft > 0)) el.hidden = left <= 0
        shownLeft = left
        if (left > 0) {
          el.style.setProperty('--left', String(left / COOLDOWN_FRAMES[kind]))
          const text = (left / TICK_RATE).toFixed(1)
          if (text !== shownText) el.textContent = shownText = text
        }
      }
      frame = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(frame)
  }, [session, kind])
  return <span ref={shade} className="keycap-cooldown" hidden />
}
