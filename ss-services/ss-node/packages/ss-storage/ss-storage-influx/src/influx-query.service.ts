// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxBucketService } from './influx-bucket.service';

/**
 * InfluxDB query result row (parsed from the Flux pivot CSV)
 */
export interface InfluxQueryRow {
  tagId: string;
  value: number;
  quality: string;
  timestamp: Date;
  deviceId?: string;
  projectId?: string;
}

/**
 * InfluxDB Flux query service
 *
 * Responsibilities:
 * - Build Flux query statements
 * - Execute queries via the InfluxDB HTTP API
 * - Parse CSV responses into InfluxQueryRow[]
 * - Support per-project bucket queries
 *
 * Fault tolerance: throws when InfluxDB is unavailable; the caller (DataQueryService) handles degradation.
 */
@Injectable()
export class InfluxQueryService {
  private readonly logger = new Logger(InfluxQueryService.name);

  private readonly influxUrl: string;
  private readonly influxToken: string;
  private readonly influxOrg: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly bucketService: InfluxBucketService,
  ) {
    this.influxUrl = this.configService.get('INFLUXDB_URL', 'http://localhost:8086');
    this.influxToken = this.configService.get('INFLUXDB_TOKEN', '');
    this.influxOrg = this.configService.get('INFLUXDB_ORG', 'ss-org');
  }

  // ──────────── Time-range queries ────────────

  /**
   * Query all data points of a single tag within a time range
   */
  async queryRange(
    projectId: string,
    tagId: string,
    startTime: Date,
    endTime: Date,
    limit?: number,
    offset?: number,
  ): Promise<InfluxQueryRow[]> {
    const bucket = await this.bucketService.getBucket(projectId);
    const flux = this.buildRangeQuery(bucket, [tagId], startTime, endTime, limit, offset);
    return this.executeFluxQuery(flux);
  }

  /**
   * Batch query multiple tags' data within a time range
   */
  async queryRangeBatch(
    projectId: string,
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    limit?: number,
  ): Promise<InfluxQueryRow[]> {
    if (tagIds.length === 0) return [];
    const bucket = await this.bucketService.getBucket(projectId);
    const flux = this.buildRangeQuery(bucket, tagIds, startTime, endTime, limit);
    return this.executeFluxQuery(flux);
  }

  // ──────────── Aggregate queries ────────────

  /**
   * Single aggregation function: mean / max / min / sum / count
   */
  async queryAggregate(
    projectId: string,
    tagId: string,
    startTime: Date,
    endTime: Date,
    fn: 'mean' | 'max' | 'min' | 'sum' | 'count',
  ): Promise<number> {
    const bucket = await this.bucketService.getBucket(projectId);
    const flux = this.buildAggregateQuery(bucket, tagId, startTime, endTime, fn);
    const rows = await this.executeFluxQuery(flux);
    // After pivot, the Flux aggregate result's value column is the aggregated value, _time=startTime
    if (rows.length === 0) return 0;
    const tagValue = rows[0].value;
    return tagValue ?? 0;
  }

  /**
   * Time-window aggregation
   * @returns a time-sorted array of { interval, value }
   */
  async queryAggregateWindow(
    projectId: string,
    tagId: string,
    startTime: Date,
    endTime: Date,
    windowMs: number,
    fn: 'mean' | 'max' | 'min' | 'sum' | 'count',
  ): Promise<{ interval: string; value: number }[]> {
    const bucket = await this.bucketService.getBucket(projectId);
    const windowDuration = this.formatWindowDuration(windowMs);
    const flux = this.buildAggregateWindowQuery(
      bucket,
      tagId,
      startTime,
      endTime,
      windowDuration,
      fn,
    );
    const rows = await this.executeFluxQuery(flux);
    return rows.map((r) => ({
      interval: r.timestamp.toISOString(),
      value: r.value ?? 0,
    }));
  }

  // ──────────── Latest-value queries ────────────

  /**
   * Batch query the latest values of multiple tags
   */
  async queryLatest(
    projectId: string,
    tagIds: string[],
  ): Promise<Map<string, { value: number | null; timestamp: Date }>> {
    if (tagIds.length === 0) return new Map();
    const bucket = await this.bucketService.getBucket(projectId);
    const flux = this.buildLatestQuery(bucket, tagIds);
    const rows = await this.executeFluxQuery(flux);
    const result = new Map<string, { value: number | null; timestamp: Date }>();
    for (const row of rows) {
      result.set(row.tagId, { value: row.value, timestamp: row.timestamp });
    }
    return result;
  }

  // ──────────── Flux Query Builders ────────────

  private buildRangeQuery(
    bucket: string,
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    limit?: number,
    offset?: number,
  ): string {
    const tagFilter =
      tagIds.length === 1
        ? `r["tagId"] == "${tagIds[0]}"`
        : tagIds.map((id) => `r["tagId"] == "${id}"`).join(' or ');

    let flux = `from(bucket: "${bucket}")`;
    flux += `\n  |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})`;
    flux += `\n  |> filter(fn: (r) => r["_measurement"] == "tag_values")`;
    flux += `\n  |> filter(fn: (r) => ${tagFilter})`;
    flux += `\n  |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "quality")`;
    if (limit) {
      flux += `\n  |> limit(n: ${limit}${offset ? `, offset: ${offset}` : ''})`;
    }
    flux += `\n  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")`;
    // keep tag columns for identification
    flux += `\n  |> group(columns: ["tagId", "deviceId", "projectId"])`;
    return flux;
  }

  private buildAggregateQuery(
    bucket: string,
    tagId: string,
    startTime: Date,
    endTime: Date,
    fn: string,
  ): string {
    const fluxFn = fn === 'count' ? 'count' : fn; // 'mean' for avg
    let flux = `from(bucket: "${bucket}")`;
    flux += `\n  |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})`;
    flux += `\n  |> filter(fn: (r) => r["_measurement"] == "tag_values")`;
    flux += `\n  |> filter(fn: (r) => r["tagId"] == "${tagId}")`;
    flux += `\n  |> filter(fn: (r) => r["_field"] == "value")`;
    flux += `\n  |> ${fluxFn}()`;
    return flux;
  }

  private buildAggregateWindowQuery(
    bucket: string,
    tagId: string,
    startTime: Date,
    endTime: Date,
    windowDuration: string,
    fn: string,
  ): string {
    const fluxFn = fn === 'count' ? 'count' : fn;
    let flux = `from(bucket: "${bucket}")`;
    flux += `\n  |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})`;
    flux += `\n  |> filter(fn: (r) => r["_measurement"] == "tag_values")`;
    flux += `\n  |> filter(fn: (r) => r["tagId"] == "${tagId}")`;
    flux += `\n  |> filter(fn: (r) => r["_field"] == "value")`;
    flux += `\n  |> aggregateWindow(every: ${windowDuration}, fn: ${fluxFn}, createEmpty: false)`;
    return flux;
  }

  private buildLatestQuery(bucket: string, tagIds: string[]): string {
    const tagFilter =
      tagIds.length === 1
        ? `r["tagId"] == "${tagIds[0]}"`
        : tagIds.map((id) => `r["tagId"] == "${id}"`).join(' or ');

    let flux = `from(bucket: "${bucket}")`;
    flux += `\n  |> range(start: -30d)`;
    flux += `\n  |> filter(fn: (r) => r["_measurement"] == "tag_values")`;
    flux += `\n  |> filter(fn: (r) => ${tagFilter})`;
    flux += `\n  |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "quality")`;
    flux += `\n  |> last()`;
    flux += `\n  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")`;
    return flux;
  }

  // ──────────── Flux Execution ────────────

  /**
   * CODE-05: Flux query fetch timeout (ms).
   * A query may scan a large time range; 15s is given (looser than the 5s for writes, avoiding killing legitimate long queries).
   */
  private readonly queryTimeoutMs = 15000;

  private async executeFluxQuery(flux: string): Promise<InfluxQueryRow[]> {
    try {
      const response = await fetch(
        `${this.influxUrl}/api/v2/query?org=${encodeURIComponent(this.influxOrg)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${this.influxToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/csv',
          },
          body: JSON.stringify({ query: flux }),
          // CODE-05: add a timeout to fetch, preventing an indefinitely hung InfluxDB from blocking the event loop
          signal: AbortSignal.timeout(this.queryTimeoutMs),
        },
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown');
        throw new Error(`InfluxDB query failed (${response.status}): ${errorBody}`);
      }

      const csvText = await response.text();
      return this.parseCsvResponse(csvText);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`InfluxDB Flux query error: ${errMsg}`);
      throw error;
    }
  }

  // ──────────── CSV Parsing ────────────

  /**
   * Parse the InfluxDB CSV response into InfluxQueryRow[]
   *
   * After a Flux query is pivoted, the CSV header contains:
   * #datatype,string,long,dateTime:RFC3339,...
   * ,result,table,_time,tagId,deviceId,projectId,value,quality
   *
   * Aggregation queries without pivot:
   * ,result,table,_time,_value
   */
  private parseCsvResponse(csvText: string): InfluxQueryRow[] {
    // Normalize line endings (InfluxDB returns \r\n, but split('\n') would leave \r at line ends)
    const lines = csvText.replace(/\r\n/g, '\n').trim().split('\n');
    if (lines.length < 2) return [];

    // Skip comment lines (starting with #) to find the header and data rows
    let headerIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#')) {
        headerIdx = i;
        break;
      }
    }

    // Parse header indexes
    const headers = lines[headerIdx].split(',');
    const dataLines = lines.slice(headerIdx + 1).filter((l) => l.trim() !== '');

    // If there is only an annotation header and a data header (no data rows), return empty directly
    if (dataLines.length === 0) return [];

    // Check whether this is an aggregation result (no pivot): _time, _value columns
    const timeIdx = headers.indexOf('_time');
    const valueIdx = headers.indexOf('_value');
    const tagIdIdx = headers.indexOf('tagId');
    const deviceIdIdx = headers.indexOf('deviceId');
    const projectIdIdx = headers.indexOf('projectId');
    const qualityIdx = headers.indexOf('quality');

    // If the pivoted value column is not found, try the _value column
    const actualValueIdx = valueIdx >= 0 ? valueIdx : headers.indexOf('value');

    const parsed = dataLines.map((line, lineIdx) => {
      const cols = line.split(',');
      const getVal = (index: number): string => (index >= 0 && index < cols.length ? cols[index] : '');

      const rawValue = getVal(actualValueIdx);
      let numericValue: number;
      // Aggregation queries may return the _value numeric directly
      if (rawValue === '' || rawValue === undefined) {
        // Try to get it from the pivoted 'value' column
        const pivotedValue =
          headers.indexOf('value') >= 0 ? getVal(headers.indexOf('value')) : rawValue;
        numericValue = pivotedValue ? parseFloat(pivotedValue) : 0;
      } else {
        numericValue = parseFloat(rawValue);
      }
      if (isNaN(numericValue)) numericValue = 0;

      const timeStr = getVal(timeIdx);
      const timestamp = timeStr ? new Date(timeStr) : new Date();

      return {
        tagId: getVal(tagIdIdx),
        value: numericValue,
        quality: getVal(qualityIdx) || '0',
        timestamp,
        deviceId: deviceIdIdx >= 0 ? getVal(deviceIdIdx) : undefined,
        projectId: projectIdIdx >= 0 ? getVal(projectIdIdx) : undefined,
      };
    });

    return parsed;
  }

  // ──────────── Helpers ────────────

  /**
   * Convert a millisecond window to a Flux duration literal
   * 60000 → "1m", 3600000 → "1h", 600000 → "10m"
   */
  private formatWindowDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }
}
