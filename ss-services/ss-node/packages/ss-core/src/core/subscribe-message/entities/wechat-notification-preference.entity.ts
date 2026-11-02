// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * WeChat notification-preference entity (Module 10)
 *
 * One record per user: whether to receive alarm subscribe-messages + minimum push level.
 * Table lives in the system DB; dev environment auto-creates it via TypeORM synchronize.
 */
import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../entities/base.entity';

export type MinimumAlarmLevel = 'info' | 'warning' | 'error' | 'critical';

/** Level numeric value (used for "minimum level" filter comparison) */
export const ALARM_LEVEL_SEVERITY: Record<MinimumAlarmLevel, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

@Entity('wx_notification_preferences')
export class WechatNotificationPreference extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'user_id' })
  userId: string;

  /** Whether to receive alarm subscribe-messages */
  @Column({ name: 'alarm_notification_enabled', default: true })
  alarmNotificationEnabled: boolean;

  /** Minimum push level (alarms below this level are not sent) */
  @Column({ name: 'minimum_alarm_level', type: 'varchar', length: 20, default: 'info' })
  minimumAlarmLevel: MinimumAlarmLevel;
}
