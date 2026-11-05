#!/usr/bin/env bash
# 운영 서버(Docker가 있는 VM)에 배포한다 — 이 컴퓨터에서 묶고(package.sh), 릴리스 폴더를 올린 뒤,
# 서버에서 이미지를 만들어 바꿔 띄운다. 게임 서버가 바뀌면 경기 중인 사람에게 10초 동안 점검을 알리고 끊는다.
# 사용법: deploy/ship.sh ubuntu@<서버 IP>
#   SSH 키 파일을 따로 쓰면: SSH_KEY=~/.ssh/LightsailDefaultKey-ap-northeast-2.pem deploy/ship.sh ubuntu@<서버 IP>
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET=${1:?사용법: deploy/ship.sh 사용자@서버주소}
SSH="ssh -o StrictHostKeyChecking=accept-new${SSH_KEY:+ -i $SSH_KEY}"
# 서버에 남겨 둘 릴리스 수 (되돌리기용)
KEEP=5

if ! $SSH "$TARGET" 'test -f fight-club/.env'; then
  echo "서버에 ~/fight-club/.env가 없습니다 — deploy/README.md의 '처음 한 번'을 먼저 해 주세요" >&2
  exit 1
fi

OUT=$(deploy/package.sh | tail -1)
RELEASE=$(cat "$OUT/RELEASE")
echo "▶ $RELEASE 를 $TARGET 에 올립니다"
$SSH "$TARGET" 'mkdir -p fight-club/releases'
rsync -az --delete -e "$SSH" "$OUT/" "$TARGET:fight-club/releases/$RELEASE/"

echo "▶ 서버에서 이미지를 만들고 바꿔 띄웁니다"
$SSH "$TARGET" "set -e
  cd fight-club/releases/$RELEASE
  # 베이스 이미지(node:22-alpine, caddy:2-alpine)의 보안 패치를 받도록 매번 새로 받아 빌드한다
  RELEASE=$RELEASE docker compose --env-file ../../.env build --pull
  RELEASE=$RELEASE docker compose --env-file ../../.env up -d --remove-orphans
  echo $RELEASE > ../../current
  RELEASE=$RELEASE docker compose --env-file ../../.env ps
  # 오래된 릴리스와 그 이미지는 지운다 (최근 ${KEEP}개만 남긴다)
  cd ..
  for old in \$(ls -1t | tail -n +$((KEEP + 1))); do
    docker image rm -f fight-club-server:\$old fight-club-web:\$old >/dev/null 2>&1 || true
    rm -rf \"\$old\"
  done"

SITE=$($SSH "$TARGET" "grep '^SITE=' fight-club/.env | cut -d= -f2-")
echo "▶ https://$SITE/healthz 응답을 기다립니다"
for _ in $(seq 60); do
  if curl -fsS "https://$SITE/healthz" >/dev/null 2>&1; then
    echo "✅ 배포 완료: https://$SITE ($RELEASE)"
    exit 0
  fi
  sleep 2
done
echo "❌ 2분 동안 응답이 없습니다 — 서버에서 'cd ~/fight-club/releases/$RELEASE && RELEASE=$RELEASE docker compose --env-file ../../.env logs' 를 확인해 주세요" >&2
exit 1
