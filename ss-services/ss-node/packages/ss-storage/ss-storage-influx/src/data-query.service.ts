// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, Between } from 'typeorm';
import { HistoricalData } from './entities/historical-data.entity';
import { ProjectDatabaseService } from '@ss-node/ss-core';
import { InfluxQueryService, InfluxQueryRow } from './influx-query.service';

export enum AggregationType {
  AVG = 'avg',
  MAX = 'max',
  MIN = 'min',
  SUM = 'sum',
  COUNT = 'count',
}

/** Interpolation type */
export enum InterpolationType {
  /** Raw — no interpolation; collected data points are returned directly */
  RAW = 'raw',
  /** Linear interpolation — fills between adjacent points linearly by time interval */
  LINEAR = 'linear',
  /** Step interpolation (previous-value hold) — missing periods reuse the last known value */
  STEP = 'step',
}

export interface AggregationResult {
  aggregation: AggregationType;
  value: number;
  tagId: string;
  startTime: string;
  endTime: string;
}

export interface TagDataPoint {
  /** Historical data point value — preserves original type semantics (number/boolean/string) */
  value: number | boolean | string | null;
  timestamp: string;
}

export interface TagDataPage {
  tagId: string;
  data: TagDataPoint[];
}

/** Trend query result */
export interface TrendDataResult {
  /** Query data for each tag */
  data: TagDataPage[];
  /** Metadata — uses pagination mode so TransformInterceptor flattens the response:
   *  returns { data: [...], pagination: { total } } → the client receives
   *  { code, data: [...], pagination: { total }, message } */
  pagination: { total: number };
}

export interface TrendQueryOptions {
  tagIds: string[];
  startTime: Date;
  endTime: Date;
  /** Max data points (triggers LTTB downsampling), default 1000 */
  maxPoints?: number;
  projectId?: string;
  /** Interpolation type, default raw */
  interpolation?: InterpolationType;
  /** Interpolation interval (ms), effective for linear/step, default 1000ms */
  interval?: number;
  /** Window aggregation parameters (optional): when present, aggregates per tag by window, skipping interpolation and LTTB downsampling */
  aggregation?: TrendAggregationOptions;
}

/** Trend query window aggregation parameters (Phase 3 enhancement: 08 #6 aggregation query) */
export interface TrendAggregationOptions {
  /** Aggregation function: avg/max/min/sum/count */
  type: AggregationType;
  /** Aggregation window size (ms), must be a positive integer */
  windowMs: number;
}

export interface TimeRangeQuery {
  tagId: string;
  startTime: Date;
  endTime: Date;
  page?: number;
  pageSize?: number;
  projectId?: string;
}

/**
 * Aggregation function names for InfluxDB Flux queries
 */
const INFLUX_FN_MAP: Record<AggregationType, 'mean' | 'max' | 'min' | 'sum' | 'count'> = {
  [AggregationType.AVG]: 'mean',
  [AggregationType.MAX]: 'max',
  [AggregationType.MIN]: 'min',
  [AggregationType.SUM]: 'sum',
  [AggregationType.COUNT]: 'count',
};

@Injectable()
export class DataQueryService {
  private readonly logger = new Logger(DataQueryService.name);
  /** Historical data query backend: influxdb | sqlite | mysql */
  private readonly backend: string;

  constructor(
    @Inject(getRepositoryToken(HistoricalData))
    private globalRepo: Repository<HistoricalData>,
    @Inject(ProjectDatabaseService)
    private projectDbService: ProjectDatabaseService,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly influxQueryService?: InfluxQueryService,
  ) {
    this.backend = this.configService?.get('HISTORICAL_DATA_BACKEND', 'influxdb') ?? 'influxdb';
  }

  /** Whether the SQLite query backend is used */
  private get useSqlite(): boolean {
    return this.backend !== 'influxdb';
  }

  /**
   * Get the project-level HistoricalData repository
   * - With projectId: queries the project database (ss-project/{project}/db/system.db)
   * - Without projectId: falls back to the global database (legacy behavior)
   */
  private async getRepo(projectId?: string): Promise<Repository<HistoricalData>> {
    if (projectId) {
      const ds = await this.projectDbService.getSystemDb(projectId);
      return ds.getRepository(HistoricalData);
    }
    return this.globalRepo;
  }

  /**
   * Extract value from a HistoricalData record — returns the first non-null value by column priority
   *
   * At write time values are split by type into numericValue/booleanValue/stringValue columns;
   * at read time the non-null column is returned, preserving type semantics.
   */
  private pickValueFromRecord(record: HistoricalData): number | boolean | string | null {
    if (record.booleanValue !== null && record.booleanValue !== undefined) {
      return record.booleanValue;
    }
    if (record.stringValue !== null && record.stringValue !== undefined) {
      return record.stringValue;
    }
    if (record.numericValue !== null && record.numericValue !== undefined) {
      return record.numericValue;
    }
    return null;
  }

  /**
   * Extract InfluxQueryRow[] into the data array format of TagDataPage
   */
  private rowsToDataPoints(rows: InfluxQueryRow[]): TagDataPoint[] {
    return rows.map((r) => ({
      value: r.value,
      timestamp: r.timestamp.toISOString(),
    }));
  }

  /**
   * Group InfluxQueryRow[] by tagId into TagDataPage[]
   */
  private groupRowsByTag(rows: InfluxQueryRow[]): TagDataPage[] {
    const groups = new Map<string, InfluxQueryRow[]>();
    for (const row of rows) {
      if (!groups.has(row.tagId)) groups.set(row.tagId, []);
      groups.get(row.tagId)!.push(row);
    }
    return Array.from(groups.entries()).map(([tagId, tagRows]) => ({
      tagId,
      data: this.rowsToDataPoints(tagRows),
    }));
  }

  // ──────────── Time-range query (with pagination) ────────────

  async queryTimeRange(query: TimeRangeQuery): Promise<{ data: HistoricalData[]; total: number }> {
    if (this.useSqlite) return this.queryTimeRangeSqlite(query);
    return this.queryTimeRangeInflux(query);
  }

  private async queryTimeRangeSqlite(
    query: TimeRangeQuery,
  ): Promise<{ data: HistoricalData[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const repo = await this.getRepo(query.projectId);

    const [data, total] = await repo.findAndCount({
      where: {
        tagId: query.tagId,
        timestamp: Between(query.startTime, query.endTime),
      },
      order: { timestamp: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { data, total };
  }

  private async queryTimeRangeInflux(
    query: TimeRangeQuery,
  ): Promise<{ data: HistoricalData[]; total: number }> {
    const projectId = query.projectId || 'default';
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const offset = (page - 1) * pageSize;

    const rows = await this.influxQueryService!.queryRange(
      projectId,
      query.tagId,
      query.startTime,
      query.endTime,
      pageSize,
      offset,
    );

    // Then query the total count (without limit/offset)
    const allRows = await this.influxQueryService!.queryRange(
      projectId,
      query.tagId,
      query.startTime,
      query.endTime,
    );

    const data = rows.map((r) => {
      const h = new HistoricalData();
      h.tagId = r.tagId;
      h.numericValue = r.value;
      h.stringValue = null;
      h.booleanValue = null;
      h.timestamp = r.timestamp;
      return h;
    });

    return { data, total: allRows.length };
  }

  // ──────────── Aggregation query ────────────

  async aggregate(
    tagId: string,
    startTime: Date,
    endTime: Date,
    type: AggregationType,
    projectId?: string,
  ): Promise<AggregationResult> {
    if (this.useSqlite) return this.aggregateSqlite(tagId, startTime, endTime, type, projectId);
    return this.aggregateInflux(tagId, startTime, endTime, type, projectId);
  }

  private async aggregateSqlite(
    tagId: string,
    startTime: Date,
    endTime: Date,
    type: AggregationType,
    projectId?: string,
  ): Promise<AggregationResult> {
    const repo = await this.getRepo(projectId);
    const qb = repo
      .createQueryBuilder('h')
      .where('h.tagId = :tagId', { tagId })
      .andWhere('h.timestamp BETWEEN :startTime AND :endTime', { startTime, endTime });

    let value: number;

    switch (type) {
      case AggregationType.AVG:
        ({ avg: value } = await qb
          .select('AVG(h.numericValue)', 'avg')
          .getRawOne<{ avg: number }>());
        break;
      case AggregationType.MAX:
        ({ max: value } = await qb
          .select('MAX(h.numericValue)', 'max')
          .getRawOne<{ max: number }>());
        break;
      case AggregationType.MIN:
        ({ min: value } = await qb
          .select('MIN(h.numericValue)', 'min')
          .getRawOne<{ min: number }>());
        break;
      case AggregationType.SUM:
        ({ sum: value } = await qb
          .select('SUM(h.numericValue)', 'sum')
          .getRawOne<{ sum: number }>());
        break;
      case AggregationType.COUNT:
        value = await qb.getCount();
        break;
      default:
        throw new Error(`Unknown aggregation type: ${type}`);
    }

    return {
      aggregation: type,
      value: value ?? 0,
      tagId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }

  private async aggregateInflux(
    tagId: string,
    startTime: Date,
    endTime: Date,
    type: AggregationType,
    projectId?: string,
  ): Promise<AggregationResult> {
    const effectiveProjectId = projectId || 'default';
    const value = await this.influxQueryService!.queryAggregate(
      effectiveProjectId,
      tagId,
      startTime,
      endTime,
      INFLUX_FN_MAP[type],
    );
    return {
      aggregation: type,
      value,
      tagId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
  }

  // ──────────── Window aggregation (grouped by time interval) ────────────

  async aggregateWindow(
    tagId: string,
    startTime: Date,
    endTime: Date,
    windowMs: number,
    type: AggregationType,
    projectId?: string,
  ): Promise<{ interval: string; value: number }[]> {
    if (this.useSqlite)
      return this.aggregateWindowSqlite(tagId, startTime, endTime, windowMs, type, projectId);
    return this.aggregateWindowInflux(tagId, startTime, endTime, windowMs, type, projectId);
  }

  private async aggregateWindowSqlite(
    tagId: string,
    startTime: Date,
    endTime: Date,
    windowMs: number,
    type: AggregationType,
    projectId?: string,
  ): Promise<{ interval: string; value: number }[]> {
    const repo = await this.getRepo(projectId);
    const raw = await repo.find({
      where: { tagId, timestamp: Between(startTime, endTime) },
      order: { timestamp: 'ASC' },
    });

    const buckets = new Map<number, number[]>();

    for (const record of raw) {
      const ts = record.timestamp.getTime();
      const bucketKey = Math.floor(ts / windowMs) * windowMs;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      if (record.numericValue !== null) {
        buckets.get(bucketKey)!.push(record.numericValue);
      }
    }

    const results: { interval: string; value: number }[] = [];

    for (const [bucketKey, values] of buckets) {
      if (values.length === 0) continue;

      let value = 0;
      switch (type) {
        case AggregationType.AVG:
          value = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case AggregationType.MAX:
          value = Math.max(...values);
          break;
        case AggregationType.MIN:
          value = Math.min(...values);
          break;
        case AggregationType.SUM:
          value = values.reduce((a, b) => a + b, 0);
          break;
        case AggregationType.COUNT:
          value = values.length;
          break;
      }

      results.push({
        interval: new Date(bucketKey).toISOString(),
        value,
      });
    }

    return results.sort((a, b) => a.interval.localeCompare(b.interval));
  }

  private async aggregateWindowInflux(
    tagId: string,
    startTime: Date,
    endTime: Date,
    windowMs: number,
    type: AggregationType,
    projectId?: string,
  ): Promise<{ interval: string; value: number }[]> {
    const effectiveProjectId = projectId || 'default';
    return this.influxQueryService!.queryAggregateWindow(
      effectiveProjectId,
      tagId,
      startTime,
      endTime,
      windowMs,
      INFLUX_FN_MAP[type],
    );
  }

  // ──────────── Batch query ────────────

  async batchQueryLatest(
    tagIds: string[],
    projectId?: string,
  ): Promise<Map<string, number | null>> {
    if (this.useSqlite) return this.batchQueryLatestSqlite(tagIds, projectId);
    return this.batchQueryLatestInflux(tagIds, projectId);
  }

  private async batchQueryLatestSqlite(
    tagIds: string[],
    projectId?: string,
  ): Promise<Map<string, number | null>> {
    const repo = await this.getRepo(projectId);
    const result = new Map<string, number | null>();

    for (const tagId of tagIds) {
      const record = await repo.findOne({
        where: { tagId },
        order: { timestamp: 'DESC' },
        // Read the three columns and return the non-null one
        select: ['tagId', 'numericValue', 'stringValue', 'booleanValue', 'timestamp'],
      });

      result.set(tagId, record ? (this.pickValueFromRecord(record) as number | null) : null);
    }

    return result;
  }

  private async batchQueryLatestInflux(
    tagIds: string[],
    projectId?: string,
  ): Promise<Map<string, number | null>> {
    if (tagIds.length === 0) return new Map();
    const effectiveProjectId = projectId || 'default';
    const rows = await this.influxQueryService!.queryLatest(effectiveProjectId, tagIds);
    const result = new Map<string, number | null>();
    for (const tagId of tagIds) {
      const row = rows.get(tagId);
      result.set(tagId, row?.value ?? null);
    }
    return result;
  }

  async batchQueryTimeRange(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<TagDataPage[]> {
    if (this.useSqlite)
      return this.batchQueryTimeRangeSqlite(tagIds, startTime, endTime, projectId);
    return this.batchQueryTimeRangeInflux(tagIds, startTime, endTime, projectId);
  }

  private async batchQueryTimeRangeSqlite(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<TagDataPage[]> {
    const repo = await this.getRepo(projectId);
    const results: TagDataPage[] = [];

    for (const tagId of tagIds) {
      const [data] = await repo.findAndCount({
        where: { tagId, timestamp: Between(startTime, endTime) },
        order: { timestamp: 'ASC' },
        take: 500,
      });

      results.push({
        tagId,
        data: data.map((d) => ({
          value: this.pickValueFromRecord(d),
          timestamp: d.timestamp.toISOString(),
        })),
      });
    }

    return results;
  }

  private async batchQueryTimeRangeInflux(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<TagDataPage[]> {
    if (tagIds.length === 0) return [];
    const effectiveProjectId = projectId || 'default';
    const rows = await this.influxQueryService!.queryRangeBatch(
      effectiveProjectId,
      tagIds,
      startTime,
      endTime,
      500,
    );
    return this.groupRowsByTag(rows);
  }

  // ──────────── Trend-chart batch query (with LTTB downsampling + interpolation) ────────────

  /**
   * Trend-chart batch query
   *
   * Flow: fetch raw data → interpolation fill → LTTB downsampling → return result (with record counts)
   *
   * @param opts.interpolation interpolation: raw (none) | linear (linear interpolation) | step (hold previous value)
   * @param opts.interval interpolation interval (ms), only for linear/step, default 1000
   */
  async queryTrendData(opts: TrendQueryOptions): Promise<TrendDataResult> {
    if (opts.aggregation) return this.queryTrendDataAggregated(opts);
    if (this.useSqlite) return this.queryTrendDataSqlite(opts);
    return this.queryTrendDataInflux(opts);
  }

  /**
   * Window-aggregated trend query (Phase 3 enhancement: 08 #6)
   *
   * Calls window aggregation per tag (automatically adapting to the sqlite/InfluxDB storage backend);
   * the aggregation window's start time serves as the data point timestamp; interpolation and LTTB downsampling are skipped
   * (the aggregation window itself already bounds the point count). The return structure matches the original trend query.
   */
  private async queryTrendDataAggregated(opts: TrendQueryOptions): Promise<TrendDataResult> {
    const { type: aggregationType, windowMs } = opts.aggregation!;
    const pages: TagDataPage[] = [];
    let total = 0;

    for (const tagId of opts.tagIds) {
      const windowPoints = await this.aggregateWindow(
        tagId,
        opts.startTime,
        opts.endTime,
        windowMs,
        aggregationType,
        opts.projectId,
      );
      const dataPoints: TagDataPoint[] = windowPoints.map((windowPoint) => ({
        value: windowPoint.value,
        timestamp: windowPoint.interval,
      }));
      pages.push({ tagId, data: dataPoints });
      total += dataPoints.length;
    }

    return { data: pages, pagination: { total } };
  }

  private async queryTrendDataSqlite(opts: TrendQueryOptions): Promise<TrendDataResult> {
    const repo = await this.getRepo(opts.projectId);
    const pages: TagDataPage[] = [];
    let total = 0;

    for (const tagId of opts.tagIds) {
      const records = await repo.find({
        where: { tagId, timestamp: Between(opts.startTime, opts.endTime) },
        order: { timestamp: 'ASC' },
      });

      let dataPoints: TagDataPoint[] = records.map((d) => ({
        value: this.pickValueFromRecord(d),
        timestamp: d.timestamp.toISOString(),
      }));

      dataPoints = this.applyInterpolation(
        dataPoints,
        opts.startTime,
        opts.endTime,
        opts.interpolation ?? InterpolationType.RAW,
        opts.interval ?? 1000,
      );

      if (dataPoints.length > (opts.maxPoints ?? 1000)) {
        dataPoints = this.lttbDownsample(dataPoints, opts.maxPoints ?? 1000);
      }

      pages.push({ tagId, data: dataPoints });
      total += dataPoints.length;
    }

    return { data: pages, pagination: { total } };
  }

  private async queryTrendDataInflux(opts: TrendQueryOptions): Promise<TrendDataResult> {
    if (opts.tagIds.length === 0) return { data: [], pagination: { total: 0 } };
    const effectiveProjectId = opts.projectId || 'default';
    const rows = await this.influxQueryService!.queryRangeBatch(
      effectiveProjectId,
      opts.tagIds,
      opts.startTime,
      opts.endTime,
    );
    const pages = this.groupRowsByTag(rows);
    let total = 0;

    // Apply interpolation + LTTB downsampling per tag
    const resultPages = pages.map((page) => {
      let points = this.applyInterpolation(
        page.data,
        opts.startTime,
        opts.endTime,
        opts.interpolation ?? InterpolationType.RAW,
        opts.interval ?? 1000,
      );

      if (points.length > (opts.maxPoints ?? 1000)) {
        points = this.lttbDownsample(points, opts.maxPoints ?? 1000);
      }

      total += points.length;
      return { tagId: page.tagId, data: points };
    });

    return { data: resultPages, pagination: { total } };
  }

  // ──────────── Interpolation algorithms ────────────

  /**
   * Apply interpolation to raw data points
   *
   * @param rawData raw data points sorted by time ascending
   * @param startTime query start time (interpolation range)
   * @param endTime query end time
   * @param type interpolation type
   * @param intervalMs interpolation interval (ms)
   */
  private applyInterpolation(
    rawData: TagDataPoint[],
    startTime: Date,
    endTime: Date,
    type: InterpolationType,
    intervalMs: number,
  ): TagDataPoint[] {
    if (type === InterpolationType.RAW || rawData.length === 0) {
      return rawData;
    }

    // Filter valid numeric values (only numeric types participate in linear/step interpolation)
    // bool/string types are kept as-is and do not participate in interpolation
    const validData = rawData
      .filter((d) => typeof d.value === 'number' && d.value !== null)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (validData.length === 0) return rawData;

    const startMs = startTime.getTime();
    const endMs = endTime.getTime();

    if (type === InterpolationType.LINEAR) {
      return this.linearInterpolate(validData as TagDataPoint[], startMs, endMs, intervalMs);
    }

    if (type === InterpolationType.STEP) {
      return this.stepInterpolate(validData as TagDataPoint[], startMs, endMs, intervalMs);
    }

    return rawData;
  }

  /** Linear interpolation */
  private linearInterpolate(
    sortedData: TagDataPoint[],
    startMs: number,
    endMs: number,
    intervalMs: number,
  ): TagDataPoint[] {
    const result: TagDataPoint[] = [];
    const first = sortedData[0];

    // Points before the start time: reuse the first value
    let t = startMs;
    while (t < new Date(first.timestamp).getTime() && t <= endMs) {
      result.push({ value: first.value, timestamp: new Date(t).toISOString() });
      t += intervalMs;
    }

    // Linear interpolation between adjacent points
    for (let i = 0; i < sortedData.length - 1; i++) {
      const cur = sortedData[i];
      const next = sortedData[i + 1];
      const curTs = new Date(cur.timestamp).getTime();
      const nextTs = new Date(next.timestamp).getTime();

      t = Math.max(t, curTs);

      while (t < nextTs && t <= endMs) {
        const ratio = (t - curTs) / (nextTs - curTs);
        const curNum = Number(cur.value ?? 0);
        const nextNum = Number(next.value ?? 0);
        const value = curNum + (nextNum - curNum) * ratio;
        result.push({ value: Math.round(value * 1e6) / 1e6, timestamp: new Date(t).toISOString() });
        t += intervalMs;
      }
    }

    // After the last point: reuse the last value
    const last = sortedData[sortedData.length - 1];
    const lastTs = new Date(last.timestamp).getTime();
    t = Math.max(t, lastTs);
    while (t <= endMs) {
      result.push({ value: last.value, timestamp: new Date(t).toISOString() });
      t += intervalMs;
    }

    return result;
  }

  /** Step interpolation (previous-value hold) */
  private stepInterpolate(
    sortedData: TagDataPoint[],
    startMs: number,
    endMs: number,
    intervalMs: number,
  ): TagDataPoint[] {
    const result: TagDataPoint[] = [];
    let dataIdx = 0;
    let lastValue = sortedData[0].value;

    for (let t = startMs; t <= endMs; t += intervalMs) {
      // Advance to the latest data point after the current time
      while (
        dataIdx < sortedData.length &&
        new Date(sortedData[dataIdx].timestamp).getTime() <= t
      ) {
        lastValue = sortedData[dataIdx].value;
        dataIdx++;
      }
      result.push({ value: lastValue, timestamp: new Date(t).toISOString() });
    }

    return result;
  }

  /**
   * LTTB (Largest Triangle Three Buckets) downsampling algorithm
   */
  private lttbDownsample(data: TagDataPoint[], threshold: number): TagDataPoint[] {
    if (data.length <= threshold || threshold < 3) {
      return data;
    }

    const result: typeof data = [];
    const bucketSize = (data.length - 2) / (threshold - 2);
    let a = 0;
    result.push(data[0]);

    for (let i = 0; i < threshold - 2; i++) {
      const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
      const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);
      const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
      const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

      let avgX = 0;
      let avgY = 0;
      const avgCount = avgRangeEnd - avgRangeStart;
      if (avgCount <= 0) {
        const fallbackIndex = Math.min(rangeStart, data.length - 1);
        result.push(data[fallbackIndex]);
        a = fallbackIndex;
        continue;
      }

      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        avgX += new Date(data[j].timestamp).getTime();
        avgY += Number(data[j].value ?? 0);
      }
      avgX /= avgCount;
      avgY /= avgCount;

      let maxArea = -1;
      let maxAreaIndex = rangeStart;
      const pointAX = new Date(data[a].timestamp).getTime();
      const pointAY = Number(data[a].value ?? 0);
      const actualRangeEnd = Math.min(rangeEnd, data.length);

      for (let j = rangeStart; j < actualRangeEnd; j++) {
        const pointBX = new Date(data[j].timestamp).getTime();
        const pointBY = Number(data[j].value ?? 0);
        const area =
          Math.abs(
            (pointAX - avgX) * (pointBY - pointAY) - (pointAX - pointBX) * (avgY - pointAY),
          ) * 0.5;
        if (area > maxArea) {
          maxArea = area;
          maxAreaIndex = j;
        }
      }
      result.push(data[maxAreaIndex]);
      a = maxAreaIndex;
    }

    result.push(data[data.length - 1]);
    return result;
  }

  // ──────────── Data export ────────────

  async exportCsv(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ csv: string; filename: string }> {
    if (this.useSqlite) return this.exportCsvSqlite(tagId, startTime, endTime, projectId);
    return this.exportCsvInflux(tagId, startTime, endTime, projectId);
  }

  private async exportCsvSqlite(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ csv: string; filename: string }> {
    const repo = await this.getRepo(projectId);
    const records = await repo.find({
      where: { tagId, timestamp: Between(startTime, endTime) },
      order: { timestamp: 'ASC' },
    });

    const header = 'timestamp,value,quality\n';
    const rows = records
      .map(
        (r) =>
          `${r.timestamp.toISOString()},${this.pickValueFromRecord(r) ?? ''},${r.stringValue ?? 'good'}`,
      )
      .join('\n');

    const filename = `${tagId}_${startTime.toISOString().slice(0, 10)}_${endTime.toISOString().slice(0, 10)}.csv`;
    return { csv: header + rows, filename };
  }

  private async exportCsvInflux(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ csv: string; filename: string }> {
    const effectiveProjectId = projectId || 'default';
    const rows = await this.influxQueryService!.queryRange(effectiveProjectId, tagId, startTime, endTime);

    const header = 'timestamp,value,quality\n';
    const csvRows = rows
      .map((r) => `${r.timestamp.toISOString()},${r.value ?? ''},${r.quality ?? 'good'}`)
      .join('\n');

    const filename = `${tagId}_${startTime.toISOString().slice(0, 10)}_${endTime.toISOString().slice(0, 10)}.csv`;
    return { csv: header + csvRows, filename };
  }

  async exportJson(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ json: string; filename: string }> {
    if (this.useSqlite) return this.exportJsonSqlite(tagId, startTime, endTime, projectId);
    return this.exportJsonInflux(tagId, startTime, endTime, projectId);
  }

  private async exportJsonSqlite(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ json: string; filename: string }> {
    const repo = await this.getRepo(projectId);
    const records = await repo.find({
      where: { tagId, timestamp: Between(startTime, endTime) },
      order: { timestamp: 'ASC' },
    });

    const data = records.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      value: this.pickValueFromRecord(r),
      quality: r.stringValue ?? 'good',
    }));

    const filename = `${tagId}_${startTime.toISOString().slice(0, 10)}_${endTime.toISOString().slice(0, 10)}.json`;
    return { json: JSON.stringify(data, null, 2), filename };
  }

  private async exportJsonInflux(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ json: string; filename: string }> {
    const effectiveProjectId = projectId || 'default';
    const rows = await this.influxQueryService!.queryRange(effectiveProjectId, tagId, startTime, endTime);

    const data = rows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      value: r.value,
      quality: r.quality ?? 'good',
    }));

    const filename = `${tagId}_${startTime.toISOString().slice(0, 10)}_${endTime.toISOString().slice(0, 10)}.json`;
    return { json: JSON.stringify(data, null, 2), filename };
  }

  async exportBatchJson(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ json: string; filename: string }> {
    if (this.useSqlite) return this.exportBatchJsonSqlite(tagIds, startTime, endTime, projectId);
    return this.exportBatchJsonInflux(tagIds, startTime, endTime, projectId);
  }

  private async exportBatchJsonSqlite(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ json: string; filename: string }> {
    const repo = await this.getRepo(projectId);
    const result: Record<
      string,
      { timestamp: string; value: number | boolean | string | null; quality: string }[]
    > = {};

    for (const tagId of tagIds) {
      const records = await repo.find({
        where: { tagId, timestamp: Between(startTime, endTime) },
        order: { timestamp: 'ASC' },
      });
      result[tagId] = records.map((r) => ({
        timestamp: r.timestamp.toISOString(),
        value: this.pickValueFromRecord(r),
        quality: r.stringValue ?? 'good',
      }));
    }

    const filename = `batch_export_${startTime.toISOString().slice(0, 10)}_${endTime.toISOString().slice(0, 10)}.json`;
    return { json: JSON.stringify(result, null, 2), filename };
  }

  private async exportBatchJsonInflux(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ json: string; filename: string }> {
    if (tagIds.length === 0) {
      return {
        json: '{}',
        filename: `batch_export_${startTime.toISOString().slice(0, 10)}_${endTime.toISOString().slice(0, 10)}.json`,
      };
    }
    const effectiveProjectId = projectId || 'default';
    const rows = await this.influxQueryService!.queryRangeBatch(effectiveProjectId, tagIds, startTime, endTime);

    const groups = new Map<
      string,
      { timestamp: string; value: number | null; quality: string }[]
    >();
    for (const row of rows) {
      if (!groups.has(row.tagId)) groups.set(row.tagId, []);
      groups.get(row.tagId)!.push({
        timestamp: row.timestamp.toISOString(),
        value: row.value,
        quality: row.quality ?? 'good',
      });
    }

    const result: Record<string, { timestamp: string; value: number | null; quality: string }[]> =
      {};
    for (const tagId of tagIds) {
      result[tagId] = groups.get(tagId) || [];
    }

    const filename = `batch_export_${startTime.toISOString().slice(0, 10)}_${endTime.toISOString().slice(0, 10)}.json`;
    return { json: JSON.stringify(result, null, 2), filename };
  }

  // ──────────── Statistics overview ────────────

  async getTagStats(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{
    avg: number;
    max: number;
    min: number;
    sum: number;
    count: number;
    tagId: string;
  }> {
    if (this.useSqlite) return this.getTagStatsSqlite(tagId, startTime, endTime, projectId);
    return this.getTagStatsInflux(tagId, startTime, endTime, projectId);
  }

  private async getTagStatsSqlite(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ avg: number; max: number; min: number; sum: number; count: number; tagId: string }> {
    const repo = await this.getRepo(projectId);
    const [avgResult, maxResult, minResult, sumResult, count] = await Promise.all([
      this.aggregateSqlite(tagId, startTime, endTime, AggregationType.AVG, projectId),
      this.aggregateSqlite(tagId, startTime, endTime, AggregationType.MAX, projectId),
      this.aggregateSqlite(tagId, startTime, endTime, AggregationType.MIN, projectId),
      this.aggregateSqlite(tagId, startTime, endTime, AggregationType.SUM, projectId),
      repo.count({ where: { tagId, timestamp: Between(startTime, endTime) } }),
    ]);

    return {
      tagId,
      avg: avgResult.value,
      max: maxResult.value,
      min: minResult.value,
      sum: sumResult.value,
      count,
    };
  }

  private async getTagStatsInflux(
    tagId: string,
    startTime: Date,
    endTime: Date,
    projectId?: string,
  ): Promise<{ avg: number; max: number; min: number; sum: number; count: number; tagId: string }> {
    const effectiveProjectId = projectId || 'default';
    const s = this.influxQueryService!;
    const [avg, max, min, sum, count] = await Promise.all([
      s.queryAggregate(effectiveProjectId, tagId, startTime, endTime, 'mean'),
      s.queryAggregate(effectiveProjectId, tagId, startTime, endTime, 'max'),
      s.queryAggregate(effectiveProjectId, tagId, startTime, endTime, 'min'),
      s.queryAggregate(effectiveProjectId, tagId, startTime, endTime, 'sum'),
      s.queryAggregate(effectiveProjectId, tagId, startTime, endTime, 'count'),
    ]);
    return { tagId, avg, max, min, sum, count };
  }
}
