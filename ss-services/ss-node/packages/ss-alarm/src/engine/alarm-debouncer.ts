// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Optional, Logger } from '@nestjs/common';

interface DebounceEntry {
  ruleId: string;
  tagId: string;
  firstTriggerAt: number;
  triggerCount: number;
  lastValue: number | null;
  /** Most recent update timestamp, used for LRU eviction */
  lastUpdatedAt: number;
}

/** Debounce statistics */
export interface DebounceStats {
  totalChecks: number;
  immediateTriggers: number;
  debouncedTriggers: number;
  debouncingCount: number;
  noChangeCount: number;
  clearedCount: number;
  evictedCount: number;
  maxEntriesReached: boolean;
}

/** Default maximum entry count */
const DEFAULT_MAX_ENTRIES = 10000;

@Injectable()
export class AlarmDebouncer {
  private readonly logger = new Logger(AlarmDebouncer.name);
  private entries = new Map<string, DebounceEntry>();
  private readonly maxEntries: number;

  /** Statistics counter */
  private stats = {
    totalChecks: 0,
    immediateTriggers: 0,
    debouncedTriggers: 0,
    noChangeCount: 0,
    clearedCount: 0,
    evictedCount: 0,
  };

  constructor(@Optional() maxEntries?: number) {
    this.maxEntries = maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  private getKey(ruleId: string, tagId: string): string {
    return `${ruleId}:${tagId}`;
  }

  /**
   * Debounce check
   * @param debounceMs time debounce (ms); 0 means time debounce disabled
   * @param debounceCount count debounce; 0 means count debounce disabled
   * @returns 'trigger' = debounce passed, alarm should fire; 'debouncing' = debouncing; 'no_change' = value unchanged
   *
   * Combination rules:
   * - debounceMs > 0 && debounceCount > 0: trigger only when both time and count are satisfied
   * - debounceMs > 0 && debounceCount == 0: time debounce only
   * - debounceMs == 0 && debounceCount > 0: count debounce only
   * - both 0: trigger immediately
   */
  check(
    ruleId: string,
    tagId: string,
    value: number,
    debounceMs: number,
    debounceCount: number = 0,
  ): 'trigger' | 'debouncing' | 'no_change' {
    this.stats.totalChecks++;
    const key = this.getKey(ruleId, tagId);
    const now = Date.now();

    // No debounce requirement, trigger directly
    if (debounceMs <= 0 && debounceCount <= 0) {
      this.stats.immediateTriggers++;
      return 'trigger';
    }

    const existing = this.entries.get(key);

    if (!existing) {
      // LRU eviction: evict the oldest entry when the cap is reached
      this.evictIfNeeded();

      // First trigger: record and enter debounce wait
      this.entries.set(key, {
        ruleId,
        tagId,
        firstTriggerAt: now,
        triggerCount: 1,
        lastValue: value,
        lastUpdatedAt: now,
      });
      this.logger.debug(
        `Debounce started for rule ${ruleId}: ms=${debounceMs}, count=${debounceCount}`,
      );

      // If only 1 occurrence satisfies count debounce and there is no time requirement
      if (debounceMs <= 0 && debounceCount > 0 && debounceCount <= 1) {
        this.clear(ruleId, tagId);
        this.stats.debouncedTriggers++;
        return 'trigger';
      }

      return 'debouncing';
    }

    // Update most-recently-used timestamp (LRU)
    existing.lastUpdatedAt = now;

    // Same value is not counted again (tiny float error allowed)
    if (existing.lastValue !== null && Math.abs(value - existing.lastValue) < 0.001) {
      this.stats.noChangeCount++;
      return 'no_change';
    }

    existing.triggerCount++;
    existing.lastValue = value;

    const elapsed = now - existing.firstTriggerAt;
    const timeSatisfied = debounceMs <= 0 || elapsed >= debounceMs;
    const countSatisfied = debounceCount <= 0 || existing.triggerCount >= debounceCount;

    if (timeSatisfied && countSatisfied) {
      // Debounce passed
      this.clear(ruleId, tagId);
      this.stats.debouncedTriggers++;
      this.logger.debug(
        `Debounce passed for rule ${ruleId}: ${existing.triggerCount} triggers in ${elapsed}ms`,
      );
      return 'trigger';
    }

    return 'debouncing';
  }

  /** Cancel debounce (value recovered to normal) */
  clear(ruleId: string, tagId: string): void {
    const existed = this.entries.delete(this.getKey(ruleId, tagId));
    if (existed) {
      this.stats.clearedCount++;
    }
  }

  /** LRU eviction: when the entry count exceeds the cap, evict the least-recently-updated entry */
  private evictIfNeeded(): void {
    if (this.entries.size < this.maxEntries) return;

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.entries) {
      if (entry.lastUpdatedAt < oldestTime) {
        oldestTime = entry.lastUpdatedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
      this.stats.evictedCount++;
      this.logger.warn(
        `Debounce LRU eviction: max entries (${this.maxEntries}) reached, evicted ${oldestKey}`,
      );
    }
  }

  /** Get the number of rules currently debouncing */
  getDebouncingCount(): number {
    return this.entries.size;
  }

  /** Get debounce details for debugging */
  getDebouncingEntries(): DebounceEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get statistics */
  getStats(): DebounceStats {
    return {
      ...this.stats,
      debouncingCount: this.entries.size,
      maxEntriesReached: this.entries.size >= this.maxEntries,
    };
  }

  /** Reset the statistics counter */
  resetStats(): void {
    this.stats = {
      totalChecks: 0,
      immediateTriggers: 0,
      debouncedTriggers: 0,
      noChangeCount: 0,
      clearedCount: 0,
      evictedCount: 0,
    };
  }

  /** Clean up expired debounce entries (no update for 24h) */
  cleanup(): number {
    const cutoff = Date.now() - 24 * 3600000;
    let cleaned = 0;

    for (const [key, entry] of this.entries) {
      if (entry.firstTriggerAt < cutoff) {
        this.entries.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned up ${cleaned} stale debounce entries`);
    }

    return cleaned;
  }
}
