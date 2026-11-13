// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, Like, In } from 'typeorm';
import { AlarmRule, AlarmRecord, AlarmStatus, AlarmLevel } from './entities/alarm.entity';
import { I18nService } from '@ss-node/ss-i18n';
import { ErrorFactory, ProjectDatabaseService } from '@ss-node/ss-core';
import { ConfigService } from '@nestjs/config';
/** Valid status-transition mapping */
const VALID_TRANSITIONS: Record<AlarmStatus, AlarmStatus[]> = {
  [AlarmStatus.ACTIVE]: [AlarmStatus.ACKNOWLEDGED, AlarmStatus.SHELVED, AlarmStatus.CLEARED],
  [AlarmStatus.ACKNOWLEDGED]: [AlarmStatus.CLEARED, AlarmStatus.SHELVED],
  [AlarmStatus.SHELVED]: [AlarmStatus.ACTIVE, AlarmStatus.ACKNOWLEDGED, AlarmStatus.CLEARED],
  [AlarmStatus.CLEARED]: [],
};

export interface AlarmRecordsFilter {
  level?: string;
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  alarmType?: string;
  dispositionType?: string;
  /** Whether it is a real-time alarm: true=real-time only (active/acknowledged/shelved) / false=history only (cleared).
   *  Added in Phase 5: explicitly distinguishes real-time from history; more efficient than status IN (...) */
  isActive?: boolean;
}

/** Single failed item of a batch acknowledgment (mini-program phase 2: partial-failure structure, no whole-operation throw) */
export interface BatchAcknowledgeFailureItem {
  alarmRecordId: string;
  reason: 'not_found' | 'already_acknowledged' | 'already_cleared' | 'invalid_status';
}

/** Batch-acknowledgment result (return structure of the idempotent API) */
export interface BatchAcknowledgeResult {
  succeeded: string[];
  failed: BatchAcknowledgeFailureItem[];
}

/** Idempotency-key cache TTL (10 minutes, covers the network-retry window) */
const BATCH_ACKNOWLEDGE_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

interface AlarmRepos {
  alarmRuleRepo: Repository<AlarmRule>;
  alarmRecordRepo: Repository<AlarmRecord>;
}

@Injectable()
export class AlarmService {
  private readonly logger = new Logger(AlarmService.name);
  private readonly err: ErrorFactory;
  private readonly dbMode: string;

  /** Batch-acknowledgment idempotency-key cache: `{projectId}:{requestId}` -> first result (in-process memory; restart invalidation does not affect correctness) */
  private readonly batchAcknowledgeIdempotencyCache = new Map<
    string,
    { result: BatchAcknowledgeResult; expireAt: number }
  >();

  constructor(
    @Inject(getRepositoryToken(AlarmRule))
    private alarmRuleRepository: Repository<AlarmRule>,
    @Inject(getRepositoryToken(AlarmRecord))
    private alarmRecordRepository: Repository<AlarmRecord>,
    @Inject(I18nService)
    private i18nService: I18nService,
    @Optional()
    private projectDbService?: ProjectDatabaseService,
    private configService?: ConfigService,
  ) {
    this.err = new ErrorFactory(this.i18nService);
    this.dbMode = this.configService?.get<string>('PROJECT_DB_MODE', 'isolated') ?? 'isolated';
  }

  /**
   * Get the Repository collection for the given project ID
   * - isolated mode: obtain the project-level DataSource via ProjectDatabaseService
   * - unified mode: use the globally injected Repository (backward-compatible behavior)
   */
  private async getRepos(projectId: string): Promise<AlarmRepos> {
    if (this.dbMode === 'isolated' && this.projectDbService) {
      const ds = await this.projectDbService.getSystemDb(projectId);
      return {
        alarmRuleRepo: ds.getRepository(AlarmRule),
        alarmRecordRepo: ds.getRepository(AlarmRecord),
      };
    }
    return {
      alarmRuleRepo: this.alarmRuleRepository,
      alarmRecordRepo: this.alarmRecordRepository,
    };
  }

  // ==================== Rule query ====================

  async findAllRules(projectId: string): Promise<AlarmRule[]> {
    const { alarmRuleRepo } = await this.getRepos(projectId);
    return alarmRuleRepo.find({ where: { projectId }, relations: ['tag'] });
  }

  async findOneRule(id: string, projectId: string): Promise<AlarmRule> {
    const { alarmRuleRepo } = await this.getRepos(projectId);
    const rule = await alarmRuleRepo.findOne({
      where: { id, projectId },
      relations: ['tag'],
    });
    if (!rule) this.err.notFound('alarm.rule.not_found', { id });
    return rule;
  }

  // ==================== Rule CRUD ====================

  async createRule(projectId: string, data: Partial<AlarmRule>): Promise<AlarmRule> {
    const { alarmRuleRepo } = await this.getRepos(projectId);
    const rule = alarmRuleRepo.create({
      name: data.name,
      description: data.description,
      level: data.level,
      condition: data.condition,
      conditionValue: data.conditionValue,
      enabled: data.enabled ?? true,
      projectId,
      tagId: data.tagId,
      debounceMs: data.debounceMs ?? 5000,
      debounceCount: data.debounceCount ?? 0,
      alarmType: data.alarmType ?? 'data',
      autoClear: data.autoClear ?? true,
    });
    return alarmRuleRepo.save(rule);
  }

  async updateRule(id: string, projectId: string, data: Partial<AlarmRule>): Promise<AlarmRule> {
    const { alarmRuleRepo } = await this.getRepos(projectId);
    const rule = await this.findOneRule(id, projectId);
    Object.assign(rule, data);
    return alarmRuleRepo.save(rule);
  }

  async deleteRule(id: string, projectId: string): Promise<void> {
    const { alarmRuleRepo, alarmRecordRepo } = await this.getRepos(projectId);
    const rule = await this.findOneRule(id, projectId);
    // Cascade-delete active alarm records
    await alarmRecordRepo.delete({ ruleId: id, projectId });
    await alarmRuleRepo.remove(rule);
  }

  async enableRule(id: string, projectId: string): Promise<AlarmRule> {
    const { alarmRuleRepo } = await this.getRepos(projectId);
    const rule = await this.findOneRule(id, projectId);
    if (rule.enabled) {
      this.err.badRequest('alarm.rule.already_enabled', { id });
    }
    rule.enabled = true;
    return alarmRuleRepo.save(rule);
  }

  async disableRule(id: string, projectId: string): Promise<AlarmRule> {
    const { alarmRuleRepo, alarmRecordRepo } = await this.getRepos(projectId);
    const rule = await this.findOneRule(id, projectId);
    if (!rule.enabled) {
      this.err.badRequest('alarm.rule.already_disabled', { id });
    }
    rule.enabled = false;
    // When disabling a rule, clear its active alarms (marked as cleared due to rule disable)
    await alarmRecordRepo.update(
      { ruleId: id, projectId, status: AlarmStatus.ACTIVE },
      {
        status: AlarmStatus.CLEARED,
        clearedAt: new Date(),
        isActive: false,
        clearReason: 'rule_disabled',
        dispositionType: 'alarm.cleared',
      },
    );
    return alarmRuleRepo.save(rule);
  }

  // ==================== Alarm record query ====================

  async getRecords(
    projectId: string,
    limit?: number,
    filter?: AlarmRecordsFilter,
  ): Promise<AlarmRecord[]> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const where: FindOptionsWhere<AlarmRecord> = { projectId };

    if (filter?.level) {
      where.level = filter.level as AlarmLevel;
    }
    if (filter?.status) {
      where.status = filter.status as AlarmStatus;
    }
    if (filter?.alarmType) {
      where.alarmType = filter.alarmType;
    }
    if (filter?.dispositionType) {
      where.dispositionType = filter.dispositionType;
    }
    if (filter?.isActive !== undefined) {
      where.isActive = filter.isActive;
    }
    if (filter?.keyword) {
      // TypeORM does not support OR conditions directly in FindOptionsWhere; use the array form
      (where as any).message = Like(`%${filter.keyword}%`);
    }
    if (filter?.startDate) {
      (where as any).createdAt = MoreThanOrEqual(new Date(filter.startDate));
    }
    if (filter?.endDate) {
      (where as any).createdAt = LessThanOrEqual(new Date(filter.endDate));
    }

    return alarmRecordRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit || 50,
      relations: ['rule'],
    });
  }

  /** Batch-acknowledge alarms */
  async batchAcknowledge(ids: string[], userId: string, projectId: string): Promise<number> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const records = await alarmRecordRepo.find({
      where: { id: In(ids), projectId, status: AlarmStatus.ACTIVE },
    });
    for (const r of records) {
      r.status = AlarmStatus.ACKNOWLEDGED;
      r.acknowledgedAt = new Date();
      r.acknowledgedBy = userId;
    }
    if (records.length > 0) {
      await alarmRecordRepo.save(records);
    }
    return records.length;
  }

  /**
   * Batch-acknowledge alarms (idempotent + partial-failure structure, mini-program phase 2, 07 #10)
   *
   * - requestId idempotency: the same `{projectId}:{requestId}` repeated within 10 minutes returns the first result directly,
   *   avoiding duplicate acknowledgments / duplicate event broadcasts caused by network retries.
   * - Partial failure: status conflicts (already acknowledged / cleared / other) and missing records go into failed, without throwing for the whole operation.
   */
  async batchAcknowledgeIdempotent(
    ids: string[],
    userId: string,
    projectId: string,
    requestId?: string,
  ): Promise<BatchAcknowledgeResult> {
    const idempotencyKey = requestId ? `${projectId}:${requestId}` : undefined;
    if (idempotencyKey) {
      this.pruneExpiredIdempotencyEntries();
      const cached = this.batchAcknowledgeIdempotencyCache.get(idempotencyKey);
      if (cached && cached.expireAt > Date.now()) {
        this.logger.debug(`[BATCH-ACK] Idempotent hit: requestId=${requestId}, returning the first result`);
        return cached.result;
      }
    }

    const result = await this.executeBatchAcknowledge(ids, userId, projectId);

    if (idempotencyKey) {
      this.batchAcknowledgeIdempotencyCache.set(idempotencyKey, {
        result,
        expireAt: Date.now() + BATCH_ACKNOWLEDGE_IDEMPOTENCY_TTL_MS,
      });
    }
    return result;
  }

  /** Execute batch acknowledgment: only ACTIVE records can be acknowledged; the rest go into failed items */
  private async executeBatchAcknowledge(
    ids: string[],
    userId: string,
    projectId: string,
  ): Promise<BatchAcknowledgeResult> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const uniqueIds = Array.from(new Set(ids ?? []));
    const records = await alarmRecordRepo.find({
      where: { id: In(uniqueIds), projectId },
    });
    const recordById = new Map(records.map((record) => [record.id, record]));

    const succeeded: string[] = [];
    const failed: BatchAcknowledgeFailureItem[] = [];
    const recordsToSave: AlarmRecord[] = [];

    for (const alarmRecordId of uniqueIds) {
      const record = recordById.get(alarmRecordId);
      if (!record) {
        failed.push({ alarmRecordId, reason: 'not_found' });
        continue;
      }
      if (record.status === AlarmStatus.ACTIVE) {
        record.status = AlarmStatus.ACKNOWLEDGED;
        record.acknowledgedAt = new Date();
        record.acknowledgedBy = userId;
        record.dispositionType = 'alarm.acknowledged';
        recordsToSave.push(record);
        succeeded.push(alarmRecordId);
      } else if (record.status === AlarmStatus.ACKNOWLEDGED) {
        failed.push({ alarmRecordId, reason: 'already_acknowledged' });
      } else if (record.status === AlarmStatus.CLEARED) {
        failed.push({ alarmRecordId, reason: 'already_cleared' });
      } else {
        failed.push({ alarmRecordId, reason: 'invalid_status' });
      }
    }

    if (recordsToSave.length > 0) {
      await alarmRecordRepo.save(recordsToSave);
    }
    return { succeeded, failed };
  }

  /** Clean expired idempotency-cache entries (lazy cleanup, triggered on each idempotent request) */
  private pruneExpiredIdempotencyEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.batchAcknowledgeIdempotencyCache) {
      if (entry.expireAt <= now) {
        this.batchAcknowledgeIdempotencyCache.delete(key);
      }
    }
  }

  /** Batch-clear alarms */
  async batchClear(ids: string[], userId: string, projectId: string): Promise<number> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const allowedStatuses = [AlarmStatus.ACTIVE, AlarmStatus.ACKNOWLEDGED];
    const records = await alarmRecordRepo.find({
      where: { id: In(ids), projectId, status: In(allowedStatuses) },
    });
    for (const r of records) {
      r.status = AlarmStatus.CLEARED;
      r.clearedAt = new Date();
      r.clearedBy = userId;
      r.isActive = false;
      r.clearReason = 'manual';
      r.dispositionType = 'alarm.cleared';
    }
    if (records.length > 0) {
      await alarmRecordRepo.save(records);
    }
    return records.length;
  }

  // ==================== Alarm lifecycle management (with state-machine validation) ====================

  /** Validate whether the status transition is legal */
  private validateTransition(current: AlarmStatus, target: AlarmStatus): void {
    const allowed = VALID_TRANSITIONS[current] ?? [];
    if (!allowed.includes(target)) {
      this.err.badRequest('alarm.invalid_transition', {
        current,
        target,
      });
    }
  }

  async acknowledgeAlarm(id: string, userId: string, projectId: string): Promise<AlarmRecord> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const record = await alarmRecordRepo.findOne({ where: { id, projectId } });
    if (!record) this.err.notFound('alarm.record.not_found', { id });

    this.validateTransition(record.status, AlarmStatus.ACKNOWLEDGED);

    record.status = AlarmStatus.ACKNOWLEDGED;
    record.acknowledgedAt = new Date();
    record.acknowledgedBy = userId;
    record.dispositionType = 'alarm.acknowledged';
    return alarmRecordRepo.save(record);
  }

  async clearAlarm(id: string, userId: string, projectId: string): Promise<AlarmRecord> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const record = await alarmRecordRepo.findOne({ where: { id, projectId } });
    if (!record) this.err.notFound('alarm.record.not_found', { id });

    this.validateTransition(record.status, AlarmStatus.CLEARED);

    record.status = AlarmStatus.CLEARED;
    record.clearedAt = new Date();
    record.clearedBy = userId;
    record.isActive = false;
    record.clearReason = 'manual';
    record.dispositionType = 'alarm.cleared';
    return alarmRecordRepo.save(record);
  }

  async shelveAlarm(
    id: string,
    userId: string,
    reason: string,
    projectId: string,
    durationMs?: number,
  ): Promise<AlarmRecord> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const record = await alarmRecordRepo.findOne({ where: { id, projectId } });
    if (!record) this.err.notFound('alarm.record.not_found', { id });

    this.validateTransition(record.status, AlarmStatus.SHELVED);

    // Record the pre-shelve status to roll back on auto-recovery (only ACTIVE / ACKNOWLEDGED can transition into SHELVED)
    record.preShelveStatus = record.status;
    record.status = AlarmStatus.SHELVED;
    record.shelvedAt = new Date();
    record.shelvedBy = userId;
    record.shelveReason = reason;
    // Note: the shelve action does not update dispositionType -- the alarmActionType dictionary has no "alarm shelved" action value,
    // only the recovery value alarm.shelve.expired exists, so the pre-shelve value is kept and updated only on recovery (see AlarmShelveRecoveryService)
    // Schedule auto-recovery: when durationMs > 0, record the expiry time; AlarmShelveRecoveryService scans and recovers
    record.shelvedUntil = durationMs && durationMs > 0 ? new Date(Date.now() + durationMs) : null;
    return alarmRecordRepo.save(record);
  }

  /**
   * Auto-recover an alarm (Phase 5 state-machine closed loop)
   *
   * Called by AlarmRecoverySubscriber when the condition is detected as recovered, closing the alarm loop:
   * - status -> CLEARED
   * - isActive -> false (marked as a historical alarm)
   * - clearReason -> 'auto' (condition auto-recovered)
   * - recoveredAt -> current time (recovery time, the key field for closing the loop)
   * - recoveredValue -> the collected value at recovery
   *
   * Note: this method does not validate VALID_TRANSITIONS, because auto-recovery can go directly from ACTIVE/ACKNOWLEDGED to CLEARED
   */
  async recoverAlarm(record: AlarmRecord, recoveredValue: string): Promise<AlarmRecord> {
    record.status = AlarmStatus.CLEARED;
    record.clearedAt = new Date();
    record.clearedBy = 'auto';
    record.isActive = false;
    record.clearReason = 'auto';
    record.recoveredAt = new Date();
    record.recoveredValue = recoveredValue;
    record.dispositionType = 'alarm.cleared';
    return record;
  }

  // ==================== Duplicate-alarm suppression ====================

  /** Check whether an active alarm already exists for this rule */
  async hasActiveAlarm(ruleId: string, projectId: string): Promise<boolean> {
    const { alarmRecordRepo } = await this.getRepos(projectId);
    const count = await alarmRecordRepo.count({
      where: { ruleId, projectId, status: AlarmStatus.ACTIVE },
    });
    return count > 0;
  }
}
