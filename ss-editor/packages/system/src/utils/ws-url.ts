// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * WebSocket server address resolution
 *
 * Web version (same-origin): uses the page origin directly; in development the Vite proxy (/socket.io ws:true)
 * forwards to the backend; in production a reverse proxy forwards.
 *
 * Desktop (Tauri, origin = https://tauri.localhost): the page origin is cross-origin from the backend.
 * The HTTP interceptor (proxy-setup) only rewrites fetch/XHR and does not cover socket.io's own connection;
 * therefore the backend address registered by the interceptor (globalThis.__SS_BACKEND_URL__) must be used explicitly,
 * otherwise socket.io connects to https://tauri.localhost/socket.io (no server, silent failure,
 * manifested as device-monitor real-time data not updating).
 */
export function getWsServerUrl(): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  if (origin.includes('tauri.localhost')) {
    const backendUrl = (globalThis as Record<string, unknown>).__SS_BACKEND_URL__;
    if (typeof backendUrl === 'string' && backendUrl) {
      return backendUrl;
    }
  }
  return origin;
}
