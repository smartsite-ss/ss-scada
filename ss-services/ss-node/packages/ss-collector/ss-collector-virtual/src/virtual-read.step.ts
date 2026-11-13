// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { PipelineStep, PipelineContext, isBooleanDataType, isStringDataType } from '@ss-node/ss-collector-sdk';
import { SimulatorFactory } from './simulator-factory';

/**
 * VirtualReadStep - the first step of the Pipeline (order=0),
 * generates simulated data for virtual devices, replacing the real device's ProtocolReadStep.
 */
@Injectable()
export class VirtualReadStep implements PipelineStep {
  name = 'VirtualRead';
  order = 0;
  private readonly logger = new Logger(VirtualReadStep.name);

  constructor(private readonly simulatorFactory: SimulatorFactory) {}

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    try {
      const simulator = this.simulatorFactory.getOrCreate(ctx.tagId, ctx.tagConfig);

      const value = simulator.generate();
      ctx.rawValue = value;
      ctx.rawTimestamp = new Date();
      ctx.quality = 'good';

      // Inject default alarm conditions for virtual devices (if not configured) so AlarmCheckStep can fire alarms
      this.injectDefaultAlarms(ctx);
    } catch (error) {
      ctx.rawValue = null;
      ctx.rawTimestamp = new Date();
      ctx.quality = 'bad';
      ctx.errors.push({
        step: 'VirtualRead',
        message: error instanceof Error ? error.message : String(error),
      });
      this.logger.warn(
        `VirtualRead generation failed: tagId=${ctx.tagId}, error=${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return ctx;
  }

  /**
   * Inject default threshold alarms for virtual device tags without configured alarm conditions.
   * Only effective for numeric types (non bool/string/enum); when simulating 0-100 range random-walk data:
   *   - value > 80 or < 20 -> warning
   *   - value > 95 or < 5  -> critical
   */
  private injectDefaultAlarms(ctx: PipelineContext): void {
    const tagConfig = ctx.tagConfig || {};
    if (tagConfig.alarms && tagConfig.alarms.length > 0) return;

    const dataType = tagConfig.dataType || 'float32';
    // Only inject threshold alarms for numeric types (also handles the point-table spec string 'boolean')
    if (isBooleanDataType(dataType) || isStringDataType(dataType)) return;

    if (!ctx.tagConfig) {
      ctx.tagConfig = {};
    }
    ctx.tagConfig.alarms = [
      { type: 'limit', severity: 'warning', enabled: true },
      { type: 'limit', severity: 'critical', enabled: true },
    ];
    ctx.tagConfig.alarmLimits = {
      high: 55,
      low: 15,
      highHigh: 70,
      lowLow: 5,
    };
    this.logger.log(
      `Injected default alarm limits for virtual tag "${ctx.tagName || ctx.tagId}" ` +
        `(dataType=${dataType}, range: 0-100, warning: <15|>55, critical: <5|>70)`,
    );
  }
}
