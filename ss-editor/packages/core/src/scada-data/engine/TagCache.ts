// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { TagValue } from '../types/data-source.types';

/**
 * TagCache — tag value cache and invalidation strategy
 *
 * Responsibilities:
 * - Cache the latest value of all tags (_tagCache)
 * - Cache each data source's raw data (_sourceRawData)
 * - Process driver-pushed data, detect changes, return the change list
 * - Support clearing the cache per data source
 */
export class TagCache {
  private _tagCache: Map<string, TagValue> = new Map();
  private _sourceRawData: Map<string, Record<string, unknown>> = new Map();

  getCachedValue(tagId: string): TagValue | undefined {
    return this._tagCache.get(tagId);
  }

  getAllCachedValues(): Map<string, TagValue> {
    return new Map(this._tagCache);
  }

  getSourceRawData(sourceId: string): Record<string, unknown> | undefined {
    return this._sourceRawData.get(sourceId);
  }

  clearCachedTags(sourceId: string): void {
    for (const [tagId, v] of this._tagCache) {
      if (v.sourceId === sourceId) {
        this._tagCache.delete(tagId);
      }
    }
  }

  clear(): void {
    this._tagCache.clear();
    this._sourceRawData.clear();
  }

  /**
   * Process driver-pushed data:
   * - Update _sourceRawData
   * - Compare cached values, detect changes
   * - Update _tagCache
   * - Return all changed entries (with previousValue)
   */
  processReceivedData(
    sourceId: string,
    values: TagValue[],
  ): Array<{
    tagId: string;
    value: unknown;
    previousValue: unknown;
    quality: string;
    sourceId: string;
  }> {
    const changes: Array<{
      tagId: string;
      value: unknown;
      previousValue: unknown;
      quality: string;
      sourceId: string;
    }> = [];

    let rawData = this._sourceRawData.get(sourceId);
    if (!rawData) {
      rawData = {};
      this._sourceRawData.set(sourceId, rawData);
    }

    for (const v of values) {
      rawData[v.tagId] = v.value;

      const cached = this._tagCache.get(v.tagId);
      v.sourceId = sourceId;
      if (!cached || cached.value !== v.value || cached.quality !== v.quality) {
        this._tagCache.set(v.tagId, v);
        changes.push({
          tagId: v.tagId,
          value: v.value,
          previousValue: cached?.value,
          quality: v.quality,
          sourceId,
        });
      }
    }

    return changes;
  }
}