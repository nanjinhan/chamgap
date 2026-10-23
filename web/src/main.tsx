import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startConnection } from './lib/ws'

// 서버 WebSocket은 React 바깥에서 한 번만 연다 (화면이 다시 그려져도 연결은 하나)
startConnection()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
