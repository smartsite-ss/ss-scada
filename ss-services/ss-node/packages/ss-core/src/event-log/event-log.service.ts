// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomUUID } from 'crypto';
import { EventBusService } from '../event-bus/event-bus.service';
import { EventLog, SubscriberRecord, EventLogStatus } from './entities/event-log.entity';

/**
 * Event-log service - config-change event persistence + subscriber tracing
 *
 * Core capabilities:
 * 1. Listen to EventBus emits and automatically record config-change events
 * 2. Provide subscriber-tracing APIs (recordSubscriberStart/Success/Failure)
 * 3. Provide query APIs (findByFilter / findOne / findFailed)
 * 4. Periodically clean up expired event logs (R6-1: prevents unbounded evt_event_log growth)
 *
 * Design points:
 * - Async writes, not blocking the EventBus main chain
 * - Write failures only warn, without affecting business
 * - Decoupled from EventBusService via the emitHook mechanism (avoiding circular dependency)
 * - Periodic cleanup uses setInterval (no @nestjs/schedule dependency needed)
 */
@Injectable()
export class EventLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventLogService.name);

  /**
   * Persistence whitelist (20 config-change events)
   * Excludes high-frequency data events (data_point_changed, device_status_changed, etc.)
   * R6-1: alarm.rule_resolved removed (188K rows/day bloated the table)
   */
  private static readonly PERSISTED_EVENTS: ReadonlySet<string> = new Set([
    // Device domain (6)
    'device.created',
    'device.updated',
    'device.deleted',
    'device.tagsChanged',
    'device.enabled',
    'device.disabled',
    // Project domain (5)
    'project.created',
    'project.imported',
    'project:enabled',
    'project:disabled',
    'project.beforeDelete',
    // Alarm domain (3)
    'alarm.triggered',
    'alarm_acknowledged',
    'alarm.cleared',
    // R6-1: removed 'alarm.rule_resolved' - measured 188K rows/day (99.6% of the table),
    // a high-frequency alarm state-change event with low audit value that bloated evt_event_log.
    // Config and timer domain (3)
    'config_changed',
    'protocol.config.updated',
    'timer:configChanged',
    // Plugin domain (3)
    'plugin.activated',
    'plugin.deactivated',
    'plugin.updated',
  ]);

  /** In-memory index of recent emissions (for subscriber-tracing logId association)
   * key: `${eventType}:${projectId || 'system'}`, value: { logId, timestamp } */
  private recentEmissions = new Map<string, { logId: string; timestamp: number }>();

  /** Cache retention time (events within 5 seconds count as "recent") */
  private static readonly RECENT_EMISSION_TTL_MS = 5000;

  /** Per-logId mutex chain - serializes read-modify-write on the subscribers array
   * key: logId, value: the previous operation's Promise (error swallowed, never rejects) */
  private readonly logLocks = new Map<string, Promise<void>>();

  /** R6-1: timer reference for periodic cleanup of expired event logs */
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** R6-1: cleanup interval (24 hours) */
  private static readonly CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(EventLog)
    private readonly eventLogRepo: Repository<EventLog>,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    // Register the emit hook, listening to all event emissions
    this.eventBus.registerEmitHook(this.handleEmit.bind(this));
    this.logger.log(
      `EventLogService initialized, persisting ${EventLogService.PERSISTED_EVENTS.size} event types`,
    );

    // R6-1: start the periodic cleanup task - clean event logs past retention every 24 hours
    // First run delayed 5 minutes (avoiding IO pressure during the startup peak)
    this.scheduleInitialCleanup();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * R6-1: schedule the first cleanup (5-minute delay), then every 24 hours
   */
  private scheduleInitialCleanup(): void {
    this.cleanupTimer = setTimeout(async () => {
      await this.cleanExpiredEvents();
      // Then run once every 24 hours
      this.cleanupTimer = setInterval(() => {
        this.cleanExpiredEvents().catch((err) => {
          this.logger.warn(`Scheduled event log cleanup failed: ${(err as Error).message}`);
        });
      }, EventLogService.CLEANUP_INTERVAL_MS);
      // Do not prevent process exit
      if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }, 5 * 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Decide whether an event needs persistence
   */
  shouldPersist(eventType: string): boolean {
    return EventLogService.PERSISTED_EVENTS.has(eventType);
  }

  // ===== Phase 1: record on emission =====

  /**
   * emit hook - called automatically by EventBusService.emit()
   *
   * Synchronously pre-generates the logId and injects payload._logId (before the first await),
   * so wrapSubscriber can read it directly from payload._logId, eliminating timing races.
   * Writes to DB asynchronously without blocking the main flow; failures only warn, never throw.
   */
  private async handleEmit(eventType: string, payload: any): Promise<void> {
    if (!this.shouldPersist(eventType)) return;

    // Synchronously pre-generate the logId and inject it into the payload (before the first await)
    // Even if triggerEmitHooks does not await this function, this code finishes synchronously,
    // ensuring payload._logId exists by the time emit() -> eventEmitter.emit() runs.
    const logId = randomUUID();
    if (payload && typeof payload === 'object') {
      payload._logId = logId;
    }

    try {
      await this.recordEmissionWithId(eventType, payload, logId);
      // Cache into the in-memory index (backward compatible; findRecentLogId still works for paths without _logId)
      const key = this.buildRecentKey(eventType, payload);
      this.recentEmissions.set(key, { logId, timestamp: Date.now() });
      this.cleanupRecentEmissions();
    } catch (err) {
      this.logger.warn(`Failed to persist event ${eventType}: ${(err as Error).message}`);
    }
  }

  /**
   * Record an event emission (writes to the evt_event_log table)
   * @returns the logId (for subscriber-tracing association), or null on failure
   */
  async recordEmission(eventType: string, payload: any): Promise<string | null> {
    try {
      const log = this.eventLogRepo.create({
        eventType,
        projectId: payload?.projectId || null,
        payload: this.sanitizePayload(payload),
        emittedBy: this.detectEmitter(payload),
        source: this.detectSource(payload),
        eventTimestamp: this.normalizeTimestamp(payload?.timestamp),
        status: 'emitted' as EventLogStatus,
        subscribers: [],
      });
      const saved = await this.eventLogRepo.save(log);
      return saved.id;
    } catch (err) {
      this.logger.warn(`Failed to record emission for ${eventType}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Record an event emission (writes to DB using the pre-generated logId)
   *
   * Difference from recordEmission: uses the caller's pre-generated logId,
   * so payload._logId matches the DB record's id,
   * letting wrapSubscriber read it from payload._logId without a lookup.
   */
  async recordEmissionWithId(eventType: string, payload: any, logId: string): Promise<void> {
    try {
      const log = this.eventLogRepo.create({
        id: logId,
        eventType,
        projectId: payload?.projectId || null,
        payload: this.sanitizePayload(payload),
        emittedBy: this.detectEmitter(payload),
        source: this.detectSource(payload),
        eventTimestamp: this.normalizeTimestamp(payload?.timestamp),
        status: 'emitted' as EventLogStatus,
        subscribers: [],
      });
      await this.eventLogRepo.save(log);
    } catch (err) {
      this.logger.warn(`Failed to record emission for ${eventType}: ${(err as Error).message}`);
    }
  }

  /**
   * Find the most recent event-log ID (for subscriber-tracing association)
   *
   * Looks up the most recent event by eventType + projectId within 5 seconds.
   * May be inaccurate under concurrency, but config-change events are rarely concurrent.
   */
  async findRecentLogId(eventType: string, payload: any): Promise<string | null> {
    // Prefer the in-memory index (fastest)
    const key = this.buildRecentKey(eventType, payload);
    const recent = this.recentEmissions.get(key);
    if (recent && Date.now() - recent.timestamp < EventLogService.RECENT_EMISSION_TTL_MS) {
      return recent.logId;
    }

    // In-memory index miss; query the database
    try {
      const log = await this.eventLogRepo.findOne({
        where: {
          eventType,
          projectId: payload?.projectId || null,
        },
        order: { createdAt: 'DESC' },
      });
      return log?.id || null;
    } catch (err) {
      this.logger.warn(`Failed to find recent log for ${eventType}: ${(err as Error).message}`);
      return null;
    }
  }

  // ===== Phase 2: subscriber tracing =====

  /**
   * Record a subscriber starting processing
   */
  async recordSubscriberStart(logId: string, subscriberName: string): Promise<void> {
    await this.updateSubscriberRecord(logId, subscriberName, {
      status: 'processing',
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Record a subscriber's success + business effect
   *
   * @param result business-effect object (e.g. { connectionId, tagsLoaded, tasksRegistered })
   */
  async recordSubscriberSuccess(
    logId: string,
    subscriberName: string,
    duration: number,
    result?: Record<string, any>,
  ): Promise<void> {
    await this.updateSubscriberRecord(logId, subscriberName, {
      status: 'processed',
      completedAt: new Date().toISOString(),
      duration,
      result,
    });
    await this.recalculateStatus(logId);
  }

  /**
   * Record a subscriber's failure + partial business effect
   *
   * @param result partial effects on failure (e.g. { oldConnectionClosed: true, newConnectionId: null })
   */
  async recordSubscriberFailure(
    logId: string,
    subscriberName: string,
    error: string,
    result?: Record<string, any>,
  ): Promise<void> {
    await this.updateSubscriberRecord(logId, subscriberName, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error,
      result,
    });
    await this.recalculateStatus(logId);
  }

  /**
   * Wrap a subscriber handler, auto-tracing the processing result
   *
   * Usage:
   * ```typescript
   * this.eventBus.on(
   *   'device.created',
   *   this.eventLogService.wrapSubscriber(
   *     'device.created',           // event type, used to find the most recent event log
   *     'DeviceConfigWatcher',      // subscriber name
   *     async (payload) => { ... }, // handler, returns a business-effect object
   *   ),
   * );
   * ```
   *
   * @param eventType       event type (used to find the most recently emitted logId)
   * @param subscriberName  subscriber class name (written into the subscribers record)
   * @param handler         handler that should return a business-effect object (e.g. { connectionId, tagsLoaded });
   *                        throwing on failure (captured here and recorded as failed)
   */
  wrapSubscriber<T extends any[]>(
    eventType: string,
    subscriberName: string,
    handler: (...args: T) => Promise<Record<string, any> | void>,
  ): (...args: T) => Promise<void> {
    return async (...args: T) => {
      const payload = args[0];
      // Prefer reading payload._logId (injected synchronously by handleEmit, eliminating timing races)
      let logId: string | null = payload?._logId || null;

      // Fallback: if _logId is absent (non-whitelisted event or legacy path), try findRecentLogId
      if (!logId) {
        logId = await this.findRecentLogId(eventType, payload);
      }

      if (logId) {
        await this.recordSubscriberStart(logId, subscriberName);
      }

      const startedAt = Date.now();
      try {
        const result = await handler(...args);
        if (logId) {
          await this.recordSubscriberSuccess(
            logId,
            subscriberName,
            Date.now() - startedAt,
            result as Record<string, any> | undefined,
          );
        }
      } catch (err) {
        if (logId) {
          await this.recordSubscriberFailure(
            logId,
            subscriberName,
            (err as Error).message,
          );
        }
        throw err;
      }
    };
  }

  // ===== Query APIs =====

  /**
   * Query event logs by condition (paginated)
   */
  async findByFilter(filter: {
    projectId?: string;
    eventType?: string;
    status?: EventLogStatus;
    emittedBy?: string;
    startTime?: Date;
    endTime?: Date;
    page?: number;
    pageSize?: number;
    hasSubscribers?: boolean;
  }): Promise<{ items: EventLog[]; total: number }> {
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;

    const queryBuilder = this.eventLogRepo.createQueryBuilder('log');

    if (filter.projectId) {
      queryBuilder.andWhere('log.projectId = :projectId', { projectId: filter.projectId });
    }
    if (filter.eventType) {
      queryBuilder.andWhere('log.eventType = :eventType', { eventType: filter.eventType });
    }
    if (filter.status) {
      queryBuilder.andWhere('log.status = :status', { status: filter.status });
    }
    if (filter.emittedBy) {
      queryBuilder.andWhere('log.emittedBy = :emittedBy', { emittedBy: filter.emittedBy });
    }
    if (filter.startTime) {
      queryBuilder.andWhere('log.eventTimestamp >= :startTime', { startTime: filter.startTime });
    }
    if (filter.endTime) {
      queryBuilder.andWhere('log.eventTimestamp <= :endTime', { endTime: filter.endTime });
    }
    // Only events with/without subscriber-tracing records
    if (filter.hasSubscribers === true) {
      queryBuilder.andWhere("log.subscribers IS NOT NULL AND log.subscribers != '[]'");
    } else if (filter.hasSubscribers === false) {
      queryBuilder.andWhere("(log.subscribers IS NULL OR log.subscribers = '[]')");
    }

    queryBuilder
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();
    return { items, total };
  }

  /**
   * Query a single event-log detail (with full subscribers records)
   */
  async findOne(id: string): Promise<EventLog | null> {
    return this.eventLogRepo.findOne({ where: { id } });
  }

  /**
   * Clear all event logs (ops operation, use with caution)
   * @returns the number of deleted records
   */
  async clearAll(): Promise<{ deleted: number }> {
    // Count current records first (clear() does not return the deleted count)
    const count = await this.eventLogRepo.count();
    // Use clear() to run TRUNCATE/DELETE FROM, avoiding delete({}) being ineffective on some drivers
    await this.eventLogRepo.clear();
    this.logger.log(`Cleared all event logs: ${count} records deleted`);
    return { deleted: count };
  }

  /**
   * R6-1: clean up expired event logs - delete records past the retention period
   *
   * Retention is configured via the EVENT_LOG_RETENTION_DAYS env var (default 30 days).
   * Cleanup is judged by the createdAt field (BaseEntity's creation time), deleting in batches to avoid oversized single transactions.
   *
   * @param retentionDays retention days (optional; defaults to the EVENT_LOG_RETENTION_DAYS env var or 30)
   * @returns the number of deleted records
   */
  async cleanExpiredEvents(retentionDays?: number): Promise<{ deleted: number }> {
    const days = retentionDays ?? (Number(process.env.EVENT_LOG_RETENTION_DAYS) || 30);
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
      // Count pending deletions first (for logging and the return value)
      const count = await this.eventLogRepo.count({
        where: { createdAt: LessThan(cutoffDate) },
      });

      if (count === 0) {
        this.logger.debug(`Event log cleanup: no records older than ${days} days`);
        return { deleted: 0 };
      }

      // Delete in batches (5000 per batch), avoiding oversized single DELETE transactions locking the DB
      // DeleteQueryBuilder does not support .take(); instead query IDs first then delete by ID
      const BATCH_SIZE = 5000;
      let totalDeleted = 0;
      let batchCount = 0;

      while (true) {
        // Query a batch of record IDs to delete
        const oldRecords = await this.eventLogRepo.find({
          select: ['id'],
          where: { createdAt: LessThan(cutoffDate) },
          take: BATCH_SIZE,
        });

        if (oldRecords.length === 0) break;

        const idsToDelete = oldRecords.map((r) => r.id);
        const result = await this.eventLogRepo
          .createQueryBuilder()
          .delete()
          .where('id IN (:...ids)', { ids: idsToDelete })
          .execute();

        const affected = result.affected || 0;
        totalDeleted += affected;
        batchCount++;

        if (oldRecords.length < BATCH_SIZE) break; // no more records to delete
      }

      this.logger.log(
        `Event log cleanup: deleted ${totalDeleted} records older than ${days} days ` +
          `(${batchCount} batches, cutoff=${cutoffDate.toISOString()})`,
      );
      return { deleted: totalDeleted };
    } catch (err) {
      this.logger.warn(`Event log cleanup failed: ${(err as Error).message}`);
      return { deleted: 0 };
    }
  }

  /**
   * Query all failed/partially failed events (fast ops triage)
   */
  async findFailed(filter?: {
    projectId?: string;
    startTime?: Date;
    endTime?: Date;
  }): Promise<EventLog[]> {
    const queryBuilder = this.eventLogRepo.createQueryBuilder('log');
    queryBuilder.andWhere('log.status IN (:...statuses)', {
      statuses: ['failed', 'partial'],
    });

    if (filter?.projectId) {
      queryBuilder.andWhere('log.projectId = :projectId', { projectId: filter.projectId });
    }
    if (filter?.startTime) {
      queryBuilder.andWhere('log.eventTimestamp >= :startTime', { startTime: filter.startTime });
    }
    if (filter?.endTime) {
      queryBuilder.andWhere('log.eventTimestamp <= :endTime', { endTime: filter.endTime });
    }

    return queryBuilder.orderBy('log.createdAt', 'DESC').getMany();
  }

  // ===== Internal utility methods =====

  /**
   * Per-logId mutex - serializes read-modify-write on a single EventLog
   *
   * Solves the race when multiple subscribers update the subscribers array concurrently:
   * - Subscriber A reads the log (subscribers=[]), adds A, saves
   * - Subscriber B reads the log (subscribers=[], A's save not yet flushed), adds B, saves -> overwrites A
   *
   * A Promise chain ensures operations on the same logId run serially:
   * - each withLogLock waits for the previous operation before running
   * - a single operation's failure does not affect later ones (error already swallowed)
   */
  private async withLogLock<T>(logId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.logLocks.get(logId) ?? Promise.resolve();
    const next = prev.then(() => fn());
    // Store the Promise with the error swallowed, preventing unhandled rejection from blocking later waiters
    this.logLocks.set(
      logId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /**
   * Update a subscriber's processing record
   */
  private async updateSubscriberRecord(
    logId: string,
    subscriberName: string,
    update: Partial<SubscriberRecord>,
  ): Promise<void> {
    try {
      await this.withLogLock(logId, async () => {
        const log = await this.eventLogRepo.findOne({ where: { id: logId } });
        if (!log) return;

        const subscribers = log.subscribers || [];
        let record = subscribers.find((s) => s.name === subscriberName);
        if (!record) {
          record = { name: subscriberName, status: 'pending' };
          subscribers.push(record);
        }
        Object.assign(record, update);

        log.subscribers = subscribers;
        log.status = 'processing';
        await this.eventLogRepo.save(log);
      });
    } catch (err) {
      this.logger.warn(`Failed to update subscriber record: ${(err as Error).message}`);
    }
  }

  /**
   * Recalculate the overall status and success ratio
   */
  private async recalculateStatus(logId: string): Promise<void> {
    try {
      await this.withLogLock(logId, async () => {
        const log = await this.eventLogRepo.findOne({ where: { id: logId } });
        if (!log || !log.subscribers?.length) return;

        const total = log.subscribers.length;
        const success = log.subscribers.filter((s) => s.status === 'processed').length;
        const failed = log.subscribers.filter((s) => s.status === 'failed').length;

        log.successRatio = `${success}/${total}`;

        if (success === total) {
          log.status = 'processed';
          log.errorMessage = null;
        } else if (failed === total) {
          log.status = 'failed';
          log.errorMessage = log.subscribers
            .filter((s) => s.status === 'failed')
            .map((s) => `${s.name}: ${s.error}`)
            .join('; ');
        } else {
          log.status = 'partial';
          log.errorMessage = log.subscribers
            .filter((s) => s.status === 'failed')
            .map((s) => `${s.name}: ${s.error}`)
            .join('; ');
        }

        await this.eventLogRepo.save(log);
      });
    } catch (err) {
      this.logger.warn(`Failed to recalculate status: ${(err as Error).message}`);
    }
  }

  /**
   * Clean up expired in-memory index entries
   */
  private cleanupRecentEmissions(): void {
    const now = Date.now();
    for (const [key, value] of this.recentEmissions) {
      if (now - value.timestamp > EventLogService.RECENT_EMISSION_TTL_MS) {
        this.recentEmissions.delete(key);
      }
    }
  }

  private buildRecentKey(eventType: string, payload: any): string {
    const projectId = payload?.projectId || 'system';
    return `${eventType}:${projectId}`;
  }

  /**
   * Detect the event initiator (user ID / system service name)
   */
  private detectEmitter(payload: any): string | null {
    if (!payload) return null;
    return payload.userId || payload.emittedBy || payload.sourceInstance || null;
  }

  /**
   * Detect the event source
   */
  private detectSource(payload: any): string {
    if (!payload) return 'system';
    if (payload.userId) return 'rest_api';
    if (payload.sourceInstance) return 'system';
    if (payload.tagId && payload.deviceId) return 'pipeline';
    return 'system';
  }

  /**
   * Normalize the timestamp - compatible with number/string/Date formats
   */
  private normalizeTimestamp(ts: number | string | Date | undefined): Date {
    if (!ts) return new Date();
    if (ts instanceof Date) return ts;
    if (typeof ts === 'number') return new Date(ts);
    if (typeof ts === 'string') return new Date(ts);
    return new Date();
  }

  /**
   * Trim the payload to avoid storing oversized objects
   */
  private sanitizePayload(payload: any): Record<string, any> {
    if (!payload || typeof payload !== 'object') return { value: payload };

    // Remove internal tracing fields
    const { _logId, ...cleanPayload } = payload;

    // Serialize to estimate size (rough)
    const jsonStr = JSON.stringify(cleanPayload);
    if (jsonStr.length > 65536) {
      // Over 64KB, truncate large arrays like tags
      this.logger.warn(`Payload too large (${jsonStr.length} chars), truncating`);
      const truncated = { ...cleanPayload };
      if (Array.isArray(truncated.tags)) {
        truncated.tags = truncated.tags.slice(0, 100);
        truncated._tagsTruncated = true;
      }
      return truncated;
    }

    return cleanPayload;
  }
}
