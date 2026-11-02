// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { DataTag } from '@ss-node/ss-device';
import { AlarmLevel, AlarmStatus, AlarmCondition } from '@ss-node/ss-sdk';
import { ProjectScopedEntity } from '@ss-node/ss-core';

export { AlarmLevel, AlarmStatus, AlarmCondition };

@Entity('alm_alarm_rules')
export class AlarmRule extends ProjectScopedEntity {
  @Column()
  name: string;

  @Column({ nullable: true, type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 20, default: AlarmLevel.WARNING })
  level: AlarmLevel;

  @Column({ type: 'varchar', length: 20 })
  condition: AlarmCondition;

  @Column({ type: 'text' })
  conditionValue: any;

  @Column({ default: true })
  enabled: boolean;

  @ManyToOne(() => DataTag)
  @JoinColumn({ name: 'tagId' })
  tag: DataTag;

  @Column({ name: 'tagId' })
  tagId: string;

  @Column({ default: 5000 })
  debounceMs: number;

  @Column({ default: 0 })
  debounceCount: number;

  /** Alarm type (from the alarmType dictionary): device/communication/data/safety/power/process/environment/system/security/custom */
  @Column({ type: 'varchar', length: 30, default: 'data' })
  alarmType: string;

  /** Whether to auto-clear the alarm after the value recovers (true=auto-clear to close the loop, false=requires manual acknowledgment).
   *  Maps to the alarm_rules.auto_clear DDL column, enabled in Phase 5 */
  @Column({ default: true })
  autoClear: boolean;

  /** Notification channels (JSON array string, e.g. '[\"sound\",\"popup\",\"sms\"]').
   *  Maps to the alarm_rules.notify_channels DDL column (TEXT DEFAULT '[\"sound\",\"popup\"]').
   *  Enabled by the Phase 6 notification wiring: AlarmNotificationSubscriber parses this field to decide which channels to use when firing the alarm;
   *  falls back to AlarmNotificationService globally-enabled channels when null/empty.
   *  Marked optional in TS to match the DB default semantics (the DB fills the default when not explicitly set) */
  @Column({ type: 'text', default: '["sound","popup"]', nullable: true })
  notifyChannels?: string;
}

@Entity('alm_alarm_records')
@Index(['level', 'status'])
@Index(['createdAt'])
@Index(['projectId'])
@Index(['ruleId'])
@Index(['projectId', 'createdAt'])
@Index(['deviceId'])
@Index(['acknowledgedAt'])
@Index(['alarmType'])
@Index(['dispositionType'])
@Index(['isActive'])
@Index(['clearReason'])
@Index(['recoveredAt'])
export class AlarmRecord extends ProjectScopedEntity {
  @ManyToOne(() => AlarmRule)
  @JoinColumn({ name: 'ruleId' })
  rule: AlarmRule;

  @Column({ name: 'ruleId', nullable: true })
  ruleId: string;

  @Column({ name: 'deviceId', nullable: true, type: 'varchar', length: 36 })
  deviceId: string;

  @Column({ name: 'deviceName', nullable: true, type: 'varchar', length: 100 })
  deviceName: string;

  @Column({ name: 'tagId', nullable: true, type: 'varchar', length: 36 })
  tagId: string;

  @Column({ name: 'tagName', nullable: true, type: 'varchar', length: 100 })
  tagName: string;

  @Column()
  message: string;

  @Column({ type: 'varchar', length: 50 })
  triggerValue: string;

  @Column({ type: 'varchar', length: 20 })
  level: AlarmLevel;

  @Column({ type: 'varchar', length: 20, default: AlarmStatus.ACTIVE })
  status: AlarmStatus;

  @Column({ nullable: true })
  acknowledgedAt: Date;

  @Column({ nullable: true, type: 'varchar', length: 36 })
  acknowledgedBy: string;

  @Column({ nullable: true })
  clearedAt: Date;

  @Column({ nullable: true, type: 'varchar', length: 36 })
  clearedBy: string;

  @Column({ nullable: true })
  shelvedAt: Date;

  @Column({ nullable: true, type: 'varchar', length: 36 })
  shelvedBy: string;

  @Column({ nullable: true, type: 'text' })
  shelveReason: string;

  /** Shelve expiry time: once set, AlarmShelveRecoveryService scans periodically to auto-recover; null means manual shelve (never auto-recovers) */
  @Column({ nullable: true })
  shelvedUntil: Date;

  /** Status before shelving: rolled back to this status on auto-recovery (usually ACTIVE or ACKNOWLEDGED); rolls back to ACTIVE when null */
  @Column({ nullable: true, type: 'varchar', length: 20 })
  preShelveStatus: AlarmStatus;

  /** Alarm type (copied from the alarmType dictionary at creation via the matching rule; defaults to custom when no rule matches) */
  @Column({ type: 'varchar', length: 30, default: 'data' })
  alarmType: string;

  /** Alarm disposition type (from the alarmActionType dictionary, updated across the lifecycle):
   *  alarm.triggered (created) -> alarm_acknowledged (acknowledged) -> alarm.cleared (cleared)
   *  -> alarm.escalated (escalated) -> alarm.shelve.expired (shelve recovered) */
  @Column({ name: 'dispositionType', type: 'varchar', length: 50, default: 'alarm.triggered' })
  dispositionType: string;

  /** Whether the alarm is real-time (unrecovered): true=real-time (active/acknowledged/shelved) / false=historical (cleared).
   *  Explicit flag to avoid front/back-end maintaining a status-mapping rule, and more efficient to query than status IN (...).
   *  Added in Phase 5: set to false when the status transitions to CLEARED */
  @Column({ default: true })
  isActive: boolean;

  /** Clear reason: auto=condition auto-recovered / manual=manual clear / rule_disabled=rule disabled / shelve_expired=shelve expired.
   *  Added in Phase 5: distinguishes the clear path that closed the alarm loop */
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  clearReason: string;

  /** Auto-recovery time (time the condition returned to normal); only set when clearReason='auto'.
   *  Added in Phase 5: a key field for closing the alarm loop, recording "when recovery happened" */
  @Column({ nullable: true })
  recoveredAt: Date;

  /** Value at auto-recovery time (the collected value when the condition returned to normal).
   *  Added in Phase 5: records the collected value at the recovery moment for traceability */
  @Column({ nullable: true, type: 'varchar', length: 50 })
  recoveredValue: string;
}
