import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react'
import { CHARACTER_COUNT } from '@fight-club/shared/constants'
import { randomNameIndex, type NameIndex } from '@fight-club/shared/nickname'
import { CloseCode, PROTOCOL_VERSION, type JoinOptions, type ResultMsg } from '@fight-club/shared/protocol'
import type { GameSession } from './game/session.ts'
import { hasWebGL2 } from './scene/quality.ts'
import { ResultScreen } from './screens/ResultScreen.tsx'
import { SelectScreen } from './screens/SelectScreen.tsx'
import { TitleScreen } from './screens/TitleScreen.tsx'

/** 3D·네트워크 코드는 시작 화면이 뜬 뒤에 받는다 (design §7.7, P4-6) */
const GameView = lazy(() => import('./scene/GameView.tsx').then((m) => ({ default: m.GameView })))

/** 시작 화면이 뜨자마자 뒤에서 받아 둔다 — 입장할 때 기다리지 않게 */
function preload() {
  void import('./scene/GameView.tsx')
  void import('./scene/CharacterPreview.tsx')
  import('./scene/characterAssets.ts').then((m) => m.loadCharacterAssets()).catch(() => {})
  import('./game/sound.ts').then((m) => m.loadSounds()).catch(() => {})
}

/** 입장에 필요한 것: 연결과 캐릭터 에셋. 둘 다 끝나야 게임 화면으로 간다 (design §5.3) */
async function enter(options: JoinOptions): Promise<GameSession> {
  const [{ GameSession }] = await Promise.all([
    import('./game/session.ts'),
    import('./scene/characterAssets.ts').then((m) => m.loadCharacterAssets()),
    import('./scene/GameView.tsx'),
  ])
  return GameSession.connect(options)
}

type Screen =
  | { name: 'title' }
  | { name: 'select'; notice?: ReactNode }
  | { name: 'connecting' }
  | { name: 'playing'; session: GameSession }
  | { name: 'result'; result: ResultMsg }
  | { name: 'outdated' }

/** 개발용: 주소에 ?play를 붙이면 시작·선택 화면을 건너뛰고 바로 들어간다 (?character=번호로 캐릭터 지정) */
const params = new URLSearchParams(location.search)
const QUICK_PLAY = import.meta.env.DEV && params.has('play')
const QUICK_CHARACTER = Number(params.get('character'))

/** 3D를 그릴 수 없는 브라우저면 연결하지 않고 안내한다 (NFR-08) */
function App() {
  const [supported] = useState(hasWebGL2)
  if (!supported) {
    return (
      <main className="screen">
        <h1 className="title-logo">Fight Club</h1>
        <p role="alert">이 브라우저는 3D 그래픽(WebGL2)을 지원하지 않아 게임을 할 수 없습니다.</p>
        <p>최신 Chrome·Edge·Firefox·Safari에서 열어 주세요.</p>
      </main>
    )
  }
  return <Game />
}

/** 화면 흐름: 시작 → 캐릭터 선택 → 입장 중 → 게임 → 결과 → 캐릭터 선택 (design §7.1) */
function Game() {
  const [characterId, setCharacterId] = useState(() =>
    Number.isInteger(QUICK_CHARACTER) && QUICK_CHARACTER >= 0 && QUICK_CHARACTER < CHARACTER_COUNT && params.has('character')
      ? QUICK_CHARACTER
      : Math.floor(Math.random() * CHARACTER_COUNT))
  const [name, setName] = useState<NameIndex>(() => randomNameIndex())
  const [screen, setScreen] = useState<Screen>(() => (QUICK_PLAY ? { name: 'connecting' } : { name: 'title' }))

  useEffect(preload, [])

  // 입장: 연결과 에셋을 함께 준비한다. 실패하면 선택 화면에서 안내한다
  useEffect(() => {
    if (screen.name !== 'connecting') return
    let cancelled = false
    enter({ v: PROTOCOL_VERSION, characterId, name })
      .then((session) => {
        if (cancelled) return session.dispose()
        session.onEnd((end) => {
          // 결과·선택 화면에서는 게임이 키 입력을 가로채지 않도록 바로 정리한다
          session.dispose()
          if (end.kind === 'eliminated') setScreen({ name: 'result', result: end.result })
          else if (end.kind === 'rejoin') setScreen({ name: 'connecting' })
          else setScreen({ name: 'select', notice: `서버와 연결이 끊어졌습니다 (코드 ${end.code}). 다시 입장해 주세요.` })
        })
        setScreen({ name: 'playing', session })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const code = (error as { code?: number }).code
        setScreen(code === CloseCode.VersionMismatch
          ? { name: 'outdated' }
          : { name: 'select', notice: `경기장에 들어가지 못했습니다. 잠시 뒤 다시 시도해 주세요. (${errorText(error)})` })
      })
    return () => {
      cancelled = true
    }
    // 입장할 때의 캐릭터·이름으로 한 번만 연결한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  const reroll = useCallback(() => setName(randomNameIndex()), [])
  const join = useCallback(() => setScreen({ name: 'connecting' }), [])

  switch (screen.name) {
    case 'title':
      return <TitleScreen onStart={() => setScreen({ name: 'select' })} />
    case 'select':
      return (
        <SelectScreen
          characterId={characterId} name={name} notice={screen.notice}
          onCharacter={setCharacterId} onReroll={reroll} onJoin={join}
        />
      )
    case 'connecting':
      return (
        <main className="screen" aria-busy="true">
          <div className="spinner" aria-hidden="true" />
          <p>경기장을 찾는 중…</p>
        </main>
      )
    case 'playing':
      return (
        <Suspense fallback={<main className="screen"><p>게임을 준비하는 중…</p></main>}>
          <GameView session={screen.session} />
        </Suspense>
      )
    case 'result':
      return (
        <ResultScreen
          result={screen.result}
          onRetry={() => {
            // 다시 하기는 새 이름으로 (FR-40)
            setName(randomNameIndex())
            setScreen({ name: 'select' })
          }}
        />
      )
    case 'outdated':
      return (
        <main className="screen">
          <p role="alert">게임이 새 버전으로 바뀌었습니다. 새로고침해 주세요.</p>
          <div className="screen-actions">
            <button type="button" className="primary" onClick={() => location.reload()}>새로고침</button>
          </div>
        </main>
      )
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default App
