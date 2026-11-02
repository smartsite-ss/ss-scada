// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { LatestValueRedisService, type LatestValueEntry } from '@ss-node/ss-core';

export interface TagValueEntry {
  value: any;
  quality: string;
  timestamp: Date;
}

export interface DataPoint {
  value: number;
  quality: string;
  timestamp: Date;
}

export interface ProjectSnapshot {
  projectId: string;
  exportedAt: Date;
  devices: Array<{
    id: string;
    deviceCode: string;
    deviceName: string;
    tags: Record<string, TagValueEntry>;
  }>;
}

/**
 * DeviceDataService - device latest-value read/write service
 *
 * Data source (after rework): Redis real-time latest values (v3 hierarchy)
 * - Device Key: ss:latest:{projectId}:{deviceCode}  (Hash, field=tagId, value=JSON full semantics)
 * - Tree index: ss:latest:tree:{projectId}          (Hash, field=deviceId, value=JSON{deviceCode,deviceName})
 * - Reads: delegated to LatestValueRedisService (HGETALL / pipeline HGETALL)
 * - Writes: delegated to LatestValueRedisService.write (for simulators / device control / manual API dispatch)
 *
 * v3 adaptation notes:
 * Redis Keys now use deviceCode (human-readable code) to express the `project->device` hierarchy,
 * but this service's external API still takes deviceId (UUID primary key) as the parameter (callers hold deviceId).
 * So the read path first queries the device entity via deviceRepo for the deviceCode, then reads Redis;
 * the write path likewise queries the entity for deviceCode/deviceName before writing.
 *
 * Rework history:
 * Previously read/wrote the project-level SQLite dev_tag_latest_values table (TagLatestValue entity),
 * but the collection Pipeline never wrote that table (Redis only), so the frontend API got no real-time data.
 * Now Redis is the single authoritative source; the SQLite latest-value table and entity are removed, eliminating inconsistency.
 *
 * Also fixes the getDevicesLatestValues multi-device query bug:
 * the old implementation `where: { deviceId: deviceIds.length === 1 ? deviceIds[0] : undefined }`
 * returned the whole table when deviceId=undefined for multiple devices; now uses the Redis pipeline to query exactly the given deviceIds.
 *
 * History queries (getTagHistory) still go through the influx DataQueryService; this service handles latest values only.
 */
@Injectable()
export class DeviceDataService {
  private readonly logger = new Logger(DeviceDataService.name);

  constructor(
    @Inject(getRepositoryToken(require('../entities/device.entity').Device))
    private readonly deviceRepo: any,
    @Optional()
    private readonly latestValueRedisService?: LatestValueRedisService,
  ) {}

  /**
   * Get the latest values of all tags under a device (from Redis HGETALL)
   *
   * v3: the Redis Key uses deviceCode, so the device entity must be queried via deviceRepo first.
   *
   * @param deviceId device ID (UUID primary key)
   * @param projectId project ID (required for the Redis key; returns empty when omitted, backward-compatible signature)
   */
  async getDeviceLatestValues(
    deviceId: string,
    projectId?: string,
  ): Promise<Record<string, TagValueEntry>> {
    if (!projectId || !this.latestValueRedisService) return {};
    try {
      // v3: readDevice needs deviceCode; get it by querying the device entity via deviceRepo
      const device = await this.deviceRepo.findOne({ where: { id: deviceId } });
      if (!device?.deviceCode) return {};
      const entries = await this.latestValueRedisService.readDevice(projectId, device.deviceCode);
      const result: Record<string, TagValueEntry> = {};
      for (const [tagId, entry] of Object.entries(entries)) {
        result[tagId] = {
          value: entry.value,
          quality: entry.quality,
          timestamp: entry.timestamp,
        };
      }
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`getDeviceLatestValues failed (device=${deviceId}): ${msg}`);
      return {};
    }
  }

  /**
   * Batch-get the latest values of multiple devices (from Redis pipeline HGETALL)
   *
   * v3: the Redis Key uses deviceCode, so device entities are batch-queried via deviceRepo first to build
   * the deviceId->deviceCode map; after readDevices returns Map<deviceCode, entries>, results are regrouped by deviceId.
   *
   * Bug fix: the old SQLite implementation returned the whole table for multi-device queries (see the class comment).
   * Now uses LatestValueRedisService.readDevices to batch-query exactly the given deviceCodes.
   */
  async getDevicesLatestValues(
    deviceIds: string[],
    projectId?: string,
  ): Promise<Map<string, Record<string, TagValueEntry>>> {
    const result = new Map<string, Record<string, TagValueEntry>>();
    if (!projectId || !this.latestValueRedisService || deviceIds.length === 0) return result;
    try {
      // v3: batch-query device entities, building the deviceId->deviceCode map
      const devices = await this.deviceRepo.find({
        where: { id: In(deviceIds) },
        select: ['id', 'deviceCode'],
      });
      const idToCode = new Map<string, string>();
      const deviceCodes: string[] = [];
      for (const device of devices) {
        if (device.deviceCode) {
          idToCode.set(device.id, device.deviceCode);
          deviceCodes.push(device.deviceCode);
        }
      }
      if (deviceCodes.length === 0) return result;

      // readDevices returns Map<deviceCode, entries>; regroup the return value by deviceId
      const deviceEntries = await this.latestValueRedisService.readDevices(projectId, deviceCodes);
      for (const [deviceId, deviceCode] of idToCode) {
        const entries = deviceEntries.get(deviceCode) ?? {};
        const tagValues: Record<string, TagValueEntry> = {};
        for (const [tagId, entry] of Object.entries(entries)) {
          tagValues[tagId] = {
            value: entry.value,
            quality: entry.quality,
            timestamp: entry.timestamp,
          };
        }
        result.set(deviceId, tagValues);
      }
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`getDevicesLatestValues failed (${deviceIds.length} devices): ${msg}`);
      return result;
    }
  }

  /** Get a specific tag's historical data (stub for InfluxDB integration) */
  async getTagHistory(
    tagId: string,
    range: { start: Date; end: Date },
    _options?: { interval?: number; aggregation?: 'avg' | 'min' | 'max' },
  ): Promise<DataPoint[]> {
    this.logger.log(`getTagHistory: ${tagId} [${range.start} - ${range.end}]`);
    // TODO: Integrate with InfluxDB for real time-series data
    return [];
  }

  /** Export a project data snapshot (device list from DB, tag latest values from Redis) */
  async exportProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
    const devices = await this.deviceRepo.find({ where: { projectId } });
    const snapshot: ProjectSnapshot = {
      projectId,
      exportedAt: new Date(),
      devices: [],
    };

    // Read all devices' latest values in the project in one shot (tags empty when Redis is unavailable)
    const deviceLatestMap: Map<string, Record<string, LatestValueEntry>> = this
      .latestValueRedisService
      ? await this.latestValueRedisService.readAll(projectId).catch((err: Error) => {
          this.logger.warn(`exportProjectSnapshot readAll failed: ${err.message}`);
          return new Map<string, Record<string, LatestValueEntry>>();
        })
      : new Map<string, Record<string, LatestValueEntry>>();

    for (const device of devices) {
      const latestValues: Record<string, TagValueEntry> = {};
      const entries: Record<string, LatestValueEntry> = deviceLatestMap.get(device.id) ?? {};
      for (const [tagId, entry] of Object.entries(entries)) {
        latestValues[tagId] = {
          value: entry.value,
          quality: entry.quality,
          timestamp: entry.timestamp,
        };
      }
      snapshot.devices.push({
        id: device.id,
        deviceCode: device.deviceCode,
        deviceName: device.deviceName,
        tags: latestValues,
      });
    }
    return snapshot;
  }

  /**
   * Write a tag's latest value (for simulators / device control / manual API dispatch)
   *
   * v3: writes Redis (HSET device Hash `ss:latest:{projectId}:{deviceCode}` + HSET tree index),
   * the same keys as the collection Pipeline's RedisLatestValuePersistWriter, ensuring read consistency.
   *
   * The device entity must be queried via deviceRepo for deviceCode/deviceName/projectId (required by v3 Redis Keys).
   *
   * @param tagId tag ID
   * @param deviceId device ID (UUID primary key)
   * @param value tag value
   * @param quality data quality
   * @param projectId project ID (when omitted, the device's owning project is reverse-queried via deviceRepo)
   */
  async updateLatestValue(
    tagId: string,
    deviceId: string,
    value: any,
    quality: string,
    projectId?: string,
  ): Promise<void> {
    if (!this.latestValueRedisService) {
      this.logger.warn(`updateLatestValue skipped: LatestValueRedisService unavailable`);
      return;
    }

    // Query the device entity: get deviceCode/deviceName, and reverse-lookup the owning project when projectId is missing
    let device: any = null;
    try {
      device = await this.deviceRepo.findOne({ where: { id: deviceId } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      this.logger.warn(`updateLatestValue cannot resolve device for device=${deviceId}: ${msg}`);
      return;
    }
    if (!device) {
      this.logger.warn(
        `updateLatestValue skipped: device not found (tag=${tagId}, device=${deviceId})`,
      );
      return;
    }

    const resolvedProjectId = projectId ?? device.projectId;
    if (!resolvedProjectId) {
      this.logger.warn(
        `updateLatestValue skipped: no projectId (tag=${tagId}, device=${deviceId})`,
      );
      return;
    }
    if (!device.deviceCode) {
      this.logger.warn(
        `updateLatestValue skipped: device has no deviceCode (tag=${tagId}, device=${deviceId})`,
      );
      return;
    }

    await this.latestValueRedisService.write({
      projectId: resolvedProjectId,
      deviceCode: device.deviceCode,
      deviceId,
      tagId,
      value,
      quality,
      timestamp: new Date(),
      deviceName: device.deviceName,
    });
  }
}
