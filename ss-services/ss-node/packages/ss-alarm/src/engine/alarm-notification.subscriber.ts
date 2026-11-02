// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Optional, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventBusService, EventLogService } from '@ss-node/ss-core';
import { AlarmNotificationService, NotificationPayload } from '../alarm-notification.service';
import type { AlarmRuleResolvedEvent } from '@ss-node/ss-core';

/**
 * AlarmNotificationSubscriber - auto-triggers alarm notifications (Phase 6 notification wiring)
 *
 * Listens for `alarm.rule_resolved` (after the P1-4 optimization) and `alarm.escalated` events and
 * automatically calls `AlarmNotificationService.sendNotification` to fire the 6-channel notifications
 * (email/sound/popup/sms/tts/webhook).
 *
 * P1-4 optimization: no longer queries the rule table independently; instead uses the pre-parsed
 * rule data (including notifyChannels) carried by the alarm.rule_resolved event from AlarmEventSubscriber,
 * eliminating duplicate DB queries.
 *
 * Notification-channel decision (rule-level config AND globally-enabled channels):
 * 1. Use the pre-parsed rule.notifyChannels from the event
 * 2. rule.notifyChannels AND AlarmNotificationService enabled channels = actual notification channels
 * 3. When the rule is not found or notifyChannels is empty, fall back to globally-enabled channels
 * 4. Skip notification if no channel is enabled
 */
@Injectable()
export class AlarmNotificationSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmNotificationSubscriber.name);
  private readonly triggeredHandler: (event: any) => void;
  private readonly escalatedHandler: (event: any) => void;
  /** The handler wrapped by wrapSubscriber (use this reference when calling off) */
  private wrappedTriggeredHandler?: (event: any) => Promise<void>;

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly notificationService?: AlarmNotificationService,
    @Optional() private readonly eventLogService?: EventLogService,
  ) {
    this.triggeredHandler = this.handleAlarmRuleResolved.bind(this);
    this.escalatedHandler = this.handleAlarmEscalated.bind(this);
  }

  onModuleInit(): void {
    if (this.eventBus && this.notificationService) {
      // wrap helper: alarm.rule_resolved is in the event-log whitelist, so wrapSubscriber tracks the processing result
      const wrap = <T extends any[]>(
        eventType: string,
        handler: (...args: T) => Promise<Record<string, any> | void>,
      ): ((...args: T) => Promise<void>) => {
        const traced = this.eventLogService
          ? this.eventLogService.wrapSubscriber(eventType, 'AlarmNotificationSubscriber', handler)
          : async (...args: T) => { await handler(...args); };
        return async (...args: T) => {
          try { await traced(...args); }
          catch (err) { this.logger.error(`Handler for ${eventType} failed: ${(err as Error).message}`); }
        };
      };

      this.wrappedTriggeredHandler = wrap('alarm.rule_resolved', async (event: any) => {
        await this.triggeredHandler(event);
        return { notificationDispatched: true };
      });
      this.eventBus.on('alarm.rule_resolved', this.wrappedTriggeredHandler);
      // alarm.escalated is not in the event-log whitelist, so wrapSubscriber is unnecessary
      this.eventBus.on('alarm.escalated', this.escalatedHandler);
      this.logger.log(
        'Subscribed to alarm.rule_resolved + alarm.escalated for notification dispatch',
      );
    }
  }

  onModuleDestroy(): void {
    if (this.eventBus) {
      if (this.wrappedTriggeredHandler) {
        this.eventBus.off('alarm.rule_resolved', this.wrappedTriggeredHandler);
      }
      this.eventBus.off('alarm.escalated', this.escalatedHandler);
    }
  }

  /**
   * Compute the actual notification channels: rule channels AND service-enabled channels. Falls back to globally-enabled channels when rule channels are empty.
   * WeChat subscription messages are opt-in channels (recipients are decided by user authorization and not part of rule-level channel config),
   * so they are always merged in when globally enabled, avoiding being filtered out by the rule notifyChannels intersection.
   */
  private resolveChannels(ruleChannels?: string[]): string[] {
    const enabled = this.notificationService!.getEnabledChannels();
    if (enabled.length === 0) return [];
    if (!ruleChannels || ruleChannels.length === 0) return enabled;
    const resolved = ruleChannels.filter((c) => enabled.includes(c));
    if (enabled.includes('wechatSubscribe') && !resolved.includes('wechatSubscribe')) {
      resolved.push('wechatSubscribe');
    }
    return resolved;
  }

  /** Handle the alarm.rule_resolved event -> dispatch notification (P1-4 optimization: uses pre-parsed rule data directly) */
  private async handleAlarmRuleResolved(event: AlarmRuleResolvedEvent): Promise<void> {
    if (!this.notificationService) return;

    const { alarmId, projectId, level, message, value, timestamp, rule } = event;

    this.logger.debug(
      `Received alarm.rule_resolved: alarmId=${alarmId} projectId=${projectId} ` +
        `level=${level} ruleId=${rule?.id ?? 'none'}`,
    );

    try {
      const channels = this.resolveChannels(rule?.notifyChannels);

      if (channels.length === 0) {
        this.logger.debug(`No enabled notification channels for alarm ${alarmId}, skipping`);
        return;
      }

      const payload: NotificationPayload = {
        alarmId,
        ruleName: rule?.name || message || '告警通知',
        level,
        message,
        value: value ?? 0,
        timestamp: new Date(timestamp),
        channels,
      };

      await this.notificationService.sendNotification(payload);
      this.logger.log(`Notification dispatched for alarm ${alarmId} via [${channels.join(',')}]`);
    } catch (err: any) {
      this.logger.error(`Failed to dispatch notification for alarm ${alarmId}: ${err.message}`);
    }
  }

  /** Handle the alarm-escalation event -> dispatch escalation notification (escalation events have no pre-parsed rule, falls back to globally-enabled channels) */
  private async handleAlarmEscalated(event: any): Promise<void> {
    if (!this.notificationService) return;

    const projectId = event.projectId;
    const alarmId = event.recordId || '';
    const fromLevel = event.fromLevel || '';
    const toLevel = event.toLevel || 'warning';
    const message = event.message || '';
    const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();

    this.logger.debug(
      `Received alarm.escalated: alarmId=${alarmId} projectId=${projectId} ${fromLevel} → ${toLevel}`,
    );

    try {
      // Escalation events have no pre-parsed rule, so fall back to globally-enabled channels
      const channels = this.resolveChannels();

      if (channels.length === 0) {
        this.logger.debug(
          `No enabled notification channels for escalated alarm ${alarmId}, skipping`,
        );
        return;
      }

      const payload: NotificationPayload = {
        alarmId,
        ruleName: '告警升级',
        level: toLevel,
        message: `[升级 ${fromLevel}→${toLevel}] ${message}`,
        value: 0,
        timestamp,
        channels,
      };

      await this.notificationService.sendNotification(payload);
      this.logger.log(
        `Escalation notification dispatched for alarm ${alarmId} via [${channels.join(',')}]`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to dispatch escalation notification for alarm ${alarmId}: ${err.message}`,
      );
    }
  }
}
