// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { PipelineContext, PipelineStep } from '../pipeline-orchestrator';

@Injectable()
export class QualityCheckStep implements PipelineStep {
  readonly name = 'QualityCheck';
  readonly order = 3;

  private readonly logger = new Logger(QualityCheckStep.name);

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    // If an earlier step already flagged an error, do not overwrite (unless upgrading)
    if (ctx.quality && ctx.quality !== 'unknown' && ctx.quality !== 'good') {
      return ctx;
    }

    try {
      // 1. Null check
      if (ctx.transformedValue === null || ctx.transformedValue === undefined) {
        ctx.quality = 'bad';
        ctx.errors.push({
          step: this.name,
          message: 'Transformed value is null',
          code: 'QUALITY_NULL',
        });
        return ctx;
      }

      // Non-numeric types (bool/string) skip NaN/Infinity and range checks
      // These types need no range validation; mark as good directly
      if (typeof ctx.transformedValue === 'boolean' || typeof ctx.transformedValue === 'string') {
        ctx.quality = 'good';
        return ctx;
      }

      // 2. NaN/Infinity check
      if (!isFinite(Number(ctx.transformedValue))) {
        ctx.quality = 'bad';
        ctx.errors.push({
          step: this.name,
          message: `Value is not finite: ${ctx.transformedValue}`,
          code: 'QUALITY_NAN',
        });
        return ctx;
      }

      const tagConfig = ctx.tagConfig || {};
      const value = Number(ctx.transformedValue);

      // 3. Range check
      if (tagConfig.rangeMin !== undefined && value < tagConfig.rangeMin) {
        ctx.quality = 'out_of_range';
        ctx.errors.push({
          step: this.name,
          message: `Value ${value} below rangeMin ${tagConfig.rangeMin}`,
          code: 'QUALITY_RANGE',
        });
        this.logger.warn(`Tag ${ctx.tagId} out of range: ${value} < ${tagConfig.rangeMin}`);
        return ctx;
      }

      if (tagConfig.rangeMax !== undefined && value > tagConfig.rangeMax) {
        ctx.quality = 'out_of_range';
        ctx.errors.push({
          step: this.name,
          message: `Value ${value} above rangeMax ${tagConfig.rangeMax}`,
          code: 'QUALITY_RANGE',
        });
        this.logger.warn(`Tag ${ctx.tagId} out of range: ${value} > ${tagConfig.rangeMax}`);
        return ctx;
      }

      // 4. Data-validity-period check
      if (tagConfig.maxAge && ctx.rawTimestamp) {
        const ageMs = Date.now() - new Date(ctx.rawTimestamp).getTime();
        if (ageMs > tagConfig.maxAge * 1000) {
          ctx.quality = 'stale';
          ctx.errors.push({
            step: this.name,
            message: `Data stale: age=${Math.round(ageMs / 1000)}s > maxAge=${tagConfig.maxAge}s`,
            code: 'QUALITY_STALE',
          });
          this.logger.warn(`Tag ${ctx.tagId} stale data: ${Math.round(ageMs / 1000)}s old`);
          return ctx;
        }
      }

      // 5. Passed all checks
      ctx.quality = 'good';

      return ctx;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown quality check error';
      this.logger.error(`Quality check error for tag ${ctx.tagId}: ${errorMsg}`);
      ctx.quality = 'uncertain';
      ctx.errors.push({ step: this.name, message: errorMsg, code: 'QUALITY_ERROR' });
      return ctx;
    }
  }
}
