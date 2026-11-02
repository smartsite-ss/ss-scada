// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Backend resource URL resolution
 *
 * Resource requests such as <img src> and CSS background-image do not go through fetch/XHR,
 * so the desktop (Tauri) HTTP interceptor cannot cover them: the page origin is https://tauri.localhost,
 * and relative API resource URLs (e.g. /api/v1/projects/{projectId}/image)
 * resolve against the page origin and 404, so project covers/page preview images fail to display.
 *
 * Therefore relative paths must be rewritten to the backend absolute address (registered to
 * globalThis.__SS_BACKEND_URL__ when the interceptor installs, same mechanism as ws-url.ts).
 * In Web same-origin scenarios this global value is absent and relative paths keep their original behavior.
 *
 * Backend resource endpoints must be @Public (auth-free), since <img> cannot carry the Authorization header.
 */
export function resolveBackendResourceUrl(url: string): string {
  if (!url) return url;

  // Absolute addresses (including protocol-relative //, data:, blob:) and non-root relative paths are kept as-is
  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:') || !url.startsWith('/')) {
    return url;
  }

  const backendUrl = (globalThis as Record<string, unknown>).__SS_BACKEND_URL__;
  if (typeof backendUrl === 'string' && backendUrl) {
    return backendUrl.replace(/\/+$/, '') + url;
  }
  return url;
}
