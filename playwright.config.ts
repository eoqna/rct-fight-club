import { defineConfig } from '@playwright/test'

/** E2E 전용 포트 — 개발 서버(2567·5173)와 겹치지 않게 따로 띄운다 */
const SERVER_PORT = 2767
const CLIENT_PORT = 5373

/** 시작부터 결과까지 전체 흐름 (P4-7). 설치된 Google Chrome을 쓴다: npm run test:e2e */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}/`,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    // 가로로 든 휴대폰 화면 크기 (터치 조작은 P5 — 여기서는 화면 흐름과 배치를 본다)
    { name: 'mobile', use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'npx tsx server/src/index.ts', port: SERVER_PORT, env: { PORT: String(SERVER_PORT) }, reuseExistingServer: false },
    {
      command: `npx vite --port ${CLIENT_PORT} --strictPort`,
      cwd: 'client',
      port: CLIENT_PORT,
      env: { VITE_GAME_SERVER_URL: `http://localhost:${SERVER_PORT}` },
      reuseExistingServer: false,
    },
  ],
})
