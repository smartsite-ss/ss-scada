// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Optional, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { StructuredLogger } from '@ss-node/ss-core';
import { StorageAdapter } from '../interfaces/storage-adapter.interface';
import {
  DownsamplingConfig,
  DownsamplingTask,
  DownsamplingResult,
  DownsamplingGranularity,
  DownsamplingAggregation,
  INFLUXDB_ADAPTER,
} from '../interfaces/downsampling.interface';

/** Interval for the daily scheduled run (24 hours) */
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Time range mapping for downsampling queries */
const GRANULARITY_RANGE: Record<DownsamplingGranularity, string> = {
  '1h': '-24h',
  '1d': '-7d',
};

/** Default aggregation function */
const DEFAULT_AGGREGATION: DownsamplingAggregation = 'mean';

/** Prefix of the target measurement after downsampling */
const TARGET_MEASUREMENT_PREFIX = 'tag_values';

/**
 * InfluxDB automatic downsampling service.
 *
 * Aggregates raw time-series data by hour/day (mean/min/max/last) and writes it into downsampling measurements,
 * implementing a multi-level data retention policy. Degrades gracefully when InfluxDB is unavailable.
 *
 * Downsampling strategy (per the design doc):
 *   raw data tag_values (30-day retention)
 *     ↓ 1h aggregation → tag_values_1h (365-day retention)
 *     ↓ 1d aggregation → tag_values_1d (permanent retention)
 */
@Injectable()
export class DownsamplingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger();

  /** Timer reference (initial delay trigger) */
  private scheduleTimer: NodeJS.Timeout | null = null;
  /** Timer reference (daily repeating trigger) */
  private dailyTimer: NodeJS.Timeout | null = null;
  /** Whether downsampling is currently running (concurrency guard) */
  private isRunning = false;

  /** InfluxDB connection configuration */
  private readonly influxUrl: string;
  private readonly influxToken: string;
  private readonly influxOrg: string;
  private readonly influxBucket: string;

  constructor(@Optional() @Inject(INFLUXDB_ADAPTER) private readonly adapter?: StorageAdapter) {
    this.influxUrl = process.env.INFLUXDB_URL || 'http://localhost:8086';
    this.influxToken = process.env.INFLUXDB_TOKEN || '';
    this.influxOrg = process.env.INFLUXDB_ORG || 'ss-org';
    this.influxBucket = process.env.INFLUXDB_BUCKET || 'ss_node_data';
  }

  // ──────────── Lifecycle ────────────

  onModuleInit(): void {
    const config = this.getDownsamplingConfig();
    if (config.enabled) {
      this.logger.log(
        `DownsamplingService initialized (auto-schedule enabled, ${config.tasks.length} tasks)`,
        'DownsamplingService',
      );
    } else {
      this.logger.log('DownsamplingService initialized (disabled)', 'DownsamplingService');
    }
  }

  onModuleDestroy(): void {
    this.clearTimers();
    this.logger.log('DownsamplingService destroyed', 'DownsamplingService');
  }

  // ──────────── Public methods ────────────

  /**
   * Run downsampling: read data from the source measurement, aggregate at the specified granularity, and write to the target measurement.
   *
   * @param measurement source measurement name (e.g. "tag_values")
   * @param granularity aggregation granularity ('1h' or '1d')
   * @param retention target retention policy description (e.g. "365d", "permanent"), used for logging
   */
  async executeDownsampling(
    measurement: string,
    granularity: DownsamplingGranularity,
    retention: string,
  ): Promise<void> {
    const targetMeasurement = this.deriveTargetMeasurement(granularity);
    const result = await this.executeDownsamplingTask({
      measurement,
      granularity,
      aggregation: DEFAULT_AGGREGATION,
      retentionDays: this.parseRetentionDays(retention),
      targetMeasurement,
    });

    if (result.success) {
      this.logger.log(
        `Downsampling completed: ${measurement} → ${targetMeasurement} ` +
          `(${result.processedCount} points aggregated, ${result.writtenCount} written, ${result.duration}ms)`,
        'DownsamplingService',
      );
    } else {
      this.logger.warn(
        `Downsampling failed: ${measurement} → ${targetMeasurement}: ${result.error}`,
        'DownsamplingService',
      );
    }
  }

  /**
   * Register the scheduled task that runs all configured downsampling tasks every early morning.
   * If a timer is already running, clear the old timer first, then re-register.
   */
  scheduleDownsampling(): void {
    this.clearTimers();

    const config = this.getDownsamplingConfig();
    if (!config.enabled) {
      this.logger.log('Downsampling scheduling skipped (disabled)', 'DownsamplingService');
      return;
    }

    const delayMs = this.getMsUntilNextMidnight();
    this.scheduleTimer = setTimeout(() => {
      this.runAllTasks().catch((err) => {
        this.logger.error(
          `Scheduled downsampling failed: ${err.message}`,
          err.stack,
          'DownsamplingService',
        );
      });
      this.dailyTimer = setInterval(() => {
        this.runAllTasks().catch((err) => {
          this.logger.error(
            `Scheduled downsampling failed: ${err.message}`,
            err.stack,
            'DownsamplingService',
          );
        });
      }, DAILY_INTERVAL_MS);
    }, delayMs);

    const nextRun = new Date(Date.now() + delayMs);
    this.logger.log(
      `Downsampling scheduled: next run at ${nextRun.toISOString()} (${config.tasks.length} tasks)`,
      'DownsamplingService',
    );
  }

  /**
   * Get the downsampling configuration.
   * The configuration is based on the default strategy defined in the design doc; in the future it can be extended to read from env vars or the database.
   */
  getDownsamplingConfig(): DownsamplingConfig {
    const enabled = (process.env.DOWNSAMPLING_ENABLED || 'true').toLowerCase() !== 'false';

    const tasks: DownsamplingTask[] = [
      {
        measurement: 'tag_values',
        granularity: '1h',
        aggregation: 'mean',
        retentionDays: 365,
        targetMeasurement: 'tag_values_1h',
      },
      {
        measurement: 'tag_values_1h',
        granularity: '1d',
        aggregation: 'mean',
        retentionDays: 0,
        targetMeasurement: 'tag_values_1d',
      },
    ];

    return { enabled, tasks };
  }

  /**
   * Run all configured downsampling tasks (called by the timer).
   */
  async runAllTasks(): Promise<DownsamplingResult[]> {
    if (this.isRunning) {
      this.logger.warn('Downsampling already in progress, skipping', 'DownsamplingService');
      return [];
    }

    const config = this.getDownsamplingConfig();
    if (!config.enabled) {
      return [];
    }

    this.isRunning = true;
    const results: DownsamplingResult[] = [];

    try {
      if (!(await this.isInfluxDbAvailable())) {
        this.logger.warn('InfluxDB not available, downsampling skipped', 'DownsamplingService');
        return config.tasks.map((task) => ({
          measurement: task.measurement,
          targetMeasurement: task.targetMeasurement,
          granularity: task.granularity,
          processedCount: 0,
          writtenCount: 0,
          duration: 0,
          success: false,
          error: 'InfluxDB not available',
        }));
      }

      for (const task of config.tasks) {
        const result = await this.executeDownsamplingTask(task);
        results.push(result);

        if (result.success) {
          this.logger.log(
            `Task done: ${task.measurement} → ${task.targetMeasurement} ` +
              `(${result.processedCount} → ${result.writtenCount}, ${result.duration}ms)`,
            'DownsamplingService',
          );
        } else {
          this.logger.warn(
            `Task failed: ${task.measurement} → ${task.targetMeasurement}: ${result.error}`,
            'DownsamplingService',
          );
        }
      }
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  // ──────────── Internal: task execution ────────────

  /**
   * Run a single downsampling task: query → aggregate → write back.
   */
  private async executeDownsamplingTask(task: DownsamplingTask): Promise<DownsamplingResult> {
    const startTime = Date.now();
    const result: DownsamplingResult = {
      measurement: task.measurement,
      targetMeasurement: task.targetMeasurement,
      granularity: task.granularity,
      processedCount: 0,
      writtenCount: 0,
      duration: 0,
      success: false,
    };

    if (!this.influxToken) {
      result.error = 'INFLUXDB_TOKEN is not configured';
      result.duration = Date.now() - startTime;
      return result;
    }

    try {
      // 1. Build and execute the Flux aggregation query
      const fluxQuery = this.buildAggregationFluxQuery(
        task.measurement,
        task.granularity,
        task.aggregation,
      );
      const csvResponse = await this.executeFluxQuery(fluxQuery);

      // 2. Parse the CSV result into downsampling data points
      const aggregatedPoints = this.parseAggregationCsv(csvResponse);
      result.processedCount = aggregatedPoints.length;

      if (aggregatedPoints.length === 0) {
        result.success = true;
        result.duration = Date.now() - startTime;
        return result;
      }

      // 3. Write the aggregated result to the target measurement
      const written = await this.writeAggregatedPoints(task.targetMeasurement, aggregatedPoints);
      result.writtenCount = written;
      result.success = true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      result.error = error.message;
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  // ──────────── Internal: Flux query building ────────────

  /**
   * Build the Flux aggregation query statement.
   *
   * Query logic:
   *   1. Read the value field of the source measurement from the bucket
   *   2. Group by tagId/deviceId/projectId
   *   3. Aggregate with aggregateWindow at the specified granularity and function
   */
  private buildAggregationFluxQuery(
    measurement: string,
    granularity: string,
    aggregation: DownsamplingAggregation,
  ): string {
    const range = this.getRangeForGranularity(granularity);
    const fluxFn = aggregation === 'last' ? 'last' : aggregation;

    return [
      `from(bucket: "${this.influxBucket}")`,
      `  |> range(start: ${range})`,
      `  |> filter(fn: (r) => r["_measurement"] == "${measurement}")`,
      `  |> filter(fn: (r) => r["_field"] == "value")`,
      `  |> group(columns: ["tagId", "deviceId", "projectId", "_field"])`,
      `  |> aggregateWindow(every: ${granularity}, fn: ${fluxFn}, createEmpty: false)`,
    ].join('\n');
  }

  // ──────────── Internal: InfluxDB HTTP communication ────────────

  /**
   * Execute a Flux query via InfluxDB's /api/v2/query endpoint, returning CSV text.
   */
  private async executeFluxQuery(query: string): Promise<string> {
    const url = `${this.influxUrl}/api/v2/query?org=${this.influxOrg}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.influxToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/csv',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      throw new Error(`InfluxDB query failed (${response.status}): ${errorBody}`);
    }

    return response.text();
  }

  /**
   * Write the aggregated data points in batch to the target measurement via Line Protocol.
   */
  private async writeAggregatedPoints(
    targetMeasurement: string,
    points: AggregatedPoint[],
  ): Promise<number> {
    if (points.length === 0) return 0;

    const lines = points.map((p) => this.toLineProtocol(targetMeasurement, p)).join('\n');
    const url = `${this.influxUrl}/api/v2/write?org=${this.influxOrg}&bucket=${this.influxBucket}&precision=ns`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.influxToken}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: lines,
    });

    if (!response.ok && response.status !== 204) {
      const errorBody = await response.text().catch(() => 'unknown');
      throw new Error(`InfluxDB write failed (${response.status}): ${errorBody}`);
    }

    return points.length;
  }

  /**
   * Convert a single aggregated data point to InfluxDB Line Protocol format.
   */
  private toLineProtocol(measurement: string, point: AggregatedPoint): string {
    const escapeTag = (v: string): string => v.replace(/[,= ]/g, '\\$&');
    const tags = [
      `tagId=${escapeTag(point.tagId)}`,
      `deviceId=${escapeTag(point.deviceId)}`,
      `projectId=${escapeTag(point.projectId)}`,
    ].join(',');

    const ts = point.timestamp.getTime() * 1000000; // ns

    return `${measurement},${tags} value=${point.value} ${ts}`;
  }

  // ──────────── Internal: CSV parsing ────────────

  /**
   * Parse the CSV returned by the InfluxDB Flux query and extract aggregated data points.
   *
   * CSV format example:
   *   #group,false,false,true,...
   *   #datatype,string,long,dateTime:RFC3339,double,...
   *   ,result,table,_time,_value,tagId,deviceId,projectId,_field,_measurement
   *   ,,0,2025-01-01T00:00:00Z,42.5,tag-001,dev-001,proj-001,value,tag_values
   */
  private parseAggregationCsv(csvText: string): AggregatedPoint[] {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    // Skip comment lines starting with # to find the header line
    let headerIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#')) {
        headerIdx = i;
        break;
      }
    }

    const headers = lines[headerIdx].split(',');
    const dataLines = lines
      .slice(headerIdx + 1)
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));

    const timeIdx = headers.findIndex((h) => h === '_time');
    const valueIdx = headers.findIndex((h) => h === '_value');
    const tagIdIdx = headers.findIndex((h) => h === 'tagId');
    const deviceIdIdx = headers.findIndex((h) => h === 'deviceId');
    const projectIdIdx = headers.findIndex((h) => h === 'projectId');

    if (timeIdx < 0 || valueIdx < 0) return [];

    const points: AggregatedPoint[] = [];

    for (const line of dataLines) {
      const cols = line.split(',');
      const getVal = (idx: number): string => (idx >= 0 && idx < cols.length ? cols[idx] : '');

      const timeStr = getVal(timeIdx);
      const valueStr = getVal(valueIdx);
      if (!timeStr || !valueStr) continue;

      const value = parseFloat(valueStr);
      if (Number.isNaN(value)) continue;

      points.push({
        timestamp: new Date(timeStr),
        value,
        tagId: getVal(tagIdIdx),
        deviceId: getVal(deviceIdIdx),
        projectId: getVal(projectIdIdx),
      });
    }

    return points;
  }

  // ──────────── Internal: helper methods ────────────

  /**
   * Check whether InfluxDB is available (a token is configured and the health check passes).
   * If a StorageAdapter is injected, its health() method is preferred.
   */
  private async isInfluxDbAvailable(): Promise<boolean> {
    if (!this.influxToken) return false;

    if (this.adapter) {
      try {
        const health = await this.adapter.health();
        return health.status === 'healthy' || health.status === 'degraded';
      } catch {
        return false;
      }
    }

    try {
      const response = await fetch(`${this.influxUrl}/health`, {
        method: 'GET',
        headers: { Authorization: `Token ${this.influxToken}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get the Flux range time span for the granularity.
   */
  private getRangeForGranularity(granularity: string): string {
    if (granularity === '1h') return GRANULARITY_RANGE['1h'];
    if (granularity === '1d') return GRANULARITY_RANGE['1d'];
    // Default to querying the last 24 hours
    return '-24h';
  }

  /**
   * Derive the target measurement name from the granularity.
   * tag_values + 1h → tag_values_1h
   * tag_values_1h + 1d → tag_values_1d
   */
  private deriveTargetMeasurement(granularity: DownsamplingGranularity): string {
    return `${TARGET_MEASUREMENT_PREFIX}_${granularity}`;
  }

  /**
   * Parse a retention string into days.
   * "365d" → 365, "permanent" → 0, "" → 0
   */
  private parseRetentionDays(retention: string): number {
    const match = retention.match(/^(\d+)d?$/i);
    if (match) return parseInt(match[1], 10);
    return 0;
  }

  /**
   * Compute the milliseconds until the next midnight (local 00:00:00).
   */
  private getMsUntilNextMidnight(): number {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return nextMidnight.getTime() - now.getTime();
  }

  /**
   * Clear all timers.
   */
  private clearTimers(): void {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }
  }
}

// ──────────── Internal types ────────────

/**
 * Aggregated data point (internal use, for writing to the target measurement).
 */
interface AggregatedPoint {
  timestamp: Date;
  value: number;
  tagId: string;
  deviceId: string;
  projectId: string;
}
