// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT_DEFAULT } from './redis.constants';

/**
 * Latest-value entry (semantic structure after deserialization)
 *
 * Returned by LatestValueRedisService.deserialize for readers such as DeviceDataService /
 * AlarmReconciliationService. Carries the full hierarchy info
 * (projectId -> deviceCode -> deviceId -> tagId), eliminating coupling to the Redis value's
 * raw JSON field naming (legacy {v,d,q,t} / P0 {value,deviceId,quality,timestamp}).
 */
export interface LatestValueEntry {
  projectId: string;
  deviceCode: string;
  deviceId: string;
  tagId: string;
  value: number | boolean | string | null;
  quality: string;
  timestamp: Date;
}

/**
 * LatestValueRedisService -- Redis read/write wrapper for real-time latest values (shared service)
 *
 * ## Key hierarchy (v3 -- expresses the project->device->tag hierarchy)
 *
 * ```
 * ss:latest:{projectId}:{deviceCode}    Hash  field=tagId, value=JSON(full semantics)
 * ss:latest:tree:{projectId}            Hash  field=deviceId, value=JSON{deviceCode,deviceName}
 * ```
 *
 * - The device Key uses **deviceCode** (human-readable code) rather than deviceId (UUID),
 *   so the `project -> device` hierarchy is obvious at a glance (e.g. `ss:latest:proj-1:pump-station-01`).
 * - The Hash field is **tagId**, representing the `device -> tag` hierarchy.
 * - The value JSON contains the full path **projectId / deviceCode / deviceId / tagId**,
 *   so a single value can locate its position in the hierarchy (self-describing).
 * - The tree index replaces the old flat Set (`ss:latest:index:{projectId}`);
 *   HGETALL tree fetches all devices' {deviceCode, deviceName} in the project at once,
 *   and also provides deviceId->deviceCode reverse lookup (for readers holding deviceId, such as alarm reconciliation).
 *
 * ## Responsibilities NOT included (implemented by each consumer)
 * - Circuit breaker, TTL throttling, index cleanup, and other fault-tolerance logic (handled by RedisLatestValuePersistWriter)
 * - High-frequency batch writes from the collection Pipeline (handled by RedisLatestValuePersistWriter.writeBatch)
 *
 * ## Fault tolerance
 * - When the Redis client is unavailable (REDIS_HOST unset), all methods are no-op / return empty results
 * - deserialize returns null for corrupted or unrecognized JSON without throwing
 *
 * ## Backward compatibility
 * - deserialize is compatible with three value formats:
 *   1. v3 (this version): { projectId, deviceCode, deviceId, tagId, value, quality, timestamp }
 *   2. P0: { value, deviceId, quality, timestamp }
 *   3. Legacy: { v, d, q, t }
 *   After the 7-day TTL expires naturally, everything is the new format.
 * - When reading, projectId/deviceCode/tagId are backfilled from key/field context,
 *   so even legacy-format values return a complete LatestValueEntry.
 */
@Injectable()
export class LatestValueRedisService {
  private readonly logger = new Logger(LatestValueRedisService.name);

  private readonly keyPrefix = 'ss:latest:';
  private readonly treePrefix = 'ss:latest:tree:';

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT_DEFAULT)
    private readonly redisClient: Redis | null,
  ) {}

  /** Whether the Redis client is available (for consumers to decide whether to degrade) */
  get enabled(): boolean {
    return this.redisClient !== null;
  }

  // ──────────── Key construction ────────────

  /**
   * Device Key: ss:latest:{projectId}:{deviceCode} (Hash, field=tagId, value=JSON)
   *
   * Uses deviceCode (human-readable code) rather than deviceId (UUID),
   * expressing the `project -> device` hierarchy so the owning device is recognizable at a glance.
   */
  deviceKey(projectId: string, deviceCode: string): string {
    return `${this.keyPrefix}${projectId}:${deviceCode}`;
  }

  /**
   * Tree-index Key: ss:latest:tree:{projectId} (Hash, field=deviceId, value=JSON{deviceCode,deviceName})
   *
   * Replaces the old flat Set (ss:latest:index:{projectId}).
   * - HGETALL tree -> fetch all devices' {deviceCode, deviceName} in the project at once (full hierarchy view)
   * - HGET tree {deviceId} -> reverse-lookup deviceCode (for readers holding deviceId)
   */
  treeKey(projectId: string): string {
    return `${this.treePrefix}${projectId}`;
  }

  // ──────────── Serialization ────────────

  /**
   * Serialize to a Redis value (full-semantics fields, carrying the full hierarchy path)
   *
   * Write format: { projectId, deviceCode, deviceId, tagId, value, quality, timestamp(ISO) }
   * A single value self-describes its position in the `project->device->tag` hierarchy.
   */
  serialize(
    projectId: string,
    deviceCode: string,
    deviceId: string,
    tagId: string,
    value: number | boolean | string | null,
    quality: string,
    timestamp: Date | string,
  ): string {
    return JSON.stringify({
      projectId,
      deviceCode,
      deviceId,
      tagId,
      value,
      quality,
      timestamp: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
    });
  }

  /**
   * Deserialize a Redis value (compatible with three formats)
   *
   * - v3 (this version): { projectId, deviceCode, deviceId, tagId, value, quality, timestamp }
   * - P0: { value, deviceId, quality, timestamp }
   * - Legacy: { v, d, q, t }
   *
   * Note: legacy values may lack projectId/deviceCode/tagId;
   * callers (readTag/readDevice etc.) backfill these fields from key/field context.
   */
  deserialize(raw: string | null | undefined): Partial<LatestValueEntry> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      // v3 format takes priority (full-semantics fields + hierarchy path)
      if (parsed.value !== undefined) {
        return {
          projectId: parsed.projectId ?? '',
          deviceCode: parsed.deviceCode ?? '',
          deviceId: parsed.deviceId ?? '',
          tagId: parsed.tagId ?? '',
          value: parsed.value,
          quality: parsed.quality ?? 'unknown',
          timestamp: new Date(parsed.timestamp),
        };
      }

      // Legacy-format compatibility (abbreviated fields {v,d,q,t})
      if (parsed.v !== undefined) {
        return {
          projectId: '',
          deviceCode: '',
          deviceId: parsed.d ?? '',
          tagId: '',
          value: parsed.v,
          quality: parsed.q ?? 'unknown',
          timestamp: new Date(parsed.t),
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  // ──────────── Writes (manual write path) ────────────

  /**
   * Write a single tag's latest value (used by DeviceDataService.updateLatestValue)
   *
   * Operations:
   * 1. HSET device Key (ss:latest:{projectId}:{deviceCode}) field=tagId
   * 2. HSET tree index (ss:latest:tree:{projectId}) field=deviceId -> {deviceCode, deviceName}
   *
   * Note: no circuit breaker/TTL throttling (handled by the collection write side, RedisLatestValuePersistWriter);
   * the manual write path throws directly on failure for the caller to handle.
   */
  async write(params: {
    projectId: string;
    deviceCode: string;
    deviceId: string;
    tagId: string;
    value: number | boolean | string | null;
    quality: string;
    timestamp: Date | string;
    deviceName?: string;
  }): Promise<void> {
    if (!this.redisClient) return;
    const { projectId, deviceCode, deviceId, tagId, value, quality, timestamp, deviceName } =
      params;
    const dKey = this.deviceKey(projectId, deviceCode);
    const tKey = this.treeKey(projectId);
    const serialized = this.serialize(
      projectId,
      deviceCode,
      deviceId,
      tagId,
      value,
      quality,
      timestamp,
    );
    await this.redisClient.hset(dKey, tagId, serialized);
    // Update the tree index: deviceId -> {deviceCode, deviceName} (fire-and-forget; failure does not affect the main write)
    this.redisClient
      .hset(tKey, deviceId, JSON.stringify({ deviceCode, deviceName: deviceName ?? '' }))
      .catch((err: Error) => {
        this.logger.debug(`tree HSET failed for ${tKey}/${deviceId}: ${err.message}`);
      });
  }

  // ──────────── Reads (by deviceCode, direct path) ────────────

  /** Read a single tag's latest value (HGET, located directly by deviceCode) */
  async readTag(
    projectId: string,
    deviceCode: string,
    tagId: string,
  ): Promise<LatestValueEntry | null> {
    if (!this.redisClient) return null;
    const raw = await this.redisClient.hget(this.deviceKey(projectId, deviceCode), tagId);
    const entry = this.deserialize(raw);
    if (!entry) return null;
    // Backfill possibly missing hierarchy fields from key/field context (compatible with legacy values)
    return {
      projectId: entry.projectId || projectId,
      deviceCode: entry.deviceCode || deviceCode,
      deviceId: entry.deviceId,
      tagId: entry.tagId || tagId,
      value: entry.value!,
      quality: entry.quality!,
      timestamp: entry.timestamp!,
    };
  }

  /** Read all tags' latest values for one device (HGETALL, located directly by deviceCode) */
  async readDevice(
    projectId: string,
    deviceCode: string,
  ): Promise<Record<string, LatestValueEntry>> {
    const result: Record<string, LatestValueEntry> = {};
    if (!this.redisClient) return result;
    const rawHash = await this.redisClient.hgetall(this.deviceKey(projectId, deviceCode));
    if (rawHash && typeof rawHash === 'object') {
      for (const [tagId, raw] of Object.entries(rawHash)) {
        const entry = this.deserialize(raw);
        if (entry) {
          result[tagId] = {
            projectId: entry.projectId || projectId,
            deviceCode: entry.deviceCode || deviceCode,
            deviceId: entry.deviceId,
            tagId: entry.tagId || tagId,
            value: entry.value!,
            quality: entry.quality!,
            timestamp: entry.timestamp!,
          };
        }
      }
    }
    return result;
  }

  /**
   * Batch-read all tags' latest values for multiple devices (pipeline HGETALL, located directly by deviceCode)
   */
  async readDevices(
    projectId: string,
    deviceCodes: string[],
  ): Promise<Map<string, Record<string, LatestValueEntry>>> {
    const result = new Map<string, Record<string, LatestValueEntry>>();
    if (!this.redisClient || deviceCodes.length === 0) return result;

    const pipeline = this.redisClient.pipeline();
    for (const deviceCode of deviceCodes) {
      pipeline.hgetall(this.deviceKey(projectId, deviceCode));
    }
    const responses = await pipeline.exec();
    if (!responses) return result;

    for (let i = 0; i < deviceCodes.length; i++) {
      const deviceCode = deviceCodes[i];
      const [error, rawHash] = responses[i];
      const entries: Record<string, LatestValueEntry> = {};
      if (error) {
        this.logger.debug(
          `readDevices HGETALL failed for ${projectId}/${deviceCode}: ${error.message}`,
        );
      } else if (rawHash && typeof rawHash === 'object') {
        for (const [tagId, raw] of Object.entries(rawHash as Record<string, string>)) {
          const entry = this.deserialize(raw);
          if (entry) {
            entries[tagId] = {
              projectId: entry.projectId || projectId,
              deviceCode: entry.deviceCode || deviceCode,
              deviceId: entry.deviceId,
              tagId: entry.tagId || tagId,
              value: entry.value!,
              quality: entry.quality!,
              timestamp: entry.timestamp!,
            };
          }
        }
      }
      result.set(deviceCode, entries);
    }
    return result;
  }

  // ──────────── Reads (by deviceId, via tree-index reverse lookup of deviceCode) ────────────

  /**
   * Read the tree index: deviceId -> {deviceCode, deviceName}
   *
   * Lets readers holding deviceId (e.g. alarm reconciliation) batch reverse-lookup deviceCode,
   * avoiding per-record HGET on the tree index.
   */
  async readTree(
    projectId: string,
  ): Promise<Map<string, { deviceCode: string; deviceName: string }>> {
    const result = new Map<string, { deviceCode: string; deviceName: string }>();
    if (!this.redisClient) return result;
    const rawHash = await this.redisClient.hgetall(this.treeKey(projectId));
    if (rawHash && typeof rawHash === 'object') {
      for (const [deviceId, raw] of Object.entries(rawHash)) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.deviceCode) {
            result.set(deviceId, {
              deviceCode: parsed.deviceCode,
              deviceName: parsed.deviceName ?? '',
            });
          }
        } catch {
          // Skip corrupted tree entries
        }
      }
    }
    return result;
  }

  /**
   * Read a single tag's latest value by deviceId (via tree-index reverse lookup of deviceCode)
   *
   * For readers holding deviceId (e.g. alarm reconciliation). Internally first HGET tree for deviceCode,
   * then HGET the device Key. Acceptable 2 round-trips for low-frequency scenarios (5-minute reconciliation).
   */
  async readTagByDeviceId(
    projectId: string,
    deviceId: string,
    tagId: string,
  ): Promise<LatestValueEntry | null> {
    if (!this.redisClient) return null;
    // 1. Tree-index reverse lookup of deviceCode
    const rawTreeEntry = await this.redisClient.hget(this.treeKey(projectId), deviceId);
    if (!rawTreeEntry) return null;
    let deviceCode: string;
    try {
      const parsed = JSON.parse(rawTreeEntry);
      deviceCode = parsed?.deviceCode;
    } catch {
      return null;
    }
    if (!deviceCode) return null;
    // 2. Read the latest value by deviceCode
    return this.readTag(projectId, deviceCode, tagId);
  }

  // ──────────── Reads (whole project) ────────────

  /**
   * Read all devices' all tags' latest values in a project
   *
   * Flow: HGETALL tree -> extract the deviceCode list -> pipeline HGETALL in batches
   * Returns Map<deviceId, Record<tagId, LatestValueEntry>> (keyed by deviceId so callers can match device entities)
   */
  async readAll(projectId: string): Promise<Map<string, Record<string, LatestValueEntry>>> {
    const result = new Map<string, Record<string, LatestValueEntry>>();
    if (!this.redisClient) return result;

    // 1. Read the tree index: deviceId -> {deviceCode, deviceName}
    const tree = await this.readTree(projectId);
    if (tree.size === 0) return result;

    // 2. pipeline HGETALL all device Keys (by deviceCode)
    const deviceIds = [...tree.keys()];
    const deviceCodes = [...tree.values()].map((v) => v.deviceCode);
    const pipeline = this.redisClient.pipeline();
    for (const deviceCode of deviceCodes) {
      pipeline.hgetall(this.deviceKey(projectId, deviceCode));
    }
    const responses = await pipeline.exec();
    if (!responses) return result;

    // 3. Assemble the result (keyed by deviceId, for callers to match by device.id)
    for (let i = 0; i < deviceIds.length; i++) {
      const deviceId = deviceIds[i];
      const deviceCode = deviceCodes[i];
      const [error, rawHash] = responses[i];
      const entries: Record<string, LatestValueEntry> = {};
      if (error) {
        this.logger.debug(
          `readAll HGETALL failed for ${projectId}/${deviceCode}: ${error.message}`,
        );
      } else if (rawHash && typeof rawHash === 'object') {
        for (const [tagId, raw] of Object.entries(rawHash as Record<string, string>)) {
          const entry = this.deserialize(raw);
          if (entry) {
            entries[tagId] = {
              projectId: entry.projectId || projectId,
              deviceCode: entry.deviceCode || deviceCode,
              deviceId: entry.deviceId || deviceId,
              tagId: entry.tagId || tagId,
              value: entry.value!,
              quality: entry.quality!,
              timestamp: entry.timestamp!,
            };
          }
        }
      }
      result.set(deviceId, entries);
    }
    return result;
  }
}
