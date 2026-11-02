// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * TriggerMatcher unit tests — P1-T06
 *
 * Covers:
 *   - dataChange trigger matching (exact + loose)
 *   - timer trigger matching (seconds/minutes/Cron)
 *   - event trigger matching (click/double click)
 *   - manual trigger matching
 *   - unknown fallback
 *   - Industrial quantity keyword → tagId mapping
 */

import { describe, it, expect } from 'vitest';
import { TriggerMatcher } from '../../ai/trigger-matcher';

describe('TriggerMatcher', () => {
  const matcher = new TriggerMatcher();

  // ────── dataChange triggers ──────

  describe('dataChange trigger matching', () => {
    it('Should match "when temperature exceeds 80 degrees, trigger alarm" → dataChange', () => {
      const result = matcher.match('当温度超过80度时触发告警');
      expect(result.type).toBe('dataChange');
      expect(result.tagId).toBe('temperature');
      expect(result.condition).toBe('>');
      expect(result.threshold).toBe(80);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('Should match "notify when pressure is below 0.5" → dataChange', () => {
      const result = matcher.match('如果压力低于0.5时就通知');
      expect(result.type).toBe('dataChange');
      expect(result.tagId).toBe('pressure');
      expect(result.condition).toBe('<');
      expect(result.threshold).toBe(0.5);
    });

    it('Should match "once the liquid level reaches 100" → dataChange', () => {
      const result = matcher.match('一旦液位达到100');
      expect(result.type).toBe('dataChange');
      expect(result.tagId).toBe('level');
      expect(result.condition).toBe('>=');
      expect(result.threshold).toBe(100);
    });

    it('Should match "when flow is not equal to 0" → dataChange', () => {
      const result = matcher.match('当流量不等于0');
      expect(result.type).toBe('dataChange');
      expect(result.tagId).toBe('flow');
      expect(result.condition).toBe('!=');
      expect(result.threshold).toBe(0);
    });

    it('Should match loose mode "when temperature changes" → dataChange (no threshold)', () => {
      const result = matcher.match('当温度变化时更新显示');
      expect(result.type).toBe('dataChange');
      expect(result.tagId).toBe('temperature');
      expect(result.confidence).toBe(0.5);
      expect(result.threshold).toBeUndefined();
    });

    it('Should match "when current is above 200 amps" → dataChange (with unit suffix)', () => {
      const result = matcher.match('当电流高于200安时断开');
      expect(result.type).toBe('dataChange');
      expect(result.tagId).toBe('current');
      expect(result.condition).toBe('>');
      expect(result.threshold).toBe(200);
    });
  });

  // ────── timer triggers ──────

  describe('timer trigger matching', () => {
    it('Should match "execute every 5 seconds" → timer', () => {
      const result = matcher.match('每5秒执行一次');
      expect(result.type).toBe('timer');
      expect(result.interval).toBe(5000);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('Should match "check every 2 minutes" → timer', () => {
      const result = matcher.match('每2分钟检查一次');
      expect(result.type).toBe('timer');
      expect(result.interval).toBe(120_000);
    });

    it('Should match "execute every 1 hour" → timer', () => {
      const result = matcher.match('每1小时执行');
      expect(result.type).toBe('timer');
      expect(result.interval).toBe(3_600_000);
    });

    it('Should match "every 100 milliseconds" → timer', () => {
      const result = matcher.match('每100毫秒');
      expect(result.type).toBe('timer');
      expect(result.interval).toBe(100);
    });

    it('Should match the Cron "run data sync on a schedule" → timer', () => {
      const result = matcher.match('定时执行数据同步');
      expect(result.type).toBe('timer');
      expect(result.confidence).toBe(0.6);
    });
  });

  // ────── event triggers ──────

  describe('event trigger matching', () => {
    it('Should match "when the confirm button is clicked" → event', () => {
      const result = matcher.match('点击确认按钮时执行');
      expect(result.type).toBe('event');
      expect(result.eventType).toBe('click');
      expect(result.graphicId).toBe('确认');
    });

    it('Should match "when the chart component is double-clicked" → event', () => {
      const result = matcher.match('双击图表组件时放大');
      expect(result.type).toBe('event');
      expect(result.eventType).toBe('dblclick');
      expect(result.graphicId).toBe('图表');
    });

    it('Should match "when the start graphic is pressed" → event', () => {
      const result = matcher.match('按下启动图元时');
      expect(result.type).toBe('event');
      expect(result.eventType).toBe('mousedown');
    });
  });

  // ────── manual triggers ──────

  describe('manual trigger matching', () => {
    it('Should match "manual execution" → manual', () => {
      const result = matcher.match('手动执行');
      expect(result.type).toBe('manual');
      expect(result.confidence).toBe(0.7);
    });
  });

  // ────── Edge cases and fallback ──────

  describe('Boundaries and fallbacks', () => {
    it('Should return unknown when unrecognized', () => {
      const result = matcher.match('hello world 123');
      expect(result.type).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('Empty string should return unknown', () => {
      const result = matcher.match('');
      expect(result.type).toBe('unknown');
    });

    it('Match priority: timer > event > dataChange', () => {
      // "every 5 seconds when the button value exceeds 80" should match timer first
      const result = matcher.match('每5秒点击启动按钮时');
      expect(result.type).toBe('timer');
    });
  });

  // ────── Industrial quantity keyword mapping ──────

  describe('Industrial quantity keyword → tagId mapping', () => {
    const mappings = [
      ['温度', 'temperature'],
      ['湿度', 'humidity'],
      ['压力', 'pressure'],
      ['流量', 'flow'],
      ['液位', 'level'],
      ['电流', 'current'],
      ['电压', 'voltage'],
      ['功率', 'power'],
      ['转速', 'speed'],
      ['振动', 'vibration'],
      ['频率', 'frequency'],
      ['开度', 'opening'],
    ] as const;

    for (const [keyword, expected] of mappings) {
      it(`"When ${keyword} above 50" → tagId="${expected}"`, () => {
        const result = matcher.match(`当${keyword}超过50时`);
        expect(result.tagId).toBe(expected);
      });
    }
  });
});
