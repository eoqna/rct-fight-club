import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 파일 이름에 해시가 붙는 JS·CSS는 /build/에 둔다 — 1년 캐시. 해시 없는 public/assets(GLB·WAV)와 나눈다 (deploy/Caddyfile)
    assetsDir: 'build',
  },
})
