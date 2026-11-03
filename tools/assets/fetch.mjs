// 원본 에셋(KayKit, CC0)을 고정된 커밋에서 받아 체크섬을 확인한다 — 결과는 tools/assets/.cache/src (커밋하지 않음)
// 사용법: npm run assets:fetch
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '.cache', 'src')
const sources = JSON.parse(await readFile(join(here, 'sources.json'), 'utf8'))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

await mkdir(out, { recursive: true })
for (const pack of Object.values(sources)) {
  const raw = pack.repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')
  for (const [name, file] of Object.entries(pack.files)) {
    const target = join(out, name)
    if (existsSync(target) && sha256(await readFile(target)) === file.sha256) {
      console.log(`있음  ${name}`)
      continue
    }
    const res = await fetch(`${raw}/${pack.commit}/${file.path}`)
    if (!res.ok) throw new Error(`${name} 받기 실패: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== file.sha256) throw new Error(`${name} 체크섬이 다르다 — sources.json의 커밋·해시를 확인할 것`)
    await writeFile(target, buf)
    console.log(`받음  ${name} (${(buf.length / 1024 / 1024).toFixed(2)}MB)`)
  }
}
