// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';

// ==================== ID generator ====================

/** Generate a standard UUID v4 */
export function generateId(): string {
  return uuidv4();
}

/** Generate a short ID (nanoid-style random string) */
export function generateShortId(length: number = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/** Generate an ID with a business prefix */
export function generateBusinessId(prefix: string, length: number = 12): string {
  return `${prefix}-${generateShortId(length)}`;
}

/** Generate a device ID */
export function generateDeviceId(): string {
  return generateBusinessId('DEV', 10);
}

/** Generate a tag ID */
export function generateTagId(): string {
  return generateBusinessId('TAG', 10);
}

/** Generate an alarm ID */
export function generateAlarmId(): string {
  return generateBusinessId('ALM', 10);
}

// ==================== Pagination building ====================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ==================== Sensitive data masking ====================

/** Masking configuration */
export interface MaskOptions {
  /** Show the first N characters */
  showFirst?: number;
  /** Show the last N characters */
  showLast?: number;
  /** Mask character */
  maskChar?: string;
}

const DEFAULT_MASK_OPTIONS: MaskOptions = {
  showLast: 4,
  maskChar: '*',
};

/** Generic masking function */
export function maskSensitive(value: string, options?: MaskOptions | number): string {
  if (!value) return '***';

  const opts: MaskOptions =
    typeof options === 'number' ? { showLast: options } : { ...DEFAULT_MASK_OPTIONS, ...options };

  const { showFirst = 0, showLast = 0, maskChar = '*' } = opts;

  if (showFirst + showLast >= value.length) {
    return maskChar.repeat(3);
  }

  const firstPart = showFirst > 0 ? value.slice(0, showFirst) : '';
  const lastPart = showLast > 0 ? value.slice(-showLast) : '';
  const maskLen = Math.max(value.length - showFirst - showLast, 3);
  return firstPart + maskChar.repeat(maskLen) + lastPart;
}

/** Password masking: fully masked */
export function maskPassword(_password: string): string {
  return '******';
}

/** Token masking: shows only the first/last few characters */
export function maskToken(token: string): string {
  if (!token || token.length <= 8) return '***';
  return maskSensitive(token, { showFirst: 4, showLast: 4 });
}

/** Phone masking: 138****1234 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return '***';
  return maskSensitive(phone, { showFirst: 3, showLast: 4 });
}

/** Email masking: a***b@domain.com */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const maskedLocal =
    local.length <= 2 ? local[0] + '***' : local[0] + '***' + local[local.length - 1];
  return `${maskedLocal}@${domain}`;
}

// ==================== Utility functions ====================

/** Deep-freeze an object */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    Object.keys(obj).forEach((key) => {
      deepFreeze((obj as Record<string, unknown>)[key]);
    });
  }
  return obj;
}

/** Safe JSON parse */
export function safeJsonParse<T = unknown>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

/** Delayed promise */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Execute with retries */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < maxRetries) {
        await delay(delayMs * (i + 1));
      }
    }
  }
  throw lastError;
}

// ==================== Date utility functions ====================

/** Format a date as YYYY-MM-DD */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Format a date-time as YYYY-MM-DD HH:mm:ss */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const datePart = formatDate(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${datePart} ${hours}:${minutes}:${seconds}`;
}

/** Get the start of a day */
export function startOfDay(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get the end of a day */
export function endOfDay(date: Date | string): Date {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Get the first day of a month */
export function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

/** Get the last day of a month */
export function endOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0, 23, 59, 59, 999);
}

// ==================== Validation utility functions ====================

/** Validate an email address */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/** Validate a phone number (mainland China) */
export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^1[3-9]\d{9}$/;
  return phoneRegex.test(phone);
}

/** Validate an IP address */
export function isValidIp(ip: string): boolean {
  const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
  return ipv4Regex.test(ip);
}

// ==================== Crypto utility functions ====================

/** Create a hash (SHA-256) */
export function createHash256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Create an MD5 hash */
export function createHashMd5(data: string): string {
  return createHash('md5').update(data).digest('hex');
}

/** Generate a random token */
export function generateToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

// ==================== File path utilities ====================

/** Get a file's extension */
export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

/** Get a file's base name (without extension) */
export function getFileBasename(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.slice(0, idx) : filename;
}
