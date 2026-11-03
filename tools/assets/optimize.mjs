// 구운 캐릭터와 공용 애니메이션을 압축해 클라이언트에 넣는다 (gltf-transform + meshopt)
// - client/public/assets/characters/<key>.glb : 캐릭터 메시·뼈대·텍스처 (애니메이션 없음)
// - client/public/assets/animations.glb       : 모든 캐릭터가 함께 쓰는 클립 (KayKit 기사 파일에서 추림)
// - client/src/game/assets.gen.ts             : 캐릭터 목록·클립 길이·타격 시점 (자동 생성)
// 사용법: npm run assets:build (fetch → bake → optimize → check)
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, resample, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { CHARACTERS, CLIPS } from './recipes.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const baked = join(here, '.cache', 'baked')
const publicDir = join(repo, 'client', 'public', 'assets')
const genFile = join(repo, 'client', 'src', 'game', 'assets.gen.ts')

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

const kb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`
await mkdir(join(publicDir, 'characters'), { recursive: true })

// 캐릭터: 같은 꼭짓점 합치기 → 안 쓰는 것 지우기 → 양자화·압축 (법선은 손실이 적은 'medium' 단계)
for (const { key } of CHARACTERS) {
  const src = join(baked, `${key}.glb`)
  const doc = await io.read(src)
  await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = join(publicDir, 'characters', `${key}.glb`)
  await io.write(out, doc)
  console.log(`압축  characters/${key}.glb ${kb((await stat(src)).size)} → ${kb((await stat(out)).size)}`)
}

// 공용 애니메이션: 쓰는 클립만 남기고 메시·스킨·텍스처를 지운다. 트랙 이름(뼈 이름)은 캐릭터 GLB와 같다
{
  const src = join(here, '.cache', 'src', 'Knight.glb')
  const doc = await io.read(src)
  const root = doc.getRoot()
  const names = root.listAnimations().map((a) => a.getName())
  const missing = CLIPS.filter((name) => !names.includes(name))
  if (missing.length) throw new Error(`원본에 없는 클립: ${missing.join(', ')}`)
  // 샘플러까지 지워야 prune이 그 데이터를 치운다 (애니메이션만 지우면 샘플러가 데이터를 붙잡고 남는다)
  for (const anim of root.listAnimations()) {
    if (CLIPS.includes(anim.getName())) continue
    for (const p of [...anim.listChannels(), ...anim.listSamplers(), anim]) p.dispose()
  }
  for (const node of root.listNodes()) node.setMesh(null).setSkin(null)
  for (const list of [root.listMeshes(), root.listSkins(), root.listMaterials(), root.listTextures()]) for (const p of list) p.dispose()
  // 굽기 단계에서 좌우로 뒤집어 만든 클립을 더한다. 트랙 이름은 three.js가 정리한 뼈 이름(점 없음)이다
  const sanitize = (name) => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '')
  const nodes = new Map(root.listNodes().map((node) => [sanitize(node.getName()), node]))
  const buffer = root.listBuffers()[0]
  for (const clip of JSON.parse(await readFile(join(baked, 'derived-clips.json'), 'utf8'))) {
    const anim = doc.createAnimation(clip.name)
    for (const track of clip.tracks) {
      const node = nodes.get(track.node)
      if (!node) throw new Error(`${clip.name}: 뼈 없음 ${track.node}`)
      const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(track.times)).setBuffer(buffer)
      const output = doc.createAccessor().setType(track.path === 'rotation' ? 'VEC4' : 'VEC3').setArray(new Float32Array(track.values)).setBuffer(buffer)
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR')
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(track.path).setSampler(sampler))
    }
  }
  await doc.transform(resample())
  // 클립 내내 기본 자세와 같은 트랙은 지운다 — 트랙이 없으면 three.js가 기본 자세를 쓰므로 결과가 같다.
  // (KayKit 캐릭터 5종의 뼈 기본 자세는 모두 같다) 남는 트랙이 줄어 파일의 JSON 부분이 크게 준다
  let dropped = 0
  for (const anim of root.listAnimations()) {
    for (const channel of anim.listChannels()) {
      const node = channel.getTargetNode(), path = channel.getTargetPath()
      const rest = path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : node.getScale()
      const out = channel.getSampler().getOutput()
      let same = true
      for (let i = 0; same && i < out.getCount(); i++) {
        const v = out.getElement(i, [])
        const near = (sign) => v.every((x, k) => Math.abs(sign * x - rest[k]) < 1e-4)
        same = near(1) || (path === 'rotation' && near(-1))
      }
      if (same) {
        channel.getSampler().dispose()
        channel.dispose()
        dropped++
      }
    }
  }
  console.log(`      기본 자세와 같은 트랙 ${dropped}개 제거`)
  // 회전 16비트·이동 12비트 필터로 압축 ('high')
  await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }))
  const out = join(publicDir, 'animations.glb')
  await io.write(out, doc)
  console.log(`압축  animations.glb (클립 ${root.listAnimations().length}개) ${kb((await stat(src)).size)} → ${kb((await stat(out)).size)}`)
}

// 클라이언트용 목록: 캐릭터 순서(= characterId), 클립 길이와 타격 시점
{
  const clips = JSON.parse(await readFile(join(baked, 'clips.json'), 'utf8'))
  // 아틀라스 칸(8열×4행) → UV 사각형 [u0, v0, u1, v1] (v는 이미지 위쪽이 0). ["칸", v시작, v끝]은 칸의 세로 일부
  const cellRect = (cell) => {
    const [name, from, to] = Array.isArray(cell) ? cell : [cell, 0, 1]
    const row = Number(name[1]), col = Number(name[3])
    return [col / 8, (row + from) / 4, (col + 1) / 8, (row + to) / 4].map((v) => Number(v.toFixed(5)))
  }
  const characters = CHARACTERS.map(({ key, label, idleClip, variants }) => ({
    key,
    label,
    idleClip,
    variants: variants.map(({ mode, cells, parts = [], values }) => ({
      mode, rects: cells.map(cellRect), parts: parts.map((hex) => `${key}_${hex}`), values,
    })),
  }))
  // 숫자로 시작하는 이름(1H_…)은 따옴표로 감싼다
  const clipLine = ([name, { duration, impact, speed }]) =>
    `  ${/^[A-Za-z_]\w*$/.test(name) ? name : `'${name}'`}: { duration: ${duration}${impact === undefined ? '' : `, impact: ${impact}`}${speed === undefined ? '' : `, speed: ${speed}`} },`
  const lines = [
    '// 자동 생성 파일 — tools/assets/optimize.mjs (npm run assets:build). 직접 고치지 말 것',
    '',
    '/**',
    ' * 캐릭터 모델 (배열 번호 = PlayerState.characterId). 파일: /assets/characters/<key>.glb',
    ' * variants: 색상 변형 1~3이 바꾸는 부위 — mode hue = 색상 회전(values: 각도°), tint = 색 곱하기(values: 색).',
    ' * rects = 아틀라스 머티리얼의 UV 사각형 [u0, v0, u1, v1], parts = 함께 바꿀 단색 머티리얼 이름',
    ' */',
    // 숫자·문자열만 든 배열은 한 줄로
    `export const CHARACTER_MODELS = ${JSON.stringify(characters, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, body) => `[${body.replace(/\s+/g, ' ')}]`)} as const`,
    '',
    '/** 공용 애니메이션 클립: 길이·타격 시점(초), 이동 클립의 원래 속도(메시 단위/초) — tools/assets/bake/edit.js analyzeClip이 잰 값 */',
    'export const CLIP_INFO = {',
    ...Object.entries(clips).map(clipLine),
    '} as const satisfies Record<string, { duration: number, impact?: number, speed?: number }>',
    '',
    'export type ClipName = keyof typeof CLIP_INFO',
    '',
  ]
  await writeFile(genFile, lines.join('\n'))
  console.log(`생성  ${genFile.slice(repo.length + 1)}`)
}
