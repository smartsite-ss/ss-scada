// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { EventBusService } from '../event-bus/event-bus.service';
import { PathResolverService } from '../path/path-resolver.service';
import { EventLogService } from '../event-log/event-log.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqlite3 = require('sqlite3');

/** SQL init-script file name */
const INIT_SCRIPT = 'init-system-db.sql';

/**
 * Connection-pool config
 */
export interface PoolConfig {
  /** Max connections, default 10 */
  maxConnections: number;
  /** Idle-connection timeout (ms), default 30000 */
  idleTimeoutMs: number;
  /** Connection health-check interval (ms), default 60000 */
  healthCheckIntervalMs: number;
  /** Connection-acquisition timeout (ms), default 5000 */
  acquireTimeoutMs: number;
}

/**
 * Connection-pool statistics
 */
export interface PoolStats {
  activeConnections: number;
  idleConnections: number;
  pendingRequests: number;
  totalCreated: number;
  totalDestroyed: number;
  acquireFailures: number;
  healthCheckFailures: number;
  lastHealthCheck: Date | null;
}

/** Default connection-pool config */
const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxConnections: 10,
  idleTimeoutMs: 30000,
  healthCheckIntervalMs: 60000,
  acquireTimeoutMs: 5000,
};

/** SQLite busy-wait timeout (ms), preventing SQLITE_BUSY deadlocks under concurrent access */
const BUSY_TIMEOUT = 10000;

/**
 * Project-database mode
 * - isolated: each project has its own system.db (default)
 * - unified: all projects share the global ss-data.db
 */
export type ProjectDbMode = 'unified' | 'isolated';

/**
 * Project-database connection info
 */
export interface ProjectDbConnection {
  /** System-config database (devices, tags, alarm rules, scripts, alarm records, etc.) */
  system: DataSource;
}

/**
 * Project-level database-connection management service (global singleton)
 *
 * Responsibilities:
 * 1. Manage per-project isolated TypeORM DataSource instances (system.db)
 * 2. Provide lazy loading: connections are created automatically on first access
 * 3. Support dynamic entity registration: business packages (ss-device etc.) register their entities at startup
 * 4. Listen for the project.beforeDelete event and auto-close the corresponding connection
 * 5. Provide connection-pool config, statistics, health checks
 *
 * Usage:
 * - ss-device calls registerSystemEntities([Device, ...]) in DeviceModule.onModuleInit()
 * - ss-project calls initProjectDatabases(tid) when creating a project
 * - business code calls getSystemDb(projectId) to get the DataSource (lazy-loaded automatically)
 */
@Injectable()
export class ProjectDatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectDatabaseService.name);

  /** Project-name -> database connection-pool map */
  private readonly connections = new Map<string, ProjectDbConnection>();

  /** In-flight project-connection Promises (prevents concurrent duplicate initialization) */
  private readonly pendingLoads = new Map<string, Promise<ProjectDbConnection>>();

  /** Registered entity classes */
  private registeredEntities: any[] = [];

  /** Connection-pool config */
  private poolConfig: PoolConfig;

  /** Connection-pool statistics */
  private poolStats: PoolStats = {
    activeConnections: 0,
    idleConnections: 0,
    pendingRequests: 0,
    totalCreated: 0,
    totalDestroyed: 0,
    acquireFailures: 0,
    healthCheckFailures: 0,
    lastHealthCheck: null,
  };

  /** Health-check timer */
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBusService,
    private readonly pathResolver: PathResolverService,
    @Optional() private readonly eventLogService?: EventLogService,
  ) {
    this.poolConfig = this.loadPoolConfig();
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  onModuleInit(): void {
    // wrap helper: auto-trace handling result and business effect via EventLogService.wrapSubscriber
    const wrap = <T extends any[]>(
      eventType: string,
      handler: (...args: T) => Promise<Record<string, any> | void>,
    ): ((...args: T) => Promise<void>) => {
      const traced = this.eventLogService
        ? this.eventLogService.wrapSubscriber(eventType, 'ProjectDatabaseService', handler)
        : async (...args: T) => { await handler(...args); };
      return async (...args: T) => {
        try { await traced(...args); }
        catch (err) { this.logger.error(`Handler for ${eventType} failed: ${(err as Error).message}`); }
      };
    };

    // Listen for the project-delete event and close that project's DataSource early
    // Prevents the SQLite file from still being held (EBUSY/EPERM) when the project directory is deleted
    this.eventBus.on(
      'project.beforeDelete',
      wrap('project.beforeDelete', async (payload: { projectId: string; tenantId?: string }) => {
        const projectId = payload?.projectId || payload?.tenantId;
        if (projectId) {
          this.logger.log(
            `[Event] project.beforeDelete received for "${projectId}", closing DataSource`,
          );
          await this.unloadProjectDatabases(projectId);
          return { dataSourceClosed: true, projectId };
        }
      }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopHealthCheck();
    const projectNames = Array.from(this.connections.keys());
    await Promise.all(projectNames.map((name) => this.unloadProjectDatabases(name)));
    this.logger.log('All project databases unloaded');
  }

  // ============================================================
  // Entity registration
  // ============================================================

  /**
   * Register system.db entity classes
   *
   * Business packages (e.g. ss-device) call this method during module init to register their entities.
   * Registered entities are used for:
   * - TypeORM synchronize table creation in initProjectDatabases()
   * - DataSource creation in loadProjectDatabases()
   * - auto-creation in getSystemDb() lazy loading
   *
   * @param entities array of entity classes
   */
  registerSystemEntities(entities: any[]): void {
    for (const entity of entities) {
      if (!this.registeredEntities.includes(entity)) {
        this.registeredEntities.push(entity);
      }
    }
    this.logger.log(
      `Registered ${entities.length} entities (total: ${this.registeredEntities.length})`,
    );
  }

  // ============================================================
  // Mode and paths
  // ============================================================

  /**
   * Get the current database mode
   * Defaults to isolated (each project has its own database); PROJECT_DB_MODE=unified falls back to the shared global DB
   */
  getMode(): ProjectDbMode {
    const mode = this.configService.get<string>('PROJECT_DB_MODE') || 'isolated';
    if (mode !== 'isolated' && mode !== 'unified') {
      this.logger.warn(`Unknown PROJECT_DB_MODE="${mode}", fallback to "isolated"`);
      return 'isolated';
    }
    return mode;
  }

  /**
   * Get the project-database directory path
   *
   * Relative-path base:
   * - dev mode: __dirname up 4 levels = ss-services/ss-node
   *   (after compilation this file lives in packages/ss-core/dist/database/, 4 levels up:
   *    dist/database/ -> dist/ -> ss-core/ -> packages/ -> ss-node/)
   * - production: process.cwd() = ss-run/ss/services/ss-node (relative-path base in .env)
   *
   * Fix history:
   * - Before v1.4 used process.cwd(); in dev mode cwd = apps/ss-node-server,
   *   so ../../ss-run/ss/data/projects in .env.dev resolved to the wrong path.
   * - Before v1.5 used 3-level upward traversal, but after compilation this file lives in packages/ss-core/dist/database/,
   *   and 3 levels only reaches packages/ (wrong), so PROJECTS_DIR=../../ss-run/ss/data/projects
   *   resolved to ss-services/ss-run/ss/data/projects (one extra ss-services level),
   *   creating an empty system.db at the wrong path while the real system.db at the correct path was never loaded.
   * - Now consistent with collector-bootstrap.service.ts resolveProjectsDir() (also under dist/<subdir>/),
   *   using 4-level upward traversal. Note project.service.ts lives in packages/ss-project/dist/ (no subdir),
   *   where 3 levels suffices; the two levels differ and cannot be unified.
   */
  getProjectDbDir(projectId: string): string {
    const projectsDir = this.configService.get<string>('PROJECTS_DIR') || './data/projects';
    const absoluteProjectsDir = this.pathResolver.resolve(projectsDir);
    return path.join(absoluteProjectsDir, projectId, 'db');
  }

  /**
   * Get the SQL init-script directory (absolute path)
   *
   * Configured via the PROJECT_DB_INIT_DIR env var, default ./data/init.
   *
   * Relative-path base:
   * - In production the service starts from `ss-run/ss/services/ss-node` (process.cwd()),
   *   so `PROJECT_DB_INIT_DIR=../../data/init` in .env resolves relative to that directory into
   *   `ss-run/ss/data/init`.
   * - Do NOT use `path.resolve(__dirname, '..', '..', '..', '..')` as the base:
   *   after compilation this file lives in `node_modules/@ss-node/ss-core/dist/database/`,
   *   and 4 levels up gives `node_modules/`, so resolving `../../data/init` yields
   *   `ss-run/ss/services/data/init` (wrong path, one extra services level).
   */
  private getInitDir(): string {
    const initDir = this.configService.get<string>('PROJECT_DB_INIT_DIR') || './data/init';
    return this.pathResolver.resolve(initDir);
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize a project's system.db
   *
   * Entity source priority:
   * 1. Explicitly passed entities param (backward compatible)
   * 2. Entity classes registered via registerSystemEntities()
   *
   * Table-creation strategy:
   * - With entities: TypeORM DataSource + synchronize auto-creates tables
   * - Without entities: SQL scripts executed via native sqlite3
   *
   * @param projectId    project name (tid)
   * @param entities       system.db entity-class array (optional; defaults to registered ones)
   */
  async initProjectDatabases(projectId: string, entities?: any[]): Promise<void> {
    const sysEntities = entities ?? this.registeredEntities;

    const dbDir = this.getProjectDbDir(projectId);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize system.db
    const systemDbPath = path.join(dbDir, 'system.db');
    if (!fs.existsSync(systemDbPath)) {
      await this.initSingleDb(systemDbPath, INIT_SCRIPT, sysEntities, projectId);
    }
  }

  /**
   * Initialize a single database file
   * - With entities: TypeORM DataSource + synchronize auto-creates tables
   * - Without entities: SQL scripts executed via native sqlite3
   */
  private async initSingleDb(
    dbPath: string,
    scriptName: string,
    entities: any[],
    projectId: string,
  ): Promise<void> {
    const hasEntities = entities && entities.length > 0;

    if (hasEntities) {
      // TypeORM table creation
      const ds = new DataSource({
        type: 'sqlite',
        database: dbPath,
        entities,
        synchronize: true,
        extra: { busyTimeout: BUSY_TIMEOUT },
      });
      await ds.initialize();
      await ds.destroy();
      this.logger.log(`[${projectId}] ${path.basename(dbPath)} initialized with TypeORM entities`);
    } else {
      // SQL-script initialization
      await this.executeInitScript(dbPath, scriptName);
      this.logger.log(
        `[${projectId}] ${path.basename(dbPath)} initialized via SQL script: ${scriptName}`,
      );
    }
  }

  /**
   * Read the SQL init script and execute statements one by one via native sqlite3
   */
  private executeInitScript(dbPath: string, scriptName: string): Promise<void> {
    const initDir = this.getInitDir();
    const scriptPath = path.join(initDir, scriptName);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(
        `SQL init script not found: ${scriptPath}. ` +
          `Check PROJECT_DB_INIT_DIR env (current: ${initDir})`,
      );
    }

    const sqlContent = fs.readFileSync(scriptPath, 'utf-8');
    this.logger.log(`Executing init script: ${scriptPath} (${sqlContent.length} bytes)`);

    const statements = this.splitSqlStatements(sqlContent);

    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(new Error(`Failed to create database ${dbPath}: ${err.message}`));
          return;
        }

        let idx = 0;
        let skippedGlobal = 0;
        const errors: string[] = [];

        const runNext = () => {
          if (idx >= statements.length) {
            db.close((closeErr) => {
              if (errors.length > 0) {
                reject(
                  new Error(
                    `SQL init script error (${scriptName}): ${errors.length} statement(s) failed. ` +
                      `First: ${errors[0]}`,
                  ),
                );
              } else if (closeErr) {
                reject(new Error(`Failed to close database ${dbPath}: ${closeErr.message}`));
              } else {
                if (skippedGlobal > 0) {
                  this.logger.warn(
                    `Init script ${scriptName}: ${skippedGlobal} global-table statement(s) skipped`,
                  );
                }
                this.logger.log(`SQL init script ${scriptName} executed successfully`);
                resolve();
              }
            });
            return;
          }

          const stmt = statements[idx];
          idx++;

          db.run(stmt, (runErr: Error | null) => {
            if (runErr) {
              const msg = runErr.message || String(runErr);
              if (msg.includes('no such table') && stmt.toLowerCase().includes('sys_menus')) {
                skippedGlobal++;
              } else {
                errors.push(`${msg} [SQL: ${stmt.substring(0, 100)}...]`);
              }
            }
            runNext();
          });
        };

        runNext();
      });
    });
  }

  /**
   * Split an SQL script into individual statements
   */
  private splitSqlStatements(sql: string): string[] {
    const lines = sql.split('\n');
    const statements: string[] = [];
    let current = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--')) {
        continue;
      }
      current += line + '\n';
      if (trimmed.endsWith(';')) {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = '';
      }
    }
    if (current.trim()) {
      statements.push(current.trim());
    }
    return statements;
  }

  // ============================================================
  // Connection management
  // ============================================================

  /**
   * Load a project-database connection (build the DataSource)
   * Returns directly if the connection exists, otherwise creates a new one
   *
   * Entity source priority:
   * 1. Explicitly passed entities param (backward compatible)
   * 2. Entity classes registered via registerSystemEntities()
   *
   * @param projectId     project name
   * @param entities        system.db entity-class array (optional)
   */
  async loadProjectDatabases(projectId: string, entities?: any[]): Promise<ProjectDbConnection> {
    // Return directly if already loaded
    const existing = this.connections.get(projectId);
    if (existing) {
      return existing;
    }

    // Concurrency guard: the same project is loading; wait for the existing Promise
    const pending = this.pendingLoads.get(projectId);
    if (pending) {
      this.logger.debug(`[${projectId}] Waiting for in-progress database load...`);
      return pending;
    }

    const loadPromise = this.doLoadProjectDatabases(projectId, entities);
    this.pendingLoads.set(projectId, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.pendingLoads.delete(projectId);
    }
  }

  private async doLoadProjectDatabases(
    projectId: string,
    entities?: any[],
  ): Promise<ProjectDbConnection> {
    const sysEntities = entities ?? this.registeredEntities;

    const dbDir = this.getProjectDbDir(projectId);
    const systemDbPath = path.join(dbDir, 'system.db');

    // If the file does not exist, initialize first
    if (!fs.existsSync(systemDbPath)) {
      await this.initProjectDatabases(projectId, sysEntities);
    }

    // Data migration: after ProjectScopedEntity was introduced, existing records may have NULL projectId.
    // Must run before TypeORM synchronize, otherwise when synchronize rebuilds tables,
    // temporary-table data copying hits a NOT NULL constraint failed error.
    await this.migrateNullProjectIdsPreSync(systemDbPath, projectId);
    // Strategy B: rename dev_devices columns tid->device_code / name->device_name
    // Must run before TypeORM synchronize, otherwise synchronize drops the old columns causing data loss
    await this.renameDeviceColumnsPreSync(systemDbPath, projectId);

    const systemDs = new DataSource({
      type: 'sqlite',
      database: systemDbPath,
      entities: sysEntities,
      synchronize: true,
      extra: {
        max: this.poolConfig.maxConnections,
        idleTimeoutMillis: this.poolConfig.idleTimeoutMs,
        acquireTimeoutMillis: this.poolConfig.acquireTimeoutMs,
        busyTimeout: BUSY_TIMEOUT,
      },
    });
    await systemDs.initialize();
    await this.enableWalMode(systemDs, systemDbPath, projectId);
    this.poolStats.totalCreated++;

    const connection: ProjectDbConnection = { system: systemDs };
    this.connections.set(projectId, connection);
    this.poolStats.activeConnections++;
    this.logger.log(`[${projectId}] system.db loaded`);
    return connection;
  }

  /**
   * Enable SQLite WAL mode + performance PRAGMAs
   *
   * WAL (Write-Ahead Logging) mode allows read/write concurrency:
   * - reads do not block writes
   * - writes do not block reads (in most cases)
   * - compared with the default DELETE mode, eliminates the vast majority of SQLITE_BUSY errors
   *
   * Performance PRAGMAs:
   * - synchronous=NORMAL: reduces fsync frequency, improves write throughput
   * - cache_size=-64000: 64MB page cache
   * - temp_store=MEMORY: temp tables/indexes in memory
   */
  private async enableWalMode(ds: DataSource, dbPath: string, projectId: string): Promise<void> {
    try {
      await ds.query('PRAGMA journal_mode=WAL');
      await ds.query('PRAGMA synchronous=NORMAL');
      await ds.query('PRAGMA cache_size=-64000');
      await ds.query('PRAGMA temp_store=MEMORY');
      this.logger.log(`[${projectId}] system.db WAL mode enabled (synchronous=NORMAL, cache=64MB)`);
    } catch (err) {
      this.logger.warn(
        `[${projectId}] Failed to enable WAL for system.db: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get a project's system.db DataSource (lazy-loaded, auto-created)
   *
   * If the connection does not exist, loadProjectDatabases() is called automatically.
   * Uses registered entity classes.
   *
   * @param projectId project name
   * @returns the system.db DataSource
   */
  async getSystemDb(projectId: string): Promise<DataSource> {
    const existing = this.connections.get(projectId);
    if (existing) {
      return existing.system;
    }
    const conn = await this.loadProjectDatabases(projectId);
    return conn.system;
  }

  /**
   * Get a loaded system.db DataSource (synchronous, no auto-creation)
   *
   * @returns the connection or undefined (when not loaded)
   */
  getLoadedSystemDb(projectId: string): DataSource | undefined {
    return this.connections.get(projectId)?.system;
  }

  /**
   * Get a loaded project-database connection (synchronous, no auto-creation)
   * @returns the connection or undefined (when not loaded)
   */
  getConnection(projectId: string): ProjectDbConnection | undefined {
    return this.connections.get(projectId);
  }

  /**
   * Unload a project-database connection (close the DataSource)
   */
  async unloadProjectDatabases(projectId: string): Promise<void> {
    const connection = this.connections.get(projectId);
    if (!connection) return;

    let destroyed = 0;
    try {
      if (connection.system.isInitialized) {
        await connection.system.destroy();
        destroyed++;
      }
    } catch (err) {
      this.logger.error(
        `[${projectId}] Failed to destroy system DataSource: ${(err as Error).message}`,
      );
    }

    this.connections.delete(projectId);
    this.poolStats.activeConnections -= destroyed;
    this.poolStats.totalDestroyed += destroyed;
    this.logger.log(`[${projectId}] system.db unloaded`);
  }

  /**
   * Delete a project-database file (physically delete the db/ directory)
   * Closes the connection first, then deletes the files
   */
  async deleteProjectDatabases(projectId: string): Promise<void> {
    await this.unloadProjectDatabases(projectId);

    const dbDir = this.getProjectDbDir(projectId);
    if (fs.existsSync(dbDir)) {
      fs.rmSync(dbDir, { recursive: true, force: true });
      this.logger.log(`[${projectId}] Database directory deleted: ${dbDir}`);
    }
  }

  /**
   * Check whether a project-database file exists
   */
  hasDatabaseFiles(projectId: string): boolean {
    const dbDir = this.getProjectDbDir(projectId);
    const systemDbPath = path.join(dbDir, 'system.db');
    return fs.existsSync(systemDbPath);
  }

  /**
   * VACUUM-compact a project database
   */
  async vacuumProjectDatabases(projectId: string): Promise<void> {
    const connection = this.connections.get(projectId);
    if (!connection) return;

    try {
      await connection.system.query('VACUUM');
      this.logger.log(`[${projectId}] system.db vacuumed`);
    } catch (err) {
      this.logger.warn(`[${projectId}] VACUUM failed: ${(err as Error).message}`);
    }
  }

  /**
   * Get the number of currently loaded projects
   */
  get loadedProjectCount(): number {
    return this.connections.size;
  }

  /**
   * Get the list of currently loaded project names (for cross-project scheduled scans etc.)
   *
   * Returns an array (snapshot copy) of project names with established DataSources.
   * In isolated mode, business scheduled tasks can iterate each project DB to run scans.
   */
  getLoadedProjectNames(): string[] {
    return Array.from(this.connections.keys());
  }

  // ============================================================
  // Connection-pool management
  // ============================================================

  private loadPoolConfig(): PoolConfig {
    return {
      maxConnections:
        this.configService.get<number>('DB_POOL_MAX_CONNECTIONS') ||
        DEFAULT_POOL_CONFIG.maxConnections,
      idleTimeoutMs:
        this.configService.get<number>('DB_POOL_IDLE_TIMEOUT_MS') ||
        DEFAULT_POOL_CONFIG.idleTimeoutMs,
      healthCheckIntervalMs:
        this.configService.get<number>('DB_POOL_HEALTH_CHECK_MS') ||
        DEFAULT_POOL_CONFIG.healthCheckIntervalMs,
      acquireTimeoutMs:
        this.configService.get<number>('DB_POOL_ACQUIRE_TIMEOUT_MS') ||
        DEFAULT_POOL_CONFIG.acquireTimeoutMs,
    };
  }

  getPoolConfig(): PoolConfig {
    return { ...this.poolConfig };
  }

  updatePoolConfig(config: Partial<PoolConfig>): void {
    this.poolConfig = { ...this.poolConfig, ...config };
    this.logger.log(
      `Pool config updated: max=${this.poolConfig.maxConnections}, ` +
        `idle=${this.poolConfig.idleTimeoutMs}ms, ` +
        `health=${this.poolConfig.healthCheckIntervalMs}ms`,
    );
  }

  getPoolStats(): PoolStats {
    return { ...this.poolStats };
  }

  async checkConnectionHealth(projectId: string): Promise<boolean> {
    const connection = this.connections.get(projectId);
    if (!connection) return false;

    try {
      if (connection.system.isInitialized) {
        await connection.system.query('SELECT 1');
      } else {
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`[${projectId}] Health check failed: ${(err as Error).message}`);
      this.poolStats.healthCheckFailures++;
      return false;
    }
  }

  async checkAllConnectionsHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const projectNames = Array.from(this.connections.keys());
    for (const name of projectNames) {
      results.set(name, await this.checkConnectionHealth(name));
    }
    this.poolStats.lastHealthCheck = new Date();
    const healthyCount = Array.from(results.values()).filter(Boolean).length;
    this.logger.log(`Health check completed: ${healthyCount}/${results.size} connections healthy`);
    return results;
  }

  startHealthCheck(): void {
    if (this.healthCheckTimer) {
      this.logger.warn('Health check timer already running');
      return;
    }
    this.healthCheckTimer = setInterval(() => {
      this.checkAllConnectionsHealth();
    }, this.poolConfig.healthCheckIntervalMs);
    this.logger.log(`Health check started (interval: ${this.poolConfig.healthCheckIntervalMs}ms)`);
  }

  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      this.logger.log('Health check stopped');
    }
  }

  isHealthCheckRunning(): boolean {
    return this.healthCheckTimer !== null;
  }

  resetPoolStats(): void {
    this.poolStats = {
      activeConnections: this.connections.size,
      idleConnections: 0,
      pendingRequests: 0,
      totalCreated: 0,
      totalDestroyed: 0,
      acquireFailures: 0,
      healthCheckFailures: 0,
      lastHealthCheck: null,
    };
  }

  /**
   * Data migration (PreSync): before TypeORM synchronize, migrate NULL projectId using a temporary DataSource.
   *
   * TypeORM's synchronize creates a temporary table to rebuild when it detects a schema change;
   * if existing records have NULL projectId, the temporary table's NOT NULL constraint raises a SQLITE_CONSTRAINT error.
   * So the migration must complete before synchronize.
   *
   * Handles two scenarios:
   * 1. Table has a projectId column but values are NULL -> UPDATE
   * 2. Table has no projectId column at all -> ALTER TABLE ADD COLUMN + UPDATE
   *
   * Optimization: check whether PreSync is needed first; skip if all tables already have the projectId column,
   * avoiding unnecessary schema checks on large tables (e.g. historical_data) at every startup.
   */
  private async migrateNullProjectIdsPreSync(dbPath: string, projectId: string): Promise<void> {
    // Fast check: skip PreSync if all tables already have the projectId column
    const needsPreSync = await this.isPreSyncNeeded(dbPath);
    if (!needsPreSync) {
      return;
    }

    // First use native sqlite3 to handle tables missing the projectId column (ALTER TABLE)
    await this.preSyncAddMissingColumns(dbPath, projectId);

    // Then use the TypeORM DataSource to handle columns that exist but have NULL values
    let ds: DataSource | null = null;
    try {
      ds = new DataSource({
        type: 'sqlite',
        database: dbPath,
        entities: this.registeredEntities,
        synchronize: false,
        logging: false,
        extra: { busyTimeout: BUSY_TIMEOUT },
      });
      await ds.initialize();

      await this.migrateNullProjectIds(ds, this.registeredEntities, projectId);

      await ds.destroy();
    } catch (err) {
      const msg = (err as Error).message || '';
      if (!msg.includes('no such table')) {
        this.logger.warn(`[${projectId}] PreSync migration error: ${msg}`);
      }
      if (ds?.isInitialized) {
        try {
          await ds.destroy();
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Check whether PreSync is needed: skip if all tables already have the projectId column
   */
  private isPreSyncNeeded(dbPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const db = new sqlite3.Database(dbPath, (openErr: Error | null) => {
        if (openErr) {
          resolve(true);
          return;
        }

        db.get(
          `SELECT COUNT(*) as cnt FROM sqlite_master
           WHERE type='table' AND name NOT LIKE 'sqlite_%'
           AND name NOT LIKE 'temporary_%'`,
          [],
          (err: Error | null, row: { cnt: number }) => {
            if (err) {
              db.close();
              resolve(true);
              return;
            }

            const totalTables = row?.cnt ?? 0;
            if (totalTables === 0) {
              db.close();
              resolve(false);
              return;
            }

            // Count user tables that already contain the projectId column
            db.all(
              `SELECT DISTINCT m.name as tbl_name
               FROM sqlite_master m
               WHERE m.type='table'
                 AND m.name NOT LIKE 'sqlite_%'
                 AND m.name NOT LIKE 'temporary_%'
                 AND EXISTS (
                   SELECT 1 FROM pragma_table_info(m.name) WHERE name='projectId'
                 )`,
              [],
              (err2: Error | null, rows: { tbl_name: string }[]) => {
                db.close();
                if (err2) {
                  resolve(true);
                  return;
                }
                const tablesWithProjectId = rows?.length ?? 0;
                // If all tables already have the projectId column, PreSync is not needed
                resolve(tablesWithProjectId < totalTables);
              },
            );
          },
        );
      });
    });
  }

  /**
   * Add the projectId column to tables missing it and fill values.
   * Must complete before TypeORM synchronize,
   * otherwise temporary-table creation during synchronize fails on the NOT NULL constraint.
   */
  private async preSyncAddMissingColumns(dbPath: string, projectId: string): Promise<void> {
    return new Promise((resolve) => {
      const db = new sqlite3.Database(dbPath, (openErr: Error | null) => {
        if (openErr) {
          resolve();
          return;
        }

        db.all(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'temporary_%'",
          [],
          (tableErr: Error | null, tables: { name: string }[]) => {
            if (tableErr) {
              db.close();
              resolve();
              return;
            }

            let pending = tables.length;
            if (pending === 0) {
              db.close();
              resolve();
              return;
            }

            for (const { name: tableName } of tables) {
              db.all(
                `SELECT name FROM pragma_table_info('${tableName}') WHERE name='projectId'`,
                [],
                (colErr: Error | null, cols: { name: string }[]) => {
                  if (colErr) {
                    if (--pending === 0) {
                      db.close();
                      resolve();
                    }
                    return;
                  }

                  if (!cols || cols.length === 0) {
                    // Table missing the projectId column: add the column first, then fill values
                    db.run(
                      `ALTER TABLE "${tableName}" ADD COLUMN projectId varchar DEFAULT ''`,
                      [],
                      (alterErr: Error | null) => {
                        if (alterErr) {
                          if (--pending === 0) {
                            db.close();
                            resolve();
                          }
                          return;
                        }
                        // Fill default values
                        db.run(
                          `UPDATE "${tableName}" SET projectId = ? WHERE projectId IS NULL OR projectId = ''`,
                          [projectId],
                          (updateErr: Error | null) => {
                            if (!updateErr) {
                              this.logger.log(
                                `[${projectId}] PreSync: added projectId column to "${tableName}"`,
                              );
                            }
                            if (--pending === 0) {
                              db.close();
                              resolve();
                            }
                          },
                        );
                      },
                    );
                  } else {
                    if (--pending === 0) {
                      db.close();
                      resolve();
                    }
                  }
                },
              );
            }
          },
        );
      });
    });
  }

  /**
   * Pre-sync migration: rename the dev_devices table columns tid->device_code / name->device_name
   *
   * Companion migration for Strategy B (DB column names aligned with TS property names).
   * Must run before TypeORM synchronize, otherwise synchronize drops the old columns (data loss) and adds empty ones.
   *
   * Idempotency:
   * - Already-migrated DB (tid/name columns absent): skip
   * - Newly created DB (device_code/device_name columns present): skip
   * - Pending DB (tid/name columns present): run RENAME COLUMN + rebuild indexes
   *
   * @param dbPath    project system.db path
   * @param projectId project identifier (for logging)
   */
  private async renameDeviceColumnsPreSync(dbPath: string, projectId: string): Promise<void> {
    return new Promise((resolve) => {
      const db = new sqlite3.Database(dbPath, (openErr: Error | null) => {
        if (openErr) {
          // File missing or unopenable: skip (new projects are created by init-system-db.sql)
          resolve();
          return;
        }

        // 1. Check whether the dev_devices table exists
        db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dev_devices'",
          [],
          (tableErr: Error | null, row: { name: string } | undefined) => {
            if (tableErr || !row) {
              // Table does not exist (new project): skip
              db.close();
              resolve();
              return;
            }

            // 2. Get dev_devices column names
            db.all(
              "SELECT name FROM pragma_table_info('dev_devices')",
              [],
              (colErr: Error | null, cols: { name: string }[]) => {
                if (colErr) {
                  db.close();
                  resolve();
                  return;
                }

                const columnNames = (cols || []).map((c) => c.name);
                const hasTid = columnNames.includes('tid');
                const hasName = columnNames.includes('name');
                const hasDeviceCode = columnNames.includes('device_code');
                const hasDeviceName = columnNames.includes('device_name');

                // 3. Build migration SQL (only when old columns exist and new ones do not)
                const statements: string[] = [];

                if (hasTid && !hasDeviceCode) {
                  statements.push('ALTER TABLE dev_devices RENAME COLUMN tid TO device_code');
                }
                if (hasName && !hasDeviceName) {
                  statements.push('ALTER TABLE dev_devices RENAME COLUMN name TO device_name');
                }

                if (statements.length === 0) {
                  db.close();
                  resolve();
                  return;
                }

                // 4. Execute the column renames
                // Note: SQLite automatically updates column references in indexes/triggers on RENAME COLUMN;
                //     index names are managed by TypeORM synchronize based on @Index/@Unique decorators,
                //     so no manual index rebuild is needed here.
                db.exec(statements.join(';\n') + ';', (execErr: Error | null) => {
                  if (execErr) {
                    this.logger.warn(
                      `[${projectId}] PreSync: dev_devices column rename failed: ${execErr.message}`,
                    );
                  } else {
                    this.logger.log(
                      `[${projectId}] PreSync: renamed dev_devices columns (${statements.join(', ')})`,
                    );
                  }
                  db.close();
                  resolve();
                });
              },
            );
          },
        );
      });
    });
  }

  /**
   * Data migration: after ProjectScopedEntity was introduced, existing records may have NULL projectId.
   * In isolated mode all records belong to the current project; uniformly set them to projectId.
   *
   * Uses TypeORM metadata to auto-discover all tables with a projectId column and runs UPDATE per table.
   */
  private async migrateNullProjectIds(
    ds: DataSource,
    entities: any[],
    projectId: string,
  ): Promise<void> {
    const migratedTables: string[] = [];
    for (const entity of entities) {
      try {
        const metadata = ds.getMetadata(entity);
        const tableName = metadata.tableName;
        const hasProjectId = metadata.columns.some((c) => c.propertyName === 'projectId');
        if (!hasProjectId) continue;

        const result = await ds.query(
          `UPDATE "${tableName}" SET projectId = ? WHERE projectId IS NULL`,
          [projectId],
        );
        // SQLite better-sqlite3 returns { changes: N } for UPDATE
        const affected =
          typeof result === 'object' && result !== null ? ((result as any).changes ?? 0) : 0;
        if (affected > 0) {
          migratedTables.push(tableName);
          this.logger.log(
            `[${projectId}] Migrated ${affected} NULL projectId(s) in "${tableName}"`,
          );
        }
      } catch (err) {
        // Silently skip when the table does not exist (entity registered but table not yet created)
        const msg = (err as Error).message || '';
        if (msg.includes('no such table')) {
          continue;
        }
        this.logger.warn(`[${projectId}] projectId migration for entity "${entity.name}": ${msg}`);
      }
    }
    if (migratedTables.length > 0) {
      this.logger.log(`[${projectId}] projectId migration completed: ${migratedTables.join(', ')}`);
    }
  }
}
