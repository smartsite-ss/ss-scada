// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPersistWriter, DataPoint, PersistWriterRegistry } from '@ss-node/ss-collector-sdk';
import { InfluxWriteService } from './influx-write.service';

/**
 * InfluxDB time-series PersistWriter implementation
 *
 * Data flow: Pipeline DataPoint → write() → InfluxWriteService → InfluxDB tag_values measurement
 *
 * Conditional activation: writes only when HISTORICAL_DATA_BACKEND=influxdb (default);
 * otherwise write/writeBatch/flush are all no-ops (SqlitePersistWriter takes over).
 *
 * Note: must actively register with PersistWriterRegistry via onModuleInit,
 * otherwise PersistStep cannot obtain this Writer (NestJS module encapsulation limitation).
 *
 * Fault tolerance: when InfluxDB is unavailable (e.g. no TOKEN configured), InfluxWriteService catches the error internally,
 * without affecting the Pipeline main flow.
 */
@Injectable()
export class InfluxPersistWriter implements IPersistWriter, OnModuleInit {
  readonly name = 'InfluxDB';
  /**
   * InfluxDB writes are relatively slow (HTTP protocol, batch commits); declaring best_effort
   * makes PersistStep fire-and-forget asynchronously, without blocking the Pipeline cycle.
   * On failure, InfluxWriteService buffers and retries internally.
   */
  readonly priority = 'best_effort' as const;
  private readonly logger = new Logger(InfluxPersistWriter.name);
  /** Whether active: only when HISTORICAL_DATA_BACKEND=influxdb (default) */
  private readonly enabled: boolean;

  isActive(): boolean {
    return this.enabled;
  }

  constructor(
    private readonly influxWriteService: InfluxWriteService,
    private readonly writerRegistry: PersistWriterRegistry,
    private readonly configService: ConfigService,
  ) {
    const backend = this.configService.get('HISTORICAL_DATA_BACKEND', 'influxdb');
    this.enabled = backend === 'influxdb';
  }

  onModuleInit(): void {
    this.writerRegistry.register(this);
    this.logger.log(`InfluxPersistWriter registered (enabled=${this.enabled})`);
  }

  async write(point: DataPoint): Promise<void> {
    if (!this.enabled) return;

    await this.influxWriteService.writePoint({
      measurement: 'tag_values',
      tags: {
        tagId: point.tagId,
        deviceId: point.deviceId,
        projectId: point.projectId,
      },
      fields: this.buildFields(point),
      timestamp: point.timestamp,
    });
  }

  async writeBatch(points: DataPoint[]): Promise<void> {
    if (!this.enabled) return;
    if (points.length === 0) return;

    const influxPoints = points.map((point) => ({
      measurement: 'tag_values',
      tags: {
        tagId: point.tagId,
        deviceId: point.deviceId,
        projectId: point.projectId,
      },
      fields: this.buildFields(point),
      timestamp: point.timestamp,
    }));

    await this.influxWriteService.writePoints(influxPoints);

    // Buffer the data first (keeps the timer running for recovery probing), then check the backend status
    if (!this.influxWriteService.isBackendReachable) {
      throw new Error('InfluxDB backend is unreachable (previous flush failed)');
    }
  }

  /**
   * Construct InfluxDB fields, preserving the original type semantics of value.
   *
   * InfluxDB supports boolean/float/integer/unsigned/string field types,
   * inferred automatically from the value's JS type:
   * - JS boolean → InfluxDB boolean
   * - JS number → InfluxDB float
   * - JS string → InfluxDB string
   *
   * quality is always stored as a string.
   */
  private buildFields(point: DataPoint): Record<string, any> {
    const fields: Record<string, any> = { quality: point.quality };
    if (point.value === null || point.value === undefined) {
      fields.value = 0; // InfluxDB does not support null field values; fall back to 0
    } else {
      fields.value = point.value;
    }
    return fields;
  }

  async flush(): Promise<void> {
    if (!this.enabled) return;
    this.influxWriteService.flushAll();
  }
}
