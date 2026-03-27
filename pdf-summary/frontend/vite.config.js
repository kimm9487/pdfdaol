/* global process */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development" || mode === undefined;
  
  // ✅ 수정된 부분 1: 기본 폴백(fallback) 주소를 nip.io로 변경
  // 로컬: npm run dev → fallback: http://127.0.0.1.nip.io:8000
  const backendTarget = process.env.VITE_BACKEND_TARGET || process.env.BACKEND_HOST || "http://127.0.0.1.nip.io:8000";

  console.log(`[Vite] Backend Target: ${backendTarget}`);

  return {
    plugins: [react()],

    server: isDev
      ? {
          host: "0.0.0.0",
          port: 5173,
          
          // ✅ 수정된 부분 2: nip.io 도메인 접속을 차단하지 않도록 허용
          allowedHosts: true, // 또는 [".nip.io"] 로 특정할 수도 있습니다.

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