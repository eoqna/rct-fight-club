#!/usr/bin/env bash
# 이 컴퓨터에서 운영과 같은 구성(Caddy TLS + 게임 서버, 운영 설정)을 띄워 본다 — 로컬 스테이징
# 사용법: deploy/local.sh up | down | logs
#   up   → https://localhost:8443 (Caddy가 만든 로컬 인증서라 브라우저가 한 번 경고한다)
#   down → 내리고 지운다 (인증서 볼륨 포함)
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=fight-club-local
STATE=deploy/out/LOCAL

compose() {
  local out
  out=$(cat "$STATE")
  (cd "$out" && RELEASE=$(cat RELEASE) docker compose -p "$PROJECT" --env-file ../../local.env "$@")
}

case "${1:-up}" in
  up)
    OUT=$(ALLOW_DIRTY=1 deploy/package.sh | tail -1)
    echo "$OUT" > "$STATE"
    compose up -d --build --remove-orphans
    echo "▶ https://localhost:8443  (운영 화면: https://localhost:8443/admin — admin / deploy/local.env의 비밀번호)"
    ;;
  down)
    compose down --volumes
    ;;
  logs)
    compose logs -f
    ;;
  *)
    echo "사용법: deploy/local.sh up | down | logs" >&2
    exit 1
    ;;
esac
