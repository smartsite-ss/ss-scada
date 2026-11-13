// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventBusService, EventLogService } from '@ss-node/ss-core';
import { STORAGE_ENGINE_TYPES, StorageEngineConfigService } from '@ss-node/ss-storage';

/** v3 database name length cap (v3 default is 64 characters) */
const DATABASE_NAME_MAX_LENGTH = 64;
/** Per-API fetch timeout (ms) */
const FETCH_TIMEOUT_MS = 5000;

/**
 * InfluxDB 3 Core project database management service (aligned with InfluxBucketService).
 *
 * P0 test (InfluxDB 3 Core 3.11.2) alignment:
 * - Create database: POST /api/v3/configure/database with body {"db", "retention_period"?};
 *   duplicate creation returns 409 (treated as already exists = success); SQL CREATE DATABASE is not supported
 *   ("DDL not supported: CreateCatalog");
 * - Isolation strategy (user decision): per-project databases, name ss-node-data-{projectId}
 *   (UUIDs with hyphens are valid, 48 chars ≤ the 64 cap);
 *   v3 Core has a 5-database limit (tested 422
 *   "Adding a new database would exceed limit of 5 databases"),
 *   a known constraint: project count is controlled by ops; beyond the limit, creation fails with a clear error;
 * - Retention period is set at creation time (v3 feature: cannot be modified afterwards), configured via INFLUXDB3_RETENTION_PERIOD;
 * - Health probe: /health requires Bearer auth (401 without a token),
 *   set to false on failure, back to true after recovery;
 * - project.created event: when a project's engine is influxdb3, create the database immediately (idempotent).
 */
@Injectable()
export class Influxdb3DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Influxdb3DatabaseService.name);

  /** Set of ready database names (avoids repeated calls to the create-database endpoint) */
  private readonly readyDatabases = new Set<string>();

  /** Whether InfluxDB 3 is available (set false on failure, back to true after the health check recovers) */
  private influxdb3Available = true;

  /** Health check timer */
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private readonly healthCheckIntervalMs = 60_000;
  private readonly healthCheckTimeoutMs = 5000;

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
        ? this.eventLogService.wrapSubscriber(eventType, 'Influxdb3DatabaseService', handler)
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

    // Project created → create the database immediately (idempotent; beyond the 5-database limit, log an error without breaking the event chain)
    this.eventBus.on(
      'project.created',
      wrap('project.created', async (payload: { projectId: string; tenantId?: string }) => {
        const projectId = payload.projectId;
        if (!projectId) return;
        const projectEngine = this.storageEngineConfig.getProjectEngine(projectId);
        if (projectEngine !== STORAGE_ENGINE_TYPES.INFLUXDB3) {
          return;
        }
        const databaseName = this.getDatabaseNameForProject(projectId);
        const created = await this.createDatabaseIfNotExists(databaseName);
        return { database: databaseName, created };
      }),
    );
    this.logger.log(
      'Influxdb3DatabaseService initialized — per-project database mode ' +
        '(naming: ss-node-data-{projectId}, known limit: 5 databases on v3 Core)',
    );

    this.startHealthCheck();
  }

  onModuleDestroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ──────────── Public API ────────────

  /**
   * Ensure the project database exists (lazy creation, idempotent).
   * Called by the adapter's write/read paths; on failure the database name is still returned (write_lp auto-creates as a fallback).
   */
  async ensureDatabase(projectId: string): Promise<string> {
    const databaseName = this.getDatabaseNameForProject(projectId);

    if (this.readyDatabases.has(databaseName) || !this.influxdb3Available) {
      return databaseName;
    }

    const created = await this.createDatabaseIfNotExists(databaseName);
    if (created) {
      this.readyDatabases.add(databaseName);
    }
    return databaseName;
  }

  /** Project → database name (pure name computation, no requests) */
  getDatabaseNameForProject(projectId: string): string {
    return this.normalizeDatabaseName(`ss-node-data-${projectId}`);
  }

  /** Fallback database name (query/write paths without a projectId) */
  getDefaultDatabase(): string {
    const base = process.env.INFLUXDB3_DATABASE || 'ss-node-data';
    return this.normalizeDatabaseName(base);
  }

  /**
   * v3 database name normalization (§5.4 sanitize boundary, pinned by unit tests):
   * ① underscore → hyphen (v3 database name convention);
   * ② other illegal characters (not [a-zA-Z0-9-]) removed;
   * ③ consecutive hyphens collapsed to one;
   * ④ leading/trailing hyphens stripped;
   * ⑤ length truncated to 64 characters.
   */
  normalizeDatabaseName(name: string): string {
    return name
      .replace(/_/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, DATABASE_NAME_MAX_LENGTH);
  }

  /** Reset the availability flag (retry after the health check recovers) */
  markAvailable(): void {
    this.influxdb3Available = true;
  }

  // ──────────── Internal methods ────────────

  /**
   * Create the database (idempotent: 409 = already exists, treated as success)
   * @returns true = database ready, false = creation failed
   */
  private async createDatabaseIfNotExists(databaseName: string): Promise<boolean> {
    const serverUrl = process.env.INFLUXDB3_URL || 'http://localhost:8181';
    const authToken = process.env.INFLUXDB3_TOKEN || '';
    // Retention period is set at creation time (v3 feature: cannot be modified afterwards), e.g. 365d; empty means the server default
    const retentionPeriod = process.env.INFLUXDB3_RETENTION_PERIOD || '';

    if (!authToken) {
      this.influxdb3Available = false;
      this.logger.warn(
        `InfluxDB 3 TOKEN not configured, skipping database creation for "${databaseName}"`,
      );
      return false;
    }

    try {
      // P0 test: the create-database endpoint is POST /api/v3/configure/database,
      // body {"db", "retention_period"?}; duplicate creation returns 409
      const body: Record<string, string> = { db: databaseName };
      if (retentionPeriod) {
        body.retention_period = retentionPeriod;
      }

      const response = await fetch(`${serverUrl}/api/v3/configure/database`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok || response.status === 409) {
        // 409 = already exists, idempotent success
        this.logger.log(
          `InfluxDB 3 database "${databaseName}" ensured (HTTP ${response.status}, ` +
            `retention: ${retentionPeriod || 'server-default'}, note: v3 retention cannot be changed after database creation)`,
        );
        return true;
      }

      const errorBody = await response.text().catch(() => 'unknown');
      // 422 = beyond v3 Core's 5-database limit (user decision: keep per-project databases; project count is ops-controlled)
      if (response.status === 422 && /limit of \d+ databases/i.test(errorBody)) {
        this.logger.error(
          `Failed to create InfluxDB 3 database "${databaseName}": exceeds v3 Core database limit ` +
            `(5 by default). Clean up unused databases or reduce project count. HTTP 422: ${errorBody}`,
        );
      } else {
        this.logger.error(
          `Failed to create InfluxDB 3 database "${databaseName}": HTTP ${response.status} ${errorBody}`,
        );
      }
      this.influxdb3Available = false;
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `InfluxDB 3 database creation error for "${databaseName}": ${errorMessage}`,
      );
      this.influxdb3Available = false;
      return false;
    }
  }

  /** Periodic health probe — /health with Bearer auth; 200 restores influxdb3Available */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      if (this.influxdb3Available) return;
      try {
        const serverUrl = process.env.INFLUXDB3_URL || 'http://localhost:8181';
        const authToken = process.env.INFLUXDB3_TOKEN || '';
        const response = await fetch(`${serverUrl}/health`, {
          headers: { Authorization: `Bearer ${authToken}` },
          signal: AbortSignal.timeout(this.healthCheckTimeoutMs),
        });
        if (response.ok) {
          this.logger.warn(
            'InfluxDB 3 health check passed — restoring availability, database creation will resume',
          );
          this.influxdb3Available = true;
        }
      } catch {
        // Still unreachable, keep false and wait for the next probe
      }
    }, this.healthCheckIntervalMs);
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }
}
