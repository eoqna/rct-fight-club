// 용량 예산 검사 (design §7.7, NFR-03) — 하나라도 넘거나 캐릭터 파일이 없으면 실패한다 (exit 1)
// 사용법: npm run assets:check (assets:build 마지막에도 실행된다)
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { CHARACTERS } from './recipes.js'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MB = 1024 * 1024
const TOTAL_BUDGET = 13 * MB

/** 묶음별 예산. each = 파일마다, total = 묶음 합계. gzip = 전송 크기(압축)로 잰다 */
const GROUPS = [
  { name: '캐릭터', dir: 'client/public/assets/characters', ext: '.glb', each: 1.2 * MB },
  { name: '공용 애니메이션', dir: 'client/public/assets', ext: 'animations.glb', total: 2 * MB },
  { name: '경기장', dir: 'client/public/assets/arena', total: 1.5 * MB },
  { name: '효과음', dir: 'client/public/assets/sfx', total: 1.5 * MB },
  // 시작 화면 묶음 예산이지만, 빌드 결과의 JS 전체가 넘지 않으면 시작 묶음도 넘지 않는다
  { name: 'JS 번들 전체 (gzip, 빌드했을 때만)', dir: 'client/dist/build', ext: '.js', total: 1.2 * MB, gzip: true },
]

const fmt = (bytes) => `${(bytes / MB).toFixed(2)}MB`
const problems = []

// 캐릭터 GLB가 레시피의 캐릭터마다 있는지 (클라이언트는 characterId 순서로 받는다)
for (const { key } of CHARACTERS) {
  const file = join(repo, 'client/public/assets/characters', `${key}.glb`)
  if (!existsSync(file)) problems.push(`캐릭터 파일 없음: ${key}.glb — npm run assets:build`)
}

let sum = 0
for (const group of GROUPS) {
  const dir = join(repo, group.dir)
  const names = existsSync(dir) ? (await readdir(dir)).filter((n) => !group.ext || n.endsWith(group.ext)) : []
  const sizes = []
  for (const name of names) {
    const path = join(dir, name)
    if (!(await stat(path)).isFile()) continue
    sizes.push([name, group.gzip ? gzipSync(await readFile(path)).length : (await stat(path)).size])
  }
  const total = sizes.reduce((a, [, s]) => a + s, 0)
  sum += total
  if (!sizes.length) {
    console.log(`  -   ${group.name}: 파일 없음`)
    continue
  }
  const over = sizes.filter(([, s]) => group.each && s > group.each)
  const totalOver = group.total && total > group.total
  const ok = !over.length && !totalOver
  const limit = group.each ? `각 ${fmt(group.each)}` : fmt(group.total)
  console.log(`  ${ok ? '통과' : '초과'} ${group.name}: ${fmt(total)} (${sizes.length}개, 예산 ${limit})`)
  for (const [name, s] of over) problems.push(`${group.name} ${name} ${fmt(s)} > ${fmt(group.each)}`)
  if (totalOver) problems.push(`${group.name} 합계 ${fmt(total)} > ${fmt(group.total)}`)
}
console.log(`  ${sum > TOTAL_BUDGET ? '초과' : '통과'} 합계: ${fmt(sum)} (예산 ${fmt(TOTAL_BUDGET)})`)
if (sum > TOTAL_BUDGET) problems.push(`합계 ${fmt(sum)} > ${fmt(TOTAL_BUDGET)}`)

if (problems.length) {
  console.error(`용량 예산 검사 실패:\n${problems.map((p) => `- ${p}`).join('\n')}`)
  process.exit(1)
}
console.log('용량 예산 검사 통과')
