import React from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

alert("✅ main.jsx 로드됨 - React 앱 시작");
console.log("✅ main.jsx 로드됨 - React 앱 시작");

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
