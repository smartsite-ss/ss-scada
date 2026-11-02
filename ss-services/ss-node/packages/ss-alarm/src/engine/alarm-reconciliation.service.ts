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
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  LatestValueRedisService,
  type LatestValueEntry,
  ProjectDatabaseService,
  EventBusService,
  AlarmRecoveredEvent,
} from '@ss-node/ss-core';
import { AlarmRule, AlarmRecord, AlarmStatus } from '../entities/alarm.entity';
import { ConditionEvaluator } from './condition-evaluator';

/**
 * AlarmReconciliationService - alarm reconciliation service (Phase 5.5 restart safety net)
 *
 * ## Design goal
 * The recovery detection in AlarmCheckStep relies on the in-memory `alarmStates` Map. After a process restart this Map is lost,
 * so even if the collected value has recovered, the `alarm_normalized` event cannot be triggered, leaving the alarm stuck in
 * the ACTIVE state (cannot be closed).
 *
 * This service solves the problem via periodic reconciliation: it periodically scans all unrecovered active alarms, reads the
 * latest value from Redis, re-evaluates the condition, and compensates by running the recovery flow if it has recovered.
 *
 * ## Scan strategy
 * - Scan once every 5 minutes (ALARM_RECONCILIATION_INTERVAL_MS configurable, default 300000)
 * - Only scan records with status IN (ACTIVE, ACKNOWLEDGED) AND isActive=true
 *   (the SHELVED state is managed independently by AlarmShelveRecoveryService and is not reconciled here)
 * - For each record, read the latest value from Redis: resolve deviceCode via the tree index (`ss:latest:tree:{projectId}`),
 *   then HGET the {tagId} latest value from the device key (`ss:latest:{projectId}:{deviceCode}`)
 * - Data freshness check: collected values older than maxAgeMs (default 10 minutes) are treated as stale and skipped
 *   (data stops updating when the device is offline, so recovery should not be based on stale values)
 * - Quality check: skip abnormal quality such as quality='bad'/'comm_error'; do not recover based on bad data
 * - Re-evaluate condition: if the condition is no longer satisfied (normalized) and rule.autoClear=true -> run recovery
 *
 * ## Database mode adaptation
 * - isolated mode: iterate ProjectDatabaseService.getLoadedProjectNames() and scan project by project
 * - unified mode: use the globally injected Repository directly
 *
 * ## Relationship with AlarmRecoverySubscriber
 * - AlarmRecoverySubscriber: real-time path, recovers immediately on the `alarm_normalized` event (normal flow)
 * - AlarmReconciliationService: fallback path, periodic scan to compensate recovery (restart / missed-event scenarios)
 * Both ultimately close the loop via the same field-update logic, with clearReason='auto'
 */
@Injectable()
export class AlarmReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmReconciliationService.name);

  /** Periodic scan interval (ms), default 5 minutes */
  private readonly scanIntervalMs: number;
  /** Max allowed staleness of a collected value (ms), default 10 minutes */
  private readonly maxAgeMs: number;
  /** Max records processed per project per scan, to prevent a large project from stalling */
  private readonly batchLimit: number;

  private periodicTimer: NodeJS.Timeout | null = null;
  private readonly dbMode: string;

  constructor(
    @Inject(getRepositoryToken(AlarmRecord))
    private readonly alarmRecordRepo: Repository<AlarmRecord>,
    @Optional() private readonly latestValueRedisService?: LatestValueRedisService,
    @Optional() private readonly projectDbService?: ProjectDatabaseService,
    @Optional() private readonly eventBus?: EventBusService,
    private readonly conditionEvaluator?: ConditionEvaluator,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.scanIntervalMs =
      this.configService?.get<number>('ALARM_RECONCILIATION_INTERVAL_MS') || 300000;
    this.maxAgeMs = this.configService?.get<number>('ALARM_RECONCILIATION_MAX_AGE_MS') || 600000;
    this.batchLimit = this.configService?.get<number>('ALARM_RECONCILIATION_BATCH_LIMIT') || 500;
    this.dbMode = this.configService?.get<string>('PROJECT_DB_MODE', 'isolated') ?? 'isolated';
  }

  onModuleInit(): void {
    // Reconciliation is meaningless without Redis (cannot read latest values), but still start the timer for log hints
    this.periodicTimer = setInterval(() => {
      this.reconcile().catch((err) => {
        this.logger.error(`Periodic reconciliation failed: ${(err as Error).message}`);
      });
    }, this.scanIntervalMs);
    this.logger.log(
      `Reconciliation scanner started (interval=${this.scanIntervalMs}ms, ` +
        `maxAge=${this.maxAgeMs}ms, batchLimit=${this.batchLimit}, ` +
        `redis=${this.latestValueRedisService?.enabled ? 'enabled' : 'disabled'}, mode=${this.dbMode})`,
    );
  }

  onModuleDestroy(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /**
   * Run one reconciliation scan
   *
   * Iterate loaded projects (isolated mode) or the global database (unified mode),
   * find unrecovered active alarms, read the latest Redis value, re-evaluate the condition, and compensate by running recovery.
   */
  async reconcile(): Promise<void> {
    if (!this.latestValueRedisService?.enabled) {
      this.logger.debug('Reconciliation skipped: Redis latest value service not configured');
      return;
    }
    if (!this.conditionEvaluator) {
      this.logger.warn('Reconciliation skipped: ConditionEvaluator not available');
      return;
    }

    let recovered = 0;
    const startedAt = Date.now();

    if (this.dbMode === 'isolated' && this.projectDbService) {
      const projectNames = this.projectDbService.getLoadedProjectNames();
      for (const projectName of projectNames) {
        const ds = this.projectDbService.getLoadedSystemDb(projectName);
        if (!ds) continue;
        const recordRepo = ds.getRepository(AlarmRecord);
        const ruleRepo = ds.getRepository(AlarmRule);
        recovered += await this.reconcileProject(recordRepo, ruleRepo, projectName);
      }
    } else {
      // unified mode: use the globally injected Repository; ruleRepo is obtained via recordRepo.manager
      const ruleRepo = this.alarmRecordRepo.manager.getRepository(AlarmRule);
      recovered += await this.reconcileProject(this.alarmRecordRepo, ruleRepo, null);
    }

    const elapsed = Date.now() - startedAt;
    if (recovered > 0) {
      this.logger.log(`Reconciliation completed: recovered ${recovered} alarm(s) in ${elapsed}ms`);
    } else {
      this.logger.debug(`Reconciliation completed: no alarms to recover (${elapsed}ms)`);
    }
  }

  /**
   * Reconcile the active alarms of a single project (or the global database)
   *
   * @param recordRepo  AlarmRecord Repository (project-level or global)
   * @param ruleRepo    AlarmRule Repository
   * @param projectId   project identifier (for the Redis key + event payload; null means unified mode)
   * @returns number of recovered records
   */
  private async reconcileProject(
    recordRepo: Repository<AlarmRecord>,
    ruleRepo: Repository<AlarmRule>,
    projectId: string | null,
  ): Promise<number> {
    // Query unrecovered active alarms (ACTIVE + ACKNOWLEDGED, excluding SHELVED)
    const records = await recordRepo.find({
      where: {
        status: In([AlarmStatus.ACTIVE, AlarmStatus.ACKNOWLEDGED]),
        isActive: true,
      },
      take: this.batchLimit,
      order: { createdAt: 'ASC' },
    });

    if (records.length === 0) return 0;

    // Batch-load related rules (for condition / conditionValue / autoClear)
    const ruleIds = [...new Set(records.map((r) => r.ruleId).filter(Boolean))] as string[];
    const rules = ruleIds.length > 0 ? await ruleRepo.find({ where: { id: In(ruleIds) } }) : [];
    const ruleMap = new Map(rules.map((r) => [r.id, r]));

    const recoveredRecords: AlarmRecord[] = [];
    const now = new Date();
    const staleThreshold = now.getTime() - this.maxAgeMs;

    for (const record of records) {
      // Missing tagId / deviceId makes Redis lookup impossible, skip
      if (!record.tagId || !record.deviceId) continue;
      // Look up rule: if not found or autoClear=false, do not auto-recover
      const rule = record.ruleId ? ruleMap.get(record.ruleId) : undefined;
      if (rule && !rule.autoClear) continue;

      const effectiveProjectId = projectId ?? record.projectId;
      let latest: LatestValueEntry | null;
      try {
        // v3: readTag needs deviceCode, but the alarm record holds deviceId,
        // so use readTagByDeviceId to resolve deviceCode via the tree index, then read
        latest = await this.latestValueRedisService!.readTagByDeviceId(
          effectiveProjectId,
          record.deviceId,
          record.tagId,
        );
      } catch (err) {
        // On Redis read failure, skip this record (do not abort the whole reconciliation scan)
        const msg = err instanceof Error ? err.message : 'Unknown';
        this.logger.debug(`readTag failed for record ${record.id}: ${msg}`);
        continue;
      }
      if (!latest) continue;

      // Quality check: bad-quality data is untrusted, skip
      if (latest.quality && latest.quality !== 'good' && latest.quality !== 'unknown') continue;

      // Stale-data check: collected values older than maxAgeMs are treated as stale
      const valueTime = latest.timestamp.getTime();
      if (isNaN(valueTime) || valueTime < staleThreshold) continue;

      // Re-evaluate condition
      const condition = rule?.condition ?? record.rule?.condition;
      const conditionValue = rule?.conditionValue ?? record.rule?.conditionValue;
      if (!condition || conditionValue === undefined || conditionValue === null) continue;

      // Convert the latest value to a number for condition evaluation (number used directly; boolean->0/1; string->parseFloat)
      // Skip null or unparseable values (numeric alarm conditions cannot be evaluated)
      const numericValue =
        typeof latest.value === 'number'
          ? latest.value
          : typeof latest.value === 'boolean'
            ? latest.value
              ? 1
              : 0
            : typeof latest.value === 'string'
              ? parseFloat(latest.value)
              : NaN;
      if (Number.isNaN(numericValue)) continue;

      const stillTriggered = this.conditionEvaluator!.evaluate(
        numericValue,
        condition,
        conditionValue,
      );

      if (stillTriggered) continue; // condition still met, not recovered

      // Condition has recovered -> run recovery (same field-update logic as AlarmRecoverySubscriber)
      const recoveredValue = String(latest.value);
      record.status = AlarmStatus.CLEARED;
      record.clearedAt = now;
      record.clearedBy = 'auto';
      record.isActive = false;
      record.clearReason = 'auto';
      record.recoveredAt = now;
      record.recoveredValue = recoveredValue;
      record.dispositionType = 'alarm.cleared';
      recoveredRecords.push(record);

      this.logger.debug(
        `Reconciled alarm ${record.id} (tag=${record.tagId}, ` +
          `project=${effectiveProjectId}, value=${recoveredValue})`,
      );
    }

    if (recoveredRecords.length > 0) {
      await recordRepo.save(recoveredRecords);

      // Emit the alarm.recovered event (for WebSocket push + notification service)
      if (this.eventBus) {
        for (const record of recoveredRecords) {
          const event: AlarmRecoveredEvent = {
            recordId: record.id,
            tagId: record.tagId ?? '',
            deviceId: record.deviceId,
            projectId: projectId ?? record.projectId,
            recoveredValue: record.recoveredValue ?? '',
            recoveredAt: now,
            ruleId: record.ruleId ?? undefined,
            ruleName: ruleMap.get(record.ruleId ?? '')?.name,
          };
          this.eventBus.emit('alarm.recovered', event);
        }
      }
    }

    return recoveredRecords.length;
  }
}
