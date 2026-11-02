// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { EventBus } from './EventBus';
import type { ScadaEventType } from '../types/event-bus.types';
import type { DataPoint } from '../types/trend.types';

export interface TrendPoint {
  tagId: string;
  value: any;
  quality: string;
  timestamp: number;
}

export interface TrendSeries {
  tagId: string;
  points: Array<{ time: number; value: any; quality?: string }>;
}

export class RingBuffer<T> {
  private _buffer: T[] = [];
  private _maxSize: number;

  constructor(maxSize: number = 10000) {
    this._maxSize = maxSize;
  }

  push(item: T): void {
    if (this._buffer.length >= this._maxSize) {
      this._buffer.shift();
    }
    this._buffer.push(item);
  }

  toArray(): T[] {
    return [...this._buffer];
  }

  get length(): number {
    return this._buffer.length;
  }

  clear(): void {
    this._buffer = [];
  }
}

export class TrendManager {
  private static instance: TrendManager;

  static getInstance(eventBus?: EventBus): TrendManager {
    if (!TrendManager.instance) {
      if (!eventBus) {
        throw new Error('[TrendManager] EventBus instance required for initialization');
      }
      TrendManager.instance = new TrendManager(eventBus);
    }
    return TrendManager.instance;
  }

  static resetInstance(): void {
    TrendManager.instance = undefined as unknown as TrendManager;
  }

  private _eventBus: EventBus;
  private _dataBuffer: Map<string, RingBuffer<DataPoint>> = new Map();
  private _maxBufferSize: number = 10000;
  private _windowSize: number = 60000;

  private constructor(eventBus: EventBus) {
    this._eventBus = eventBus;
  }

  recordDataPoint(tagId: string, value: any, quality: string): void {
    if (!tagId) {
      return;
    }

    let buffer = this._dataBuffer.get(tagId);
    if (!buffer) {
      buffer = new RingBuffer<DataPoint>(this._maxBufferSize);
      this._dataBuffer.set(tagId, buffer);
    }

    const point: DataPoint = {
      timestamp: Date.now(),
      value,
      quality,
    };

    buffer.push(point);

    try {
      this._eventBus.emit('trendUpdated' as ScadaEventType, {
        tagId,
        value,
        quality,
        timestamp: point.timestamp,
      });
    } catch (err) {
      console.error('[TrendManager] Failed to emit trendUpdated event:', err);
    }
  }

  getRealtimeData(tagIds: string[], windowMs?: number): TrendSeries[] {
    const window = windowMs ?? this._windowSize;
    const now = Date.now();
    const cutoff = now - window;

    return tagIds.map((tagId) => {
      const buffer = this._dataBuffer.get(tagId);
      if (!buffer) {
        return { tagId, points: [] };
      }

      const allPoints = buffer.toArray();
      const filtered = allPoints
        .filter((p) => p.timestamp >= cutoff)
        .map((p) => ({
          time: p.timestamp,
          value: p.value,
          quality: p.quality,
        }));

      return { tagId, points: filtered };
    });
  }

  setWindowSize(ms: number): void {
    if (ms <= 0) {
      console.warn('[TrendManager] Window size must be positive');
      return;
    }
    this._windowSize = ms;
  }

  setMaxBufferSize(size: number): void {
    if (size <= 0) {
      console.warn('[TrendManager] Max buffer size must be positive');
      return;
    }
    this._maxBufferSize = size;

    for (const [tagId, buffer] of this._dataBuffer) {
      const data = buffer.toArray();
      const newBuffer = new RingBuffer<DataPoint>(size);
      const keepCount = Math.min(data.length, size);
      const keepData = data.slice(-keepCount);
      for (const point of keepData) {
        newBuffer.push(point);
      }
      this._dataBuffer.set(tagId, newBuffer);
    }
  }

  clearTag(tagId: string): void {
    const buffer = this._dataBuffer.get(tagId);
    if (buffer) {
      buffer.clear();
    }
    this._dataBuffer.delete(tagId);
  }

  clearAll(): void {
    for (const [, buffer] of this._dataBuffer) {
      buffer.clear();
    }
    this._dataBuffer.clear();
  }

  getTagNames(): string[] {
    return Array.from(this._dataBuffer.keys());
  }

  getLatestValue(tagId: string): { value: any; timestamp: number } | null {
    const buffer = this._dataBuffer.get(tagId);
    if (!buffer) {
      return null;
    }

    const points = buffer.toArray();
    if (points.length === 0) {
      return null;
    }

    const latest = points[points.length - 1];
    return {
      value: latest.value,
      timestamp: latest.timestamp,
    };
  }

  /**
   * Query historical data; automatically applies LTTB downsampling when the returned data volume exceeds the threshold
   * @param tagIds list of tag IDs
   * @param options query options
   * @param options.startTime start timestamp (optional, unlimited by default)
   * @param options.endTime end timestamp (optional, unlimited by default)
   * @param options.downsampleThreshold downsampling threshold; auto-downsamples beyond this count (default 1000)
   * @returns array of trend series
   */
  queryHistory(
    tagIds: string[],
    options?: {
      startTime?: number;
      endTime?: number;
      downsampleThreshold?: number;
    },
  ): TrendSeries[] {
    const startTime = options?.startTime;
    const endTime = options?.endTime;
    const threshold = options?.downsampleThreshold ?? 1000;

    return tagIds.map((tagId) => {
      const buffer = this._dataBuffer.get(tagId);
      if (!buffer) {
        return { tagId, points: [] };
      }

      const allPoints = buffer.toArray();
      const filtered = allPoints.filter((p) => {
        if (startTime !== undefined && p.timestamp < startTime) return false;
        if (endTime !== undefined && p.timestamp > endTime) return false;
        return true;
      });

      let trendPoints: TrendPoint[] = filtered.map((p) => ({
        tagId,
        value: p.value,
        quality: p.quality ?? 'good',
        timestamp: p.timestamp,
      }));

      if (trendPoints.length > threshold) {
        trendPoints = TrendManager.downsample(trendPoints, threshold);
      }

      const points = trendPoints.map((p) => ({
        time: p.timestamp,
        value: p.value,
        quality: p.quality,
      }));

      return { tagId, points };
    });
  }

  /**
   * LTTB (Largest Triangle Three Buckets) downsampling algorithm
   * Reduces the number of data points dramatically while preserving visual characteristics
   *
   * Algorithm steps:
   * 1. Split the data into N buckets (N = threshold)
   * 2. The first and last data points are always kept
   * 3. For each bucket, choose the point forming the "largest triangle area"
   * 4. The triangle consists of: the previously selected point, the current bucket's candidate point, and the next bucket's average point
   *
   * @param data input data point array (must be sorted by timestamp ascending)
   * @param threshold target number of data points
   * @returns downsampled data point array
   */
  static downsample(data: TrendPoint[], threshold: number): TrendPoint[] {
    if (!data || data.length === 0) {
      return data ?? [];
    }

    if (data.length <= threshold) {
      return data;
    }

    // With threshold < 3 a triangle cannot be formed; take head and tail directly
    if (threshold < 3) {
      const result: TrendPoint[] = [data[0]];
      if (threshold === 2 && data.length > 1) {
        result.push(data[data.length - 1]);
      }
      return result;
    }

    const result: TrendPoint[] = [];
    const bucketSize = (data.length - 2) / (threshold - 2);
    let a = 0; // index of the previous selected point
    result.push(data[0]);

    for (let i = 0; i < threshold - 2; i++) {
      const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
      const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);
      const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
      const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);

      // Compute the next bucket's average point
      let avgX = 0;
      let avgY = 0;
      const avgCount = avgRangeEnd - avgRangeStart;
      if (avgCount <= 0) {
        // Defensive handling: when the bucket is empty, take the current bucket's start point
        const fallbackIndex = Math.min(rangeStart, data.length - 1);
        result.push(data[fallbackIndex]);
        a = fallbackIndex;
        continue;
      }
      for (let j = avgRangeStart; j < avgRangeEnd; j++) {
        avgX += data[j].timestamp;
        avgY += Number(data[j].value);
      }
      avgX /= avgCount;
      avgY /= avgCount;

      // Find the point with the largest triangle area in the current bucket
      let maxArea = -1;
      let maxAreaIndex = rangeStart;
      const pointA = data[a];
      const pointAX = pointA.timestamp;
      const pointAY = Number(pointA.value);
      const actualRangeEnd = Math.min(rangeEnd, data.length);
      for (let j = rangeStart; j < actualRangeEnd; j++) {
        const pointBX = data[j].timestamp;
        const pointBY = Number(data[j].value);
        // Triangle area = |(xA - avgX) * (yB - yA) - (xA - xB) * (avgY - yA)| * 0.5
        const area =
          Math.abs((pointAX - avgX) * (pointBY - pointAY) - (pointAX - pointBX) * (avgY - pointAY)) *
          0.5;
        if (area > maxArea) {
          maxArea = area;
          maxAreaIndex = j;
        }
      }
      result.push(data[maxAreaIndex]);
      a = maxAreaIndex;
    }
    result.push(data[data.length - 1]);
    return result;
  }

  destroy(): void {
    this.clearAll();
  }
}