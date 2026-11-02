// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import {
  INFLUX_WRITE_SERVICE,
  DATA_QUERY_SERVICE,
  IInfluxWriteService,
  IDataQueryService,
} from '../archive/device-archive.service';

export interface ArchiveConfig {
  enabled: boolean;
  interval: number; // archive interval (ms)
  retentionDays: number; // retention days
  destination: 'influxdb' | 'sqlite' | 'both';
}

export interface ArchivedDataPoint {
  tagId: string;
  deviceId: string;
  value: number;
  quality: string;
  timestamp: Date;
}

/**
 * ArchiveService - data archive and history-query service (implemented in 3.17)
 *
 * Behavior:
 * - archiveDataPoint(): when InfluxWriteService is available -> writes the real InfluxDB; otherwise only logs
 * - queryHistory(): when DataQueryService is available -> queries the HistoricalData table; otherwise returns an empty array
 *
 * String-Token injection avoids a circular package dependency between ss-device and ss-storage-influx.
 *
 * @see device-management design doc section 10
 */
@Injectable()
export class ArchiveService {
  private readonly logger = new Logger(ArchiveService.name);
  private configs = new Map<string, ArchiveConfig>();

  constructor(
    @Optional()
    @Inject(INFLUX_WRITE_SERVICE)
    private influxWriteService?: IInfluxWriteService,
    @Optional()
    @Inject(DATA_QUERY_SERVICE)
    private dataQueryService?: IDataQueryService,
  ) {
    this.logger.log(
      `ArchiveService initialized (InfluxWrite: ${influxWriteService ? 'enabled' : 'disabled'}, DataQuery: ${dataQueryService ? 'enabled' : 'disabled'})`,
    );
  }

  setArchiveConfig(tagId: string, config: ArchiveConfig): void {
    this.configs.set(tagId, config);
    this.logger.log(
      `Archive config set for tag ${tagId}: interval=${config.interval}ms, retention=${config.retentionDays}d`,
    );
  }

  getArchiveConfig(tagId: string): ArchiveConfig | undefined {
    return this.configs.get(tagId);
  }

  /**
   * Archive a single data point (implemented in 3.17)
   *
   * Behavior:
   * - When InfluxWriteService is available -> calls writePoint() to write the real InfluxDB
   * - When unavailable -> only logs at debug level
   */
  async archiveDataPoint(point: ArchivedDataPoint): Promise<void> {
    if (this.influxWriteService) {
      try {
        await this.influxWriteService.writePoint({
          measurement: 'tag_archive',
          tags: {
            tagId: point.tagId,
            deviceId: point.deviceId || 'unknown',
          },
          fields: {
            value: point.value,
            quality: point.quality,
          },
          timestamp: point.timestamp,
        });
      } catch (error) {
        this.logger.error(
          `Failed to archive data point to InfluxDB for tag ${point.tagId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    } else {
      this.logger.debug(
        `Archive (no-op, InfluxWriteService unavailable): ${point.tagId} = ${point.value} @ ${point.timestamp}`,
      );
    }
  }

  /**
   * Query historical data (implemented in 3.17)
   *
   * Behavior:
   * - When DataQueryService is available -> calls queryTimeRange() on the HistoricalData table
   * - When unavailable -> returns an empty array
   */
  async queryHistory(
    tagId: string,
    start: Date,
    end: Date,
    _options?: { interval?: number; aggregation?: 'avg' | 'min' | 'max' },
  ): Promise<ArchivedDataPoint[]> {
    if (this.dataQueryService) {
      try {
        const result = await this.dataQueryService.queryTimeRange({
          tagId,
          startTime: start,
          endTime: end,
          page: 1,
          pageSize: 1000,
        });

        return result.data.map((h) => ({
          tagId: h.tagId,
          deviceId: '',
          value: h.numericValue ?? 0,
          quality: 'good',
          timestamp: h.timestamp,
        }));
      } catch (error) {
        this.logger.error(
          `Failed to query history for tag ${tagId}: ${error instanceof Error ? error.message : error}`,
        );
        return [];
      }
    }

    this.logger.debug(`Query history (no-op): ${tagId} [${start} - ${end}]`);
    return [];
  }
}
