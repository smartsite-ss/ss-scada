// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Global, Module, OnModuleDestroy, Inject, Optional, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { closeRedisClient, createRedisClient } from './redis.client-factory';
import { REDIS_CLIENT_DEFAULT, REDIS_CLIENT_OFFLINE, RedisClientToken } from './redis.constants';
import { LatestValueRedisService } from './latest-value-redis.service';

/**
 * Redis module - globally shared Redis client Providers
 *
 * Design motivation:
 * DeviceModule and WebSocketModule previously each created their own ioredis instances via
 * useFactory (PERSIST_REDIS_CLIENT / OFFLINE_REDIS_CLIENT), which had these problems:
 * 1. Doubled connection count, wasteful resources
 * 2. Duplicated config code (retryStrategy / maxRetriesPerRequest etc.)
 * 3. On failure each client retried independently, impossible to observe uniformly
 *
 * After the rework:
 * - All Redis clients are created centrally in RedisModule, distinguished by token
 * - DeviceModule / WebSocketModule only need to import RedisModule
 * - One config change takes effect globally
 *
 * Global module (@Global): avoids every business module having to import RedisModule.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT_DEFAULT,
      useFactory: (config: ConfigService): Redis | null =>
        createRedisClient(config, REDIS_CLIENT_DEFAULT as RedisClientToken),
      inject: [ConfigService],
    },
    {
      provide: REDIS_CLIENT_OFFLINE,
      useFactory: (config: ConfigService): Redis | null =>
        createRedisClient(config, REDIS_CLIENT_OFFLINE as RedisClientToken),
      inject: [ConfigService],
    },
    LatestValueRedisService,
  ],
  exports: [REDIS_CLIENT_DEFAULT, REDIS_CLIENT_OFFLINE, LatestValueRedisService],
})
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(
    @Optional() @Inject(REDIS_CLIENT_DEFAULT) private readonly defaultClient: Redis | null,
    @Optional() @Inject(REDIS_CLIENT_OFFLINE) private readonly offlineClient: Redis | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing all Redis clients on module destroy');
    await Promise.all([closeRedisClient(this.defaultClient), closeRedisClient(this.offlineClient)]);
  }
}
