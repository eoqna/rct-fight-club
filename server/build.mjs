// 서버를 파일 하나로 묶는다 (design §8.1, P7-2): npm run build -w @fight-club/server → dist/server.mjs
// 의존성까지 모두 넣으므로 실행 이미지에는 Node와 이 파일만 있으면 된다
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // 오류 위치를 원래 소스로 보여 준다 (node --enable-source-maps)
  sourcemap: true,
  // CommonJS로 된 의존성(express 등)이 쓰는 require·__dirname을 ESM 파일 안에서도 쓸 수 있게
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module'",
      "import { fileURLToPath as __fileURLToPath } from 'node:url'",
      "import { dirname as __pathDirname } from 'node:path'",
      'const require = __createRequire(import.meta.url)',
      'const __filename = __fileURLToPath(import.meta.url)',
      'const __dirname = __pathDirname(__filename)',
    ].join('; '),
  },
  // 있으면 빨라지는 선택 의존성(네이티브 모듈) — 없으면 순수 JS로 돈다
  external: ['msgpackr-extract', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
})
