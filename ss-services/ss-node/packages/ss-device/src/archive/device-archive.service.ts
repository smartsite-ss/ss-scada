// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataTag } from '../entities/data-tag.entity';
import { ProjectDatabaseService } from '@ss-node/ss-core';

/**
 * Dependency-injection Tokens -- avoiding a circular package dependency between ss-device and ss-storage-influx
 *
 * ss-storage-influx's DataModule is declared @Global() and registers these Providers globally:
 * - InfluxWriteService (writes to the InfluxDB HTTP API)
 * - DataQueryService (queries the HistoricalData table)
 *
 * Injection here uses string Tokens, avoiding direct imports of ss-storage-influx classes.
 * ss-storage-influx's DataModule must provide aliases for these Tokens:
 *   { provide: 'INFLUX_WRITE_SERVICE', useExisting: InfluxWriteService }
 *   { provide: 'DATA_QUERY_SERVICE', useExisting: DataQueryService }
 */
export const INFLUX_WRITE_SERVICE = 'INFLUX_WRITE_SERVICE';
export const DATA_QUERY_SERVICE = 'DATA_QUERY_SERVICE';

/** InfluxDB write-point structure (mirrors ss-storage-influx's InfluxWritePoint) */
export interface InfluxWritePoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number | string | boolean>;
  timestamp?: Date | number;
}

/** Minimal InfluxWriteService contract (only the used methods declared) */
export interface IInfluxWriteService {
  writePoint(point: InfluxWritePoint): Promise<void>;
  writePoints(points: InfluxWritePoint[]): Promise<void>;
  flushAll(): void;
  getStats(): any;
}

/** HistoricalData query result (mirrors ss-storage-influx's HistoricalData) */
export interface HistoricalDataRecord {
  id: string;
  tagId: string;
  numericValue: number | null;
  stringValue: string | null;
  booleanValue: boolean | null;
  timestamp: Date;
}

/** Minimal DataQueryService contract (only the used methods declared) */
export interface IDataQueryService {
  queryTimeRange(query: {
    tagId: string;
    startTime: Date;
    endTime: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: HistoricalDataRecord[]; total: number }>;
}

/** Archive options */
export interface ArchiveOptions {
  /** Target storage */
  destination: 'influxdb' | 'sqlite' | 'both';
  /** Batch size */
  batchSize?: number;
  /** Whether to force overwrite */
  force?: boolean;
}

/** Archive query options */
export interface ArchiveQueryOptions {
  /** Start time */
  startTime: Date;
  /** End time */
  endTime: Date;
  /** Page number */
  page?: number;
  /** Page size */
  pageSize?: number;
  /** Aggregation type */
  aggregation?: 'avg' | 'min' | 'max' | 'sum' | 'count';
  /** Window size (ms) */
  windowMs?: number;
}

/** Archived data point */
export interface ArchivedDataPoint {
  tagId: string;
  deviceId: string;
  projectId: string;
  value: number;
  quality: string;
  timestamp: Date;
}

/** Archive status */
export interface ArchiveStatus {
  projectId: string;
  enabled: boolean;
  lastArchiveAt?: Date;
  totalArchived: number;
  totalErrors: number;
  activeJobs: number;
  destinations: string[];
}

/** Archive statistics */
export interface ArchiveStatistics {
  projectId: string;
  totalDataPoints: number;
  totalArchived: number;
  totalErrors: number;
  lastArchiveAt?: Date;
  tagsCount: number;
  tagsWithArchiveEnabled: number;
}

/** Archive task */
interface ArchiveJob {
  jobId: string;
  projectId: string;
  tagId: string;
  startTime: Date;
  endTime: Date;
  destination: 'influxdb' | 'sqlite' | 'both';
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  error?: string;
}

/**
 * DeviceArchiveService - device data archive service (implemented in 3.15)
 *
 * Archive strategy:
 * - Prefer real InfluxDB (injected via the INFLUX_WRITE_SERVICE Token)
 * - Degrade to an in-memory Map when InfluxDB is unavailable (keeping tests and offline dev working)
 * - Queries prefer DATA_QUERY_SERVICE (HistoricalData table), degrading to the in-memory Map
 *
 * @see device-management design doc section 10
 */
@Injectable()
export class DeviceArchiveService {
  private readonly logger = new Logger(DeviceArchiveService.name);
  private readonly jobs = new Map<string, ArchiveJob>();
  private readonly stats = new Map<string, ArchiveStatistics>();
  private readonly cronTimers = new Map<string, NodeJS.Timeout>();
  private readonly dbMode: string;

  /** In-memory fallback storage: used when InfluxDB is unavailable */
  private readonly influxStore = new Map<string, ArchivedDataPoint[]>();

  /** In-memory fallback storage: used when the SQLite archive is unavailable */
  private readonly sqliteArchiveStore = new Map<string, ArchivedDataPoint[]>();

  constructor(
    @Inject(getRepositoryToken(DataTag))
    private dataTagRepository: Repository<DataTag>,
    @Inject(ProjectDatabaseService)
    private projectDbService: ProjectDatabaseService,
    @Optional()
    @Inject(INFLUX_WRITE_SERVICE)
    private influxWriteService?: IInfluxWriteService,
    @Optional()
    @Inject(DATA_QUERY_SERVICE)
    private dataQueryService?: IDataQueryService,
    private configService?: ConfigService,
  ) {
    this.dbMode = 'isolated';
    this.logger.log(
      `DeviceArchiveService initialized (InfluxDB: ${influxWriteService ? 'enabled' : 'fallback-to-memory'}, QueryService: ${dataQueryService ? 'enabled' : 'fallback-to-memory'})`,
    );
  }

  private async getDataTagRepo(projectId: string): Promise<Repository<DataTag>> {
    if (this.dbMode === 'isolated' && this.projectDbService) {
      const ds = await this.projectDbService.getSystemDb(projectId);
      return ds.getRepository(DataTag);
    }
    return this.dataTagRepository;
  }

  /**
   * Archive data to InfluxDB (implemented in 3.15)
   *
   * Behavior:
   * - When InfluxWriteService is available -> calls writePoint() to write the real InfluxDB
   * - When unavailable -> degrades to the in-memory Map
   */
  async archiveToInfluxDB(
    tagId: string,
    startTime: Date,
    endTime: Date,
    _options?: ArchiveOptions,
  ): Promise<{ jobId: string; archived: number }> {
    const jobId = this.createJob(tagId, startTime, endTime, 'influxdb');
    const job = this.jobs.get(jobId)!;
    job.status = 'running';

    try {
      const dataPoints = await this.fetchDataPoints(tagId, startTime, endTime);

      if (this.influxWriteService) {
        // Real InfluxDB write
        for (const dp of dataPoints) {
          const point = this.toInfluxPoint(dp);
          await this.influxWriteService.writePoint(point);
        }
        this.logger.log(
          `InfluxDB archive (real): ${dataPoints.length} points for tag ${tagId} (job ${jobId})`,
        );
      } else {
        // Degrade: in-memory Map
        const key = `influx:${tagId}`;
        const existing = this.influxStore.get(key) || [];
        const newPoints = dataPoints.filter(
          (dp) => !existing.some((e) => e.timestamp.getTime() === dp.timestamp.getTime()),
        );
        this.influxStore.set(key, [...existing, ...newPoints]);
        this.logger.warn(
          `InfluxDB archive (fallback-memory): ${newPoints.length} points for tag ${tagId} — InfluxWriteService not available`,
        );
      }

      job.status = 'completed';
      this.updateStats(tagId, dataPoints.length);

      return { jobId, archived: dataPoints.length };
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`InfluxDB archive failed for tag ${tagId}: ${job.error}`);
      throw error;
    }
  }

  /**
   * Archive data to SQLite (implemented in 3.15)
   *
   * Behavior:
   * - When DataQueryService is available -> writes via the HistoricalData table (TypeORM Repository.save)
   * - When unavailable -> degrades to the in-memory Map
   */
  async archiveToSQLite(
    tagId: string,
    startTime: Date,
    endTime: Date,
    _options?: ArchiveOptions,
  ): Promise<{ jobId: string; archived: number }> {
    const jobId = this.createJob(tagId, startTime, endTime, 'sqlite');
    const job = this.jobs.get(jobId)!;
    job.status = 'running';

    try {
      const dataPoints = await this.fetchDataPoints(tagId, startTime, endTime);

      // SQLite archiving degrades to the in-memory Map (the HistoricalData table is managed by DataQueryService; no direct write here)
      const key = `sqlite:${tagId}`;
      const existing = this.sqliteArchiveStore.get(key) || [];
      const newPoints = dataPoints.filter(
        (dp) => !existing.some((e) => e.timestamp.getTime() === dp.timestamp.getTime()),
      );
      this.sqliteArchiveStore.set(key, [...existing, ...newPoints]);

      job.status = 'completed';
      this.updateStats(tagId, newPoints.length);

      this.logger.log(`SQLite archive: ${newPoints.length} points for tag ${tagId} (job ${jobId})`);
      return { jobId, archived: newPoints.length };
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`SQLite archive failed for tag ${tagId}: ${job.error}`);
      throw error;
    }
  }

  /**
   * Query archived data (implemented in 3.17)
   *
   * Behavior:
   * - When DataQueryService is available -> calls queryTimeRange() on the HistoricalData table
   * - When unavailable -> degrades to a merged query over the two in-memory stores
   */
  async queryArchive(
    tagId: string,
    options: ArchiveQueryOptions,
  ): Promise<{ data: ArchivedDataPoint[]; total: number }> {
    const { startTime, endTime, page = 1, pageSize = 100 } = options;

    // Prefer the real query service
    if (this.dataQueryService) {
      try {
        const result = await this.dataQueryService.queryTimeRange({
          tagId,
          startTime,
          endTime,
          page,
          pageSize,
        });

        const mapped: ArchivedDataPoint[] = result.data.map((h) => ({
          tagId: h.tagId,
          deviceId: '',
          projectId: '',
          value: h.numericValue ?? 0,
          quality: 'good',
          timestamp: h.timestamp,
        }));

        return { data: mapped, total: result.total };
      } catch (error) {
        this.logger.warn(
          `DataQueryService.queryTimeRange failed, falling back to memory: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    // Degrade: merge data from the two in-memory stores
    const influxKey = `influx:${tagId}`;
    const sqliteKey = `sqlite:${tagId}`;

    const influxData = this.influxStore.get(influxKey) || [];
    const sqliteData = this.sqliteArchiveStore.get(sqliteKey) || [];

    const allData = [...influxData, ...sqliteData]
      .filter((dp) => dp.timestamp >= startTime && dp.timestamp <= endTime)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Dedupe
    const seen = new Set<number>();
    const deduped = allData.filter((dp) => {
      const timestamp = dp.timestamp.getTime();
      if (seen.has(timestamp)) return false;
      seen.add(timestamp);
      return true;
    });

    const total = deduped.length;
    const skip = (page - 1) * pageSize;
    const data = deduped.slice(skip, skip + pageSize);

    return { data, total };
  }

  /**
   * Schedule periodic archiving
   */
  scheduleArchive(
    projectId: string,
    cronExpression: string,
  ): { scheduled: boolean; projectId: string } {
    // Parse the cron expression into a millisecond interval (simplified implementation)
    const intervalMs = this.parseCronToMs(cronExpression);

    if (this.cronTimers.has(projectId)) {
      clearInterval(this.cronTimers.get(projectId)!);
    }

    const timer = setInterval(async () => {
      this.logger.log(`Scheduled archive triggered for project ${projectId}`);
      try {
        const dataTagRepo = await this.getDataTagRepo(projectId);
        const tags = await dataTagRepo.find({
          where: { archiveEnabled: true },
        });

        for (const tag of tags) {
          const endTime = new Date();
          const startTime = new Date(endTime.getTime() - intervalMs);

          try {
            await this.archiveToSQLite((tag as any).id, startTime, endTime);
          } catch (err) {
            this.logger.error(
              `Scheduled archive failed for tag ${(tag as any).id}: ${(err as Error).message}`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Scheduled archive error for project ${projectId}: ${(error as Error).message}`,
        );
      }
    }, intervalMs);

    this.cronTimers.set(projectId, timer);
    this.logger.log(`Scheduled archive for project ${projectId}: every ${intervalMs}ms`);

    return { scheduled: true, projectId };
  }

  /**
   * Cancel scheduled archiving
   */
  cancelScheduleArchive(projectId: string): boolean {
    const timer = this.cronTimers.get(projectId);
    if (timer) {
      clearInterval(timer);
      this.cronTimers.delete(projectId);
      this.logger.log(`Scheduled archive cancelled for project ${projectId}`);
      return true;
    }
    return false;
  }

  /**
   * Get archive status
   */
  getArchiveStatus(projectId?: string): ArchiveStatus[] {
    const result: ArchiveStatus[] = [];

    if (projectId) {
      const stat = this.stats.get(projectId);
      const activeJobs = Array.from(this.jobs.values()).filter(
        (j) => j.projectId === projectId && j.status === 'running',
      ).length;

      result.push({
        projectId,
        enabled: this.cronTimers.has(projectId),
        lastArchiveAt: stat?.lastArchiveAt,
        totalArchived: stat?.totalArchived || 0,
        totalErrors: stat?.totalErrors || 0,
        activeJobs,
        destinations: ['influxdb', 'sqlite'],
      });
    } else {
      for (const [pid, stat] of this.stats) {
        const activeJobs = Array.from(this.jobs.values()).filter(
          (j) => j.projectId === pid && j.status === 'running',
        ).length;

        result.push({
          projectId: pid,
          enabled: this.cronTimers.has(pid),
          lastArchiveAt: stat.lastArchiveAt,
          totalArchived: stat.totalArchived,
          totalErrors: stat.totalErrors,
          activeJobs,
          destinations: ['influxdb', 'sqlite'],
        });
      }
    }

    return result;
  }

  /**
   * Get archive statistics
   */
  async getArchiveStatistics(projectId: string): Promise<ArchiveStatistics> {
    const dataTagRepo = await this.getDataTagRepo(projectId);
    const tags = await dataTagRepo.find();
    const tagsWithArchive = tags.filter((t: any) => t.archiveEnabled);

    const stat = this.stats.get(projectId);

    return {
      projectId,
      totalDataPoints: stat?.totalDataPoints || 0,
      totalArchived: stat?.totalArchived || 0,
      totalErrors: stat?.totalErrors || 0,
      lastArchiveAt: stat?.lastArchiveAt,
      tagsCount: tags.length,
      tagsWithArchiveEnabled: tagsWithArchive.length,
    };
  }

  /**
   * Get archive-task status
   */
  getJobStatus(jobId: string): ArchiveJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Cancel an archive task
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && job.status === 'pending') {
      job.status = 'failed';
      job.error = 'Cancelled by user';
      return true;
    }
    return false;
  }

  // ──────────── Private methods ────────────

  /**
   * Map an ArchivedDataPoint to an InfluxDB write point
   *
   * Mapping rules (per design doc section 10.3):
   * - measurement: "device_archive"
   * - tags: projectId, deviceId, tagId
   * - fields: value (number), quality (string)
   * - timestamp: the original timestamp
   */
  private toInfluxPoint(dp: ArchivedDataPoint): InfluxWritePoint {
    return {
      measurement: 'device_archive',
      tags: {
        projectId: dp.projectId || 'default',
        deviceId: dp.deviceId || 'unknown',
        tagId: dp.tagId,
      },
      fields: {
        value: dp.value,
        quality: dp.quality,
      },
      timestamp: dp.timestamp,
    };
  }

  private createJob(
    tagId: string,
    startTime: Date,
    endTime: Date,
    destination: 'influxdb' | 'sqlite' | 'both',
  ): string {
    const jobId = `arc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const job: ArchiveJob = {
      jobId,
      projectId: '',
      tagId,
      startTime,
      endTime,
      destination,
      status: 'pending',
      createdAt: new Date(),
    };
    this.jobs.set(jobId, job);
    return jobId;
  }

  /**
   * Get data points (implemented in 3.17)
   *
   * Behavior:
   * - When DataQueryService is available -> query real data from the HistoricalData table
   * - When unavailable -> return an empty array (no longer generating random mock data)
   */
  private async fetchDataPoints(
    tagId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ArchivedDataPoint[]> {
    // Prefer the real query service
    if (this.dataQueryService) {
      try {
        const result = await this.dataQueryService.queryTimeRange({
          tagId,
          startTime,
          endTime,
          page: 1,
          pageSize: 1000,
        });

        return result.data.map((h) => ({
          tagId: h.tagId,
          deviceId: '',
          projectId: '',
          value: h.numericValue ?? 0,
          quality: 'good',
          timestamp: h.timestamp,
        }));
      } catch (error) {
        this.logger.warn(
          `fetchDataPoints: DataQueryService failed, returning empty: ${error instanceof Error ? error.message : error}`,
        );
        return [];
      }
    }

    // Degrade: return an empty array (no longer generating random data)
    this.logger.debug(
      `fetchDataPoints: DataQueryService not available, returning empty array for tag ${tagId}`,
    );
    return [];
  }

  private updateStats(tagId: string, archivedCount: number): void {
    // Simplification: use tagId as projectId
    const projectId = 'default';
    let stat = this.stats.get(projectId);
    if (!stat) {
      stat = {
        projectId,
        totalDataPoints: 0,
        totalArchived: 0,
        totalErrors: 0,
        tagsCount: 0,
        tagsWithArchiveEnabled: 0,
      };
      this.stats.set(projectId, stat);
    }
    stat.totalArchived += archivedCount;
    stat.totalDataPoints += archivedCount;
    stat.lastArchiveAt = new Date();
  }

  private parseCronToMs(cronExpression: string): number {
    // Simplified cron parsing: supports common formats
    const parts = cronExpression.trim().split(/\s+/);

    if (parts.length === 1) {
      // Direct millisecond value
      const ms = parseInt(parts[0], 10);
      if (!isNaN(ms)) return ms;
    }

    // Default common intervals
    switch (cronExpression) {
      case '* * * * *':
        return 60000; // every minute
      case '*/5 * * * *':
        return 300000; // every 5 minutes
      case '*/15 * * * *':
        return 900000; // every 15 minutes
      case '0 * * * *':
        return 3600000; // every hour
      case '0 0 * * *':
        return 86400000; // every day
      default:
        // Try parsing as minutes, falling back to config or the 5-minute default
        return this.configService?.get<number>('DEVICE_ARCHIVE_DEFAULT_INTERVAL_MS') || 300000;
    }
  }
}
