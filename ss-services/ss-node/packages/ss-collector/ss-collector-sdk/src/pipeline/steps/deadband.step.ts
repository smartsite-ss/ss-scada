// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { PipelineContext, PipelineStep } from '../pipeline-orchestrator';

interface LastValueRecord {
  value: number;
  timestamp: Date;
  bypassCount: number;
}

@Injectable()
export class DeadbandStep implements PipelineStep {
  readonly name = 'Deadband';
  readonly order = 2;

  private readonly logger = new Logger(DeadbandStep.name);
  private lastValues = new Map<string, LastValueRecord>();

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    ctx.shouldPersist = true;

    try {
      // If transformedValue is null (comm error / conversion failure), do not filter; pass through directly
      if (ctx.transformedValue === null || ctx.transformedValue === undefined) {
        return ctx;
      }

      const tagConfig = ctx.tagConfig || {};
      const deadband = tagConfig.deadband;

      // No deadband config, do not filter
      if (!deadband) {
        return ctx;
      }

      const lastRecord = this.lastValues.get(ctx.tagId);
      const currentValue = Number(ctx.transformedValue);

      if (lastRecord !== undefined) {
        const shouldFilter = this.shouldFilterByDeadband(currentValue, lastRecord, deadband);

        if (shouldFilter) {
          ctx.shouldPersist = false;
          lastRecord.bypassCount++;
          return ctx;
        }
      }

      // Update record
      this.lastValues.set(ctx.tagId, {
        value: currentValue,
        timestamp: new Date(),
        bypassCount: 0,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown deadband error';
      this.logger.error(`Deadband error for tag ${ctx.tagId}: ${errorMsg}`);
      // Deadband-filter exceptions do not block the data flow; allow through
      ctx.shouldPersist = true;
      ctx.errors.push({ step: this.name, message: errorMsg, code: 'DEADBAND_ERROR' });
    }

    return ctx;
  }

  private shouldFilterByDeadband(
    currentValue: number,
    lastRecord: LastValueRecord,
    deadband: Record<string, any>,
  ): boolean {
    const type = deadband.type || 'absolute';
    const threshold = deadband.value ?? 0.01;

    switch (type) {
      case 'absolute': {
        const delta = Math.abs(currentValue - lastRecord.value);
        return delta < threshold;
      }

      case 'percent': {
        if (lastRecord.value === 0) return false; // avoid division by zero
        const deltaPercent =
          (Math.abs(currentValue - lastRecord.value) / Math.abs(lastRecord.value)) * 100;
        return deltaPercent < threshold;
      }

      case 'time': {
        // Time deadband: filter if elapsed since last collection is below the threshold
        const elapsedMs = Date.now() - lastRecord.timestamp.getTime();
        return elapsedMs < threshold * 1000;
      }

      default:
        this.logger.warn(`Unknown deadband type "${type}", using absolute`);
        const delta = Math.abs(currentValue - lastRecord.value);
        return delta < threshold;
    }
  }

  getLastValue(tagId: string): LastValueRecord | undefined {
    return this.lastValues.get(tagId);
  }

  clearTag(tagId: string): boolean {
    return this.lastValues.delete(tagId);
  }

  clearAll(): void {
    this.lastValues.clear();
  }
}
