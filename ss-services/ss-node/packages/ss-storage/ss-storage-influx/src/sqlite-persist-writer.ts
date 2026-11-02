// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { IPersistWriter, DataPoint, PersistWriterRegistry } from '@ss-node/ss-collector-sdk';
import { ProjectDatabaseService } from '@ss-node/ss-core';
import { HistoricalData } from './entities/historical-data.entity';

/**
 * SQLite historical-data PersistWriter implementation
 *
 * Data flow: Pipeline DataPoint → write() → buffer → flush() → project database data_historical_data table
 *
 * Conditional activation: writes only when HISTORICAL_DATA_BACKEND=sqlite;
 * otherwise write/writeBatch/flush are all no-ops (InfluxPersistWriter takes over).
 *
 * Key design: uses the project-level DataSource (obtained via ProjectDatabaseService), not the global
 * DataSource. Reasons:
 * - The HistoricalData entity references dev_data_tags.id via @ManyToOne(() => DataTag)
 * - DataTag data lives in the project database (PROJECT_DB_MODE=isolated)
 * - With the global DataSource (ss-node.db), the global dev_data_tags is empty and the foreign key check fails
 *
 * The HistoricalData entity is already registered with ProjectDatabaseService by DataModule.onModuleInit(),
 * so the data_historical_data table is created automatically when each project database initializes.
 *
 * Registration: must actively register with PersistWriterRegistry via onModuleInit,
 * otherwise PersistStep cannot obtain this Writer (NestJS module encapsulation limitation).
 */
@Injectable()
export class SqlitePersistWriter implements IPersistWriter, OnModuleInit {
  readonly name = 'SQLite';
  private readonly logger = new Logger(SqlitePersistWriter.name);
  /** Pending-write buffer grouped by projectId */
  private bufferByProject: Map<string, HistoricalData[]> = new Map();
  private readonly batchSize = 100;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs = 5000;
  /** Whether active: only when HISTORICAL_DATA_BACKEND=sqlite */
  private readonly enabled: boolean;

  isActive(): boolean {
    return this.enabled;
  }

  constructor(
    private readonly projectDbService: ProjectDatabaseService,
    private readonly writerRegistry: PersistWriterRegistry,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get('HISTORICAL_DATA_BACKEND', 'influxdb') === 'sqlite';
  }

  onModuleInit(): void {
    this.writerRegistry.register(this);
    this.logger.log(`SqlitePersistWriter registered (enabled=${this.enabled})`);
  }

  /**
   * Get the HistoricalData repository for a given project
   * Obtains the project-level DataSource via ProjectDatabaseService, then the Repository
   */
  private async getRepo(projectId: string): Promise<Repository<HistoricalData>> {
    const ds = await this.projectDbService.getSystemDb(projectId);
    return ds.getRepository(HistoricalData);
  }

  async write(point: DataPoint): Promise<void> {
    if (!this.enabled) return;

    const repo = await this.getRepo(point.projectId);
    const record = repo.create(this.buildRecord(point));

    const buf = this.bufferByProject.get(point.projectId) ?? [];
    buf.push(record);
    this.bufferByProject.set(point.projectId, buf);

    if (buf.length >= this.batchSize) {
      await this.flushProject(point.projectId, buf);
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  async writeBatch(points: DataPoint[]): Promise<void> {
    if (!this.enabled) return;
    if (points.length === 0) return;

    // Group by projectId and write to the corresponding project databases
    const grouped = new Map<string, DataPoint[]>();
    for (const point of points) {
      const arr = grouped.get(point.projectId) ?? [];
      arr.push(point);
      grouped.set(point.projectId, arr);
    }

    for (const [projectId, pointsForProject] of grouped) {
      try {
        const repo = await this.getRepo(projectId);
        const records = pointsForProject.map((point) => repo.create(this.buildRecord(point)));
        await repo.save(records);
        this.logger.debug(
          `SQLite batch written: ${records.length} records to project ${projectId}`,
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'SQLite write failed';
        this.logger.error(`SQLite batch write error (project=${projectId}): ${errorMsg}`);
        throw error;
      }
    }
  }

  /**
   * Build a HistoricalData record from a DataPoint
   *
   * Values are split by type into the corresponding columns:
   * - number → numericValue
   * - boolean → booleanValue
   * - string → stringValue
   * - null → all three columns null
   *
   * Queries can then read the correct column based on tag.dataType.
   */
  private buildRecord(point: DataPoint): Partial<HistoricalData> {
    const record: Partial<HistoricalData> = {
      tagId: point.tagId,
      numericValue: null,
      stringValue: null,
      booleanValue: null,
      timestamp: point.timestamp,
    };

    if (point.value === null || point.value === undefined) {
      return record;
    }

    if (typeof point.value === 'boolean') {
      record.booleanValue = point.value;
    } else if (typeof point.value === 'string') {
      record.stringValue = point.value;
    } else {
      record.numericValue = point.value;
    }

    return record;
  }

  async flush(): Promise<void> {
    if (!this.enabled) return;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Snapshot the projects pending flush, to avoid re-queueing after flushProject failures making the Map
    // modified during iteration (delete + set makes the iterator revisit that key → infinite loop)
    const entries = Array.from(this.bufferByProject.entries());
    for (const [projectId, buf] of entries) {
      if (buf.length === 0) continue;
      await this.flushProject(projectId, buf);
    }
  }

  private async flushProject(projectId: string, buf: HistoricalData[]): Promise<void> {
    if (buf.length === 0) return;

    // Take out and clear the buffer of the corresponding project
    const batch = buf.splice(0);
    // If the buffer is empty, remove it from the map (avoiding unbounded Map growth)
    if (buf.length === 0) {
      this.bufferByProject.delete(projectId);
    }

    this.logger.debug(`SQLite flushing ${batch.length} records for project ${projectId}`);

    try {
      const repo = await this.getRepo(projectId);
      await repo.save(batch);
      this.logger.debug(`SQLite flushed ${batch.length} records for project ${projectId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'SQLite flush failed';
      this.logger.error(`SQLite flush error (project=${projectId}): ${errorMsg}`);
      // On failure, put the records back into the buffer for the next attempt
      const current = this.bufferByProject.get(projectId) ?? [];
      this.bufferByProject.set(projectId, [...batch, ...current]);
    }
  }
}
