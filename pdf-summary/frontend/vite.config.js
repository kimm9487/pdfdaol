/* global process */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";

export default defineConfig(({ mode }) => {
    // allowedHosts를 환경변수에서 읽기 (없으면 기존 nip.io 도메인 fallback)
    const allowedHostsEnv = process.env.VITE_ALLOWED_HOSTS;
    const allowedHosts = allowedHostsEnv
      ? allowedHostsEnv.split(",").map(h => h.trim())
      : ["192.168.0.151.nip.io"];
  const isDev = mode === "development" || mode === undefined;

  // 환경변수에서 백엔드 주소 읽기 (없으면 기본값)
  // 로컬: npm run dev → fallback: http://localhost:8000
  // 도커: VITE_BACKEND_TARGET 또는 BACKEND_HOST 환경변수
  const backendTarget =
    process.env.VITE_BACKEND_TARGET ||
    process.env.BACKEND_HOST ||
    "http://localhost:8000";
  const socketTarget =
    process.env.VITE_SOCKET_TARGET || "http://localhost:8001";
  console.log(`[Vite] Backend Target: ${backendTarget}`);
  console.log(`[Vite] Socket Target: ${socketTarget}`);

  return {
    plugins: [react()],

    server: isDev
      ? {
          host: "0.0.0.0",
          port: 5173,
          allowedHosts,

          proxy: {
            // ✅ Socket.IO (WebSocket 포함)
            "/socket.io": {
              target: socketTarget,  
              ws: true,
              changeOrigin: true,
              secure: false,
              rejectUnauthorized: false,
              agent: new http.Agent({ keepAlive: true }),
              headers: {
                Origin: socketTarget,
              },

              configure: (proxy) => {
                proxy.on("proxyReqWs", (_proxyReq, req) => {
                  console.log(
                    "[VITE-WS] WebSocket 프록시 요청 →",
                    req.url,
                    "→",
                    socketTarget,
                  );
                });

                proxy.on("error", (err) => {
                  console.error("[VITE-WS] 프록시 에러:", err.message);
                  console.error("[VITE-WS] 타겟:", socketTarget);
                });
              },
            },

            // ✅ REST API
            "/api": {
              target: backendTarget,
              changeOrigin: true,
              secure: false,
              timeout: 0,
              proxyTimeout: 0,
              agent: new http.Agent({ keepAlive: true }),
            },
          },
        }
      : undefined,
  };
});