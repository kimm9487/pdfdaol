import React from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from "react-hot-toast"; // [추가] toast import (main.jsx에서 전역적으로 사용하기 위해)
import './index.css'
import App from './App.jsx'

alert("✅ main.jsx 로드됨 - React 앱 시작");
console.log("✅ main.jsx 로드됨 - React 앱 시작");
console.log("🔍 VITE_SOCKET_URL:", import.meta.env.VITE_SOCKET_URL);

// WebSocket URL localStorage 초기화
localStorage.removeItem('backendSocketUrl');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
