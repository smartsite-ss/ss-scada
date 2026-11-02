// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { PipelineContext, PipelineStep, PipelineValue } from '../pipeline-orchestrator';
import { TransformFormulaError } from '../errors';
import { isBooleanDataType, isStringDataType } from '../../data-type.util';

@Injectable()
export class TransformStep implements PipelineStep {
  readonly name = 'Transform';
  readonly order = 1;

  private readonly logger = new Logger(TransformStep.name);

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    try {
      // If rawValue is null (comm error), pass through directly
      if (ctx.rawValue === null || ctx.rawValue === undefined) {
        ctx.transformedValue = null;
        return ctx;
      }

      const tagConfig = ctx.tagConfig || {};
      const dataType: string = tagConfig.dataType || 'float32';

      // 1. Basic type conversion - keep original semantics per dataType (compatible with tag-table spec string 'boolean')
      //    - bool: keep boolean, avoid being converted to 0/1
      //    - string: keep string, avoid parseFloat losing non-numeric strings
      //    - numeric: parseRawValue converts to number
      let value: PipelineValue;
      if (isBooleanDataType(dataType)) {
        value = this.parseBoolValue(ctx.rawValue);
        if (value === null) {
          this.logger.warn(
            `Data transformation parse failed for tag ${ctx.tagId}: INVALID_BOOL "${ctx.rawValue}"`,
          );
          ctx.transformedValue = null;
          ctx.quality = 'bad';
          ctx.errors.push({
            step: this.name,
            message: `Cannot parse bool value: ${ctx.rawValue}`,
            code: 'TRANSFORM_PARSE',
          });
          return ctx;
        }
      } else if (isStringDataType(dataType)) {
        value = this.parseStringValue(ctx.rawValue);
      } else {
        const numValue = this.parseRawValue(ctx.rawValue);
        if (numValue === null) {
          this.logger.warn(
            `Data transformation parse failed for tag ${ctx.tagId}: INVALID_VALUE "${ctx.rawValue}"`,
          );
          ctx.transformedValue = null;
          ctx.quality = 'bad';
          ctx.errors.push({
            step: this.name,
            message: `Cannot parse raw value: ${ctx.rawValue}`,
            code: 'TRANSFORM_PARSE',
          });
          return ctx;
        }
        value = numValue;
      }

      // 2. Apply conversion config (only for numeric; bool/string skip linear/polynomial conversion)
      if (tagConfig.transform && typeof value === 'number') {
        value = this.applyTransform(value, tagConfig.transform, ctx);
      }

      // 3. Conversion-result validation (numeric only)
      if (typeof value === 'number' && !isFinite(value)) {
        this.logger.warn(`Transform result is not finite for tag ${ctx.tagId}: ${value}`);
        ctx.transformedValue = null;
        ctx.quality = 'bad';
        ctx.errors.push({
          step: this.name,
          message: `Transform result is not finite: ${value}`,
          code: 'TRANSFORM_RANGE',
        });
        return ctx;
      }

      ctx.transformedValue = value;

      return ctx;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown transform error';
      this.logger.error(`Data transformation error for tag ${ctx.tagId}: ${errorMsg}`);

      // Fallback: use the original value
      ctx.transformedValue = typeof ctx.rawValue === 'number' ? ctx.rawValue : null;
      ctx.quality = 'uncertain';
      ctx.errors.push({ step: this.name, message: errorMsg, code: 'TRANSFORM_ERROR' });

      return ctx;
    }
  }

  /** Parse a boolean value - supports boolean / 0|1 / "true"|"false" / "0"|"1" */
  private parseBoolValue(rawValue: any): boolean | null {
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'number') {
      if (rawValue === 0) return false;
      if (rawValue === 1) return true;
      return null;
    }
    if (typeof rawValue === 'string') {
      const s = rawValue.toLowerCase().trim();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      return null;
    }
    return null;
  }

  /** Parse a string value - any value becomes a string, nothing is lost */
  private parseStringValue(rawValue: any): string {
    if (typeof rawValue === 'string') return rawValue;
    return String(rawValue);
  }

  private parseRawValue(rawValue: any): number | null {
    if (typeof rawValue === 'number') {
      return isNaN(rawValue) ? null : rawValue;
    }
    if (typeof rawValue === 'string') {
      const parsed = parseFloat(rawValue);
      return isNaN(parsed) ? null : parsed;
    }
    if (typeof rawValue === 'boolean') {
      return rawValue ? 1 : 0;
    }
    return null;
  }

  private applyTransform(
    value: number,
    transform: Record<string, any>,
    ctx: PipelineContext,
  ): number | null {
    const type = transform.type || 'linear';

    switch (type) {
      case 'linear': {
        const { scale = 1, offset = 0, precision } = transform;
        let result = value * scale + offset;
        if (precision !== undefined && precision >= 0) {
          result = parseFloat(result.toFixed(precision));
        }
        return result;
      }

      case 'polynomial': {
        const { a = 0, b = 1, c = 0, precision } = transform;
        let result = a * value ** 2 + b * value + c;
        if (precision !== undefined && precision >= 0) {
          result = parseFloat(result.toFixed(precision));
        }
        return result;
      }

      case 'table': {
        if (!Array.isArray(transform.table)) {
          throw new TransformFormulaError(`Transform table is not an array`, { tagId: ctx.tagId });
        }
        const entry = transform.table.find((e: any) => e.raw === value);
        if (entry) return entry.eng;
        // Linear interpolation
        return this.interpolateTable(value, transform.table);
      }

      case 'script': {
        // Script conversion is handled by ScriptEngine; this is only a placeholder
        this.logger.warn(`Script transform not yet implemented for tag ${ctx.tagId}`);
        return value;
      }

      default:
        this.logger.warn(`Unknown transform type "${type}" for tag ${ctx.tagId}, using linear`);
        return value;
    }
  }

  private interpolateTable(value: number, table: Array<{ raw: number; eng: number }>): number {
    const sorted = [...table].sort((a, b) => a.raw - b.raw);

    // Out of bounds
    if (value <= sorted[0].raw) return sorted[0].eng;
    if (value >= sorted[sorted.length - 1].raw) return sorted[sorted.length - 1].eng;

    // Find the interval
    for (let i = 0; i < sorted.length - 1; i++) {
      if (value >= sorted[i].raw && value <= sorted[i + 1].raw) {
        const ratio = (value - sorted[i].raw) / (sorted[i + 1].raw - sorted[i].raw);
        return sorted[i].eng + ratio * (sorted[i + 1].eng - sorted[i].eng);
      }
    }

    return value;
  }
}
