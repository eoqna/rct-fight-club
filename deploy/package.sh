#!/usr/bin/env bash
# 배포할 것을 묶는다 — 클라이언트 빌드(미리 압축)·서버 번들·Docker 파일 → deploy/out/<커밋>/ (릴리스 폴더)
# 사용법: deploy/package.sh   → 마지막 줄에 릴리스 폴더 경로를 찍는다
# 커밋하지 않은 변경이 있으면 멈춘다 (어떤 코드가 배포됐는지 커밋으로 알 수 있게). 시험 삼아 묶을 때만 ALLOW_DIRTY=1
set -euo pipefail
cd "$(dirname "$0")/.."

RELEASE=$(git rev-parse --short=10 HEAD)
if [ -n "$(git status --porcelain)" ]; then
  if [ "${ALLOW_DIRTY:-}" != 1 ]; then
    echo "커밋하지 않은 변경이 있습니다 — 커밋한 뒤 배포하세요 (시험 삼아 그대로 묶으려면 ALLOW_DIRTY=1)" >&2
    exit 1
  fi
  RELEASE="$RELEASE-dirty"
fi

# 클라이언트: tsc + vite → client/dist, 서버: esbuild → server/dist/server.mjs
npm run build >&2

OUT="deploy/out/$RELEASE"
rm -rf "$OUT"
mkdir -p "$OUT/server" "$OUT/web"
cp deploy/compose.yaml "$OUT/"
cp deploy/server.Dockerfile "$OUT/server/Dockerfile"
cp server/dist/server.mjs server/dist/server.mjs.map "$OUT/server/"
cp deploy/web.Dockerfile "$OUT/web/Dockerfile"
cp deploy/Caddyfile "$OUT/web/"
cp -R client/dist "$OUT/web/dist"
node deploy/precompress.mjs "$OUT/web/dist" >&2
echo "$RELEASE" > "$OUT/RELEASE"
echo "$OUT"
