// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { PathResolverService } from '@ss-node/ss-core';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sqlite3 = require('sqlite3');

export interface DatabaseStatus {
  type: 'system' | 'project';
  name: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  sizeFormatted: string;
  tableCount: number;
  lastModified: string | null;
  /** Failure reason (filled when exists=false) */
  errorMessage?: string;
}

export interface IntegrityCheckResult {
  ok: boolean;
  message: string;
  checkedAt: Date;
}

export interface VacuumResult {
  ok: boolean;
  beforeBytes: number;
  afterBytes: number;
  freedBytes: number;
  freedFormatted: string;
  completedAt: Date;
}

/** Truncate-table operation result */
export interface ClearTableResult {
  ok: boolean;
  /** Total number of deleted rows */
  deleted: number;
  /** List of truncated table names */
  tables: string[];
  completedAt: Date;
}

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {}

  // ==================== Database status ====================

  /** Get the system database status */
  async getSystemDatabaseStatus(): Promise<DatabaseStatus> {
    const dbPath = this.getSystemDatabasePath();
    return this.buildDatabaseStatus(dbPath, 'system', '系统数据库');
  }

  /** Get the status of all project databases */
  async getProjectDatabasesStatus(): Promise<DatabaseStatus[]> {
    const projectsDir = this.getProjectsDir();
    if (!fs.existsSync(projectsDir)) {
      return [];
    }

    const results: DatabaseStatus[] = [];
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dbPath = path.join(projectsDir, entry.name, 'db', 'system.db');
      results.push(await this.buildDatabaseStatus(dbPath, 'project', entry.name));
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get the full database status (system + projects) */
  async getAllDatabasesStatus(): Promise<{ system: DatabaseStatus; projects: DatabaseStatus[] }> {
    return {
      system: await this.getSystemDatabaseStatus(),
      projects: await this.getProjectDatabasesStatus(),
    };
  }

  private async buildDatabaseStatus(
    dbPath: string,
    type: 'system' | 'project',
    name: string,
  ): Promise<DatabaseStatus> {
    const exists = fs.existsSync(dbPath);
    let sizeBytes = 0;
    let lastModified: string | null = null;
    let tableCount = 0;
    let errorMessage: string | undefined;

    if (exists) {
      try {
        const stats = fs.statSync(dbPath);
        sizeBytes = stats.size;
        lastModified = stats.mtime.toISOString();
        tableCount = await this.countTables(dbPath);
      } catch (error) {
        errorMessage = `Failed to read database: ${(error as Error).message}`;
      }
    } else {
      errorMessage = `Database file not found: ${dbPath}`;
    }

    return {
      type,
      name,
      path: dbPath,
      exists,
      sizeBytes,
      sizeFormatted: this.formatBytes(sizeBytes),
      tableCount,
      lastModified,
      errorMessage,
    };
  }

  private countTables(dbPath: string): Promise<number> {
    return new Promise((resolve) => {
      try {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr: Error | null) => {
          if (openErr) {
            this.logger.warn(
              `countTables: open failed [${path.basename(dbPath)}]: ${openErr.message}`,
            );
            resolve(0);
            return;
          }
          db.get(
            "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            (err: Error | null, row: { cnt: number } | undefined) => {
              db.close();
              if (err) {
                this.logger.warn(
                  `countTables: query failed [${path.basename(dbPath)}]: ${err.message}`,
                );
                resolve(0);
                return;
              }
              resolve(row?.cnt ?? 0);
            },
          );
        });
      } catch (err) {
        this.logger.warn(
          `countTables: exception [${path.basename(dbPath)}]: ${(err as Error).message}`,
        );
        resolve(0);
      }
    });
  }

  // ==================== Integrity check ====================

  /** System database integrity check */
  async checkSystemIntegrity(): Promise<IntegrityCheckResult> {
    return this.checkIntegrity(this.getSystemDatabasePath());
  }

  /** Project database integrity check */
  async checkProjectIntegrity(projectName: string): Promise<IntegrityCheckResult> {
    return this.checkIntegrity(this.getProjectDbPath(projectName));
  }

  private checkIntegrity(dbPath: string): Promise<IntegrityCheckResult> {
    if (!fs.existsSync(dbPath)) {
      return Promise.resolve({
        ok: false,
        message: `Database file not found: ${dbPath}`,
        checkedAt: new Date(),
      });
    }

    return new Promise((resolve) => {
      try {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr: Error | null) => {
          if (openErr) {
            this.logger.error(`Integrity check open failed [${dbPath}]: ${openErr.message}`);
            resolve({
              ok: false,
              message: `Check failed: ${openErr.message}`,
              checkedAt: new Date(),
            });
            return;
          }
          db.all(
            'PRAGMA integrity_check',
            (err: Error | null, rows: Array<{ integrity_check: string }>) => {
              db.close();
              if (err) {
                this.logger.error(`Integrity check failed [${dbPath}]: ${err.message}`);
                resolve({
                  ok: false,
                  message: `Check failed: ${err.message}`,
                  checkedAt: new Date(),
                });
                return;
              }
              const message = rows?.[0]?.integrity_check || 'unknown';
              const ok = message === 'ok';
              this.logger.log(`Integrity check [${path.basename(dbPath)}]: ${message}`);
              resolve({ ok, message, checkedAt: new Date() });
            },
          );
        });
      } catch (error) {
        this.logger.error(`Integrity check exception [${dbPath}]: ${(error as Error).message}`);
        resolve({
          ok: false,
          message: `Check failed: ${(error as Error).message}`,
          checkedAt: new Date(),
        });
      }
    });
  }

  // ==================== Space reclaim ====================

  /** System database VACUUM */
  async vacuumSystem(): Promise<VacuumResult> {
    return this.vacuum(this.getSystemDatabasePath());
  }

  /** Project database VACUUM */
  async vacuumProject(projectName: string): Promise<VacuumResult> {
    return this.vacuum(this.getProjectDbPath(projectName));
  }

  private vacuum(dbPath: string): Promise<VacuumResult> {
    if (!fs.existsSync(dbPath)) {
      return Promise.reject(new Error(`Database file not found: ${dbPath}`));
    }

    const beforeBytes = fs.statSync(dbPath).size;

    return new Promise((resolve, reject) => {
      try {
        const db = new sqlite3.Database(dbPath, (openErr: Error | null) => {
          if (openErr) {
            this.logger.error(`VACUUM open failed [${dbPath}]: ${openErr.message}`);
            reject(new Error(`VACUUM failed: ${openErr.message}`));
            return;
          }
          db.exec('VACUUM', (execErr: Error | null) => {
            db.close((closeErr: Error | null) => {
              if (execErr) {
                this.logger.error(`VACUUM failed [${dbPath}]: ${execErr.message}`);
                reject(new Error(`VACUUM failed: ${execErr.message}`));
                return;
              }
              if (closeErr) {
                this.logger.warn(`VACUUM close warning [${dbPath}]: ${closeErr.message}`);
              }
              const afterBytes = fs.statSync(dbPath).size;
              const freedBytes = beforeBytes - afterBytes;
              this.logger.log(
                `VACUUM [${path.basename(dbPath)}]: ${this.formatBytes(beforeBytes)} -> ${this.formatBytes(afterBytes)} (freed ${this.formatBytes(Math.max(0, freedBytes))})`,
              );
              resolve({
                ok: true,
                beforeBytes,
                afterBytes,
                freedBytes: Math.max(0, freedBytes),
                freedFormatted: this.formatBytes(Math.max(0, freedBytes)),
                completedAt: new Date(),
              });
            });
          });
        });
      } catch (error) {
        this.logger.error(`VACUUM exception [${dbPath}]: ${(error as Error).message}`);
        reject(error);
      }
    });
  }

  // ==================== Truncate table data ====================

  /** Alarm event table names (only runtime event data is truncated; config tables are untouched) */
  private static readonly EVENT_TABLES = ['alm_alarm_records'];

  /** Log table names (device status log + control operation log) */
  private static readonly LOG_TABLES = ['dev_device_status_log', 'control_operation_logs'];

  /**
   * Truncate a project's alarm event tables
   *
   * Only alm_alarm_records (alarm raise/clear records) is truncated; alm_alarm_rules (rule config) and alm_alarm_groups (group config) are unaffected.
   * Uses a raw sqlite3 connection (consistent with VACUUM/integrity-check), with busyTimeout set to avoid conflicts with the TypeORM connection pool.
   *
   * @param projectName project name (directory name)
   * @returns the deleted record count and the truncated table names
   */
  async clearProjectEvents(projectName: string): Promise<ClearTableResult> {
    return this.clearTables(this.getProjectDbPath(projectName), DatabaseService.EVENT_TABLES);
  }

  /**
   * Truncate a project's log tables
   *
   * Truncates dev_device_status_log (device status change log) and control_operation_logs (control operation log).
   * Device/tag configuration data is unaffected.
   *
   * @param projectName project name (directory name)
   * @returns the deleted record count and the truncated table names
   */
  async clearProjectLogs(projectName: string): Promise<ClearTableResult> {
    return this.clearTables(this.getProjectDbPath(projectName), DatabaseService.LOG_TABLES);
  }

  /**
   * Truncate several tables in the given project database (DELETE FROM, keeping the schema)
   *
   * Uses raw sqlite3 to execute DELETE FROM per table, accumulating deleted rows via changes().
   * Missing tables are skipped (debug-logged silently) and are not treated as errors.
   */
  private clearTables(dbPath: string, tables: string[]): Promise<ClearTableResult> {
    if (!fs.existsSync(dbPath)) {
      return Promise.reject(new Error(`Database file not found: ${dbPath}`));
    }

    return new Promise((resolve, reject) => {
      try {
        const db = new sqlite3.Database(dbPath, (openErr: Error | null) => {
          if (openErr) {
            this.logger.error(`clearTables: open failed [${path.basename(dbPath)}]: ${openErr.message}`);
            reject(new Error(`Clear tables failed: ${openErr.message}`));
            return;
          }

          // Set busyTimeout to avoid SQLITE_BUSY from write conflicts with the TypeORM connection pool
          db.configure('busyTimeout', 10000);

          let totalDeleted = 0;
          const clearedTables: string[] = [];
          let idx = 0;

          const processNext = () => {
            if (idx >= tables.length) {
              db.close((closeErr: Error | null) => {
                if (closeErr) {
                  this.logger.warn(`clearTables: close warning [${path.basename(dbPath)}]: ${closeErr.message}`);
                }
                this.logger.log(
                  `clearTables [${path.basename(dbPath)}]: deleted ${totalDeleted} rows from ${clearedTables.join(', ') || '(no tables)'}`,
                );
                resolve({
                  ok: true,
                  deleted: totalDeleted,
                  tables: clearedTables,
                  completedAt: new Date(),
                });
              });
              return;
            }

            const tableName = tables[idx];
            idx++;

            db.run(`DELETE FROM ${tableName}`, (runErr: Error | null) => {
              if (runErr) {
                const msg = runErr.message || String(runErr);
                if (msg.includes('no such table')) {
                  // Table does not exist (the project may not use this feature); skip silently
                  this.logger.debug(`clearTables: table "${tableName}" not found [${path.basename(dbPath)}], skipped`);
                  processNext();
                } else {
                  this.logger.error(`clearTables: DELETE FROM ${tableName} failed [${path.basename(dbPath)}]: ${msg}`);
                  db.close();
                  reject(new Error(`Clear table "${tableName}" failed: ${msg}`));
                }
                return;
              }
              // sqlite3@6's Database object has no changes() method; use the SQL function changes() to get the deleted row count
              db.get(
                'SELECT changes() AS count',
                (getErr: Error | null, row: { count: number } | undefined) => {
                  const changes = !getErr && row ? row.count || 0 : 0;
                  totalDeleted += changes;
                  if (changes > 0) {
                    clearedTables.push(tableName);
                  }
                  processNext();
                },
              );
            });
          };

          processNext();
        });
      } catch (error) {
        this.logger.error(`clearTables: exception [${dbPath}]: ${(error as Error).message}`);
        reject(error);
      }
    });
  }

  // ==================== Path utilities ====================

  /**
   * Get the absolute path of the ss-services/ss-node project root.
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node
   *   (this file lives in packages/ss-system/dist/backup/)
   *   relative paths in .env.dev / .env.ss resolve against ss-services/ss-node
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *   relative paths in .env resolve against that directory
   *
   * Fix history:
   * - Before v1.3, 5 '..' levels went up to ss-services (one too many)
   * - Before v1.5, only __dirname was used without distinguishing prod; in prod, __dirname sits in
   *   node_modules/@ss-node/ss-system/dist/backup/, so 4 levels up lands in node_modules/ (wrong)
   * - Now kept consistent with app.module.ts getDatabaseConfig() and project-database.service.ts getProjectDbDir()
   */
  private getProjectRoot(): string {
    return this.pathResolver.getProjectRoot();
  }

  /**
   * Resolve a path to an absolute path.
   * - Absolute paths: returned as-is (only normalized)
   * - Relative paths: resolved to an absolute path against the project root (ss-services/ss-node)
   */
  private resolveAbsolutePath(p: string | undefined): string | undefined {
    if (!p) return undefined;
    return this.pathResolver.resolve(p);
  }

  /**
   * Get the absolute path of the system database file.
   *
   * In .env.ss, DATABASE_PATH is a relative path (e.g. ../../ss-run/ss/data/db/ss-node.db),
   * resolved against the ss-services/ss-node directory.
   *
   * Fix history: before v1.3, 5 '..' levels went up to ss-services (one too many),
   * leaving the absolute path one ss-v7 level short, so the system database could not be found by fs.existsSync.
   *
   * DATA_DIR basis: in .env.base, DATA_DIR=../../ss-run/ss/data (relative to ss-services/ss-node);
   * DATABASE_PATH=${DATA_DIR}/db/ss-node.db is resolved via dotenv-expand.
   */
  private getSystemDatabasePath(): string {
    const dbPath = this.configService.get<string>('DATABASE_PATH') || './data/ss-node.db';
    return this.resolveAbsolutePath(dbPath)!;
  }

  /**
   * Get the absolute path of the projects root directory.
   *
   * In .env.ss, PROJECTS_DIR is a relative path (e.g. ../../ss-project),
   * resolved to an absolute path against the ss-services/ss-node directory.
   *
   * Fix history: before v1.3, process.env.PROJECTS_DIR (the relative path) was returned directly,
   * making the API response's path field relative and its process.cwd()-based resolution fragile.
   */
  private getProjectsDir(): string {
    const projectsDir =
      this.configService.get<string>('PROJECTS_DIR') || path.join('data', 'projects');
    return this.resolveAbsolutePath(projectsDir)!;
  }

  /**
   * Get the absolute path of a project's database file
   *
   * @param projectName project name (directory name)
   * @returns the absolute path of the project's system.db
   */
  private getProjectDbPath(projectName: string): string {
    return path.join(this.getProjectsDir(), projectName, 'db', 'system.db');
  }

  // ==================== Utility methods ====================

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }
}
