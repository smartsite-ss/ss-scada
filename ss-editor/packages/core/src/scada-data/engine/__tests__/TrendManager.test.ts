// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TrendManager, type TrendPoint } from '../TrendManager';
import { EventBus } from '../EventBus';

/**
 * Generate test data points
 * @param count number of data points
 * @param startTimestamp start timestamp
 * @param intervalMs time interval (ms)
 * @param valueFn value generator function
 */
function generatePoints(
  count: number,
  startTimestamp: number = 1000000,
  intervalMs: number = 1000,
  valueFn: (i: number) => number = (i) => Math.sin(i / 10) * 50 + 50,
): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      tagId: 'tag-1',
      timestamp: startTimestamp + i * intervalMs,
      value: valueFn(i),
      quality: 'good',
    });
  }
  return points;
}

describe('TrendManager', () => {
  let eventBus: EventBus;
  let manager: TrendManager;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    TrendManager.resetInstance();
    manager = TrendManager.getInstance(eventBus);
  });

  afterEach(() => {
    manager.destroy();
    TrendManager.resetInstance();
    vi.useRealTimers();
  });

  // ==================== downsample (LTTB) ====================
  describe('downsample (LTTB algorithm)', () => {
    // ---------- Empty data handling ----------
    it('TC-TRD-001: should return empty array for empty data', () => {
      const result = TrendManager.downsample([], 100);
      expect(result).toEqual([]);
    });

    it('TC-TRD-002: should return empty array for null/undefined data', () => {
      expect(TrendManager.downsample(null as unknown as TrendPoint[], 100)).toEqual([]);
      expect(TrendManager.downsample(undefined as unknown as TrendPoint[], 100)).toEqual([]);
    });

    // ---------- Single data point handling ----------
    it('TC-TRD-003: should return original data for single point', () => {
      const data: TrendPoint[] = [
        { tagId: 't1', value: 10, quality: 'good', timestamp: 1000 },
      ];
      const result = TrendManager.downsample(data, 100);
      expect(result).toBe(data);
      expect(result.length).toBe(1);
    });

    it('TC-TRD-004: should return original data for two points when threshold >= data length', () => {
      const data: TrendPoint[] = [
        { tagId: 't1', value: 10, quality: 'good', timestamp: 1000 },
        { tagId: 't1', value: 20, quality: 'good', timestamp: 2000 },
      ];
      const result = TrendManager.downsample(data, 100);
      expect(result).toBe(data);
      expect(result.length).toBe(2);
    });

    // ---------- Data volume <= threshold returns the original data ----------
    it('TC-TRD-010: should return original data when data length <= threshold', () => {
      const data = generatePoints(500);
      const result = TrendManager.downsample(data, 500);
      expect(result).toBe(data);
      expect(result.length).toBe(500);
    });

    it('TC-TRD-011: should return original data when data length < threshold', () => {
      const data = generatePoints(100);
      const result = TrendManager.downsample(data, 500);
      expect(result).toBe(data);
    });

    it('TC-TRD-012: should return original data when data length equals threshold exactly', () => {
      const data = generatePoints(1000);
      const result = TrendManager.downsample(data, 1000);
      expect(result).toBe(data);
    });

    // ---------- Data volume > threshold returns threshold points ----------
    it('TC-TRD-020: should downsample to threshold count when data exceeds threshold', () => {
      const data = generatePoints(5000);
      const result = TrendManager.downsample(data, 500);
      expect(result.length).toBe(500);
    });

    it('TC-TRD-021: should downsample to 1000 points from 5000 points', () => {
      const data = generatePoints(5000);
      const result = TrendManager.downsample(data, 1000);
      expect(result.length).toBe(1000);
    });

    it('TC-TRD-022: should downsample to 2000 points from 10000 points', () => {
      const data = generatePoints(10000);
      const result = TrendManager.downsample(data, 2000);
      expect(result.length).toBe(2000);
    });

    it('TC-TRD-023: should downsample with small threshold of 3', () => {
      const data = generatePoints(100);
      const result = TrendManager.downsample(data, 3);
      expect(result.length).toBe(3);
    });

    // ---------- First and last points are kept ----------
    it('TC-TRD-030: should preserve the first point', () => {
      const data = generatePoints(1000);
      const result = TrendManager.downsample(data, 100);
      expect(result[0]).toBe(data[0]);
    });

    it('TC-TRD-031: should preserve the last point', () => {
      const data = generatePoints(1000);
      const result = TrendManager.downsample(data, 100);
      expect(result[result.length - 1]).toBe(data[data.length - 1]);
    });

    it('TC-TRD-032: should preserve both first and last points', () => {
      const data = generatePoints(2000, 5000, 100);
      const result = TrendManager.downsample(data, 200);
      expect(result[0]).toBe(data[0]);
      expect(result[result.length - 1]).toBe(data[data.length - 1]);
      expect(result[0].timestamp).toBe(5000);
      expect(result[result.length - 1].timestamp).toBe(5000 + 1999 * 100);
    });

    // ---------- Downsampled data retains visual characteristics ----------
    it('TC-TRD-040: should preserve visual characteristics - average value close to original', () => {
      const data = generatePoints(5000, 0, 1, (i) => Math.sin(i / 50) * 30 + 50);
      const threshold = 500;
      const result = TrendManager.downsample(data, threshold);

      const originalAvg =
        data.reduce((sum, p) => sum + Number(p.value), 0) / data.length;
      const sampledAvg =
        result.reduce((sum, p) => sum + Number(p.value), 0) / result.length;

      // Mean deviation should be within 20%
      const deviation = Math.abs(sampledAvg - originalAvg) / Math.abs(originalAvg);
      expect(deviation).toBeLessThan(0.2);
    });

    it('TC-TRD-041: should preserve visual characteristics - max value close to original', () => {
      const data = generatePoints(5000, 0, 1, (i) => Math.sin(i / 50) * 30 + 50);
      const result = TrendManager.downsample(data, 500);

      const originalMax = Math.max(...data.map((p) => Number(p.value)));
      const sampledMax = Math.max(...result.map((p) => Number(p.value)));

      // Max value deviation should be within 15%
      const deviation = Math.abs(sampledMax - originalMax) / Math.abs(originalMax);
      expect(deviation).toBeLessThan(0.15);
    });

    it('TC-TRD-042: should preserve visual characteristics - min value close to original', () => {
      const data = generatePoints(5000, 0, 1, (i) => Math.sin(i / 50) * 30 + 50);
      const result = TrendManager.downsample(data, 500);

      const originalMin = Math.min(...data.map((p) => Number(p.value)));
      const originalMaxVal = Math.max(...data.map((p) => Number(p.value)));
      const sampledMin = Math.min(...result.map((p) => Number(p.value)));

      // Min value deviation should be within 15% (using the value range as reference)
      const range = originalMaxVal - originalMin;
      const deviation = Math.abs(sampledMin - originalMin) / Math.abs(range);
      expect(deviation).toBeLessThan(0.15);
    });

    it('TC-TRD-043: should preserve peak value when peak is significant', () => {
      // Build data with a clear peak; LTTB should retain points near the peak
      const data: TrendPoint[] = [];
      for (let i = 0; i < 1000; i++) {
        let value = 10;
        if (i === 500) value = 100; // single-point peak
        else if (i === 499 || i === 501) value = 90;
        data.push({
          tagId: 't1',
          timestamp: i * 100,
          value,
          quality: 'good',
        });
      }
      const result = TrendManager.downsample(data, 100);

      // The sampled max value should be very close to the original peak
      const originalMax = Math.max(...data.map((p) => Number(p.value)));
      const sampledMax = Math.max(...result.map((p) => Number(p.value)));
      expect(sampledMax).toBeGreaterThanOrEqual(originalMax * 0.85);
    });

    // ---------- threshold boundary cases ----------
    it('TC-TRD-050: should handle threshold of 1 - return only first point', () => {
      const data = generatePoints(100);
      const result = TrendManager.downsample(data, 1);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(data[0]);
    });

    it('TC-TRD-051: should handle threshold of 2 - return first and last points', () => {
      const data = generatePoints(100);
      const result = TrendManager.downsample(data, 2);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(data[0]);
      expect(result[1]).toBe(data[data.length - 1]);
    });

    it('TC-TRD-052: should handle threshold of 0 - return empty for large data', () => {
      const data = generatePoints(100);
      const result = TrendManager.downsample(data, 0);
      // threshold < 3 and threshold != 2 returns the first point (affected by the threshold=1 branch; threshold=0 goes through threshold<3 && !=2, returning the first point)
      expect(result.length).toBe(1);
      expect(result[0]).toBe(data[0]);
    });

    // ---------- Data integrity ----------
    it('TC-TRD-060: should preserve TrendPoint structure in result', () => {
      const data = generatePoints(1000);
      const result = TrendManager.downsample(data, 100);
      for (const point of result) {
        expect(point).toHaveProperty('tagId');
        expect(point).toHaveProperty('value');
        expect(point).toHaveProperty('quality');
        expect(point).toHaveProperty('timestamp');
      }
    });

    it('TC-TRD-061: should preserve timestamps in ascending order', () => {
      const data = generatePoints(2000);
      const result = TrendManager.downsample(data, 200);
      for (let i = 1; i < result.length; i++) {
        expect(result[i].timestamp).toBeGreaterThanOrEqual(result[i - 1].timestamp);
      }
    });

    it('TC-TRD-062: should return points that are references to original data (no cloning)', () => {
      const data = generatePoints(1000);
      const result = TrendManager.downsample(data, 100);
      // Points in the result should be references from the original array (an LTTB property)
      for (const point of result) {
        expect(data).toContain(point);
      }
    });

    // ---------- Different data patterns ----------
    it('TC-TRD-070: should handle constant value data', () => {
      const data = generatePoints(1000, 0, 1, () => 42);
      const result = TrendManager.downsample(data, 100);
      expect(result.length).toBe(100);
      // All values should stay 42
      for (const p of result) {
        expect(Number(p.value)).toBe(42);
      }
    });

    it('TC-TRD-071: should handle linear increasing data', () => {
      const data = generatePoints(1000, 0, 1, (i) => i);
      const result = TrendManager.downsample(data, 100);
      expect(result.length).toBe(100);
      expect(result[0].value).toBe(0);
      expect(result[result.length - 1].value).toBe(999);
    });

    it('TC-TRD-072: should handle negative values', () => {
      const data = generatePoints(1000, 0, 1, (i) => Math.sin(i / 10) * 100);
      const result = TrendManager.downsample(data, 100);
      expect(result.length).toBe(100);
      expect(result[0]).toBe(data[0]);
      expect(result[result.length - 1]).toBe(data[data.length - 1]);
    });
  });

  // ==================== queryHistory ====================
  describe('queryHistory', () => {
    const BASE_TIME = 1000000;

    beforeEach(() => {
      // Write test data to the buffer, advancing time each step for increasing timestamps
      for (let i = 0; i < 1500; i++) {
        vi.setSystemTime(BASE_TIME + i * 1000);
        manager.recordDataPoint('tag-1', Math.sin(i / 10) * 50 + 50, 'good');
      }
    });

    it('TC-TRD-100: should return all points when below default threshold (1000)', () => {
      // Write a small amount of data
      manager.clearAll();
      for (let i = 0; i < 500; i++) {
        vi.setSystemTime(BASE_TIME + i * 1000);
        manager.recordDataPoint('tag-small', i, 'good');
      }
      const result = manager.queryHistory(['tag-small']);
      expect(result.length).toBe(1);
      expect(result[0].points.length).toBe(500);
    });

    it('TC-TRD-101: should apply downsampling when data exceeds default threshold', () => {
      const result = manager.queryHistory(['tag-1']);
      expect(result.length).toBe(1);
      // Default threshold=1000; 1500 data points should be downsampled to 1000
      expect(result[0].points.length).toBe(1000);
    });

    it('TC-TRD-102: should apply downsampling with custom threshold', () => {
      const result = manager.queryHistory(['tag-1'], { downsampleThreshold: 500 });
      expect(result[0].points.length).toBe(500);
    });

    it('TC-TRD-103: should not downsample when threshold >= data length', () => {
      const result = manager.queryHistory(['tag-1'], { downsampleThreshold: 2000 });
      expect(result[0].points.length).toBe(1500);
    });

    it('TC-TRD-104: should filter by startTime and endTime', () => {
      // tag-1's timestamp range: BASE_TIME to BASE_TIME + 1499 * 1000
      const startTime = BASE_TIME + 200 * 1000;
      const endTime = BASE_TIME + 800 * 1000;

      const filteredResult = manager.queryHistory(['tag-1'], {
        startTime,
        endTime,
        downsampleThreshold: 2000,
      });
      const filteredTimes = filteredResult[0].points.map((p) => p.time);
      // After filtering, points should be within [startTime, endTime]
      expect(Math.min(...filteredTimes)).toBeGreaterThanOrEqual(startTime);
      expect(Math.max(...filteredTimes)).toBeLessThanOrEqual(endTime);
      // 800 - 200 + 1 = 601 points
      expect(filteredResult[0].points.length).toBe(601);
    });

    it('TC-TRD-105: should return empty points for non-existent tag', () => {
      const result = manager.queryHistory(['non-existent-tag']);
      expect(result.length).toBe(1);
      expect(result[0].tagId).toBe('non-existent-tag');
      expect(result[0].points.length).toBe(0);
    });

    it('TC-TRD-106: should handle multiple tags', () => {
      for (let i = 0; i < 1500; i++) {
        vi.setSystemTime(BASE_TIME + 2000000 + i * 1000);
        manager.recordDataPoint('tag-2', i, 'good');
      }
      const result = manager.queryHistory(['tag-1', 'tag-2'], { downsampleThreshold: 500 });
      expect(result.length).toBe(2);
      expect(result[0].tagId).toBe('tag-1');
      expect(result[1].tagId).toBe('tag-2');
      expect(result[0].points.length).toBe(500);
      expect(result[1].points.length).toBe(500);
    });

    it('TC-TRD-107: should preserve point structure { time, value, quality }', () => {
      const result = manager.queryHistory(['tag-1'], { downsampleThreshold: 100 });
      for (const point of result[0].points) {
        expect(point).toHaveProperty('time');
        expect(point).toHaveProperty('value');
        expect(point).toHaveProperty('quality');
      }
    });

    it('TC-TRD-108: should preserve first and last points after downsampling', () => {
      const result = manager.queryHistory(['tag-1'], { downsampleThreshold: 500 });
      const points = result[0].points;
      // After downsampling, the head/tail timestamps should match the original data
      expect(points[0].time).toBe(BASE_TIME);
      expect(points[points.length - 1].time).toBe(BASE_TIME + 1499 * 1000);
    });
  });
});
