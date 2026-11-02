// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Cross-platform interface contract unwrap utilities (single source of truth)
 *
 * The backend uniformly wraps list endpoints via TransformInterceptor as:
 *   { code, data: { data: [...], pagination }, message, timestamp }
 * Some legacy/flat endpoints return an array or { data: [...] } directly.
 * This module provides a unified extraction entry point, eliminating duplicated
 * compatibility branches across frontends.
 */

/** Standard pagination structure (from TransformInterceptor) */
export interface StandardPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}

/** Standard wrapped response */
export interface StandardListEnvelope<T> {
  code?: number;
  message?: string;
  timestamp?: number;
  data?: T[] | { data: T[]; pagination?: StandardPagination };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Extracts the list array from a response.
 * Compatible with the following shapes:
 *   - Standard wrapper: { data: { data: [...], pagination } }
 *   - Half wrapper: { data: [...] }
 *   - Bare array: [...]
 *   - Object wrapped in data: { data: [...] }
 * Returns an empty array when nothing can be extracted; never throws.
 */
export function extractListData<T = any>(payload: unknown): T[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload as T[];

  if (!isPlainObject(payload)) return [];

  const data = (payload as Record<string, unknown>).data;

  // Standard wrapper: data is { data: [...], pagination }
  if (isPlainObject(data)) {
    const inner = (data as Record<string, unknown>).data;
    if (Array.isArray(inner)) return inner as T[];
  }

  // Half wrapper: data is directly an array
  if (Array.isArray(data)) return data as T[];

  return [];
}

/**
 * Extracts pagination info from a response (returns undefined when absent).
 */
export function extractPagination(
  payload: unknown,
): StandardPagination | undefined {
  if (!isPlainObject(payload)) return undefined;
  const data = (payload as Record<string, unknown>).data;
  if (isPlainObject(data)) {
    const pagination = (data as Record<string, unknown>).pagination;
    if (isPlainObject(pagination)) return pagination as unknown as StandardPagination;
  }
  return undefined;
}
