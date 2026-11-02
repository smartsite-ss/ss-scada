// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PipelineContext,
  PipelineStep,
  AlarmConditionType,
  AlarmEvent,
  NormalizedAlarmEvent,
} from '../pipeline.types';
import { isBooleanDataType, isStringDataType } from '../../data-type.util';

export { AlarmConditionType, AlarmEvent, NormalizedAlarmEvent };

/** Alarm-state record (with recovery-debounce tracking) */
interface AlarmState {
  isActive: boolean;
  lastTriggerTime?: Date;
  /** Time when the value started recovering (Phase 5 recovery debounce); null means recovery not yet started */
  normalSince?: Date;
}

@Injectable()
export class AlarmCheckStep implements PipelineStep {
  readonly name = 'AlarmCheck';
  readonly order = 4;

  private readonly logger = new Logger(AlarmCheckStep.name);
  private alarmStates = new Map<string, AlarmState>();
  /** Set of tags whose alarm state has been diagnosed (each tag logs diagnosis only once) */
  private diagnosedTags = new Set<string>();

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    try {
      // Skip alarm checking if data quality is bad
      if (ctx.quality !== 'good') {
        return ctx;
      }

      if (ctx.transformedValue === null || ctx.transformedValue === undefined) {
        return ctx;
      }

      const tagConfig = ctx.tagConfig || {};
      // Note: must use let; the virtual-device branch below reassigns to reference the injected condition
      let alarmConditions: AlarmConditionType[] = tagConfig.alarms || [];

      // Auto-inject default alarm conditions for virtual devices (simulating 0-100 random-walk data)
      if (alarmConditions.length === 0 && ctx.deviceType === 'virtual') {
        const dataType = tagConfig.dataType || 'float32';
        if (!isBooleanDataType(dataType) && !isStringDataType(dataType)) {
          if (!ctx.tagConfig) ctx.tagConfig = {};
          ctx.tagConfig.alarms = [
            { type: 'limit', severity: 'warning', enabled: true },
            { type: 'limit', severity: 'critical', enabled: true },
          ];
          ctx.tagConfig.alarmLimits = { high: 55, low: 15, highHigh: 70, lowLow: 5 };
          // Re-read the injected condition
          alarmConditions = ctx.tagConfig.alarms;
          this.logger.log(
            `Injected default alarm limits for virtual tag "${ctx.tagName || ctx.tagId}" ` +
              `(dataType=${dataType}, warning: <15|>55, critical: <5|>70)`,
          );
        }
      }

      if (alarmConditions.length === 0) {
        // Log diagnosis once per tag to avoid flooding
        if (!this.diagnosedTags.has(ctx.tagId)) {
          this.diagnosedTags.add(ctx.tagId);
          this.logger.log(
            `🔍 [DIAG] Tag "${ctx.tagName || ctx.tagId}" has no alarm conditions configured → alarm check skipped (tagConfig.alarms is empty)`,
          );
        }
        return ctx;
      }

      const value = Number(ctx.transformedValue);
      const triggeredAlarms: AlarmEvent[] = [];
      const normalizedAlarms: NormalizedAlarmEvent[] = [];

      for (const condition of alarmConditions) {
        if (!condition.enabled) continue;

        try {
          const isTriggered = this.checkAlarmCondition(value, condition, ctx);
          const alarmKey = `${ctx.tagId}:${condition.type}`;
          const state = this.alarmStates.get(alarmKey);

          if (isTriggered) {
            // Debounce: do not re-trigger the same alarm within 5 seconds
            if (!state || !state.isActive || this.shouldRetrigger(state.lastTriggerTime)) {
              const alarmEvent: AlarmEvent = {
                alarmId: randomUUID(),
                tagId: ctx.tagId,
                deviceId: ctx.deviceId,
                projectId: ctx.projectId,
                condition,
                value,
                timestamp: new Date(),
                message: this.buildAlarmMessage(
                  ctx.tagName || ctx.tagId,
                  value,
                  condition,
                  ctx.tagConfig,
                ),
              };

              triggeredAlarms.push(alarmEvent);
              this.alarmStates.set(alarmKey, { isActive: true, lastTriggerTime: new Date() });

              this.logger.warn(`Alarm triggered: ${alarmEvent.message}`, {
                tagId: ctx.tagId,
                deviceId: ctx.deviceId,
                value,
                severity: condition.severity,
              });
            }
          } else if (state?.isActive) {
            // Phase 5: detect that the condition has recovered
            // Value no longer satisfies the alarm condition, and the condition was previously active -> decide whether to recover
            if (this.shouldRecover(state, condition)) {
              const normalizedEvent: NormalizedAlarmEvent = {
                tagId: ctx.tagId,
                deviceId: ctx.deviceId,
                projectId: ctx.projectId,
                value,
                timestamp: new Date(),
                message: `${ctx.tagName || ctx.tagId} 告警条件已恢复正常，当前值: ${this.formatAlarmValue(value)}`,
                conditionType: condition.type,
              };

              normalizedAlarms.push(normalizedEvent);
              // Mark as recovered and clear the active state
              this.alarmStates.set(alarmKey, {
                isActive: false,
                lastTriggerTime: undefined,
                normalSince: new Date(),
              });

              this.logger.log(`Alarm normalized: ${normalizedEvent.message}`, {
                tagId: ctx.tagId,
                deviceId: ctx.deviceId,
                value,
                conditionType: condition.type,
              });
            } else if (!state.normalSince) {
              // First detection that the value recovered; record the start time (recovery-debounce start)
              this.alarmStates.set(alarmKey, {
                ...state,
                normalSince: new Date(),
              });
            }
          }
        } catch (conditionError) {
          this.logger.error(
            `Alarm condition check error for tag ${ctx.tagId}: ${conditionError.message}`,
          );
        }
      }

      // Attach the triggered alarm event to the context (for PublishStep)
      if (triggeredAlarms.length > 0) {
        (ctx as any).triggeredAlarms = triggeredAlarms;
      }

      // Phase 5: attach the recovered-alarm event to the context (for PublishStep to emit alarm_normalized)
      if (normalizedAlarms.length > 0) {
        (ctx as any).normalizedAlarms = normalizedAlarms;
      }

      return ctx;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown alarm check error';
      this.logger.error(`Alarm check error for tag ${ctx.tagId}: ${errorMsg}`);
      ctx.errors.push({ step: this.name, message: errorMsg, code: 'ALARM_ERROR' });
      return ctx;
    }
  }

  private checkAlarmCondition(
    value: number,
    condition: AlarmConditionType,
    ctx: PipelineContext,
  ): boolean {
    const tagConfig = ctx.tagConfig || {};

    switch (condition.type) {
      case 'limit': {
        const { high, low, highHigh, lowLow } = tagConfig.alarmLimits || {};
        if (highHigh !== undefined && value >= highHigh) return true;
        if (lowLow !== undefined && value <= lowLow) return true;
        if (high !== undefined && value >= high) return true;
        if (low !== undefined && value <= low) return true;
        return false;
      }

      case 'deviation': {
        const { setpoint, deviation } = tagConfig.alarmDeviation || {};
        if (setpoint !== undefined && deviation !== undefined) {
          return Math.abs(value - setpoint) > deviation;
        }
        return false;
      }

      case 'rate': {
        const { rateLimit } = tagConfig.alarmRate || {};
        if (rateLimit !== undefined) {
          const lastRecord = this.getLastValue(ctx.tagId);
          if (lastRecord) {
            const timeDiff = (Date.now() - lastRecord.timestamp.getTime()) / 1000;
            if (timeDiff > 0) {
              const rate = Math.abs(value - lastRecord.value) / timeDiff;
              return rate > rateLimit;
            }
          }
        }
        return false;
      }

      case 'digital': {
        // Digital alarm: value equals the trigger value
        const { triggerValue } = tagConfig.alarmDigital || {};
        return triggerValue !== undefined && value === triggerValue;
      }

      default:
        this.logger.warn(`Unknown alarm condition type: ${condition.type}`);
        return false;
    }
  }

  private shouldRetrigger(lastTriggerTime?: Date): boolean {
    if (!lastTriggerTime) return true;
    return Date.now() - lastTriggerTime.getTime() > 5000;
  }

  /**
   * Decide whether the alarm condition has recovered (Phase 5 recovery debounce)
   *
   * First-version strategy: recover as soon as the value returns to normal (immediate recovery).
   * Later extensible to: require the value to stay normal for N seconds / N sampling cycles
   * (via normalSince) before declaring recovery, to prevent oscillation from intermediate
   * fluctuations (e.g. 80->79->80) causing alarm flapping.
   *
   * @param state      current alarm state (with normalSince recovery-timing start)
   * @param condition alarm condition (for condition-type-specific recovery policy)
   */
  private shouldRecover(_state: AlarmState, _condition: AlarmConditionType): boolean {
    // Simple strategy: recover as soon as the value returns to normal
    // TODO: later extend to time-based debounce - require state.normalSince to persist beyond RECOVERY_DEBOUNCE_MS before recovering
    return true;
  }

  /**
   * Format the numeric value in an alarm message, avoiding floating-point precision issues (e.g. 22.57000000000001)
   * Integers show no decimals; floats keep 2 decimals
   */
  private formatAlarmValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  /**
   * Build a human-readable alarm message, including alarm type, threshold, and current value
   */
  private buildAlarmMessage(
    tagName: string,
    value: number,
    condition: AlarmConditionType,
    tagConfig?: any,
  ): string {
    const severityLabel =
      condition.severity === 'critical'
        ? '严重'
        : condition.severity === 'warning'
          ? '警告'
          : '提示';
    const fmtVal = this.formatAlarmValue(value);

    switch (condition.type) {
      case 'limit': {
        const limits = tagConfig?.alarmLimits || {};
        // Determine which threshold triggered, by priority (consistent with checkAlarmCondition)
        if (limits.highHigh !== undefined && value >= limits.highHigh) {
          return `[${severityLabel}] ${tagName} 超过上上限 ${this.formatAlarmValue(limits.highHigh)}，当前值: ${fmtVal}`;
        }
        if (limits.lowLow !== undefined && value <= limits.lowLow) {
          return `[${severityLabel}] ${tagName} 低于下下限 ${this.formatAlarmValue(limits.lowLow)}，当前值: ${fmtVal}`;
        }
        if (limits.high !== undefined && value >= limits.high) {
          return `[${severityLabel}] ${tagName} 超过上限 ${this.formatAlarmValue(limits.high)}，当前值: ${fmtVal}`;
        }
        if (limits.low !== undefined && value <= limits.low) {
          return `[${severityLabel}] ${tagName} 低于下限 ${this.formatAlarmValue(limits.low)}，当前值: ${fmtVal}`;
        }
        return `[${severityLabel}] ${tagName} 限值报警触发，当前值: ${fmtVal}`;
      }

      case 'deviation': {
        const dev = tagConfig?.alarmDeviation || {};
        const setpoint = dev.setpoint !== undefined ? this.formatAlarmValue(dev.setpoint) : '?';
        const devLimit = dev.deviation !== undefined ? this.formatAlarmValue(dev.deviation) : '?';
        return `[${severityLabel}] ${tagName} 偏差超限 ±${devLimit}，当前值: ${fmtVal}，设定值: ${setpoint}`;
      }

      case 'rate': {
        const rateCfg = tagConfig?.alarmRate || {};
        const rateLimit =
          rateCfg.rateLimit !== undefined ? this.formatAlarmValue(rateCfg.rateLimit) : '?';
        return `[${severityLabel}] ${tagName} 变化率超限 ${rateLimit}/s，当前值: ${fmtVal}`;
      }

      case 'digital': {
        return `[${severityLabel}] ${tagName} 数字量报警触发，当前值: ${fmtVal}`;
      }

      default:
        return `[${severityLabel}] ${tagName} 报警触发，当前值: ${fmtVal}`;
    }
  }

  private getLastValue(_tagId: string): { value: number; timestamp: Date } | undefined {
    // Get the last value from DeadbandStep or Cache
    return undefined;
  }

  clearAlarmState(tagId: string): void {
    for (const key of this.alarmStates.keys()) {
      if (key.startsWith(`${tagId}:`)) {
        this.alarmStates.delete(key);
      }
    }
  }

  clearAllAlarmStates(): void {
    this.alarmStates.clear();
    this.diagnosedTags.clear();
  }
}
