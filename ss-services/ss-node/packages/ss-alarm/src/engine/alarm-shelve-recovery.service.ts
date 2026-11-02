// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Logger,
  Inject,
  Optional,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, FindOptionsWhere } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AlarmRecord, AlarmStatus } from '../entities/alarm.entity';
import { EventBusService, ProjectDatabaseService } from '@ss-node/ss-core';

/**
 * Alarm-shelve auto-recovery service
 *
 * Design goal:
 * - Replace the fragile setTimeout approach inside shelveAlarm (the timer is lost on process restart)
 * - Use periodic scanning (setInterval) to check for expired shelves so recovery still works after restart
 *
 * Scan strategy:
 * - Scan once every 60s (shelve recovery has low real-time requirements, no need for the 30s cadence used by escalation)
 * - Query records with status=SHELVED and shelvedUntil <= now
 * - Roll back to preShelveStatus (roll back to ACTIVE when null), and clear shelvedUntil/preShelveStatus
 * - Keep shelvedAt/shelvedBy/shelveReason as audit trails
 *
 * Database mode adaptation:
 * - isolated mode: iterate ProjectDatabaseService.getLoadedProjectNames() and scan project by project
 * - unified mode: use the globally injected Repository directly
 */
@Injectable()
export class AlarmShelveRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmShelveRecoveryService.name);

  /** Periodic scan interval (ms) */
  private readonly scanIntervalMs: number;
  private periodicTimer: NodeJS.Timeout | null = null;

  private readonly dbMode: string;

  constructor(
    @Inject(getRepositoryToken(AlarmRecord))
    private readonly alarmRecordRepo: Repository<AlarmRecord>,
    private readonly eventBusService: EventBusService,
    @Optional() private readonly projectDbService?: ProjectDatabaseService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.scanIntervalMs = this.configService?.get<number>('ALARM_SHELVE_SCAN_INTERVAL_MS') || 60000;
    this.dbMode = this.configService?.get<string>('PROJECT_DB_MODE', 'isolated') ?? 'isolated';
  }

  onModuleInit(): void {
    this.periodicTimer = setInterval(() => {
      this.periodicCheck().catch((err) => {
        this.logger.error(`Periodic shelve recovery check failed: ${(err as Error).message}`);
      });
    }, this.scanIntervalMs);
    this.logger.log(
      `Shelve recovery scanner started (interval=${this.scanIntervalMs}ms, mode=${this.dbMode})`,
    );
  }

  onModuleDestroy(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Periodically scan for expired shelved alarms and auto-recover them
   *
   * Iterate loaded projects (isolated mode) or the global database (unified mode),
   * find records with status=SHELVED and shelvedUntil <= now, and roll back to the pre-shelve status.
   */
  async periodicCheck(): Promise<void> {
    const now = new Date();
    let recovered = 0;

    if (this.dbMode === 'isolated' && this.projectDbService) {
      const projectNames = this.projectDbService.getLoadedProjectNames();
      for (const projectName of projectNames) {
        const ds = this.projectDbService.getLoadedSystemDb(projectName);
        if (!ds) continue;
        const repo = ds.getRepository(AlarmRecord);
        recovered += await this.recoverExpiredShelves(repo, projectName, now);
      }
    } else {
      recovered += await this.recoverExpiredShelves(this.alarmRecordRepo, null, now);
    }

    if (recovered > 0) {
      this.logger.log(`Recovered ${recovered} expired shelved alarm(s)`);
    }
  }

  /**
   * Recover the expired shelved alarms under the given Repository
   *
   * @param repo    AlarmRecord Repository (project-level or global)
   * @param projectId project identifier (for the event payload; null means unified mode)
   * @param now     current time
   * @returns number of recovered records
   */
  private async recoverExpiredShelves(
    repo: Repository<AlarmRecord>,
    projectId: string | null,
    now: Date,
  ): Promise<number> {
    const where: FindOptionsWhere<AlarmRecord> = {
      status: AlarmStatus.SHELVED,
      // shelvedUntil <= now (in SQL, NULL <= x is NULL/false, so manual-shelve records are auto-excluded)
      shelvedUntil: LessThanOrEqual(now) as unknown as Date,
    };
    const expired = await repo.find({ where });

    if (expired.length === 0) return 0;

    for (const record of expired) {
      const targetStatus = record.preShelveStatus ?? AlarmStatus.ACTIVE;
      record.status = targetStatus;
      record.dispositionType = 'alarm.shelve.expired';
      // Clear the shelve-recovery-specific fields, keeping shelvedAt/shelvedBy/shelveReason as audit trails
      record.shelvedUntil = null;
      record.preShelveStatus = null;

      await repo.save(record);

      this.eventBusService.emit('alarm.shelve.expired', {
        recordId: record.id,
        projectId: projectId ?? record.projectId,
        ruleId: record.ruleId,
        recoveredTo: targetStatus,
        shelvedAt: record.shelvedAt,
        timestamp: Date.now(),
      });

      this.logger.debug(
        `Recovered shelved alarm ${record.id} → ${targetStatus}` +
          (projectId ? ` [project=${projectId}]` : ''),
      );
    }

    return expired.length;
  }
}
