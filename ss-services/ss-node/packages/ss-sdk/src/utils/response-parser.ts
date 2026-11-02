// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ApiResponse, PaginatedResult } from '../types';

/**
 * Global cap for pagination pageSize (consistent with PaginationDto's @Max(100) validation).
 * Exceeding it triggers a 400 "must not be greater than 100".
 * All frontend list pages must reference this constant; hard-coded out-of-range values (e.g. 200) are forbidden.
 * See architecture design 07-API design spec §2.4 / §4.2.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Parses a response body wrapped by the ss-node TransformInterceptor.
 *
 * Wrapper structure: `{ code, data: <business body>, message, timestamp }`
 * Recognition signature: **both `timestamp` and `data` fields exist**.
 *
 * Unwrapping branches (see architecture design 07-API design spec §2.3):
 *   - has `pagination` field → returns the full `{ data, pagination }` (paginated API; caller reads `pagination.totalPages`)
 *   - no `pagination` → unwraps `data` (single object / flat pagination)
 *
 * Historical pitfall: the early implementation always did `return bodyRecord.data`, which unwrapped flat paginated
 * tag responses into `{ data:[...], total, page, pageSize }`; callers then read `pagination` and got `undefined` →
 * the thrown error was caught and misjudged as "load failed". The presence of the `pagination` field must be the branch criterion.
 *
 * Compatibility: parsing of legacy ApiResponse bodies containing a `success` field (early ss-data system) is kept; new code should not rely on it.
 */
export function parseBusinessResponse<T>(body: unknown): T {
  const bodyRecord = body as Record<string, unknown> | null;

  // Legacy ss-data ApiResponse (with a success field) — kept for compatibility; new code should not use it
  if (bodyRecord !== null && typeof bodyRecord === 'object' && 'success' in bodyRecord) {
    const wrapped = bodyRecord as unknown as { success: boolean; data: T; code: string; message: string };
    if (wrapped.success) {
      return wrapped.data;
    }
    // Under the legacy contract success=false is a business error, caught by the caller / upper-level error handling
    return body as T;
  }

  // ss-node TransformInterceptor wrapper ({code, data, message, timestamp}, no success)
  if (
    bodyRecord !== null &&
    typeof bodyRecord === 'object' &&
    'timestamp' in bodyRecord &&
    'data' in bodyRecord
  ) {
    // Paginated response with pagination: keep the full structure so callers can read pagination.totalPages
    if ('pagination' in bodyRecord) {
      return bodyRecord as unknown as T;
    }
    // Single object / flat pagination: unwrap data
    return (bodyRecord as { data: T }).data;
  }

  // Non-wrapped bodies (bare arrays, bare strings) are returned as-is
  return body as T;
}

/**
 * Type guard: determines whether a response body is an ss-node TransformInterceptor wrapper.
 */
export function isTransformWrapped(body: unknown): boolean {
  const rec = body as Record<string, unknown> | null;
  return (
    rec !== null &&
    typeof rec === 'object' &&
    'timestamp' in rec &&
    'data' in rec
  );
}

/**
 * Type guard: determines whether a response body is a pagination result (data array + pagination).
 */
export function isPaginatedResult<T>(body: unknown): body is PaginatedResult<T> {
  const rec = body as Record<string, unknown> | null;
  if (rec === null || typeof rec !== 'object') return false;
  return 'data' in rec && 'pagination' in rec;
}

/**
 * Extracts a pagination result from any response body (compatible with wrapped and unwrapped forms).
 * Used as a fallback on the frontend when multiple structural shapes still need to be supported after unwrapping.
 */
export function extractPaginated<T>(body: unknown): PaginatedResult<T> | null {
  if (isPaginatedResult<T>(body)) {
    return body;
  }
  if (isTransformWrapped(body)) {
    const inner = (body as { data: unknown }).data;
    if (isPaginatedResult<T>(inner)) {
      return inner;
    }
  }
  return null;
}

export type { ApiResponse };
