// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Optional, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { In } from 'typeorm';
import {
  EventBusService,
  ProjectDatabaseService,
  AlarmNormalizedEvent,
  AlarmRecoveredEvent,
} from '@ss-node/ss-core';
import { AlarmRule, AlarmRecord, AlarmStatus } from '../entities/alarm.entity';

/**
 * AlarmRecoverySubscriber - alarm auto-recovery subscriber (Phase 5 state-machine closed loop)
 *
 * Listens for the `alarm_normalized` event emitted by the collection pipeline (raised by AlarmCheckStep when it detects
 * the condition has recovered) and auto-recovers all active alarms (ACTIVE / ACKNOWLEDGED) of that tag to CLEARED, closing the loop.
 *
 * Closed-loop flow:
 * 1. AlarmCheckStep detects the value no longer satisfies the alarm condition -> emits the `alarm_normalized` event
 * 2. This subscriber receives the event -> queries all active alarms of that tag in the project
 * 3. For each alarm, check the rule's autoClear config:
 *    - autoClear=true (default): auto-recover, set clearReason='auto' + recoveredAt + recoveredValue
 *    - autoClear=false: skip (requires manual acknowledgment)
 * 4. Emit the `alarm.recovered` event -> for WebSocket push + notification service
 *
 * Project isolation: obtain the project-level DataSource via ProjectDatabaseService.getSystemDb(projectId)
 */
@Injectable()
export class AlarmRecoverySubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlarmRecoverySubscriber.name);

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly projectDbService?: ProjectDatabaseService,
  ) {}

  onModuleInit(): void {
    if (this.eventBus) {
      this.eventBus.on('alarm_normalized', this.handleNormalized.bind(this));
      this.logger.log('Subscribed to alarm_normalized events (Phase 5 auto-recovery)');
    }
  }

  onModuleDestroy(): void {
    if (this.eventBus) {
      this.eventBus.off('alarm_normalized', this.handleNormalized);
    }
  }

  private async handleNormalized(event: AlarmNormalizedEvent): Promise<void> {
    this.logger.debug(
      `Received alarm_normalized: tagId=${event.tagId} ` +
        `projectId=${event.projectId} value=${event.value} ` +
        `conditionType=${event.conditionType} message="${event.message}"`,
    );

    if (!this.projectDbService || !event.projectId) {
      this.logger.warn(
        `Skipped alarm_normalized: projectDbService=${!!this.projectDbService} projectId=${event.projectId}`,
      );
      return;
    }

    try {
      const ds = await this.projectDbService.getSystemDb(event.projectId);
      const recordRepo = ds.getRepository(AlarmRecord);
      const ruleRepo = ds.getRepository(AlarmRule);

      // Find all active alarms of that tag (both ACTIVE + ACKNOWLEDGED can be auto-recovered)
      const activeRecords = await recordRepo.find({
        where: {
          tagId: event.tagId,
          projectId: event.projectId,
          status: In([AlarmStatus.ACTIVE, AlarmStatus.ACKNOWLEDGED]),
          isActive: true,
        },
      });

      if (activeRecords.length === 0) {
        this.logger.debug(
          `No active alarms found for tagId=${event.tagId} in project=${event.projectId}, skipping`,
        );
        return;
      }

      // Batch-load related rules (for the autoClear check)
      const ruleIds = [...new Set(activeRecords.map((r) => r.ruleId).filter(Boolean))] as string[];
      const rules = ruleIds.length > 0 ? await ruleRepo.find({ where: { id: In(ruleIds) } }) : [];
      const ruleMap = new Map(rules.map((r) => [r.id, r]));

      const recoveredValue = String(event.value);
      const recoveredAt = new Date();
      const recoveredRecords: AlarmRecord[] = [];

      for (const record of activeRecords) {
        // Check whether the rule allows auto-recovery
        const rule = record.ruleId ? ruleMap.get(record.ruleId) : undefined;
        if (rule && !rule.autoClear) {
          this.logger.debug(
            `Alarm ${record.id} skipped: rule ${rule.id} has autoClear=false (manual confirmation required)`,
          );
          continue;
        }

        // Run auto-recovery - same logic as AlarmService.recoverAlarm()
        record.status = AlarmStatus.CLEARED;
        record.clearedAt = recoveredAt;
        record.clearedBy = 'auto';
        record.isActive = false;
        record.clearReason = 'auto';
        record.recoveredAt = recoveredAt;
        record.recoveredValue = recoveredValue;
        record.dispositionType = 'alarm.cleared';

        recoveredRecords.push(record);
      }

      if (recoveredRecords.length > 0) {
        await recordRepo.save(recoveredRecords);

        // Emit the alarm.recovered event (for WebSocket push + notification service)
        for (const record of recoveredRecords) {
          const recoveredEvent: AlarmRecoveredEvent = {
            recordId: record.id,
            tagId: record.tagId ?? event.tagId,
            deviceId: record.deviceId ?? event.deviceId,
            projectId: event.projectId,
            recoveredValue,
            recoveredAt,
            ruleId: record.ruleId ?? undefined,
            ruleName: ruleMap.get(record.ruleId ?? '')?.name,
          };
          if (this.eventBus) {
            this.eventBus.emit('alarm.recovered', recoveredEvent);
          }
        }

        this.logger.log(
          `Auto-recovered ${recoveredRecords.length} alarm(s) for tagId=${event.tagId} ` +
            `in project=${event.projectId} (value=${recoveredValue})`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to auto-recover alarms for tagId=${event.tagId}: ${error.message}`);
    }
  }
}
