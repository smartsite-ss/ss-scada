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
  serializeLineProtocol,
} from '@ss-node/ss-storage';
import { TdengineDatabaseService } from './tdengine-database.service';
import { TdengineSqlQueryBuilder } from './query/tdengine-sql-query.builder';
import { TdengineJsonParser } from './parse/tdengine-json.parser';

// CODE-05: per-fetch timeout (ms), preventing an indefinitely hung request from blocking the event loop
const FETCH_TIMEOUT_MS = 5000;

/**
 * TDengine adapter (engine type tdengine).
 *
 * - Write: reuses serializeLineProtocol → taosAdapter's InfluxDB Line Protocol compatible endpoint
 *   POST /influxdb/v1/write?db={database}&precision=ns (Basic Auth);
 *   before writing, TdengineDatabaseService idempotently ensures the child table exists (CREATE TABLE ... USING ... TAGS);
 * - Read: TdengineSqlQueryBuilder → POST /rest/sql/{database} (INTERVAL/FILL dialect),
 *   results normalized by TdengineJsonParser;
 * - Delete: per-child-table range `DELETE FROM t_{tagId} WHERE ts < ...` (capabilities.delete = true;
 *   super-table-level deletion is restricted and must be avoided);
 * - Multi-project isolation: database = {TDENGINE_DATABASE}_{projectId}, super table tag_values + child tables t_{tagId}.
 */
@Injectable()
export class TdengineAdapterService
  extends InfluxBaseAdapter
  implements OnModuleInit, OnModuleDestroy
{
  readonly name = 'TDengine';
  readonly engineType = STORAGE_ENGINE_TYPES.TDENGINE;
  readonly capabilities: AdapterCapabilities = {
    delete: true, // supports per-child-table range delete (super-table-level delete is restricted)
    interpolation: true, // FILL(PREV/LINEAR/NULL) natively supported
    aggregation: true, // INTERVAL + AVG/MAX/MIN/SUM/COUNT natively supported
  };
  protected readonly logger = new Logger(TdengineAdapterService.name);
  protected readonly readErrorLabel = 'TDengine query';

  private readonly queryBuilder = new TdengineSqlQueryBuilder();
  private readonly responseParser = new TdengineJsonParser();

  private tdengineUrl: string;
  private tdengineUser: string;
  private tdenginePassword: string;

  constructor(@Optional() private readonly databaseService?: TdengineDatabaseService) {
    super();
    this.tdengineUrl = process.env.TDENGINE_URL || 'http://localhost:6041';
    this.tdengineUser = process.env.TDENGINE_USER || 'root';
    this.tdenginePassword = process.env.TDENGINE_PASSWORD || 'taosdata';
  }

  onModuleInit(): void {
    this.logger.log(
      `TdengineAdapterService initialized (engine: ${this.engineType}, url: ${this.tdengineUrl}, ` +
        `per-project databases: ${!!this.databaseService})`,
    );
  }

  onModuleDestroy(): void {
    void this.close();
  }

  // ──────────── Write hook: taosAdapter /influxdb/v1/write ────────────

  protected async sendBatch(points: DataPoint[]): Promise<void> {
    // Strict-mode constraint: idempotently ensure the child table exists before writing (value DOUBLE; non-numeric values already split to value_text in the serialization layer)
    if (this.databaseService) {
      await this.databaseService.ensureSubtables(points);
    }

    // Send grouped by project isolation unit (database)
    const pointsByDatabase = new Map<string, DataPoint[]>();
    for (const point of points) {
      const databaseName = this.resolveDatabaseName(point.projectId);
      const grouped = pointsByDatabase.get(databaseName);
      if (grouped) {
        grouped.push(point);
      } else {
        pointsByDatabase.set(databaseName, [point]);
      }
    }

    for (const [databaseName, groupedPoints] of pointsByDatabase) {
      await this.writeLines(databaseName, serializeLineProtocol(groupedPoints));
    }
  }

  private async writeLines(databaseName: string, lines: string): Promise<void> {
    const authorizationToken = Buffer.from(
      `${this.tdengineUser}:${this.tdenginePassword}`,
    ).toString('base64');

    const response = await fetch(
      `${this.tdengineUrl}/influxdb/v1/write?db=${encodeURIComponent(databaseName)}&precision=ns`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorizationToken}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: lines,
        // CODE-05: add a 5s timeout to fetch
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok && response.status !== 204) {
      const errorBody = await response.text().catch(() => 'unknown');
      throw new Error(`TDengine HTTP ${response.status}: ${errorBody}`);
    }
  }

  // ──────────── Read hook: POST /rest/sql/{database} ────────────

  protected async buildReadRequest(options: QueryOptions): Promise<EngineReadRequest> {
    // Multi-project isolation: route by options.projectId first; fall back to the default database when unspecified
    const databaseName =
      options.projectId && this.databaseService
        ? (await this.databaseService.ensureDatabase(options.projectId))
          ? this.databaseService.getDatabaseName(options.projectId)
          : this.getDefaultDatabaseName()
        : this.getDefaultDatabaseName();

    const sqlQuery = this.queryBuilder.buildQuery(options, { name: databaseName });
    const authorizationToken = Buffer.from(
      `${this.tdengineUser}:${this.tdenginePassword}`,
    ).toString('base64');

    return {
      url: `${this.tdengineUrl}/rest/sql/${encodeURIComponent(databaseName)}`,
      headers: {
        Authorization: `Basic ${authorizationToken}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: sqlQuery,
    };
  }

  protected parseReadResponse(rawText: string): DataPoint[] {
    return this.responseParser.parse(rawText);
  }

  // ──────────── delete (per child table) ────────────

  async delete(options: { tagIds?: string[]; before?: Date }): Promise<number> {
    const { tagIds, before } = options;

    // Super-table-level deletion is restricted: must specify tagIds and delete child table by child table
    if (!tagIds || tagIds.length === 0) {
      throw new Error(
        'TDengine delete requires tagIds (super-table level delete is restricted; delete per sub-table instead)',
      );
    }

    const timeBoundary = before ? before.toISOString() : new Date().toISOString();
    let deletedRows = 0;
    let countAvailable = true;

    // Execute DELETE FROM t_{tagId} WHERE ts < boundary per child table (using the default database)
    for (const tagId of tagIds) {
      const subtableName = this.databaseService
        ? this.databaseService.getSubtableName(tagId)
        : `t_${tagId.replace(/[^a-zA-Z0-9_]/g, '')}`;
      const databaseName = this.getDefaultDatabaseName();

      try {
        const affectedRows = await this.executeDelete(databaseName, subtableName, timeBoundary);
        if (affectedRows < 0) {
          countAvailable = false;
        } else {
          deletedRows += affectedRows;
        }
      } catch (error) {
        this.logger.error(
          `TDengine delete error for sub-table ${subtableName}: ${(error as Error).message}`,
        );
        throw error;
      }
    }

    return countAvailable ? deletedRows : -1;
  }

  private async executeDelete(
    databaseName: string,
    subtableName: string,
    timeBoundary: string,
  ): Promise<number> {
    const deleteStatement = `DELETE FROM \`${databaseName}\`.${subtableName} WHERE ts < '${timeBoundary}'`;
    if (this.databaseService) {
      return this.databaseService.executeSql(databaseName, deleteStatement);
    }

    // Without a database service, go through REST directly
    const authorizationToken = Buffer.from(
      `${this.tdengineUser}:${this.tdenginePassword}`,
    ).toString('base64');
    const response = await fetch(
      `${this.tdengineUrl}/rest/sql/${encodeURIComponent(databaseName)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorizationToken}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: deleteStatement,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      throw new Error(`TDengine HTTP ${response.status}: ${errorBody}`);
    }
    return -1;
  }

  // ──────────── health ────────────

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    const authorizationToken = Buffer.from(
      `${this.tdengineUser}:${this.tdenginePassword}`,
    ).toString('base64');

    try {
      const response = await fetch(`${this.tdengineUrl}/rest/sql`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorizationToken}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: 'SELECT SERVER_STATUS',
        // CODE-05: add a 5s timeout to fetch
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        const serverHealthy = (body as { status?: string }).status === 'succ';
        return {
          status: serverHealthy ? 'healthy' : 'degraded',
          details: { ...body, pendingBuffer: this.pendingBufferCount },
        };
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

  // ──────────── Internal methods ────────────

  /** Project → database name mapping (falls back to the default database name when no database service) */
  private resolveDatabaseName(projectId: string): string {
    return this.databaseService ? this.databaseService.getDatabaseName(projectId) : 'ss_node_data';
  }

  private getDefaultDatabaseName(): string {
    return process.env.TDENGINE_DATABASE || 'ss_node_data';
  }
}
