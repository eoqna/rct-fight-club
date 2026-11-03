#!/usr/bin/env bash
# 이전 릴리스로 되돌린다 — 그 릴리스의 이미지가 남아 있으면 다시 빌드하지 않고 바로 바꿔 띄운다 (design §8.1)
# 사용법: deploy/rollback.sh ubuntu@<서버 IP>            → 남아 있는 릴리스 목록 (최근 것부터)
#         deploy/rollback.sh ubuntu@<서버 IP> <릴리스>   → 그 릴리스로 되돌림
set -euo pipefail
TARGET=${1:?사용법: deploy/rollback.sh 사용자@서버주소 [릴리스]}
SSH="ssh -o StrictHostKeyChecking=accept-new${SSH_KEY:+ -i $SSH_KEY}"

if [ -z "${2:-}" ]; then
  $SSH "$TARGET" 'echo "지금: $(cat fight-club/current 2>/dev/null || echo 없음)"; echo "남아 있는 릴리스:"; ls -1t fight-club/releases'
  exit 0
fi

RELEASE=$2
$SSH "$TARGET" "set -e
  cd fight-club/releases/$RELEASE
  RELEASE=$RELEASE docker compose --env-file ../../.env up -d --remove-orphans
  echo $RELEASE > ../../current
  RELEASE=$RELEASE docker compose --env-file ../../.env ps"
echo "✅ $RELEASE 로 되돌렸습니다"
