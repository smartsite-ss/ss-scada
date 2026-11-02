// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import type { OfflineMessage } from './offline-message.service';

/**
 * OfflineMessage Redis persistence helper
 *
 * Serves as an optional persistence layer for OfflineMessageService, restoring offline messages after service restart.
 * Design principles:
 * - All methods async + try-catch; failures warn and do not block the main flow
 * - Degrades to pure in-memory mode when Redis is unavailable
 * - key format: ws:offline:msg:{userId} -> JSON string of OfflineMessage[]
 */
@Injectable()
export class OfflineMessageRedisPersistence implements OnModuleDestroy {
  private readonly logger = new Logger(OfflineMessageRedisPersistence.name);
  private readonly keyPrefix = 'ws:offline:msg:';

  constructor(private readonly client: Redis) {}

  private key(userId: string): string {
    return `${this.keyPrefix}${userId}`;
  }

  /**
   * Load all users' offline messages from Redis (called at service startup)
   * @returns a Map of userId -> OfflineMessage[]
   */
  async loadAllMessages(): Promise<Map<string, OfflineMessage[]>> {
    const result = new Map<string, OfflineMessage[]>();
    try {
      const keys = await this.scanKeys(`${this.keyPrefix}*`);
      if (keys.length === 0) {
        return result;
      }

      const values = await this.client.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        const userId = keys[i].substring(this.keyPrefix.length);
        const raw = values[i];
        if (raw) {
          try {
            const messages = JSON.parse(raw) as OfflineMessage[];
            if (Array.isArray(messages) && messages.length > 0) {
              result.set(userId, messages);
            }
          } catch {
            this.logger.warn(`Failed to parse messages for user ${userId}, skipping`);
          }
        }
      }

      this.logger.log(`Loaded ${result.size} users' offline messages from Redis`);
    } catch (err) {
      this.logger.warn(`Failed to load offline messages from Redis: ${(err as Error).message}`);
    }
    return result;
  }

  /**
   * Persist a user's offline-message list
   */
  async persistMessages(userId: string, messages: OfflineMessage[]): Promise<void> {
    try {
      if (messages.length === 0) {
        await this.client.del(this.key(userId));
        return;
      }
      await this.client.set(this.key(userId), JSON.stringify(messages));
    } catch (err) {
      this.logger.warn(`Failed to persist messages for user ${userId}: ${(err as Error).message}`);
    }
  }

  /**
   * Delete a user's offline messages
   */
  async deleteMessages(userId: string): Promise<void> {
    try {
      await this.client.del(this.key(userId));
    } catch (err) {
      this.logger.warn(`Failed to delete messages for user ${userId}: ${(err as Error).message}`);
    }
  }

  /**
   * Delete all offline messages (use with caution)
   */
  async deleteAllMessages(): Promise<void> {
    try {
      const keys = await this.scanKeys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
        this.logger.log(`Deleted ${keys.length} users' offline messages from Redis`);
      }
    } catch (err) {
      this.logger.warn(`Failed to delete all offline messages: ${(err as Error).message}`);
    }
  }

  /**
   * Scan matching keys with SCAN (avoiding KEYS blocking)
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const result: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      result.push(...batch);
    } while (cursor !== '0');
    return result;
  }

  onModuleDestroy(): void {
    this.client.quit().catch(() => {
      // Ignore close errors
    });
  }
}
