// 캐릭터 굽기: 헤드리스 Chrome에서 bake/index.html을 열어 레시피를 적용한 GLB와 클립 정보를 받는다
// 결과는 tools/assets/.cache/baked (커밋하지 않음). 설치된 Google Chrome을 쓴다 (CHROME_PATH로 바꿀 수 있음)
// 사용법: npm run assets:build (fetch → bake → optimize)
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const out = join(here, '.cache', 'baked')

// 경로 접두사 → 폴더 (먼저 맞는 것). 127.0.0.1에서만 연다
const mounts = [
  ['/three/', join(repo, 'node_modules', 'three')],
  ['/src/', join(here, '.cache', 'src')],
  ['/', here],
]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' }
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const [prefix, dir] = mounts.find(([p]) => path.startsWith(p))
  const rel = normalize(path.slice(prefix.length)).replace(/^(\.\.[/\\])+/, '')
  try {
    const body = await readFile(join(dir, rel))
    res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/bake/index.html`

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url)
  await page.waitForFunction(() => globalThis.__bake || globalThis.__bakeError, null, { timeout: 120_000 })
  const failure = await page.evaluate(() => globalThis.__bakeError)
  if (failure) throw new Error(`굽기 실패\n${failure}\n${errors.join('\n')}`)
  const result = await page.evaluate(() => globalThis.__bake)

  await mkdir(out, { recursive: true })
  for (const [key, base64] of Object.entries(result.characters)) {
    const buf = Buffer.from(base64, 'base64')
    await writeFile(join(out, `${key}.glb`), buf)
    const meshes = result.meshes[key].map((m) => `${m.name} ${m.triangles}`).join(', ')
    console.log(`구움  ${key}.glb (${(buf.length / 1024).toFixed(0)}KB) — ${meshes}`)
  }
  await writeFile(join(out, 'clips.json'), `${JSON.stringify(result.clips, null, 2)}\n`)
  await writeFile(join(out, 'derived-clips.json'), JSON.stringify(result.derived))
  console.log(`클립 정보 ${Object.keys(result.clips).length}개 → clips.json, 뒤집어 만든 클립 ${result.derived.map((c) => c.name).join(', ')}`)
} finally {
  await browser.close()
  server.close()
}
