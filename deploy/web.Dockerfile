# 게임 화면 + Caddy(자동 TLS·wss 리버스 프록시) 이미지 (design §8.1, P7-2·3).
# 화면은 배포하는 컴퓨터에서 빌드하고 미리 압축해 둔다 (deploy/package.sh)
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY dist /srv
