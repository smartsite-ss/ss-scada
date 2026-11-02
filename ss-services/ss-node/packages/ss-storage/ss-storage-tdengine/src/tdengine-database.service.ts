// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventBusService, EventLogService } from '@ss-node/ss-core';
import { DataPoint, STORAGE_ENGINE_TYPES, StorageEngineConfigService } from '@ss-node/ss-storage';

/** Per-fetch timeout (ms) */
const FETCH_TIMEOUT_MS = 5000;
/** Super-table name (same as the Line Protocol measurement) */
const SUPER_TABLE_NAME = 'tag_values';

/** TDengine REST SQL response */
interface TdengineRestResponse {
  status: string;
  code: number;
  message?: string;
  rows?: number;
}

/**
 * TDengine project database + super-table/child-table management service.
 *
 * Responsibilities (plan §7.4.2 strict-mode modeling):
 * - Project → database mapping: `{TDENGINE_DATABASE}_{projectId}` (keeps underscore naming);
 * - Listens for project.created to create the database and super table automatically (idempotent), only when the project's engine is tdengine;
 * - Super-table modeling (strict mode): value DOUBLE (numeric main column), value_text BINARY(4096) (non-numeric fallback column),
 *   quality INT; TAGS: projectId / tagId / deviceId;
 * - Child-table lazy creation: per tagId (t_{tagId}), idempotent CREATE TABLE ... USING ... TAGS before writing;
 * - Retention KEEP is set at database creation (like v3, fixed afterwards), configured via TDENGINE_KEEP_DAYS.
 */
@Injectable()
export class TdengineDatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TdengineDatabaseService.name);

  /** Cache of known-ready databases (database + super table created) */
  private readonly knownDatabases = new Set<string>();

  /** Cache of known-created child tables (key: `{databaseName}:{tagId}`) */
  private readonly knownSubtables = new Set<string>();

  /** Databases currently being created (prevents concurrent duplicate creation) */
  private readonly pendingCreations = new Map<string, Promise<boolean>>();

  constructor(
    private readonly eventBus: EventBusService,
    private readonly storageEngineConfig: StorageEngineConfigService,
    @Optional() private readonly eventLogService?: EventLogService,
  ) {}

  onModuleInit(): void {
    const wrap = <T extends any[]>(
      eventType: string,
      handler: (...args: T) => Promise<Record<string, any> | void>,
    ): ((...args: T) => Promise<void>) => {
      const traced = this.eventLogService
        ? this.eventLogService.wrapSubscriber(eventType, 'TdengineDatabaseService', handler)
        : async (...args: T) => {
            await handler(...args);
          };
      return async (...args: T) => {
        try {
          await traced(...args);
        } catch (err) {
          this.logger.error(`Handler for ${eventType} failed: ${(err as Error).message}`);
        }
      };
    };

    // Listen for project-created events; create the database and super table automatically only when the project's engine is tdengine
    this.eventBus.on(
      'project.created',
      wrap('project.created', async (payload: { projectId: string; tenantId?: string }) => {
        const projectId = payload.projectId;
        if (!projectId) return;
        const projectEngine = this.storageEngineConfig.getProjectEngine(projectId);
        if (projectEngine !== STORAGE_ENGINE_TYPES.TDENGINE) {
          return;
        }
        this.logger.log(
          `project.created event received, ensuring TDengine database for: ${projectId}`,
        );
        const created = await this.ensureDatabase(projectId);
        return {
          databaseCreated: created,
          databaseName: this.getDatabaseName(projectId),
        };
      }),
    );
    this.logger.log(
      'TdengineDatabaseService initialized — listening for project.created (engine=tdengine)',
    );
  }

  onModuleDestroy(): void {
    // No timer to clean up (health probing is handled by the adapter's health())
  }

  // ──────────── Public API ────────────

  /** Project → database name (pure name mapping, no requests): `{base}_{safeProjectId}` */
  getDatabaseName(projectId: string): string {
    const base = process.env.TDENGINE_DATABASE || 'ss_node_data';
    return `${this.normalizeIdentifier(base)}_${this.normalizeIdentifier(projectId)}`;
  }

  /**
   * Ensure the given project's database + super table exist (idempotent)
   * @returns true = ready, false = creation failed (caller should fall back to the default database)
   */
  async ensureDatabase(projectId: string): Promise<boolean> {
    const databaseName = this.getDatabaseName(projectId);

    if (this.knownDatabases.has(databaseName)) {
      return true;
    }

    const pending = this.pendingCreations.get(databaseName);
    if (pending) {
      return pending;
    }

    const promise = this.createDatabaseIfNotExists(databaseName);
    this.pendingCreations.set(databaseName, promise);

    try {
      return await promise;
    } finally {
      this.pendingCreations.delete(databaseName);
    }
  }

  /**
   * Ensure the child tables corresponding to a batch of write points exist (lazy creation + idempotent, called before writing).
   * Child tables are per tagId: `t_{safeTagId}` USING super table TAGS(projectId, tagId, deviceId).
   */
  async ensureSubtables(points: DataPoint[]): Promise<void> {
    for (const point of points) {
      const databaseName = this.getDatabaseName(point.projectId);
      const cacheKey = `${databaseName}:${point.tagId}`;
      if (this.knownSubtables.has(cacheKey)) {
        continue;
      }

      const createStatement =
        `CREATE TABLE IF NOT EXISTS \`${databaseName}\`.${this.getSubtableName(point.tagId)} ` +
        `USING \`${databaseName}\`.${SUPER_TABLE_NAME} ` +
        `TAGS (${this.escapeSqlLiteral(point.projectId)}, ${this.escapeSqlLiteral(point.tagId)}, ` +
        `${this.escapeSqlLiteral(point.deviceId)})`;

      await this.executeSql(databaseName, createStatement);
      this.knownSubtables.add(cacheKey);
    }
  }

  /** Child table name: t_{tagId} (characters not in [a-zA-Z0-9_] removed from tagId, e.g. UUID hyphens) */
  getSubtableName(tagId: string): string {
    return `t_${this.normalizeIdentifier(tagId)}`;
  }

  /**
   * Execute SQL (POST /rest/sql/{database}, Basic Auth)
   * @returns the response's rows (affected row count; used for counting on DELETE, result row count on queries)
   */
  async executeSql(databaseName: string, sqlStatement: string): Promise<number> {
    const serverUrl = process.env.TDENGINE_URL || 'http://localhost:6041';
    const userName = process.env.TDENGINE_USER || 'root';
    const password = process.env.TDENGINE_PASSWORD || 'taosdata';
    const authorizationToken = Buffer.from(`${userName}:${password}`).toString('base64');

    const response = await fetch(`${serverUrl}/rest/sql/${encodeURIComponent(databaseName)}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorizationToken}`,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: sqlStatement,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      throw new Error(`TDengine HTTP ${response.status}: ${errorBody}`);
    }

    const parsed = (await response.json()) as TdengineRestResponse;
    if (parsed.status !== 'succ') {
      throw new Error(
        `TDengine SQL failed (code ${parsed.code}): ${parsed.message || 'unknown error'}`,
      );
    }
    return parsed.rows ?? 0;
  }

  // ──────────── Internal methods ────────────

  private async createDatabaseIfNotExists(databaseName: string): Promise<boolean> {
    try {
      // Retention KEEP is set at database creation (unit: days); empty means the server default
      const keepDays = process.env.TDENGINE_KEEP_DAYS || '';
      const createDatabaseStatement = keepDays
        ? `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` KEEP ${keepDays}`
        : `CREATE DATABASE IF NOT EXISTS \`${databaseName}\``;

      // Strict-mode super table: value DOUBLE / value_text BINARY / quality INT; TAGS are dimension columns
      const createSuperTableStatement =
        `CREATE STABLE IF NOT EXISTS \`${databaseName}\`.${SUPER_TABLE_NAME} (` +
        `ts TIMESTAMP, value DOUBLE, value_text BINARY(4096), quality INT) ` +
        `TAGS (projectId BINARY(64), tagId BINARY(64), deviceId BINARY(64))`;

      // CREATE DATABASE is an admin statement; the REST context database name is unrestricted (the target database name is used as the default context)
      await this.executeSql(databaseName, createDatabaseStatement);
      await this.executeSql(databaseName, createSuperTableStatement);

      this.knownDatabases.add(databaseName);
      this.logger.log(
        `TDengine database "${databaseName}" + stable "${SUPER_TABLE_NAME}" ensured ` +
          `(keep: ${keepDays || 'server-default'}，注意：KEEP 建库时设定后语义固定)`,
      );
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`TDengine database creation error for "${databaseName}": ${errorMessage}`);
      return false;
    }
  }

  /** Identifier whitelist normalization: keeps only [a-zA-Z0-9_] (safe for database/child-table names) */
  private normalizeIdentifier(identifier: string): string {
    return identifier.replace(/[^a-zA-Z0-9_]/g, '');
  }

  /** SQL string literal escaping: single quotes doubled, blocking injection */
  private escapeSqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }
}
