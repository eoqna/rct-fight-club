import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 개인정보 점검표 (P6-5, NFR-10) 중 소스로 확인할 수 있는 것 — 서버 로그·저장소의 IP는 security.test.ts가 본다.
 * 클라이언트 소스는 Node 타입 없이 검사하므로 이 점검은 서버 테스트에 둔다
 */
const ROOT = join(import.meta.dirname, '..', '..')

/** 테스트를 뺀 소스 파일들 (상대 경로 → 내용) */
function sources(dir: string, pattern: RegExp): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (pattern.test(entry.name) && !entry.name.includes('.test.')) found.set(relative(ROOT, full), readFileSync(full, 'utf8'))
    }
  }
  walk(join(ROOT, dir))
  return found
}

describe('개인정보 점검 (P6-5)', () => {
  const client = sources('client/src', /\.(ts|tsx|css)$/)

  it('브라우저에는 음소거와 조작법 안내를 본 적이 있는지만 저장한다 (쿠키·sessionStorage·IndexedDB는 쓰지 않는다)', () => {
    const all = [...client.values()].join('\n')
    expect(all).not.toMatch(/document\.cookie|sessionStorage|indexedDB/)
    const keys = [...all.matchAll(/localStorage\.setItem\(\s*([A-Z_]+)/g)].map((m) => m[1]).sort()
    expect(keys).toEqual(['GUIDE_SEEN_KEY', 'MUTE_KEY'])
    expect(all).toContain("const MUTE_KEY = 'fight-club:muted'")
    expect(all).toContain("const GUIDE_SEEN_KEY = 'fight-club:guide-seen'")
  })

  it('다른 회사의 서버(글꼴·분석 도구·CDN)로 요청하지 않는다 — 우리 게임 서버만 부른다', () => {
    const pages = new Map([...client, ['client/index.html', readFileSync(join(ROOT, 'client/index.html'), 'utf8')]])
    for (const [file, text] of pages) {
      const urls = [...text.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0])
      // 게임 서버 기본 주소(지금 페이지의 호스트)만 있다
      expect(urls.filter((url) => !url.startsWith('http://${location.hostname}')), file).toEqual([])
      expect(text, file).not.toMatch(/@import\s+url|@font-face|<script[^>]+src=["']https?:/)
    }
  })

  it('서버는 IP나 개인정보를 파일·DB에 저장하지 않는다 (쓰기 API를 쓰지 않는다)', () => {
    const server = sources('server/src', /\.ts$/)
    for (const [file, text] of server) {
      expect(text, file).not.toMatch(/writeFile|appendFile|createWriteStream|fs\.promises|from 'node:fs'/)
    }
  })
})
