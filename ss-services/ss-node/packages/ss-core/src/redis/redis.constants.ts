// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Redis client injection-Token constants
 *
 * Design principles:
 * - Separate clients by purpose, for per-db isolation, independent monitoring, and independent circuit breaking
 * - All token strings are prefixed with REDIS_CLIENT_ to avoid clashing with business tokens
 * - Providers are registered centrally in RedisModule; business modules import it
 */

/**
 * Default Redis client (db=0)
 * Purpose: Pipeline latest-value writes (ss:latest:{projectId}:{deviceId})
 */
export const REDIS_CLIENT_DEFAULT = 'REDIS_CLIENT_DEFAULT';

/**
 * Offline-message Redis client (db=1)
 * Purpose: WebSocket offline-message cache
 */
export const REDIS_CLIENT_OFFLINE = 'REDIS_CLIENT_OFFLINE';

/**
 * Redis client purpose description (for log diagnostics)
 */
export const REDIS_CLIENT_PURPOSE = {
  [REDIS_CLIENT_DEFAULT]: 'latest-value',
  [REDIS_CLIENT_OFFLINE]: 'offline-message',
} as const;

export type RedisClientToken = typeof REDIS_CLIENT_DEFAULT | typeof REDIS_CLIENT_OFFLINE;
