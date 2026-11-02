// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Simple Cookie utility
 * Used to store non-sensitive client-side configuration (e.g. tab state)
 */

const COOKIE_MAX_AGE_DAYS = 365;
const COOKIE_PATH = '/';

/**
 * Set a cookie
 */
export function setCookie(name: string, value: string, maxAgeDays: number = COOKIE_MAX_AGE_DAYS): void {
  const maxAge = maxAgeDays * 24 * 60 * 60;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)};path=${COOKIE_PATH};max-age=${maxAge};SameSite=Lax`;
}

/**
 * Get a cookie value, returns null if it does not exist
 */
export function getCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const c = cookies[i].trim();
    if (c.startsWith(prefix)) {
      return decodeURIComponent(c.substring(prefix.length));
    }
  }
  return null;
}

/**
 * Delete a cookie
 */
export function deleteCookie(name: string): void {
  document.cookie = `${encodeURIComponent(name)}=;path=${COOKIE_PATH};max-age=0;SameSite=Lax`;
}

/**
 * Set a JSON cookie
 */
export function setJsonCookie<T>(name: string, value: T, maxAgeDays?: number): void {
  setCookie(name, JSON.stringify(value), maxAgeDays);
}

/**
 * Get a JSON cookie
 */
export function getJsonCookie<T>(name: string): T | null {
  const raw = getCookie(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
