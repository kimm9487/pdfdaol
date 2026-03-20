/* eslint-env node */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http"; // ← 이 한 줄 추가 (Node.js 14+ 권장 방식)

export default defineConfig(({ mode }) => {
  // development 모드에서만 proxy 켜기 (빌드 시 proxy 불필요)
  const isDev = mode === "development" || mode === undefined;

// eslint-disable-next-line no-undef
const backendTarget = process.env.VITE_BACKEND_TARGET || "http://localhost:8000";

  return {
    plugins: [react()],

    server: isDev
      ? {
          host: true, // ← Docker에서 외부(호스트 브라우저) 접근 허용 필수!
          proxy: {
            // Socket.IO 전용 프록시
            "/socket.io": {
              target: backendTarget,
              ws: true,
              changeOrigin: true,
              secure: false,
              agent: new http.Agent({ keepAlive: true }), // ✅ 연결 유지 강화
              rewrite: (path) => path, // path 유지 (필요 시 조정)
            },
            // 필요하면 일반 API도 추가
            // "/api": { target: backendTarget, changeOrigin: true },
          },
        }
      : undefined,
  };
  
});
