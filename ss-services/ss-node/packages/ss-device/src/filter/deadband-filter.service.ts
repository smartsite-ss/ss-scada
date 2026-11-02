// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { DeadbandMode } from '../entities/data-tag.entity';

/** Deadband-filter result */
export interface DeadbandFilterResult {
  /** Whether it should be reported */
  shouldReport: boolean;
  /** Filter reason */
  reason?: string;
  /** Amount of change */
  delta?: number;
  /** Percentage of change */
  deltaPercent?: number;
}

/** Deadband state record */
interface DeadbandState {
  lastValue: number;
  lastReportedAt: number;
  skipCount: number;
}

@Injectable()
export class DeadbandFilterService {
  private readonly logger = new Logger(DeadbandFilterService.name);
  private readonly states = new Map<string, DeadbandState>();

  /**
   * Decide whether a data point should be reported (deadband filtering)
   * @param currentValue current value
   * @param previousValue the previously reported value
   * @param tag tag config (containing deadband params)
   */
  shouldReport(
    currentValue: number,
    previousValue: number | undefined,
    tag: {
      deadbandMode?: DeadbandMode | string;
      deadbandValue?: number;
      deadbandPercent?: number;
      deadbandTime?: number;
    },
  ): DeadbandFilterResult {
    const mode = tag.deadbandMode || DeadbandMode.NONE;
    const _now = Date.now();

    // First report, or previousValue not provided
    if (previousValue === undefined || previousValue === null) {
      return { shouldReport: true, reason: 'first_report' };
    }

    switch (mode) {
      case DeadbandMode.NONE:
        return this.handleNone(currentValue, previousValue);

      case DeadbandMode.ABSOLUTE:
        return this.handleAbsolute(currentValue, previousValue, tag.deadbandValue);

      case DeadbandMode.PERCENT:
        return this.handlePercentage(currentValue, previousValue, tag.deadbandPercent);

      case DeadbandMode.TIME:
        return this.handleTime(currentValue, tag.deadbandTime);

      default:
        this.logger.warn(`Unknown deadband mode: ${mode}, defaulting to pass`);
        return { shouldReport: true, reason: 'unknown_mode' };
    }
  }

  /**
   * Absolute deadband comparison
   */
  absoluteDeadband(current: number, previous: number, deadbandValue: number): DeadbandFilterResult {
    const delta = Math.abs(current - previous);
    const shouldReport = delta > (deadbandValue || 0);

    return {
      shouldReport,
      delta,
      reason: shouldReport
        ? undefined
        : `absolute_deadband: |${current} - ${previous}| = ${delta} <= ${deadbandValue}`,
    };
  }

  /**
   * Percentage deadband comparison
   */
  percentageDeadband(
    current: number,
    previous: number,
    deadbandPercent: number,
  ): DeadbandFilterResult {
    // Avoid division by zero
    if (Math.abs(previous) < 1e-10) {
      return { shouldReport: true, reason: 'zero_base_bypass' };
    }

    const deltaPercent = (Math.abs(current - previous) / Math.abs(previous)) * 100;
    const shouldReport = deltaPercent > (deadbandPercent || 0);

    return {
      shouldReport,
      deltaPercent,
      reason: shouldReport
        ? undefined
        : `percentage_deadband: ${deltaPercent.toFixed(4)}% <= ${deadbandPercent}%`,
    };
  }

  /**
   * Update a tag's deadband state
   */
  updateState(tagId: string, value: number): void {
    this.states.set(tagId, {
      lastValue: value,
      lastReportedAt: Date.now(),
      skipCount: 0,
    });
  }

  /**
   * Record a skipped data point
   */
  recordSkip(tagId: string): void {
    const state = this.states.get(tagId);
    if (state) {
      state.skipCount++;
    }
  }

  /**
   * Get a tag's deadband state
   */
  getState(tagId: string): DeadbandState | undefined {
    return this.states.get(tagId);
  }

  /**
   * Get a tag's previously reported value
   */
  getLastValue(tagId: string): number | undefined {
    return this.states.get(tagId)?.lastValue;
  }

  /**
   * Reset a tag's deadband state
   */
  reset(tagId: string): void {
    this.states.delete(tagId);
  }

  /**
   * Clear all deadband states
   */
  clearAll(): void {
    this.states.clear();
  }

  /**
   * Get skip statistics for all tags
   */
  getSkipStatistics(): Map<string, { tagId: string; skipCount: number; lastValue: number }> {
    const result = new Map<string, { tagId: string; skipCount: number; lastValue: number }>();
    for (const [tagId, state] of this.states) {
      result.set(tagId, {
        tagId,
        skipCount: state.skipCount,
        lastValue: state.lastValue,
      });
    }
    return result;
  }

  // ──────────── Private methods ────────────

  private handleNone(_currentValue: number, _previousValue: number): DeadbandFilterResult {
    return { shouldReport: true, reason: 'none_mode' };
  }

  private handleAbsolute(
    currentValue: number,
    previousValue: number,
    deadbandValue?: number,
  ): DeadbandFilterResult {
    return this.absoluteDeadband(currentValue, previousValue, deadbandValue ?? 0);
  }

  private handlePercentage(
    currentValue: number,
    previousValue: number,
    deadbandPercent?: number,
  ): DeadbandFilterResult {
    return this.percentageDeadband(currentValue, previousValue, deadbandPercent ?? 0);
  }

  private handleTime(currentValue: number, deadbandTime?: number): DeadbandFilterResult {
    // Time deadband needs state-based judgment
    // Simplified here: when deadbandTime is provided, always return true (time deadband is handled by DeadbandStep in the pipeline)
    if (!deadbandTime || deadbandTime <= 0) {
      return { shouldReport: true, reason: 'time_deadband_disabled' };
    }
    return { shouldReport: true, reason: 'time_deadband_delegated' };
  }
}
