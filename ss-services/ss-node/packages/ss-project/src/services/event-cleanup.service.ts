// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ProjectDatabaseService, PathResolverService, SystemEventService } from '@ss-node/ss-core';

/** Cleanup-scheduler config */
export interface CleanupSchedulerConfig {
  /** Cleanup interval (ms), default 86400000 (24 hours) */
  intervalMs: number;
  /** Whether auto-cleanup is enabled, default true */
  enabled: boolean;
}

/**
 * Event-data retention policy
 */
export interface RetentionPolicy {
  /** Table name */
  tableName: string;
  /** Retention days (default 90) */
  retentionDays: number;
  /** Timestamp field name (default "createdAt") */
  timestampField?: string;
  /** Whether to run VACUUM after cleanup */
  vacuum?: boolean;
}

/**
 * Cleanup result
 */
export interface CleanupResult {
  /** Table name */
  tableName: string;
  /** Number of deleted rows */
  deletedRows: number;
  /** Error message (if any) */
  error?: string;
}

/**
 * Event-data auto-archive and cleanup service
 *
 * Periodically cleans expired event data in system.db:
 * - Alarm records: retained 365 days by default
 */
@Injectable()
export class EventCleanupService implements OnModuleDestroy {
  private readonly logger = new Logger(EventCleanupService.name);

  /** Scheduler timer reference */
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;

  /** Scheduler running state */
  private schedulerRunning = false;

  /** Last cleanup timestamp */
  private lastCleanupTime: Date | null = null;

  /** Cleanup statistics */
  private cleanupStats = {
    totalRuns: 0,
    totalDeletedRows: 0,
    totalErrors: 0,
    lastRunDurationMs: 0,
  };

  /** Table retention policies in system.db */
  private readonly policies: RetentionPolicy[] = [
    { tableName: 'alm_alarm_records', retentionDays: 365, vacuum: true },
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly projectDbService: ProjectDatabaseService,
    private readonly pathResolver: PathResolverService,
    @Optional() private readonly systemEventService?: SystemEventService,
  ) {}

  /**
   * Clean all projects' expired event data
   * Recommended to be called periodically by an external scheduler (e.g. @nestjs/schedule or a cron job)
   */
  async cleanupAllProjects(): Promise<void> {
    if (this.projectDbService.getMode() !== 'isolated') {
      // Project-level cleanup is not executed in unified mode for now
      return;
    }

    this.logger.log('Starting event data cleanup for all projects...');
    const projects = this.getProjectNames();

    for (const projectName of projects) {
      await this.cleanupProjectEvents(projectName);
    }

    // P1-6: clean expired events in the global sys_events table
    await this.cleanupGlobalEvents();

    this.logger.log('Event data cleanup completed');
  }

  /**
   * Clean a specified project's expired event data
   *
   * @param projectName project name
   * @param policies    custom retention policies (defaults used when omitted)
   */
  async cleanupProjectEvents(
    projectName: string,
    policies: RetentionPolicy[] = this.policies,
  ): Promise<{ projectName: string; results: CleanupResult[] }> {
    const results: CleanupResult[] = [];

    // Clean tables in system.db (e.g. alm_alarm_records)
    const systemDs = this.projectDbService.getLoadedSystemDb(projectName);
    if (systemDs) {
      for (const policy of policies) {
        try {
          const result = await this.cleanupTable(systemDs, policy);
          results.push(result);
        } catch (err) {
          const errorMsg = `[${policy.tableName}] 清理失败: ${(err as Error).message}`;
          this.logger.error(`[${projectName}] ${errorMsg}`);
          results.push({ tableName: policy.tableName, deletedRows: 0, error: errorMsg });
        }
      }
      // system.db VACUUM
      try {
        await systemDs.query('VACUUM');
        this.logger.log(`[${projectName}] system.db VACUUM completed`);
      } catch (err) {
        this.logger.warn(`[${projectName}] system.db VACUUM failed: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn(`[${projectName}] system.db not loaded, skip cleanup`);
    }

    const totalDeleted = results.reduce((sum, r) => sum + r.deletedRows, 0);
    if (totalDeleted > 0) {
      this.logger.log(`[${projectName}] Cleanup completed: ${totalDeleted} rows deleted`);
    }

    return { projectName, results };
  }

  /**
   * Clean a single table
   */
  private async cleanupTable(
    dataSource: DataSource,
    policy: RetentionPolicy,
  ): Promise<CleanupResult> {
    const tableName = policy.tableName;
    const timestampField = policy.timestampField || 'createdAt';
    const cutoffDate = new Date(Date.now() - policy.retentionDays * 86400000);
    const cutoffISO = cutoffDate.toISOString();

    // Check whether the table exists
    const tables = await dataSource.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`,
    );
    if (tables.length === 0) {
      return { tableName, deletedRows: 0 };
    }

    const deleteSQL = `DELETE FROM "${tableName}" WHERE "${timestampField}" < ?`;
    const _result = await dataSource.query(deleteSQL, [cutoffISO]);

    // SQLite's DELETE does not directly return affected rows; use changes()
    const changesResult = await dataSource.query('SELECT changes() as count');
    const deletedRows = changesResult[0]?.count || 0;

    if (policy.vacuum && deletedRows > 0) {
      await dataSource.query('VACUUM');
    }

    if (deletedRows > 0) {
      this.logger.log(
        `[${tableName}] 清理完成: ${deletedRows} 行 (保留 ${policy.retentionDays} 天，截止 ${cutoffISO})`,
      );
    }

    return { tableName, deletedRows };
  }

  /**
   * P1-6: clean expired system events in the global sys_events table
   * Retained 90 days by default, executed via SystemEventService.cleanupExpired
   */
  private async cleanupGlobalEvents(): Promise<void> {
    if (!this.systemEventService) {
      this.logger.debug('SystemEventService not available, skip global events cleanup');
      return;
    }

    try {
      const deletedCount = await this.systemEventService.cleanupExpired(90);
      if (deletedCount > 0) {
        this.logger.log(`Global sys_events cleanup: ${deletedCount} expired events removed`);
        this.cleanupStats.totalDeletedRows += deletedCount;
      }
    } catch (err: any) {
      this.cleanupStats.totalErrors++;
      this.logger.error(`Global sys_events cleanup failed: ${err.message}`);
    }
  }

  /**
   * Manually clean a specified table of a specified project
   *
   * @param projectName   project name
   * @param tableName     table name
   * @param retentionDays retention days
   * @param timestampField timestamp field
   */
  async manualCleanup(
    projectName: string,
    tableName: string,
    retentionDays: number,
    timestampField: string = 'createdAt',
  ): Promise<CleanupResult> {
    const policy: RetentionPolicy = {
      tableName,
      retentionDays,
      timestampField,
      vacuum: true,
    };

    const systemDs = this.projectDbService.getLoadedSystemDb(projectName);
    if (!systemDs) {
      throw new Error(`[${projectName}] system.db not loaded`);
    }
    return this.cleanupTable(systemDs, policy);
  }

  /**
   * Get database file-size statistics
   */
  async getDatabaseSizeStats(projectName: string): Promise<{
    systemDbSize: number;
    systemDbSizeHuman: string;
  }> {
    const fs = require('fs');
    const path = require('path');
    const dbDir = this.projectDbService.getProjectDbDir(projectName);

    const systemDbPath = path.join(dbDir, 'system.db');
    const systemDbSize = fs.existsSync(systemDbPath) ? fs.statSync(systemDbPath).size : 0;

    return {
      systemDbSize,
      systemDbSizeHuman: this.formatBytes(systemDbSize),
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Get all project directory names
   *
   * Relative-path base:
   * - dev mode: __dirname up 4 levels = ss-services/ss-node
   *   (after compilation this file lives in packages/ss-project/dist/services/, 4 levels up:
   *    dist/services/ -> dist/ -> ss-project/ -> packages/ -> ss-node/)
   * - production: process.cwd() = ss-run/ss/services/ss-node
   *
   * Fix history: previously used 3-level traversal without distinguishing dev/prod; in dev mode it resolved to packages/ (wrong),
   * and in production __dirname lives in node_modules/@ss-node/ss-project/dist/services/, where 3 levels reaches node_modules/ (wrong).
   * Kept consistent with project-database.service.ts getProjectDbDir().
   */
  private getProjectNames(): string[] {
    const fs = require('fs');
    const projectsDir = this.configService.get<string>('PROJECTS_DIR') || './data/projects';
    const absoluteDir = this.pathResolver.resolve(projectsDir);

    if (!fs.existsSync(absoluteDir)) return [];

    return fs
      .readdirSync(absoluteDir, { withFileTypes: true })
      .filter((e: any) => e.isDirectory())
      .map((e: any) => e.name);
  }

  // ============================================================
  // Auto-cleanup scheduler
  // ============================================================

  /**
   * Start the auto-cleanup scheduler
   *
   * @param config scheduler config (defaults used when omitted: 24-hour interval, enabled)
   */
  startScheduler(config?: Partial<CleanupSchedulerConfig>): void {
    if (this.schedulerTimer) {
      this.logger.warn('Scheduler is already running, stop it first');
      return;
    }

    const enabled = config?.enabled !== false;
    if (!enabled) {
      this.logger.log('Auto-cleanup scheduler is disabled by config');
      return;
    }

    const intervalMs = config?.intervalMs || 86400000; // default 24 hours
    this.logger.log(
      `Starting auto-cleanup scheduler (interval: ${intervalMs}ms ≈ ${(intervalMs / 3600000).toFixed(1)}h)`,
    );

    // Run one cleanup immediately
    this.runScheduledCleanup();

    // Run periodically
    this.schedulerTimer = setInterval(() => {
      this.runScheduledCleanup();
    }, intervalMs);
  }

  /**
   * Stop the auto-cleanup scheduler
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      this.logger.log('Auto-cleanup scheduler stopped');
    }
  }

  /**
   * Check whether the scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.schedulerTimer !== null;
  }

  /**
   * Get scheduler status and statistics
   */
  getSchedulerStatus(): {
    running: boolean;
    lastCleanupTime: Date | null;
    totalRuns: number;
    totalDeletedRows: number;
    totalErrors: number;
    lastRunDurationMs: number;
  } {
    return {
      running: this.isSchedulerRunning(),
      lastCleanupTime: this.lastCleanupTime,
      ...this.cleanupStats,
    };
  }

  /**
   * Run one scheduled cleanup task
   */
  private async runScheduledCleanup(): Promise<void> {
    if (this.schedulerRunning) {
      this.logger.warn('Previous cleanup still running, skipping this cycle');
      return;
    }

    this.schedulerRunning = true;
    const startTime = Date.now();

    try {
      await this.cleanupAllProjects();
      this.cleanupStats.totalRuns++;
      this.lastCleanupTime = new Date();
    } catch (err) {
      this.cleanupStats.totalErrors++;
      this.logger.error(`Scheduled cleanup failed: ${(err as Error).message}`);
    } finally {
      this.cleanupStats.lastRunDurationMs = Date.now() - startTime;
      this.schedulerRunning = false;
    }
  }

  /**
   * Stop the scheduler on module destroy
   */
  onModuleDestroy(): void {
    this.stopScheduler();
  }
}
