#!/usr/bin/env bash
# 운영 서버의 로그를 본다 (지금 띄운 릴리스)
# 사용법: deploy/logs.sh ubuntu@<서버 IP> [server|web]   — 기본 server (게임 서버 JSON 로그), web은 Caddy
set -euo pipefail
TARGET=${1:?사용법: deploy/logs.sh 사용자@서버주소 [server|web]}
SERVICE=${2:-server}
SSH="ssh -o StrictHostKeyChecking=accept-new${SSH_KEY:+ -i $SSH_KEY}"
$SSH -t "$TARGET" "cd fight-club/releases/\$(cat fight-club/current) && RELEASE=\$(cat ../../current) docker compose --env-file ../../.env logs -f --tail 200 $SERVICE"
