// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT_OFFLINE, REDIS_CLIENT_PURPOSE, RedisClientToken } from './redis.constants';

/**
 * Redis client factory
 *
 * Unifies the connection config of all Redis clients, ensuring:
 * - the same retryStrategy / maxRetriesPerRequest / enableReadyCheck
 * - db index decided by token (default 0, offline messages 1)
 * - returns null when REDIS_HOST is unset (consumers should receive via @Optional())
 *
 * Retry strategy:
 * - at most 5 retries, intervals increasing from 200ms to 2000ms
 * - disconnects after 5 failures, triggering the circuit breaker
 */
const logger = new Logger('RedisClientFactory');

export function createRedisClient(config: ConfigService, token: RedisClientToken): Redis | null {
  const host = config.get<string>('REDIS_HOST');
  if (!host) {
    logger.warn(`Redis client "${token}" disabled (REDIS_HOST not configured)`);
    return null;
  }

  const port = config.get<number>('REDIS_PORT') || 6379;
  const password = config.get<string>('REDIS_PASSWORD');
  // Decide db index by token: offline messages use db=1, others use db=0 (overridable by REDIS_DB)
  const defaultDb = token === REDIS_CLIENT_OFFLINE ? 1 : 0;
  const db = config.get<number>('REDIS_DB') ?? defaultDb;

  const client = new Redis({
    host,
    port,
    password: password || undefined,
    db,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      if (times > 5) {
        logger.error(`Redis client "${token}" exhausted 5 retries — giving up until reconnect`);
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  client.on('error', (err) => {
    logger.error(`Redis client "${token}" error: ${err.message}`);
  });

  logger.log(
    `Redis client "${token}" created (purpose=${REDIS_CLIENT_PURPOSE[token]}, host=${host}:${port}, db=${db})`,
  );

  return client;
}

/**
 * Gracefully close Redis connections on module destroy
 */
export async function closeRedisClient(client: Redis | null): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // Force disconnect when exit fails
    client.disconnect();
  }
}
