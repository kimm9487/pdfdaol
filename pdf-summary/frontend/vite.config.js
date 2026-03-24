/* global process */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development" || mode === undefined;
  
  // 환경변수에서 백엔드 주소 읽기 (없으면 기본값)
  // 로컬: npm run dev → fallback: http://localhost:8000
  // 도커: VITE_BACKEND_TARGET 또는 BACKEND_HOST 환경변수
  const backendTarget = process.env.VITE_BACKEND_TARGET || process.env.BACKEND_HOST || "http://localhost:8000";

  console.log(`[Vite] Backend Target: ${backendTarget}`);

  return {
    plugins: [react()],

    server: isDev
      ? {
          host: "0.0.0.0",
          port: 5173,

          proxy: {
            // ✅ Socket.IO (WebSocket 포함)
            "/socket.io": {
              target: backendTarget,
              ws: true,
              changeOrigin: true,
              secure: false,
              rejectUnauthorized: false,
              agent: new http.Agent({ keepAlive: true }),
              headers: {
                Origin: backendTarget,
              },

              configure: (proxy) => {
                proxy.on("proxyReqWs", (proxyReq, req, res, options) => {
                  console.log("[VITE-WS] WebSocket 프록시 요청 →", req.url, "→", backendTarget);
                });

                proxy.on("error", (err, req, res) => {
                  console.error("[VITE-WS] 프록시 에러:", err.message);
                  console.error("[VITE-WS] 타겟:", backendTarget);
                });
              },
            },

            // ✅ REST API
            "/api": {
              target: backendTarget,
              changeOrigin: true,
              secure: false,
            },
          },
        }
      : undefined,
  };
});