const envApiUrl = (import.meta.env.VITE_API_URL || "").trim();

const protocol = window.location.protocol === "https:" ? "https:" : "http:";
const host = window.location.hostname || "localhost";
const port = import.meta.env.VITE_API_PORT || "8000";

export const API_ORIGIN = envApiUrl || `${protocol}//${host}:${port}`;
export const API_BASE = `${API_ORIGIN}/api`;

export const buildApiUrl = (path) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}${normalizedPath}`;
};
