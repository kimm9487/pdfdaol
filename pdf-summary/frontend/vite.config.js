/* eslint-env node */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development" || mode === undefined;

  // 환경 변수로 backend URL 결정 → 모든 환경 동적 처리
  // Docker: http://backend:8000
  // 로컬: http://localhost:8000 (fallback)
  // 배포: https://api.yourdomain.com (또는 .env.production에서 주입)
  const backendTarget =
    process.env.VITE_BACKEND_TARGET || "http://localhost:8000";

  console.log(`[Vite] Using backend target: ${backendTarget}`); // ← 디버깅용 로그 (중요!)

  return {
    plugins: [react()],

    server: isDev
      ? {
          host: "0.0.0.0", // Docker 외부 접근 필수
          port: 5173,
          proxy: {
            // Socket.IO 전용 프록시 (가장 중요한 부분)
            "/socket.io": {
              target: backendTarget,
              ws: true,
              changeOrigin: true,
              secure: false,
              agent: new http.Agent({ keepAlive: true }),

              // ↓↓↓ 여기부터 아래처럼 교체 (전체 configure 블록 통째로 바꿈)
              configure: (proxy) => {
                proxy.on("proxyReqWs", (proxyReq, req) => {
                  console.log("[VITE-WS] 요청 →", req.url);
                });
                proxy.on("error", (err) => {
                  console.error("[VITE-WS] 에러:", err);
                });
              },
              // ======================================================
            },

            // 필요하면 일반 API도 동일하게 (나중에 확장 용이)
            // "/api": { target: backendTarget, changeOrigin: true },
          },
        }
      : undefined,
  };
});
