// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

const DEBUG_SKIP_AUTH_KEY = 'scada_debug_skip_auth'
// Warning: debug-mock-token is only recognized when the backend NODE_ENV !== 'production' (see jwt-auth.guard.ts isDevMode())
//     Production builds must never use this token, otherwise the frontend skips login but the backend returns 401 → no data can be fetched
const DEBUG_TOKEN = 'debug-mock-token'

export interface DebugUser {
  id: string
  username: string
  displayName: string
  email: string
  role: 'admin' | 'user' | 'viewer'
}

export const DEBUG_USER: DebugUser = {
  id: 'debug-user',
  username: 'debug',
  displayName: 'Debug User',
  email: 'debug@local.dev',
  role: 'admin',
}

export function isDebugSkipAuth(): boolean {
  return localStorage.getItem(DEBUG_SKIP_AUTH_KEY) === '1'
}

export function setDebugSkipAuth(enable: boolean): void {
  if (enable) {
    localStorage.setItem(DEBUG_SKIP_AUTH_KEY, '1')
  } else {
    localStorage.removeItem(DEBUG_SKIP_AUTH_KEY)
  }
}

export function getDebugToken(): string {
  return DEBUG_TOKEN
}
