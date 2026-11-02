// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, ApiError } from './types/api';
import { errorHandler } from './error-handler';
import { connectionMonitor } from './connection-monitor';
import { requestQueue } from './request-queue';
import { shouldQueueRequest } from './error-handler';

/**
 * S-C03: Token storage changed to in-memory (no longer using localStorage)
 *
 * Tokens are managed automatically by the backend via HttpOnly Cookie and cannot be read by the frontend.
 * The in-memory token value is only used to mark the auth state and as an Authorization header compatibility fallback.
 */
let memoryToken: string | null = null;
let memoryRefreshToken: string | null = null;

/**
 * Bearer Token mode (desktop Tauri): refreshToken persisted to localStorage,
 * used to restore the session after app restart. Only the desktop app (cross-site, cookies unavailable) writes the real token;
 * the Web app (HttpOnly Cookie mode) never triggers persistence.
 */
const PERSISTED_REFRESH_TOKEN_KEY = 'ss_auth_refresh_token';

export function persistRefreshToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(PERSISTED_REFRESH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(PERSISTED_REFRESH_TOKEN_KEY);
    }
  } catch { /* degrade silently when storage is unavailable (valid for this session only) */ }
}

export function loadPersistedRefreshToken(): string | null {
  try {
    return localStorage.getItem(PERSISTED_REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  // S-C03: carry the Cookie (the HttpOnly token is transported automatically via Cookie)
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

client.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Filter mode: when the backend is known to be offline, enqueue the request directly without sending an HTTP request
    // Avoids pointless network requests; the view layer need not be aware of network errors
    if (connectionMonitor.isOffline() && shouldQueueRequest(config)) {
      return new Promise((resolve, reject) => {
        const enqueued = requestQueue.enqueue(config, resolve, reject);
        if (!enqueued) {
          reject(new Error('QUEUE_FULL'));
        }
      });
    }

    // S-C03: the token is primarily transported via Cookie; the Authorization header is only a compatibility fallback
    const token = getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Inject X-Request-Id to correlate frontend and backend logs
    if (config.headers && !config.headers['X-Request-Id']) {
      config.headers['X-Request-Id'] =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    // FormData requests must remove Content-Type so the browser sets the multipart boundary automatically,
    // otherwise the default application/json causes the backend json() body-parser to consume the request stream early,
    // and multer cannot parse the uploaded file (triggering 400 errors such as "missing background image file", "missing preview image file")
    if (config.data instanceof FormData && config.headers) {
      delete config.headers['Content-Type'];
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * S-C03: refresh-token request with retry (up to 3 attempts, exponential backoff 1s / 2s)
 *
 * - Cookie mode (Web, same-origin): refreshToken is transported automatically via HttpOnly Cookie, body is empty;
 * - Bearer mode (desktop Tauri): refreshToken is transported via the body;
 *   after a successful refresh the new token pair is synced from the response body to memory and persistent storage.
 */
async function refreshAccessToken(): Promise<boolean> {
  let bearerRefreshToken = memoryRefreshToken && memoryRefreshToken !== 'httpOnly'
    ? memoryRefreshToken
    : null;
  // After app restart memory is empty: fall back to reading the persisted refreshToken (only the desktop Bearer mode writes it)
  if (!bearerRefreshToken) {
    bearerRefreshToken = loadPersistedRefreshToken();
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Auth] 刷新 Token 请求 | attempt=${attempt}/3 mode=${bearerRefreshToken ? 'bearer' : 'cookie'}`);
      const response = await axios.post(
        '/api/v1/auth/refresh',
        bearerRefreshToken ? { refreshToken: bearerRefreshToken } : {},
        { withCredentials: true },
      );
      // Bearer mode: the new token pair is in the response body, sync to memory and update persistent storage;
      // Cookie mode: the new token has been written via Set-Cookie, no further handling needed.
      const data = response.data?.data ?? response.data;
      if (data?.accessToken) {
        memoryToken = data.accessToken;
        if (data.refreshToken) {
          memoryRefreshToken = data.refreshToken;
          persistRefreshToken(data.refreshToken);
        }
      }
      console.log(`[Auth] Token 刷新成功 | attempt=${attempt}/3`);
      return true;
    } catch (err) {
      const status = (err as any)?.response?.status;
      console.warn(`[Auth] Token 刷新失败 | attempt=${attempt}/3 status=${status} error="${(err as Error)?.message || 'unknown'}"`);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  return false;
}

/**
 * Clear the auth state and redirect to the login page (silent, no error shown)
 */
function logoutAndRedirect(): void {
  console.warn('[Auth] 认证失效，跳转登录页');
  clearTokens();
  persistRefreshToken(null);
  // Use replace to avoid returning to the 401 page when navigating back
  if (window.location.hash !== '#/login') {
    window.location.replace('#/login');
  }
}

client.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    // Request succeeded → mark the backend as online
    connectionMonitor.markOnline();
    return response;
  },
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const requestUrl = originalRequest?.url || 'unknown';
    const requestMethod = originalRequest?.method || 'unknown';

    // 401 handling
    if (error.response?.status === 401) {
      console.warn(`[Auth] 401 未授权 | ${requestMethod.toUpperCase()} ${requestUrl} | _retry=${!!originalRequest._retry}`);

      // A retried request after refresh getting 401 again → silently go to login
      if (originalRequest._retry) {
        console.warn(`[Auth] 重试后仍 401，放弃 → 跳转登录 | ${requestMethod.toUpperCase()} ${requestUrl}`);
        logoutAndRedirect();
        return Promise.reject(error);
      }

      // S-C03: try refreshing the token via Cookie
      if (isRefreshing) {
        console.debug(`[Auth] 已有刷新进行中，排队等待 | ${requestMethod.toUpperCase()} ${requestUrl}`);
        return new Promise<AxiosResponse>((resolve) => {
          addRefreshSubscriber(() => {
            console.debug(`[Auth] 刷新完成，重试排队请求 | ${requestMethod.toUpperCase()} ${requestUrl}`);
            resolve(client(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;
      console.log(`[Auth] 开始刷新 Token | 触发请求=${requestMethod.toUpperCase()} ${requestUrl}`);

      try {
        const success = await refreshAccessToken();

        if (success) {
          console.log(`[Auth] Token 刷新成功，重试原请求 | ${requestMethod.toUpperCase()} ${requestUrl}`);
          onTokenRefreshed('cookie-refreshed');
          return client(originalRequest);
        }
      } finally {
        isRefreshing = false;
      }

      // Refresh failed → silently go to login
      console.warn(`[Auth] Token 刷新失败 → 跳转登录 | ${requestMethod.toUpperCase()} ${requestUrl}`);
      logoutAndRedirect();
    }

    // Non-401 errors are delegated to the unified error handler
    if (error.response?.status !== 401) {
      return errorHandler.handle(error);
    }

    return Promise.reject(error);
  },
);

// Automatically refresh and retry the queue when the backend recovers
connectionMonitor.onRecover(() => {
  requestQueue.flush(client);
});

/**
 * S-C03: Token operation functions (in-memory storage, no longer using localStorage)
 */
export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  // Debug mode: when scada_debug_skip_auth === '1' in localStorage, automatically return the debug token,
  // ensuring wsStore.connect() can establish the WebSocket connection when the preview page is opened directly (new tab/window)
  try {
    if (localStorage.getItem('scada_debug_skip_auth') === '1') return 'debug-mock-token';
  } catch { /* not in browser */ }
  return null;
}

export function setToken(token: string): void {
  memoryToken = token;
}

export function getRefreshToken(): string | null {
  return memoryRefreshToken;
}

export function setRefreshToken(token: string): void {
  memoryRefreshToken = token;
}

export function clearTokens(): void {
  memoryToken = null;
  memoryRefreshToken = null;
}

export function getBaseURL(): string {
  return client.defaults.baseURL || '/api/v1';
}

export default client;