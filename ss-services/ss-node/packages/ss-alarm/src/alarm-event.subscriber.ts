// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Optional, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventBusService, ProjectDatabaseService } from '@ss-node/ss-core';
import { AlarmRule, AlarmRecord, AlarmStatus } from './entities/alarm.entity';
import { Device, DataTag } from '@ss-node/ss-device';

/**
 * AlarmEventSubscriber
 *
 * Listens for the `alarm_triggered` event emitted by the collection pipeline and persists the
 * alarm record to the project database.
 *
 * Event source: the AlarmEvent published via EventBus inside the pipeline's PublishStep
 * Event format: { tagId, deviceId, projectId, condition: { severity, type }, value, timestamp, message }
 *
 * Persistence logic:
 * 1. Find the matching AlarmRule by tagId (to obtain ruleId)
 * 2. Suppress duplicates for the same active ruleId (update triggerValue / message)
 * 3. Still create a record when no rule matches (ruleId is null, level taken from condition.severity)
 */
@Injectable()
export class AlarmEventSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmEventSubscriber.name);

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly projectDbService?: ProjectDatabaseService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.eventBus.on('alarm_triggered', this.handleAlarmTriggered.bind(this));
      this.logger.log('Subscribed to alarm_triggered events');
    }
  }

  onModuleDestroy(): void {
    if (this.eventBus) {
      this.eventBus.off('alarm_triggered', this.handleAlarmTriggered);
    }
  }

  private async handleAlarmTriggered(event: any): Promise<void> {
    this.logger.debug(
      `Received alarm_triggered: tagId=${event.tagId} ` +
        `deviceId=${event.deviceId} projectId=${event.projectId} ` +
        `severity=${event.condition?.severity} type=${event.condition?.type} ` +
        `value=${event.value} message="${event.message}"`,
    );

    if (!this.projectDbService || !event.projectId) {
      this.logger.warn(
        `Skipped alarm_triggered: projectDbService=${!!this.projectDbService} projectId=${event.projectId}`,
      );
      return;
    }

    try {
      const ds = await this.projectDbService.getSystemDb(event.projectId);
      const repo = ds.getRepository(AlarmRecord);
      const ruleRepo = ds.getRepository(AlarmRule);

      // Find the matching alarm rule by tagId
      const rule = await ruleRepo.findOne({
        where: { tagId: event.tagId, projectId: event.projectId },
      });

      // P1-4 optimization: emit the internal alarm.rule_resolved event carrying pre-parsed rule data,
      // so downstream subscribers like AlarmNotificationSubscriber avoid re-querying the rule table
      this.eventBus?.emit('alarm.rule_resolved', {
        alarmId: event.alarmId,
        tagId: event.tagId,
        deviceId: event.deviceId,
        projectId: event.projectId,
        level: event.condition?.severity ?? 'warning',
        message: event.message,
        timestamp: event.timestamp ?? Date.now(),
        value: event.value,
        rule: rule
          ? {
              id: rule.id,
              name: rule.name,
              alarmType: rule.alarmType,
              // notify_channels is a TEXT column storing a JSON array string;
              // parse it so downstream consumers receive a real string[]
              notifyChannels: this.parseNotifyChannels(rule.notifyChannels),
            }
          : null,
      });

      // Suppress duplicates: the same active ruleId is not created again, only triggerValue / message are updated
      if (rule) {
        const existing = await repo.findOne({
          where: { ruleId: rule.id, projectId: event.projectId, status: AlarmStatus.ACTIVE },
        });
        if (existing) {
          existing.triggerValue = String(event.value ?? existing.triggerValue ?? '');
          existing.message = event.message;
          existing.dispositionType = 'alarm.triggered'; // re-triggered, reset the disposition type
          await repo.save(existing);
          return;
        }
      }

      // Dedup by alarmId: system-generated alarms (device communication / system health) are already persisted directly by their subscribers,
      // so emitting 'alarm_triggered' here is only for real-time WebSocket push; skip duplicate persistence
      if (event.alarmId) {
        const existingById = await repo.findOne({
          where: { id: event.alarmId, projectId: event.projectId },
        });
        if (existingById) {
          this.logger.debug(
            `AlarmRecord ${event.alarmId} already exists (source: system subscriber), skipping`,
          );
          return;
        }
      }

      // Look up the device name and tag name
      let deviceName: string | null = null;
      let tagName: string | null = null;
      try {
        if (event.deviceId) {
          const deviceRepo = ds.getRepository(Device);
          const device = await deviceRepo.findOne({ where: { id: event.deviceId } });
          deviceName = device?.deviceName ?? null;
        }
        if (event.tagId) {
          const tagRepo = ds.getRepository(DataTag);
          const tag = await tagRepo.findOne({ where: { id: event.tagId } });
          tagName = tag?.name ?? null;
        }
      } catch (lookupErr: any) {
        this.logger.warn(`Failed to lookup device/tag names: ${lookupErr.message}`);
      }

      // Create a new record - triggerValue is uniformly converted to string, supporting number/boolean/string types
      // Use the pre-generated alarmId from AlarmCheckStep as the primary key, enabling two-way linkage between alarms and real-time data
      const record = repo.create({
        id: event.alarmId,
        projectId: event.projectId,
        ruleId: rule?.id ?? null,
        deviceId: event.deviceId ?? null,
        deviceName,
        tagId: event.tagId ?? null,
        tagName,
        level: event.condition?.severity ?? 'warning',
        message: event.message,
        triggerValue: String(event.value ?? ''),
        status: AlarmStatus.ACTIVE,
        // Alarm type mapping: limit (over-high/high/low/over-low) -> overlimit, grouped under the over-limit alarm category;
        // other types follow the rule definition; when no rule exists (script trigger, etc.) the default is custom
        alarmType: event.condition?.type === 'limit' ? 'overlimit' : (rule?.alarmType ?? 'custom'),
        // Disposition type initialized to "alarm triggered"
        dispositionType: 'alarm.triggered',
      });
      await repo.save(record);
      this.logger.debug(
        `AlarmRecord persisted: id=${record.id} tag=${event.tagId} ` +
          `level=${record.level} ruleId=${record.ruleId} status=${record.status}`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to persist alarm record: ${error.message}`);
    }
  }

  /**
   * Parse the notify_channels TEXT column (a JSON array string, e.g. '["sound","popup"]')
   * into a real string[]. Tolerates arrays, null, malformed JSON and legacy plain text.
   */
  private parseNotifyChannels(value?: string | string[]): string[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || value.length === 0) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      // Legacy plain-text channel name (not JSON) — treat as a single channel
      return [value];
    }
  }
}
