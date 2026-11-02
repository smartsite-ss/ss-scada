// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  DataPoint,
  QueryOptions,
  AdapterCapabilities,
  STORAGE_ENGINE_TYPES,
  InfluxBaseAdapter,
  EngineReadRequest,
  serializeLineProtocol,
} from '@ss-node/ss-storage';
import { FluxQueryBuilder } from './query/flux-query.builder';
import { FluxCsvParser } from './parse/flux-csv.parser';

// CODE-05: per-InfluxDB-fetch timeout (ms), preventing an indefinitely hung request from blocking the event loop
const FETCH_TIMEOUT_MS = 5000;

/**
 * InfluxDB 2.x adapter (engine type influxdb2).
 *
 * After the P1 abstraction consolidation: buffered batch writes / failure retry / close flush / the read transport
 * skeleton are inherited from InfluxBaseAdapter, Line Protocol serialization reuses serializeLineProtocol,
 * query dialects go through FluxQueryBuilder, and result normalization through FluxCsvParser —
 * write/read behavior is identical to before the consolidation.
 */
@Injectable()
export class InfluxdbAdapterService
  extends InfluxBaseAdapter
  implements OnModuleInit, OnModuleDestroy
{
  readonly name = 'InfluxDB';
  readonly engineType = STORAGE_ENGINE_TYPES.INFLUXDB2;
  readonly capabilities: AdapterCapabilities = {
    delete: true,
    interpolation: true, // Flux interpolate.linear / fill(usePrevious) natively supported
    aggregation: true,
  };
  protected readonly logger = new Logger(InfluxdbAdapterService.name);
  protected readonly readErrorLabel = 'InfluxDB query';

  private readonly queryBuilder = new FluxQueryBuilder();
  private readonly responseParser = new FluxCsvParser();

  private influxUrl: string;
  private influxToken: string;
  private influxOrg: string;
  private influxBucket: string;

  constructor() {
    super();
    this.influxUrl = process.env.INFLUXDB_URL || 'http://localhost:8086';
    this.influxToken = process.env.INFLUXDB_TOKEN || '';
    this.influxOrg = process.env.INFLUXDB_ORG || 'ss-org';
    this.influxBucket = process.env.INFLUXDB_BUCKET || 'ss_node_data';
  }

  onModuleInit(): void {
    this.logger.log(
      `InfluxdbAdapterService initialized (engine: ${this.engineType}, batch: 1000, flush: 5000ms)`,
    );
  }

  onModuleDestroy(): void {
    void this.close();
  }

  // ──────────── Write hook: POST /api/v2/write ────────────

  protected async sendBatch(points: DataPoint[]): Promise<void> {
    const lines = serializeLineProtocol(points);

    const response = await fetch(
      `${this.influxUrl}/api/v2/write?org=${this.influxOrg}&bucket=${this.influxBucket}&precision=ns`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.influxToken}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: lines,
        // CODE-05: add a 5s timeout to fetch
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok && response.status !== 204) {
      const errorBody = await response.text().catch(() => 'unknown');
      throw new Error(`InfluxDB HTTP ${response.status}: ${errorBody}`);
    }
  }

  // ──────────── Read hook: POST /api/v2/query (Flux) ────────────

  protected async buildReadRequest(options: QueryOptions): Promise<EngineReadRequest> {
    const fluxQuery = this.queryBuilder.buildQuery(options, { name: this.influxBucket });

    return {
      url: `${this.influxUrl}/api/v2/query?org=${this.influxOrg}`,
      headers: {
        Authorization: `Token ${this.influxToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/csv',
      },
      body: JSON.stringify({ query: fluxQuery }),
    };
  }

  protected parseReadResponse(rawText: string): DataPoint[] {
    return this.responseParser.parse(rawText);
  }

  // ──────────── delete ────────────

  async delete(options: { tagIds?: string[]; before?: Date }): Promise<number> {
    const { tagIds, before } = options;

    let predicate = '';
    if (tagIds && tagIds.length > 0) {
      const tagFilters = tagIds.map((id) => `r["tagId"] == "${id}"`).join(' or ');
      predicate += `(${tagFilters})`;
    }
    if (before) {
      const timeFilter = `r["_time"] <= ${before.toISOString()}`;
      predicate += predicate ? ` and ${timeFilter}` : timeFilter;
    }

    if (!predicate) {
      predicate = 'true';
    }

    try {
      const url = `${this.influxUrl}/api/v2/delete?org=${this.influxOrg}&bucket=${this.influxBucket}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.influxToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          predicate: predicate,
          start: '1970-01-01T00:00:00Z',
          stop: (before || new Date()).toISOString(),
        }),
        // CODE-05: add a 5s timeout to fetch
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok && response.status !== 204) {
        const errorBody = await response.text().catch(() => 'unknown');
        throw new Error(`InfluxDB delete failed (${response.status}): ${errorBody}`);
      }

      this.logger.log(`Delete completed: predicate="${predicate}"`);
      return -1; // InfluxDB delete API doesn't return count
    } catch (error) {
      this.logger.error(`InfluxDB delete error: ${(error as Error).message}`);
      throw error;
    }
  }

  // ──────────── health ────────────

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    try {
      const response = await fetch(`${this.influxUrl}/health`, {
        method: 'GET',
        headers: { Authorization: `Token ${this.influxToken}` },
        // CODE-05: add a 5s timeout to fetch
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        return { status: 'healthy', details: { ...body, pendingBuffer: this.pendingBufferCount } };
      }

      return {
        status: 'degraded',
        details: { httpStatus: response.status, pendingBuffer: this.pendingBufferCount },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: { error: (error as Error).message, pendingBuffer: this.pendingBufferCount },
      };
    }
  }
}
