// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { AlarmLevel, AlarmStatus } from '@ss-node/ss-sdk';

/**
 * System-event clear reason
 */
export enum SystemEventClearReason {
  /** Auto-recovery (system recovered on its own, e.g. DB reconnected) */
  AUTO = 'auto',
  /** Manual clear */
  MANUAL = 'manual',
  /** System-restart recovery */
  SYSTEM_RESTART = 'system_restart',
}

/**
 * System-event disposition type (lifecycle action)
 */
export enum SystemEventDispositionType {
  TRIGGERED = 'event.triggered',
  ACKNOWLEDGED = 'event.acknowledged',
  CLEARED = 'event.cleared',
}

/**
 * Global system-event entity
 *
 * Stored in the global ss-node.db sys_events table, recording system-level events.
 * Its lifecycle is identical to the project-level AlarmRecord:
 *   ACTIVE -> ACKNOWLEDGED -> CLEARED
 *   ACTIVE -> CLEARED (auto-recovery)
 *
 * Comparison with the project-level AlarmRecord (system.db):
 * ┌──────────────┬─────────────────────────────┬─────────────────────────────┐
 * │ Field        │ AlarmRecord (project-level)  │ SystemEvent (global)        │
 * ├──────────────┼─────────────────────────────┼─────────────────────────────┤
 * │ Database     │ system.db (per project)      │ ss-node.db (global)         │
 * │ Subject      │ has rule/device/tag assoc.   │ no business assoc., standalone event │
 * │ Event type   │ alarmType (device/system...) │ eventType + subType         │
 * │ Level        │ AlarmLevel                   │ AlarmLevel (shared)         │
 * │ Status       │ AlarmStatus                  │ AlarmStatus (shared)        │
 * │ Clear reason │ clearReason                  │ clearReason (shared)        │
 * │ Disposition  │ dispositionType             │ dispositionType (shared)    │
 * │ Active flag  │ isActive                     │ isActive (shared)           │
 * └──────────────┴─────────────────────────────┴─────────────────────────────┘
 */
@Entity('sys_events')
@Index(['eventType'])
@Index(['level'])
@Index(['status'])
@Index(['isActive'])
@Index(['createdAt'])
export class SystemEvent {
  /** Deterministic ID (e.g. sys-health-influxdb), for dedupe and lookup on recovery */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  // ========== Event classification (system-specific) ==========

  /** Event type: health | startup | config_change | plugin */
  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: string;

  /** Subtype: disk | memory | cpu | database | influxdb | redis, etc. */
  @Column({ name: 'sub_type', type: 'varchar', length: 32, nullable: true })
  subType: string;

  /** Event source: health-checker | system-resource-checker | plugin-manager, etc. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  source: string;

  /** Extended metadata (JSON string): threshold, snapshot, details, etc. */
  @Column({ type: 'text', nullable: true })
  metadata: string;

  // ========== Lifecycle fields (aligned with AlarmRecord) ==========

  /** Event level */
  @Column({ type: 'varchar', length: 16, default: AlarmLevel.WARNING })
  level: AlarmLevel;

  /** Event description */
  @Column({ type: 'text' })
  message: string;

  /** Value at trigger (e.g. disk usage 95%) */
  @Column({ name: 'trigger_value', type: 'varchar', length: 50, nullable: true })
  triggerValue: string;

  /** Event status */
  @Column({ type: 'varchar', length: 20, default: AlarmStatus.ACTIVE })
  status: AlarmStatus;

  /** Whether active (not cleared): true=active/acknowledged, false=cleared */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // -- Acknowledgement --


  /** Whether acknowledged */
  @Column({ default: false })
  acknowledged: boolean;

  /** Acknowledgement time */
  @Column({ name: 'acknowledged_at', nullable: true })
  acknowledgedAt: Date;

  /** Acknowledged by */
  @Column({ name: 'acknowledged_by', type: 'varchar', length: 36, nullable: true })
  acknowledgedBy: string;

  // -- Clear --


  /** Clear reason: auto=auto-recovery / manual=manual clear / system_restart=system-restart recovery */
  @Column({ name: 'clear_reason', type: 'varchar', length: 20, nullable: true })
  clearReason: string;

  /** Clear time */
  @Column({ name: 'cleared_at', nullable: true })
  clearedAt: Date;

  /** Cleared by (set to 'system' on auto-recovery) */
  @Column({ name: 'cleared_by', type: 'varchar', length: 36, nullable: true })
  clearedBy: string;

  // -- Recovery --


  /** Auto-recovery time (when condition returned to normal) */
  @Column({ name: 'recovered_at', nullable: true })
  recoveredAt: Date;

  /** Value at auto-recovery (e.g. disk usage dropped to 80%) */
  @Column({ name: 'recovered_value', type: 'varchar', length: 50, nullable: true })
  recoveredValue: string;

  // -- Disposition --


  /** Disposition type (lifecycle action): event.triggered -> event.acknowledged -> event.cleared */
  @Column({
    name: 'disposition_type',
    type: 'varchar',
    length: 50,
    default: SystemEventDispositionType.TRIGGERED,
  })
  dispositionType: string;

  // ========== Timestamps ==========

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
