// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT_DEFAULT } from '../../../redis/redis.constants';
import { ScanState } from './wechat-auth.types';

/**
 * Scan-state storage service - Redis first + in-memory Map fallback
 *
 * Design motivation:
 * RedisModule is a @Global module, but REDIS_CLIENT_DEFAULT may be null
 * (see redis.client-factory.ts lines 21-25, returns null when Redis is not started).
 * To keep scan login working when Redis is unavailable, a dual-track approach is used:
 *   - Redis available: use SET EX for auto-expiry
 *   - Redis unavailable: in-memory Map + check expiresAt on get
 *
 * Key naming follows project conventions: ss: prefix + business domain + purpose, see ss:latest:{projectId}:{deviceId}
 */
const STATE_KEY_PREFIX = 'ss:wechat:scan:state:';
const STATE_TTL_SECONDS = 300; // 5 minutes (matches the WeChat QR code default validity)

@Injectable()
export class WechatStateService {
  private readonly logger = new Logger(WechatStateService.name);
  /** In-memory fallback storage (used when Redis unavailable) */
  private readonly memoryStore = new Map<string, ScanState>();

  constructor(
    @Optional() @Inject(REDIS_CLIENT_DEFAULT) private readonly redis: Redis | null,
  ) {
    if (this.redis) {
      this.logger.log('扫码 state 存储使用 Redis（持久化 + 自动过期）');
    } else {
      this.logger.warn('扫码 state 存储使用内存 Map（Redis 不可用，重启后 state 丢失）');
    }
  }

  /** Create scan-session status */
  async create(state: ScanState): Promise<void> {
    if (this.redis) {
      await this.redis.set(
        STATE_KEY_PREFIX + state.state,
        JSON.stringify(state),
        'EX',
        STATE_TTL_SECONDS,
      );
    } else {
      // Memory mode: expiresAt already set by caller, checked on get
      this.memoryStore.set(state.state, state);
    }
  }

  /** Query scan-session status (auto-delete on expiry and return null) */
  async get(state: string): Promise<ScanState | null> {
    if (this.redis) {
      const raw = await this.redis.get(STATE_KEY_PREFIX + state);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as ScanState;
        // Redis TTL auto-expires, but double-check expiresAt (guard against clock drift)
        if (Date.now() > parsed.expiresAt && parsed.status === 'pending') {
          await this.update(state, { status: 'expired' });
          parsed.status = 'expired';
        }
        return parsed;
      } catch {
        return null;
      }
    }

    const entry = this.memoryStore.get(state);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt && entry.status === 'pending') {
      entry.status = 'expired';
      this.memoryStore.set(state, entry);
    }
    return entry;
  }

  /** Update scan-session status (preserve original TTL) */
  async update(state: string, patch: Partial<ScanState>): Promise<ScanState | null> {
    const current = await this.get(state);
    if (!current) return null;
    const updated: ScanState = { ...current, ...patch };

    if (this.redis) {
      // Preserve remaining TTL (re-SET with the remaining time)
      const remainingTtl = await this.redis.ttl(STATE_KEY_PREFIX + state);
      const ttl = remainingTtl > 0 ? remainingTtl : STATE_TTL_SECONDS;
      await this.redis.set(
        STATE_KEY_PREFIX + state,
        JSON.stringify(updated),
        'EX',
        ttl,
      );
    } else {
      this.memoryStore.set(state, updated);
    }
    return updated;
  }

  /** Delete scan-session status (one-time consume after confirmed) */
  async delete(state: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(STATE_KEY_PREFIX + state);
    } else {
      this.memoryStore.delete(state);
    }
  }
}
