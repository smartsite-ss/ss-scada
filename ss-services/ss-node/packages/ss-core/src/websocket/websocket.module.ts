// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { ScadaWebSocketGateway } from './websocket.gateway';
import { DataPushBridge } from './data-push-bridge';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventBusModule } from '../event-bus/event-bus.module';
import { ConnectionLimiterService } from './connection-limiter.service';
import { RoomService } from './room/room.service';
import { ConnectionMonitorService } from './connection-monitor.service';
import { OfflineMessageService } from './offline-message.service';
import { OfflineMessageCacheService } from './offline-message-cache.service';
import { OfflineMessageRedisPersistence } from './offline-message-redis.persistence';
import { WebSocketMetricsService } from './websocket-metrics.service';
import { WebSocketMetricsController } from './websocket-metrics.controller';
import { WebSocketAdminController } from './websocket-admin.controller';
import { REDIS_CLIENT_OFFLINE } from '../redis/redis.constants';

/**
 * WebSocket module
 *
 * Redis-client rework (P1-1):
 * The module previously created OFFLINE_REDIS_CLIENT via useFactory; now it uses the REDIS_CLIENT_OFFLINE token
 * (db=1) provided by the global RedisModule. RedisModule is registered as @Global in AppModule,
 * so no imports are needed here.
 *
 * Offline-message Redis persistence is optional: when REDIS_HOST is unset the client is null,
 * OfflineMessageRedisPersistence is also null, and OfflineMessageService must tolerate this.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || 'ss-data-secret-key',
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
    EventBusModule,
  ],
  providers: [
    ScadaWebSocketGateway,
    DataPushBridge,
    ConnectionLimiterService,
    RoomService,
    ConnectionMonitorService,
    OfflineMessageService,
    OfflineMessageCacheService,
    WebSocketMetricsService,
    // Offline-message persistence: depends on the global REDIS_CLIENT_OFFLINE (provided by RedisModule)
    {
      provide: OfflineMessageRedisPersistence,
      useFactory: (client: Redis | null): OfflineMessageRedisPersistence | null => {
        if (!client) return null;
        return new OfflineMessageRedisPersistence(client);
      },
      inject: [REDIS_CLIENT_OFFLINE],
    },
  ],
  controllers: [WebSocketMetricsController, WebSocketAdminController],
  exports: [
    ScadaWebSocketGateway,
    DataPushBridge,
    ConnectionLimiterService,
    RoomService,
    ConnectionMonitorService,
    OfflineMessageService,
    OfflineMessageCacheService,
    WebSocketMetricsService,
    OfflineMessageRedisPersistence,
  ],
})
export class WebSocketModule {}
