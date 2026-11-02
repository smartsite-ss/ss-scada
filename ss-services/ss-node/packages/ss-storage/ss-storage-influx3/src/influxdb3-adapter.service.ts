// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import {
  DataPoint,
  QueryOptions,
  AdapterCapabilities,
  STORAGE_ENGINE_TYPES,
  InfluxBaseAdapter,
  EngineReadRequest,
  NotSupportedError,
  serializeLineProtocol,
} from '@ss-node/ss-storage';
import { Influxdb3DatabaseService } from './influxdb3-database.service';
import { Influxdb3SqlQueryBuilder } from './query/influxdb3-sql-query.builder';
import { Influxdb3JsonParser } from './parse/influxdb3-json.parser';

// CODE-05: per-fetch timeout (ms), preventing an indefinitely hung request from blocking the event loop
const FETCH_TIMEOUT_MS = 5000;

/**
 * InfluxDB 3 Core adapter (engine type influxdb3).
 *
 * P0 test (InfluxDB 3 Core 3.11.2) alignment:
 * - Write: POST /api/v3/write_lp?db={database}&precision=ns (Bearer auth,
 *   testing shows the token prefix is compatible as well);
 *   v3 does not support string fields (value_text/metadata fail the whole line), so skipStringFields
 *   is enabled at serialization; points with non-numeric values are skipped entirely and counted for alerting;
 *   Per-project databases (user decision): group by projectId before writing, ensure each database exists, then write;
 * - Read: POST /api/v3/query_sql with body {"db","q"} (tested: the sql field is not recognized);
 *   the response is a sparse array of objects; columns never written do not appear in the rows;
 *   queries are routed to the project database by options.projectId;
 * - Health check: /health requires Bearer auth (401 without a token),
 *   the response body is plain text "OK" (not JSON);
 * - Delete: InfluxDB 3 Core has no compactor; DELETE fails with "DML not supported",
 *   capabilities.delete = false, delete() throws NotSupportedError directly;
 *   upper layers should check capabilities before calling and fall back to retention expiry / database rebuild.
 */
@Injectable()
export class Influxdb3AdapterService
  extends InfluxBaseAdapter
  implements OnModuleInit, OnModuleDestroy
{
  readonly name = 'InfluxDB 3 Core';
  readonly engineType = STORAGE_ENGINE_TYPES.INFLUXDB3;
  readonly capabilities: AdapterCapabilities = {
    delete: false, // v3 Core has no compactor, delete not supported (P0 test: DML not supported)
    interpolation: true, // date_bin_gapfill + interpolate/locf natively supported (P0 test passed)
    aggregation: true,
  };
  protected readonly logger = new Logger(Influxdb3AdapterService.name);
  protected readonly readErrorLabel = 'InfluxDB 3 query';

  private readonly queryBuilder = new Influxdb3SqlQueryBuilder();
  private readonly responseParser = new Influxdb3JsonParser();

  private influxdb3Url: string;
  private influxdb3Token: string;

  /** Count of skipped non-numeric data points (v3 does not support string fields; accumulated for health details and alerting) */
  private skippedTextPointCount = 0;

  constructor(@Optional() private readonly databaseService?: Influxdb3DatabaseService) {
    super();
    this.influxdb3Url = process.env.INFLUXDB3_URL || 'http://localhost:8181';
    this.influxdb3Token = process.env.INFLUXDB3_TOKEN || '';
  }

  onModuleInit(): void {
    this.logger.log(
      `Influxdb3AdapterService initialized (engine: ${this.engineType}, url: ${this.influxdb3Url}, ` +
        `database service: ${!!this.databaseService}, isolation: per-project database ` +
        `ss-node-data-{projectId})`,
    );
  }

  onModuleDestroy(): void {
    void this.close();
  }

  // ──────────── Write hook: POST /api/v3/write_lp ────────────

  protected async sendBatch(points: DataPoint[]): Promise<void> {
    // v3 does not support string fields: points with non-numeric values are skipped entirely (the write would fail the whole line anyway)
    const numericPoints = points.filter((point) => {
      if (typeof point.value === 'number') return true;
      this.skippedTextPointCount++;
      return false;
    });

    if (this.skippedTextPointCount > 0) {
      this.logger.warn(
        `InfluxDB 3 Core does not support string field values: skipped ` +
          `${this.skippedTextPointCount} non-numeric point(s) in total (tagId list omitted)`,
      );
    }

    if (numericPoints.length === 0) {
      return;
    }

    // Per-project databases (user decision): group by projectId, ensure each database exists, then write;
    // any group failure throws (handled uniformly by the base class retry mechanism)
    const pointsByProject = new Map<string, DataPoint[]>();
    for (const point of numericPoints) {
      const projectId = point.projectId || '';
      const group = pointsByProject.get(projectId);
      if (group) {
        group.push(point);
      } else {
        pointsByProject.set(projectId, [point]);
      }
    }

    for (const [projectId, projectPoints] of pointsByProject) {
      const databaseName = await this.resolveWriteDatabase(projectId);
      await this.writeLines(
        databaseName,
        serializeLineProtocol(projectPoints, { skipStringFields: true }),
      );
    }
  }

  private async writeLines(databaseName: string, lines: string): Promise<void> {
    const response = await fetch(
      `${this.influxdb3Url}/api/v3/write_lp?db=${encodeURIComponent(databaseName)}&precision=ns`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.influxdb3Token}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: lines,
        // CODE-05: add a 5s timeout to fetch
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok && response.status !== 204) {
      const errorBody = await response.text().catch(() => 'unknown');
      throw new Error(`InfluxDB 3 HTTP ${response.status}: ${errorBody}`);
    }
  }

  /** Write routing: projectId → project database (fallback database name when no databaseService) */
  private async resolveWriteDatabase(projectId: string): Promise<string> {
    if (!projectId) {
      return this.databaseService
        ? this.databaseService.getDefaultDatabase()
        : (process.env.INFLUXDB3_DATABASE || 'ss-node-data').replace(/_/g, '-');
    }
    return this.databaseService
      ? this.databaseService.ensureDatabase(projectId)
      : this.normalizeFallbackDatabaseName(`ss-node-data-${projectId}`);
  }

  /** Local normalization when no databaseService (same rules as DatabaseService.normalizeDatabaseName) */
  private normalizeFallbackDatabaseName(name: string): string {
    return name
      .replace(/_/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  // ──────────── Read hook: POST /api/v3/query_sql (SQL) ────────────

  protected async buildReadRequest(options: QueryOptions): Promise<EngineReadRequest> {
    // Per-project databases: projectId routes to the project database; fallback database when no projectId
    const databaseName = options.projectId
      ? await this.resolveReadDatabase(options.projectId)
      : this.getFallbackDatabaseName();

    const sqlQuery = this.queryBuilder.buildQuery(options, { name: databaseName });

    return {
      url: `${this.influxdb3Url}/api/v3/query_sql?db=${encodeURIComponent(databaseName)}&format=json`,
      headers: {
        Authorization: `Bearer ${this.influxdb3Token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // P0 test: the body must be {"db","q"}; the sql field is not recognized (missing field `q`)
      body: JSON.stringify({ db: databaseName, q: sqlQuery }),
    };
  }

  /** Read routing: projectId → project database */
  private async resolveReadDatabase(projectId: string): Promise<string> {
    return this.databaseService
      ? this.databaseService.ensureDatabase(projectId)
      : this.normalizeFallbackDatabaseName(`ss-node-data-${projectId}`);
  }

  /** Fallback database name (when no databaseService) */
  private getFallbackDatabaseName(): string {
    return this.databaseService
      ? this.databaseService.getDefaultDatabase()
      : (process.env.INFLUXDB3_DATABASE || 'ss-node-data').replace(/_/g, '-');
  }

  protected parseReadResponse(rawText: string): DataPoint[] {
    return this.responseParser.parse(rawText);
  }

  // ──────────── delete (restricted capability, throws NotSupportedError) ────────────

  async delete(_options: { tagIds?: string[]; before?: Date }): Promise<number> {
    // InfluxDB 3 Core has no compactor and does not support delete; upper layers should check capabilities.delete before calling
    // and fall back to "retention expiry / database rebuild" instead (plan §7.2)
    throw new NotSupportedError(
      'InfluxDB 3 Core does not support delete (no compactor); use retention period or recreate database instead',
    );
  }

  // ──────────── health ────────────

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    try {
      // P0 test: /health requires Bearer auth (401 without a token); the response body is plain text "OK"
      const response = await fetch(`${this.influxdb3Url}/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.influxdb3Token}` },
        // CODE-05: add a 5s timeout to fetch
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok) {
        const rawBody = await response.text().catch(() => '');
        return {
          status: 'healthy',
          details: {
            serverResponse: rawBody,
            pendingBuffer: this.pendingBufferCount,
            skippedTextPoints: this.skippedTextPointCount,
          },
        };
      }

      return {
        status: 'degraded',
        details: {
          httpStatus: response.status,
          pendingBuffer: this.pendingBufferCount,
          skippedTextPoints: this.skippedTextPointCount,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: (error as Error).message,
          pendingBuffer: this.pendingBufferCount,
          skippedTextPoints: this.skippedTextPointCount,
        },
      };
    }
  }
}
