#!/usr/bin/env bash
# 운영 서버(Lightsail Ubuntu 24.04)를 처음 한 번 준비한다 — Docker 설치, 자동 보안 업데이트, 스왑 1GB, 배포 폴더.
# 서버에서 실행: bash vm-setup.sh   (끝나면 한 번 나갔다 다시 들어와야 sudo 없이 docker를 쓸 수 있다)
set -euo pipefail

sudo apt-get update
sudo apt-get install -y ca-certificates curl rsync unattended-upgrades
# 보안 업데이트를 자동으로 설치한다
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# Docker Engine + Compose 플러그인 (공식 설치 스크립트)
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

# 메모리 2GB라도 순간적으로 모자랄 때 프로세스가 죽지 않게 스왑 1GB
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

mkdir -p ~/fight-club/releases
echo "✅ 준비 끝 — 나갔다가 다시 들어온 뒤 ~/fight-club/.env 를 만들어 주세요 (deploy/env.example)"
