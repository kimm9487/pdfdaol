const envApiUrl = (import.meta.env.VITE_API_URL || "").trim();
const envSocketUrl = (import.meta.env.VITE_SOCKET_URL || "").trim();

const protocol = window.location.protocol === "https:" ? "https:" : "http:";
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const host = window.location.hostname || "localhost";
const port = import.meta.env.VITE_API_PORT || "8000";
const socketPort = import.meta.env.VITE_SOCKET_PORT || "8001";

export const API_ORIGIN = envApiUrl || `${protocol}//${host}:${port}`;
export const SOCKET_ORIGIN = envSocketUrl || `${wsProtocol}//${host}:${socketPort}`;
export const API_BASE = `${API_ORIGIN}/api`;

export const buildApiUrl = (path) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}${normalizedPath}`;
};
