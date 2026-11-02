// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AlarmLevel, AlarmStatus } from '@ss-node/ss-sdk';
import {
  SystemEvent,
  SystemEventClearReason,
  SystemEventDispositionType,
} from '../entities/system-event.entity';

/**
 * Create-system-event input
 */
export interface CreateSystemEventDto {
  eventType: string;
  subType?: string;
  level: AlarmLevel;
  message: string;
  source?: string;
  triggerValue?: string;
  metadata?: Record<string, any>;
  /** Deterministic ID (for dedupe); a UUID is generated when omitted */
  deterministicId?: string;
}

/**
 * System-event query params
 */
export interface SystemEventQuery {
  eventType?: string;
  subType?: string;
  level?: AlarmLevel;
  status?: AlarmStatus;
  isActive?: boolean;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Global system-event service
 *
 * Manages read/write of the sys_events table in the global ss-node.db.
 * Its lifecycle is identical to the project-level AlarmRecord:
 *
 *   ACTIVE ──(acknowledge)──> ACKNOWLEDGED ──(clear)──> CLEARED
 *     │                                                        ↑
 *     └────────────────(recover/clear)────────────────────────┘
 *
 * State-transition validation:
 * - acknowledge: ACTIVE -> ACKNOWLEDGED only
 * - clear:       ACTIVE/ACKNOWLEDGED -> CLEARED
 * - recover:     ACTIVE -> CLEARED (auto recovery)
 */
@Injectable()
export class SystemEventService {
  private readonly logger = new Logger(SystemEventService.name);

  constructor(
    @Optional()
    @InjectRepository(SystemEvent)
    private readonly repo?: Repository<SystemEvent>,
  ) {}

  // ==================== Create ====================

  /**
   * Create a system event
   *
   * If deterministicId already exists with isActive=true, creation is skipped (dedupe),
   * but lastTriggerTime and triggerValue are updated.
   */
  async create(dto: CreateSystemEventDto): Promise<SystemEvent | null> {
    if (!this.repo) {
      this.logger.warn('SystemEventService: repository not available (global DB not initialized)');
      return null;
    }

    const id = dto.deterministicId || crypto.randomUUID();

    // Dedupe: skip if an active event with the same ID exists
    if (dto.deterministicId) {
      const existing = await this.repo.findOne({
        where: { id, isActive: true },
      });
      if (existing) {
        this.logger.debug(`SystemEvent "${id}" already active, skipped`);
        return existing;
      }
    }

    const event = this.repo.create({
      id,
      eventType: dto.eventType,
      subType: dto.subType || null,
      level: dto.level,
      message: dto.message,
      source: dto.source || null,
      triggerValue: dto.triggerValue || null,
      metadata: dto.metadata ? JSON.stringify(dto.metadata) : null,
      status: AlarmStatus.ACTIVE,
      isActive: true,
      acknowledged: false,
      dispositionType: SystemEventDispositionType.TRIGGERED,
    });

    await this.repo.save(event);
    this.logger.log(`SystemEvent created: ${id} type=${dto.eventType} level=${dto.level}`);
    return event;
  }

  // ==================== Acknowledge ====================

  /**
   * Acknowledge an event (manual)
   *
   * State transition: ACTIVE -> ACKNOWLEDGED
   */
  async acknowledge(id: string, userId: string): Promise<SystemEvent | null> {
    if (!this.repo) return null;

    const event = await this.repo.findOne({ where: { id } });
    if (!event) {
      this.logger.warn(`SystemEvent "${id}" not found for acknowledge`);
      return null;
    }

    if (!this.validateTransition(event.status, AlarmStatus.ACKNOWLEDGED)) {
      this.logger.warn(
        `SystemEvent "${id}" invalid transition: ${event.status} → ${AlarmStatus.ACKNOWLEDGED}`,
      );
      return null;
    }

    event.status = AlarmStatus.ACKNOWLEDGED;
    event.acknowledged = true;
    event.acknowledgedBy = userId;
    event.acknowledgedAt = new Date();
    event.dispositionType = SystemEventDispositionType.ACKNOWLEDGED;
    // isActive stays true

    await this.repo.save(event);
    this.logger.log(`SystemEvent acknowledged: ${id} by ${userId}`);
    return event;
  }

  // ==================== Clear ====================

  /**
   * Clear an event (manual)
   *
   * State transition: ACTIVE/ACKNOWLEDGED -> CLEARED
   */
  async clear(
    id: string,
    clearReason: SystemEventClearReason = SystemEventClearReason.MANUAL,
    clearedBy?: string,
  ): Promise<SystemEvent | null> {
    if (!this.repo) return null;

    const event = await this.repo.findOne({ where: { id } });
    if (!event) {
      this.logger.warn(`SystemEvent "${id}" not found for clear`);
      return null;
    }

    if (!this.validateTransition(event.status, AlarmStatus.CLEARED)) {
      this.logger.warn(
        `SystemEvent "${id}" invalid transition: ${event.status} → ${AlarmStatus.CLEARED}`,
      );
      return null;
    }

    event.status = AlarmStatus.CLEARED;
    event.isActive = false;
    event.clearReason = clearReason;
    event.clearedAt = new Date();
    event.clearedBy = clearedBy || 'system';
    event.dispositionType = SystemEventDispositionType.CLEARED;

    await this.repo.save(event);
    this.logger.log(`SystemEvent cleared: ${id} reason=${clearReason}`);
    return event;
  }

  /**
   * Auto-recover an event (system recovered on its own)
   *
   * State transition: ACTIVE -> CLEARED (clearReason=auto)
   * Consistent with AlarmRecord auto-recovery: records recoveredAt + recoveredValue
   */
  async recover(id: string, recoveredValue?: string): Promise<SystemEvent | null> {
    if (!this.repo) return null;

    const event = await this.repo.findOne({
      where: { id, isActive: true },
    });
    if (!event) return null;

    if (!this.validateTransition(event.status, AlarmStatus.CLEARED)) {
      this.logger.warn(`SystemEvent "${id}" invalid transition for recover: ${event.status}`);
      return null;
    }

    event.status = AlarmStatus.CLEARED;
    event.isActive = false;
    event.clearReason = SystemEventClearReason.AUTO;
    event.clearedAt = new Date();
    event.clearedBy = 'system';
    event.recoveredAt = new Date();
    event.recoveredValue = recoveredValue || null;
    event.dispositionType = SystemEventDispositionType.CLEARED;

    await this.repo.save(event);
    this.logger.log(`SystemEvent recovered: ${id}`);
    return event;
  }

  /**
   * Batch-recover all active events by event type
   *
   * Used for batch clearing on system-health recovery (e.g. after DB recovery, all database-type events are marked CLEARED)
   */
  async recoverByType(eventType: string, subType?: string): Promise<number> {
    if (!this.repo) return 0;

    const where: any = { eventType, isActive: true };
    if (subType) {
      where.subType = subType;
    }

    const events = await this.repo.find({ where });
    if (events.length === 0) return 0;

    const now = new Date();
    for (const event of events) {
      event.status = AlarmStatus.CLEARED;
      event.isActive = false;
      event.clearReason = SystemEventClearReason.AUTO;
      event.clearedAt = now;
      event.clearedBy = 'system';
      event.recoveredAt = now;
      event.dispositionType = SystemEventDispositionType.CLEARED;
    }

    await this.repo.save(events);
    this.logger.log(`Recovered ${events.length} system events of type=${eventType}`);
    return events.length;
  }

  // ==================== Query ====================

  /**
   * Query system events
   */
  async query(query: SystemEventQuery): Promise<{ items: SystemEvent[]; total: number }> {
    if (!this.repo) return { items: [], total: 0 };

    const where: any = {};
    if (query.eventType) where.eventType = query.eventType;
    if (query.subType) where.subType = query.subType;
    if (query.level) where.level = query.level;
    if (query.status) where.status = query.status;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: query.limit || 50,
      skip: query.offset || 0,
    });

    return { items, total };
  }

  /**
   * Get the active event list
   */
  async getActive(eventType?: string): Promise<SystemEvent[]> {
    if (!this.repo) return [];
    const where: any = { isActive: true };
    if (eventType) where.eventType = eventType;
    return this.repo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get a single event
   */
  async getById(id: string): Promise<SystemEvent | null> {
    if (!this.repo) return null;
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Event statistics
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    acknowledged: number;
    cleared: number;
  }> {
    if (!this.repo) return { total: 0, active: 0, acknowledged: 0, cleared: 0 };

    const [total, active, acknowledged, cleared] = await Promise.all([
      this.repo.count(),
      this.repo.count({ where: { status: AlarmStatus.ACTIVE } }),
      this.repo.count({ where: { status: AlarmStatus.ACKNOWLEDGED } }),
      this.repo.count({ where: { status: AlarmStatus.CLEARED } }),
    ]);

    return { total, active, acknowledged, cleared };
  }

  // ==================== Cleanup ====================

  /**
   * Clean up expired events (keep cleared records from the last N days)
   */
  async cleanupExpired(retentionDays: number = 90): Promise<number> {
    if (!this.repo) return 0;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('isActive = :isActive', { isActive: false })
      .andWhere('created_at < :cutoff', { cutoff: cutoff.toISOString() })
      .execute();

    const count = result.affected || 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired system events`);
    }
    return count;
  }

  // ==================== Internal ====================

  /**
   * State-transition validation (consistent with AlarmRecord)
   */
  private validateTransition(current: AlarmStatus, target: AlarmStatus): boolean {
    if (current === AlarmStatus.CLEARED) return false;
    if (current === AlarmStatus.SHELVED) return false;

    switch (target) {
      case AlarmStatus.ACKNOWLEDGED:
        return current === AlarmStatus.ACTIVE;
      case AlarmStatus.CLEARED:
        return current === AlarmStatus.ACTIVE || current === AlarmStatus.ACKNOWLEDGED;
      default:
        return false;
    }
  }
}
