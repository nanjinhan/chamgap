import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 데이터는 Supabase에서 바로 받는다 (주소·공개 키는 web/.env.local 의 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
// 빌드 결과(web/dist)는 Vercel이 띄운다.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: true, // 같은 WiFi 폰에서 http://<노트북IP>:5173 접속
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
})
