// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { PipelineContext, PipelineStep } from '../pipeline-orchestrator';
import { AlarmEvent, NormalizedAlarmEvent } from '../pipeline.types';
import { EventBusService } from '@ss-node/ss-core';
import { TagUpdatePayload } from '../interfaces';

/**
 * PublishStep - data-publishing step
 *
 * Change (P2-2): use the unified TagUpdatePayload type, keeping field naming consistent
 * with the DataPoint construction logic in PersistStep, for easy cross-step tracing and serialization.
 */
@Injectable()
export class PublishStep implements PipelineStep {
  readonly name = 'Publish';
  readonly order = 8;

  private readonly logger = new Logger(PublishStep.name);

  constructor(private readonly eventBus?: EventBusService) {}

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldPersist) {
      return ctx;
    }

    try {
      const triggeredAlarms = (ctx as any).triggeredAlarms as AlarmEvent[] | undefined;

      const payload: TagUpdatePayload = {
        tagId: ctx.tagId,
        deviceId: ctx.deviceId,
        projectId: ctx.projectId,
        value: ctx.transformedValue,
        displayValue: ctx.formattedValue ?? ctx.transformedValue?.toString(),
        quality: ctx.quality,
        timestamp: new Date().toISOString(),
        errors: ctx.errors.length > 0 ? ctx.errors : undefined,
      };

      // Only attach activeAlarms when there is an alarm; omit the field when none (zero overhead)
      if (triggeredAlarms && triggeredAlarms.length > 0) {
        payload.activeAlarms = triggeredAlarms.map((a) => ({
          alarmId: a.alarmId,
          level: a.condition.severity,
          condition: a.condition.type,
          message: a.message,
        }));
      }

      // 1. WebSocket push (real-time data)
      if (this.eventBus) {
        this.eventBus.emit('data_point_changed', payload);
      }

      // 2. Alarm-event push
      if (triggeredAlarms && triggeredAlarms.length > 0) {
        for (const alarm of triggeredAlarms) {
          this.logger.debug(
            `Alarm event: alarmId=${alarm.alarmId} tagId=${alarm.tagId} ` +
              `severity=${alarm.condition.severity} type=${alarm.condition.type} ` +
              `message="${alarm.message}"`,
          );
          if (this.eventBus) {
            this.eventBus.emit('alarm_triggered', alarm);
          }
        }
      }

      // 3. Phase 5: alarm-condition-recovered event push
      const normalizedAlarms = (ctx as any).normalizedAlarms as NormalizedAlarmEvent[] | undefined;
      if (normalizedAlarms && normalizedAlarms.length > 0) {
        for (const normalized of normalizedAlarms) {
          this.logger.debug(
            `Alarm normalized: tagId=${normalized.tagId} ` +
              `conditionType=${normalized.conditionType} value=${normalized.value} ` +
              `message="${normalized.message}"`,
          );
          if (this.eventBus) {
            this.eventBus.emit('alarm_normalized', normalized);
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown publish error';
      this.logger.error(`Publish error for tag ${ctx.tagId}: ${errorMsg}`);
      ctx.errors.push({ step: this.name, message: errorMsg, code: 'PUBLISH_ERROR' });
      // Publish exceptions do not interrupt the Pipeline
    }

    return ctx;
  }
}
