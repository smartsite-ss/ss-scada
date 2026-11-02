// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

/** Offline cached-message format */
export interface CachedMessage {
  event: string;
  data: unknown;
  timestamp: number;
}

/** Cache statistics */
export interface CacheStats {
  totalClients: number;
  totalMessages: number;
}

/**
 * WebSocket offline-message cache service
 *
 * Uses an in-memory Map + ring buffer to cache offline messages per client.
 * After reconnection, pending messages are auto-replayed; messages older than 5 minutes are auto-cleared.
 *
 * - Each client caches at most 100 messages; the oldest are dropped when exceeded
 * - Expiry: messages older than 5 minutes are auto-cleared
 * - Cache is in-memory only, suitable for single-instance deployments
 */
@Injectable()
export class OfflineMessageCacheService implements OnModuleInit, OnModuleDestroy {
  /** Max cached messages per client */
  private static readonly MAX_MESSAGES_PER_CLIENT = 100;

  /** Message expiry (ms), default 5 minutes */
  private static readonly MESSAGE_TTL_MS = 5 * 60 * 1000;

  /** Auto-cleanup interval (ms), default 1 minute */
  private static readonly CLEANUP_INTERVAL_MS = 60 * 1000;

  private static readonly LOG_CONTEXT = 'OfflineMessageCacheService';

  /** Message cache: clientId -> CachedMessage[] */
  private readonly cache = new Map<string, CachedMessage[]>();

  /** Set of registered clients (clients that have ever connected) */
  private readonly registeredClients = new Set<string>();

  /** Expired-message cleanup timer */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private readonly logger = new Logger(OfflineMessageCacheService.name);

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredMessages(),
      OfflineMessageCacheService.CLEANUP_INTERVAL_MS,
    );
    this.logger.log(
      `OfflineMessageCacheService initialized (max:${OfflineMessageCacheService.MAX_MESSAGES_PER_CLIENT}/client, ttl:${OfflineMessageCacheService.MESSAGE_TTL_MS / 1000}s)`,
      OfflineMessageCacheService.LOG_CONTEXT,
    );
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Register a client (marks it known, for offline-message cache tracking)
   * @param clientId client identifier (usually the authenticated user's userId)
   */
  registerClient(clientId: string): void {
    this.registeredClients.add(clientId);
  }

  /**
   * Unregister a client (also clears the cache)
   * @param clientId client identifier
   */
  unregisterClient(clientId: string): void {
    this.registeredClients.delete(clientId);
    this.cache.delete(clientId);
  }

  /**
   * Cache an offline message
   * @param clientId client identifier
   * @param event event name
   * @param data message data
   */
  cacheMessage(clientId: string, event: string, data: unknown): void {
    if (!this.cache.has(clientId)) {
      this.cache.set(clientId, []);
    }

    const messages = this.cache.get(clientId)!;
    messages.push({ event, data, timestamp: Date.now() });

    // Ring buffer: drop the oldest messages when over the cap
    if (messages.length > OfflineMessageCacheService.MAX_MESSAGES_PER_CLIENT) {
      const removedCount = messages.length - OfflineMessageCacheService.MAX_MESSAGES_PER_CLIENT;
      messages.splice(0, removedCount);
      this.logger.warn(
        `Message cache overflow for client ${clientId}, removed ${removedCount} oldest messages`,
        OfflineMessageCacheService.LOG_CONTEXT,
      );
    }

    // Register the client synchronously
    this.registeredClients.add(clientId);

    this.logger.debug(
      `Message cached for client ${clientId}: event=${event}`,
      OfflineMessageCacheService.LOG_CONTEXT,
    );
  }

  /**
   * Get a client's pending replay messages (expired ones filtered automatically)
   * @param clientId client identifier
   * @returns the list of unexpired pending messages
   */
  getPendingMessages(clientId: string): CachedMessage[] {
    const messages = this.cache.get(clientId);
    if (!messages || messages.length === 0) {
      return [];
    }

    const now = Date.now();
    const valid = messages.filter(
      (m) => now - m.timestamp < OfflineMessageCacheService.MESSAGE_TTL_MS,
    );

    // If expired messages were filtered, update the cache
    if (valid.length < messages.length) {
      this.cache.set(clientId, valid);
    }

    return valid;
  }

  /**
   * Clear all of a client's cached messages (keeps the client's registration)
   * @param clientId client identifier
   */
  clearMessages(clientId: string): void {
    this.cache.set(clientId, []);
    this.logger.debug(
      `Messages cleared for client ${clientId}`,
      OfflineMessageCacheService.LOG_CONTEXT,
    );
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    let totalMessages = 0;
    this.cache.forEach((messages) => {
      totalMessages += messages.length;
    });

    return {
      totalClients: this.cache.size,
      totalMessages,
    };
  }

  /**
   * Get the offline client list (registered but currently offline)
   * @param onlineIds set of currently online client identifiers
   * @returns the list of offline client identifiers
   */
  getOfflineClientIds(onlineIds: Set<string>): string[] {
    const offline: string[] = [];
    this.registeredClients.forEach((clientId) => {
      if (!onlineIds.has(clientId)) {
        offline.push(clientId);
      }
    });
    return offline;
  }

  /**
   * Clean up all clients' expired messages
   * @returns the total number of cleaned messages
   */
  private cleanupExpiredMessages(): number {
    const now = Date.now();
    let totalCleaned = 0;

    this.cache.forEach((messages, clientId) => {
      const before = messages.length;
      const remaining = messages.filter(
        (m) => now - m.timestamp < OfflineMessageCacheService.MESSAGE_TTL_MS,
      );

      if (remaining.length < before) {
        this.cache.set(clientId, remaining);
        totalCleaned += before - remaining.length;
      }

      // If the client is unregistered and has no messages, clean up the cache entry
      if (remaining.length === 0 && !this.registeredClients.has(clientId)) {
        this.cache.delete(clientId);
      }
    });

    if (totalCleaned > 0) {
      this.logger.log(
        `Cleaned ${totalCleaned} expired offline cache messages`,
        OfflineMessageCacheService.LOG_CONTEXT,
      );
    }

    return totalCleaned;
  }
}
