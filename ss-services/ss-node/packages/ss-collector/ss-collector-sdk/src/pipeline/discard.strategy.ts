// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { PressureLevel } from './frequency-reduction.strategy';

export enum DataPriority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export interface DiscardConfig {
  /** Pressure level required to discard MEDIUM-priority data; default CRITICAL */
  mediumDiscardLevel?: PressureLevel;
  /** Pressure level required to discard LOW-priority data; default HIGH */
  lowDiscardLevel?: PressureLevel;
  /** Minimum queue utilization (0-1) to enable discarding; default 0.8 */
  minUtilizationForDiscard?: number;
  /** Maximum discard rate (0-1); above this ratio no more discarding; default 0.5 */
  maxDiscardRate?: number;
}

const DEFAULT_DISCARD_CONFIG: Required<DiscardConfig> = {
  mediumDiscardLevel: PressureLevel.CRITICAL,
  lowDiscardLevel: PressureLevel.HIGH,
  minUtilizationForDiscard: 0.8,
  maxDiscardRate: 0.5,
};

export interface DiscardStats {
  totalDiscarded: number;
  totalOffered: number;
  discardRate: number;
  lastDiscardTime: number | null;
  discardedByLevel: Record<DataPriority, number>;
  currentPressureLevel: PressureLevel;
}

export interface QueueState {
  size: number;
  maxSize: number;
  isUnderPressure: boolean;
  utilization: number;
}

export interface Taggable {
  tagId: string;
  priority?: DataPriority;
}

@Injectable()
export class DiscardStrategy {
  private readonly logger = new Logger(DiscardStrategy.name);
  private config: Required<DiscardConfig>;
  private totalDiscarded = 0;
  private totalOffered = 0;
  private lastDiscardTime: number | null = null;
  private discardedByLevel: Record<DataPriority, number> = {
    [DataPriority.HIGH]: 0,
    [DataPriority.MEDIUM]: 0,
    [DataPriority.LOW]: 0,
  };

  constructor(config?: DiscardConfig) {
    this.config = { ...DEFAULT_DISCARD_CONFIG, ...config };
  }

  /**
   * Decide whether data should be discarded
   * @param tag data tag carrying a priority
   * @param queueState queue state
   * @param currentPressure current pressure level
   * @returns whether the data should be discarded
   */
  shouldDiscard(tag: Taggable, queueState: QueueState, currentPressure?: PressureLevel): boolean {
    this.totalOffered++;

    const priority = tag.priority ?? DataPriority.MEDIUM;
    const pressure = currentPressure ?? PressureLevel.NORMAL;

    // HIGH-priority data is never discarded
    if (priority === DataPriority.HIGH) {
      return false;
    }

    // Do not discard when queue utilization is below the minimum threshold
    if (queueState.utilization < this.config.minUtilizationForDiscard) {
      return false;
    }

    // Check whether the discard rate exceeds the maximum limit
    if (this.totalOffered > 0) {
      const currentDiscardRate = this.totalDiscarded / this.totalOffered;
      if (currentDiscardRate >= this.config.maxDiscardRate) {
        return false;
      }
    }

    const pressureLevels = [
      PressureLevel.NORMAL,
      PressureLevel.LOW,
      PressureLevel.MEDIUM,
      PressureLevel.HIGH,
      PressureLevel.CRITICAL,
    ];
    const pressureIndex = pressureLevels.indexOf(pressure);

    let shouldDiscard = false;

    if (priority === DataPriority.LOW) {
      const lowThreshold = pressureLevels.indexOf(this.config.lowDiscardLevel);
      if (pressureIndex >= lowThreshold) {
        shouldDiscard = true;
      }
    } else if (priority === DataPriority.MEDIUM) {
      const mediumThreshold = pressureLevels.indexOf(this.config.mediumDiscardLevel);
      if (pressureIndex >= mediumThreshold) {
        shouldDiscard = true;
      }
    }

    if (shouldDiscard) {
      this.totalDiscarded++;
      this.discardedByLevel[priority]++;
      this.lastDiscardTime = Date.now();
      this.logger.warn(
        `Discarding ${priority} priority tag "${tag.tagId}" ` +
          `at pressure=${pressure}, utilization=${queueState.utilization.toFixed(2)}`,
      );
    }

    return shouldDiscard;
  }

  /**
   * Batch-decide whether data should be discarded
   */
  filterDiscardable(
    tags: Taggable[],
    queueState: QueueState,
    currentPressure?: PressureLevel,
  ): { accepted: Taggable[]; discarded: Taggable[] } {
    const accepted: Taggable[] = [];
    const discarded: Taggable[] = [];

    for (const tag of tags) {
      if (this.shouldDiscard(tag, queueState, currentPressure)) {
        discarded.push(tag);
      } else {
        accepted.push(tag);
      }
    }

    return { accepted, discarded };
  }

  /**
   * Get discard statistics
   */
  getDiscardStats(): DiscardStats {
    const discardRate = this.totalOffered > 0 ? this.totalDiscarded / this.totalOffered : 0;

    return {
      totalDiscarded: this.totalDiscarded,
      totalOffered: this.totalOffered,
      discardRate: Math.round(discardRate * 10000) / 10000,
      lastDiscardTime: this.lastDiscardTime,
      discardedByLevel: { ...this.discardedByLevel },
      currentPressureLevel: PressureLevel.NORMAL,
    };
  }

  /**
   * Reset discard statistics
   */
  reset(): void {
    this.totalDiscarded = 0;
    this.totalOffered = 0;
    this.lastDiscardTime = null;
    this.discardedByLevel = {
      [DataPriority.HIGH]: 0,
      [DataPriority.MEDIUM]: 0,
      [DataPriority.LOW]: 0,
    };
    this.logger.log('DiscardStrategy reset');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<DiscardConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
