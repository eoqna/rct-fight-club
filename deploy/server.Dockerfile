# 게임 서버 실행 이미지 (design §8.1, P7-2) — esbuild로 묶은 파일 하나와 Node 22만 들어간다.
# 번들은 배포하는 컴퓨터에서 만든다 (npm run build -w @fight-club/server → server/dist/server.mjs)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server.mjs server.mjs.map ./
USER node
EXPOSE 2567
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:2567/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "server.mjs"]
