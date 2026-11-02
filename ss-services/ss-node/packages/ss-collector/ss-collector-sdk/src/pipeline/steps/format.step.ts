// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { PipelineContext, PipelineStep } from '../pipeline-orchestrator';

/**
 * Display-format step - formats numeric values into display strings per the tag's displayFormat config.
 *
 * Design principles:
 * - The storage layer (PersistStep) keeps the raw numeric value, no formatting
 * - The display layer (PublishStep -> WebSocket) uses the formatted string
 * - This step runs after Persist and before Publish
 *
 * Supported format strings:
 * - `%.1f` / `%.2f` / `%.3f` etc. - keep the specified number of decimals
 * - `%d` / `%i` / `%.0f` - integer
 * - `%X` / `%04X` / `%08X` - uppercase hex (zero-padded width)
 * - `%x` / `%04x` - lowercase hex
 * - empty string or unsupported format - direct toString()
 */
@Injectable()
export class FormatStep implements PipelineStep {
  readonly name = 'Format';
  readonly order = 7;

  private readonly logger = new Logger(FormatStep.name);

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldPersist) {
      return ctx;
    }

    try {
      const value = ctx.transformedValue;

      if (value === null || value === undefined) {
        ctx.formattedValue = undefined;
        return ctx;
      }

      // Non-numeric types (bool/string) are converted to string directly, without precision formatting
      // This way the frontend displayValue correctly shows true/false, OK/WARN/ERR, etc.
      if (typeof value === 'boolean') {
        ctx.formattedValue = value ? 'true' : 'false';
        return ctx;
      }
      if (typeof value === 'string') {
        ctx.formattedValue = value;
        return ctx;
      }

      const tagConfig = ctx.tagConfig || {};
      const displayFormat: string = tagConfig.displayFormat || '%.2f';

      ctx.formattedValue = this.applyFormat(Number(value), displayFormat);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown format error';
      this.logger.error(`Format error for tag ${ctx.tagId}: ${errorMsg}`);
      // Fallback: use toString()
      ctx.formattedValue = ctx.transformedValue?.toString();
      ctx.errors.push({ step: this.name, message: errorMsg, code: 'FORMAT_ERROR' });
    }

    return ctx;
  }

  /**
   * Format a numeric value into a string using a printf-style format string.
   * Keeps semantics consistent with the frontend formatTagValue().
   */
  private applyFormat(value: number, format: string): string {
    // Integer format
    if (format === '%d' || format === '%i' || format === '%.0f') {
      return Math.round(value).toString();
    }

    // Float format: %.Nf
    const floatMatch = format.match(/^%\.(\d+)f$/);
    if (floatMatch) {
      const decimals = parseInt(floatMatch[1], 10);
      return value.toFixed(decimals);
    }

    // Hex format: %X / %x / %04X / %08x etc.
    const hexMatch = format.match(/^%(\d*)([Xx])$/);
    if (hexMatch) {
      const width = parseInt(hexMatch[1], 10) || 0;
      const upper = hexMatch[2] === 'X';
      const intVal = Math.round(value);
      if (intVal < 0) return value.toString();
      const hex = intVal.toString(16);
      const padded = hex.padStart(width, '0');
      return upper ? padded.toUpperCase() : padded;
    }

    // Default: direct string conversion
    return value.toString();
  }
}
