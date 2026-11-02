// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import { IPersistWriter, DataPoint, PersistWriterRegistry } from '@ss-node/ss-collector-sdk';
import { REDIS_CLIENT_DEFAULT, LatestValueRedisService } from '@ss-node/ss-core';

/**
 * Redis latest-value PersistWriter implementation
 *
 * Data flow:
 *   Pipeline DataPoint -> write()/writeBatch() -> Redis HSET overwrite
 *
 * Key design (v3 -- expresses the project->device->tag hierarchy):
 *   - Device Key: ss:latest:{projectId}:{deviceCode}  (Hash, field={tagId}, value=JSON full semantics)
 *   - Tree index: ss:latest:tree:{projectId}         (Hash, field={deviceId}, value=JSON{deviceCode,deviceName})
 *   - Value: JSON { projectId, deviceCode, deviceId, tagId, value, quality, timestamp }
 *   - TTL: 7-day rolling expiry (refreshed on each write); proactively DEL on project deletion
 *
 * v2 -> v3 changes:
 *   - Device Key uses deviceCode (human-readable) instead of deviceId (UUID), so the `project->device` hierarchy is obvious at a glance
 *   - The value JSON adds projectId / deviceCode / tagId, making a single value self-describing in the hierarchy
 *   - The tree index (Hash) replaces the flat Set (ss:latest:index:{projectId});
 *     HGETALL tree fetches all devices' {deviceCode, deviceName} in the project at once, and supports deviceId->deviceCode reverse lookup
 *
 * Design rationale (kept from v1 -> v2):
 *   - Solves the hot-key problem: large projects (1000+ tags) spread writes across N device Keys, avoiding single-key contention
 *   - Redis Cluster friendly: different devices' Keys auto-distribute across slots, supporting horizontal scaling
 *   - Device-level data lifecycle: one DEL removes a device; offline devices can have independent TTLs
 *
 * Overwrite semantics: HSET on the same key+field auto-overwrites the old value, naturally guaranteeing "the latest record".
 *
 * Fault-tolerance strategy (three layers of protection):
 * 1. When the Redis client is unavailable (REDIS_HOST unset), all methods are no-op
 * 2. Built-in circuit breaker: after N consecutive failures it goes OPEN; writes become no-op during that time, avoiding avalanche
 * 3. write/writeBatch errors are not thrown upward (keeping the Pipeline main flow uninterrupted),
 *    but the lastError field exposes the most recent error; PersistStep can query it and write into ctx.errors
 */
@Injectable()
export class RedisLatestValuePersistWriter implements IPersistWriter, OnModuleInit {
  readonly name = 'RedisLatestValue';
  private readonly logger = new Logger(RedisLatestValuePersistWriter.name);

  /** TTL of the latest-value key (7-day rolling refresh, preventing residue after project/device/tag deletion) */
  private static readonly KEY_TTL_SECONDS = 7 * 24 * 3600;

  /**
   * Simple circuit-breaker config
   * - consecutive failures >= FAILURE_THRESHOLD -> OPEN
   * - after OPEN persists for RESET_TIMEOUT_MS -> HALF_OPEN, allowing 1 probe
   * - probe success -> CLOSED; probe failure -> OPEN
   */
  private static readonly FAILURE_THRESHOLD = 5;
  private static readonly RESET_TIMEOUT_MS = 30_000;

  private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures = 0;
  private circuitOpenedAt = 0;

  /** The most recent error (for PersistStep to query and pass through to ctx.errors) */
  private lastError: { message: string; timestamp: number } | null = null;

  /** Per key (device Key or index Key) the last TTL-refresh time (avoiding EXPIRE on every write) */
  private readonly ttlRefreshedAt = new Map<string, number>();
  /** TTL-refresh throttle interval (the same key refreshes at most once per 5 minutes) */
  private static readonly TTL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT_DEFAULT)
    private readonly redisClient: Redis | null,
    private readonly writerRegistry: PersistWriterRegistry,
    private readonly latestValueRedisService: LatestValueRedisService,
  ) {}

  onModuleInit(): void {
    this.writerRegistry.register(this);
    this.logger.log(
      `RedisLatestValuePersistWriter registered (redis=${this.redisClient ? 'enabled' : 'disabled'})`,
    );
  }

  /** Exposed for PersistStep to query, for passing Redis errors through to ctx.errors */
  getLastError(): { message: string; timestamp: number } | null {
    return this.lastError;
  }

  /** Exposes the circuit-breaker state for monitoring/diagnostics */
  getCircuitState(): typeof this.circuitState {
    return this.circuitState;
  }

  private get enabled(): boolean {
    return this.redisClient !== null;
  }

  /** Decide whether the circuit breaker allows passage (HALF_OPEN allows only one probe) */
  private allowRequest(): boolean {
    if (this.circuitState === 'CLOSED') return true;
    if (this.circuitState === 'OPEN') {
      const elapsed = Date.now() - this.circuitOpenedAt;
      if (elapsed >= RedisLatestValuePersistWriter.RESET_TIMEOUT_MS) {
        this.circuitState = 'HALF_OPEN';
        this.logger.warn('Redis circuit → HALF_OPEN (probing)');
        return true;
      }
      return false;
    }
    // HALF_OPEN: one probe already allowed, awaiting its result; reject other requests
    return false;
  }

  private recordSuccess(): void {
    if (this.circuitState !== 'CLOSED') {
      this.logger.log('Redis circuit → CLOSED (recovered)');
    }
    this.circuitState = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastError = null;
  }

  private recordFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown';
    this.consecutiveFailures += 1;
    this.lastError = { message, timestamp: Date.now() };

    if (this.circuitState === 'HALF_OPEN') {
      this.openCircuit();
      return;
    }
    if (
      this.circuitState === 'CLOSED' &&
      this.consecutiveFailures >= RedisLatestValuePersistWriter.FAILURE_THRESHOLD
    ) {
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.circuitState = 'OPEN';
    this.circuitOpenedAt = Date.now();
    this.logger.error(
      `Redis circuit → OPEN (failures=${this.consecutiveFailures}, reset in ${RedisLatestValuePersistWriter.RESET_TIMEOUT_MS}ms)`,
    );
  }

  /**
   * Refresh a key's TTL (throttled: the same key refreshes at most once per 5 minutes)
   * Runs asynchronously after a successful HSET / SADD, not blocking the main flow
   *
   * Fault tolerance: EXPIRE failure (including clients without the expire method) does not affect the main write;
   * both sync exceptions and async rejections are caught.
   */
  private refreshTTL(rawKey: string): void {
    const now = Date.now();
    const last = this.ttlRefreshedAt.get(rawKey) ?? 0;
    if (now - last < RedisLatestValuePersistWriter.TTL_REFRESH_INTERVAL_MS) return;

    const client = this.redisClient;
    if (!client || typeof client.expire !== 'function') return;

    this.ttlRefreshedAt.set(rawKey, now);
    try {
      const result = client.expire(rawKey, RedisLatestValuePersistWriter.KEY_TTL_SECONDS);
      // Compatible with Promise and non-Promise return values (expire returns Promise<number>)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch((err: Error) => {
          // TTL-refresh failure does not affect the main write; debug log only
          this.logger.debug(`Redis EXPIRE failed for ${rawKey}: ${err.message}`);
        });
      }
    } catch (syncErr) {
      // Sync exceptions are caught too, avoiding impact on the write() main flow
      this.logger.debug(
        `Redis EXPIRE sync error for ${rawKey}: ${syncErr instanceof Error ? syncErr.message : 'Unknown'}`,
      );
    }
  }

  async write(point: DataPoint): Promise<void> {
    if (!this.enabled) return;
    if (!this.allowRequest()) return;

    // Fall back to deviceId when deviceCode is missing (legacy code-path / test-mock compatibility)
    const deviceCode = point.deviceCode || point.deviceId;
    const dKey = this.latestValueRedisService.deviceKey(point.projectId, deviceCode);
    const tKey = this.latestValueRedisService.treeKey(point.projectId);

    try {
      await this.redisClient!.hset(
        dKey,
        point.tagId,
        this.latestValueRedisService.serialize(
          point.projectId,
          deviceCode,
          point.deviceId,
          point.tagId,
          point.value,
          point.quality,
          point.timestamp,
        ),
      );
      // Update the tree index: deviceId -> {deviceCode, deviceName} (fire-and-forget, non-critical path)
      this.redisClient!.hset(
        tKey,
        point.deviceId,
        JSON.stringify({ deviceCode, deviceName: point.deviceName ?? '' }),
      ).catch(() => {});
      this.recordSuccess();
      this.refreshTTL(dKey);
      this.refreshTTL(tKey);
    } catch (error) {
      this.recordFailure(error);
      this.logger.error(
        `Redis latest value write failed (tag=${point.tagId}, device=${point.deviceId}): ${this.lastError!.message}`,
      );
      // Fault-tolerance strategy: errors are not thrown upward (keeping the Pipeline main flow uninterrupted),
      // the lastError field exposes the most recent error; PersistStep can query it and write into ctx.errors
    }
  }

  async writeBatch(points: DataPoint[]): Promise<void> {
    if (!this.enabled) return;
    if (points.length === 0) return;
    if (!this.allowRequest()) return;

    // Collect keys needing TTL refresh
    const keysToRefresh = new Set<string>();
    // Collect tree-index entries: projectId -> Map<deviceId, {deviceCode, deviceName}> (deduped)
    const treeEntries = new Map<string, Map<string, { deviceCode: string; deviceName: string }>>();

    try {
      const pipeline = this.redisClient!.pipeline();
      for (const point of points) {
        // Fall back to deviceId when deviceCode is missing (legacy code-path / test-mock compatibility)
        const deviceCode = point.deviceCode || point.deviceId;
        const dKey = this.latestValueRedisService.deviceKey(point.projectId, deviceCode);
        pipeline.hset(
          dKey,
          point.tagId,
          this.latestValueRedisService.serialize(
            point.projectId,
            deviceCode,
            point.deviceId,
            point.tagId,
            point.value,
            point.quality,
            point.timestamp,
          ),
        );
        keysToRefresh.add(dKey);

        // Collect tree-index entries (deduped by projectId + deviceId)
        if (!treeEntries.has(point.projectId)) {
          treeEntries.set(point.projectId, new Map());
        }
        treeEntries.get(point.projectId)!.set(point.deviceId, {
          deviceCode,
          deviceName: point.deviceName ?? '',
        });
      }
      // Update each project's tree index: HSET treeKey deviceId -> {deviceCode, deviceName}
      for (const [projectId, deviceMap] of treeEntries) {
        const tKey = this.latestValueRedisService.treeKey(projectId);
        for (const [deviceId, info] of deviceMap) {
          pipeline.hset(tKey, deviceId, JSON.stringify(info));
        }
        keysToRefresh.add(tKey);
      }
      await pipeline.exec();
      this.recordSuccess();
      for (const key of keysToRefresh) {
        this.refreshTTL(key);
      }
    } catch (error) {
      this.recordFailure(error);
      this.logger.error(
        `Redis batch write failed (${points.length} points): ${this.lastError!.message}`,
      );
      // On batch failure, degrade to per-record writes (only while the circuit breaker still allows)
      // Per-record write errors are recorded by write()'s internal recordFailure, not re-thrown
      if (this.allowRequest()) {
        for (const point of points) {
          try {
            await this.write(point);
          } catch {
            // Per-record failures are already handled inside write()
          }
        }
      }
      // Fault-tolerance strategy: errors are not thrown upward (keeping the Pipeline main flow uninterrupted),
      // the lastError field exposes the most recent error; PersistStep can query it and write into ctx.errors
    }
  }

  async flush(): Promise<void> {
    // Redis writes immediately on each write(); no batch flushing needed
  }

  /**
   * Listen for the project before-delete event and proactively clean the Redis latest-value data
   *
   * Cleanup strategy (v3 -- tree index):
   * 1. Get all devices' deviceCodes in the project from the tree index (Hash `ss:latest:tree:{projectId}`)
   * 2. Batch-delete all device Keys (`ss:latest:{projectId}:{deviceCode}`) + the tree-index Key
   * 3. Clean up TTL-refresh records
   *
   * Event payload: { projectId, tenantId?, timestamp } (tenantId is multi-tenant reserved, currently = projectId)
   */
  @OnEvent('project.beforeDelete')
  async handleProjectBeforeDelete(payload: {
    projectId: string;
    tenantId?: string;
    timestamp: number;
  }): Promise<void> {
    if (!this.enabled) return;
    const projectId = payload?.projectId || payload?.tenantId;
    if (!projectId) return;

    const tKey = this.latestValueRedisService.treeKey(projectId);
    try {
      // 1. Read the tree index: deviceId -> {deviceCode, deviceName}
      const tree = await this.latestValueRedisService.readTree(projectId);

      // 2. Build all keys to delete (device Keys + the tree-index Key)
      const keysToDelete: string[] = [];
      for (const { deviceCode } of tree.values()) {
        keysToDelete.push(this.latestValueRedisService.deviceKey(projectId, deviceCode));
      }
      keysToDelete.push(tKey); // the tree index key itself

      // 3. Batch delete
      if (keysToDelete.length > 0) {
        await this.redisClient!.del(...keysToDelete);
      }

      // 4. Clean up TTL-refresh records
      for (const key of keysToDelete) {
        this.ttlRefreshedAt.delete(key);
      }

      this.logger.log(
        `Redis latest values cleared for project ${projectId} (${tree.size} device keys + tree index)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`Failed to clear Redis latest values for project ${projectId}: ${message}`);
    }
  }
}
