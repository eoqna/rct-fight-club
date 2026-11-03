// 사용법: node deploy/precompress.mjs <폴더>
// 글자·모델·소리 파일 옆에 .br·.gz를 미리 만들어 둔다 — Caddy가 브라우저에 맞는 것을 골라 보낸다 (file_server precompressed).
// meshopt로 줄인 GLB도 일반 압축을 한 번 더 거치면 더 작아진다 (meshopt가 그렇게 쓰라고 설계됐다)
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.glb', '.wav', '.txt'])
/** 이보다 작으면 압축해도 얻는 것이 없다 (바이트) */
const MIN_BYTES = 1024
/** 원래 크기의 이 비율보다 작아질 때만 남긴다 */
const WORTH = 0.95

const root = process.argv[2]
if (!root) {
  console.error('사용법: node deploy/precompress.mjs <폴더>')
  process.exit(1)
}

let original = 0
let brotli = 0
let files = 0
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path)
      continue
    }
    if (!COMPRESSIBLE.has(extname(name)) || statSync(path).size < MIN_BYTES) continue
    const data = readFileSync(path)
    const br = brotliCompressSync(data, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
    })
    const gz = gzipSync(data, { level: 9 })
    if (br.length < data.length * WORTH) writeFileSync(`${path}.br`, br)
    if (gz.length < data.length * WORTH) writeFileSync(`${path}.gz`, gz)
    original += data.length
    brotli += Math.min(br.length, data.length)
    files++
  }
}
walk(root)
const kb = (n) => `${(n / 1024).toFixed(0)}KB`
console.log(`미리 압축: 파일 ${files}개 ${kb(original)} → brotli ${kb(brotli)} (${Math.round((brotli / original) * 100)}%)`)
