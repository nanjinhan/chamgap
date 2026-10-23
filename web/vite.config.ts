import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 웹앱은 서버 주소를 하드코딩하지 않고 항상 상대 경로(/api, /ws)를 쓴다.
// 개발 중에는 Vite가 브리지 서버(:8000)로 넘겨 주고, 빌드 후에는 서버가 web/dist를 직접 띄운다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: true, // 같은 WiFi 폰에서 http://<노트북IP>:5173 접속
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
})
