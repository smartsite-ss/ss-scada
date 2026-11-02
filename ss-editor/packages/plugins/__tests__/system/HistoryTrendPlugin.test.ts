// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect } from 'vitest';
import {
  createDefaultSeriesStyle,
  DEFAULT_TREND_COLORS,
} from '../../system/history-trend/historyTrendUtils';
import { historyTrendPropertySchema } from '../../system/history-trend/historyTrendPropertySchema';

describe('historyTrendUtils - DEFAULT_TREND_COLORS', () => {
  it('Provides 8 palette colors, all hex', () => {
    expect(DEFAULT_TREND_COLORS).toHaveLength(8);
    for (const color of DEFAULT_TREND_COLORS) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('historyTrendUtils - createDefaultSeriesStyle', () => {
  it('Primary color backfilled into line and area gradients', () => {
    const style = createDefaultSeriesStyle('#4dabf7');
    expect(style.lineStyle.color).toBe('#4dabf7');
    expect(style.lineStyle.type).toBe('solid');
    expect(style.lineStyle.width).toBe(3);
    expect(style.areaStyle.show).toBe(true);
    expect(style.areaStyle.colorStops[0].color).toBe('#4dabf7');
    expect(style.areaStyle.colorStops[2].color).toBe('#4dabf7');
  });

  it('Tag hidden by default with solid dot defaulting to 5', () => {
    const style = createDefaultSeriesStyle('#51cf66');
    expect(style.label.show).toBe(false);
    expect(style.symbolSize).toBe(5);
  });
});

describe('historyTrendPropertySchema static validation', () => {
  it('All fields have name/type/defaultValue', () => {
    for (const field of historyTrendPropertySchema.fields) {
      expect(field.name, 'field missing name').toBeTruthy();
      expect(field.type, `Field ${field.name} missing type`).toBeTruthy();
      expect(field.defaultValue, `Field ${field.name} missing defaultValue`).toBeDefined();
    }
  });

  it('All select fields have options', () => {
    for (const field of historyTrendPropertySchema.fields.filter((f) => f.type === 'select')) {
      expect(field.options?.length, `Field ${field.name} missing options`).toBeGreaterThan(0);
    }
  });

  it('Contains default query mode/time range/showDataZoom and other key fields', () => {
    const names = historyTrendPropertySchema.fields.map((f) => f.name);
    expect(names).toContain('defaultInterpolation');
    expect(names).toContain('defaultInterval');
    expect(names).toContain('defaultPresetRange');
    expect(names).toContain('defaultCustomStart');
    expect(names).toContain('defaultCustomEnd');
    expect(names).toContain('maxPoints');
    expect(names).toContain('showDataZoom');
  });

  it('Field names do not repeat', () => {
    const names = historyTrendPropertySchema.fields.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
