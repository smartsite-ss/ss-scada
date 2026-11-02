// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Scene-creation Agent unit tests - P2-T02
 *
 * Verifies:
 *   - GRAPHIC_TYPE_MAP data completeness
 *   - matchGraphicTypes keyword matching
 *   - getSceneCreationSystemPrompt completeness
 *   - isSceneCreationIntent intent detection
 */

import {
  GRAPHIC_TYPE_MAP,
  matchGraphicTypes,
  getSceneCreationSystemPrompt,
  isSceneCreationIntent,
} from '../scene-creator-agent';

describe('GRAPHIC_TYPE_MAP', () => {
  it('Should include at least 50 graphic types', () => {
    expect(GRAPHIC_TYPE_MAP.length).toBeGreaterThanOrEqual(50);
  });

  it('All entries\' type should not be empty', () => {
    for (const entry of GRAPHIC_TYPE_MAP) {
      expect(entry.type).toBeTruthy();
      expect(typeof entry.type).toBe('string');
    }
  });

  it('All entries\' label should not be empty', () => {
    for (const entry of GRAPHIC_TYPE_MAP) {
      expect(entry.label).toBeTruthy();
    }
  });

  it('All entries\' keywords should contain at least 2', () => {
    for (const entry of GRAPHIC_TYPE_MAP) {
      expect(entry.keywords.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('All entries\' defaultSize should be [number, number]', () => {
    for (const entry of GRAPHIC_TYPE_MAP) {
      expect(entry.defaultSize).toHaveLength(2);
      expect(typeof entry.defaultSize[0]).toBe('number');
      expect(typeof entry.defaultSize[1]).toBe('number');
    }
  });

  it('All type names should be unique', () => {
    const types = GRAPHIC_TYPE_MAP.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('Should include common industrial graphics', () => {
    const types = GRAPHIC_TYPE_MAP.map((e) => e.type);
    expect(types).toContain('waterpump');
    expect(types).toContain('valve');
    expect(types).toContain('pipe');
    expect(types).toContain('tank');
    expect(types).toContain('gauge');
  });

  it('Should include common power graphics', () => {
    const types = GRAPHIC_TYPE_MAP.map((e) => e.type);
    expect(types).toContain('motor');
    expect(types).toContain('breaker');
    expect(types).toContain('transformer2w');
    expect(types).toContain('voltmeter');
    expect(types).toContain('ammeter');
  });

  it('Should include common mining graphics', () => {
    const types = GRAPHIC_TYPE_MAP.map((e) => e.type);
    expect(types).toContain('conveyerbelt');
    expect(types).toContain('ballmill');
    expect(types).toContain('crusher');
    expect(types).toContain('pressuregauge');
    expect(types).toContain('flowmeter');
  });

  it('Should include generic and chart components', () => {
    const types = GRAPHIC_TYPE_MAP.map((e) => e.type);
    expect(types).toContain('label');
    expect(types).toContain('button');
    expect(types).toContain('chart');
  });

  it('All graphic categories should be valid values', () => {
    const validCategories = ['工业组件', '电力组件', '矿产组件', '通用组件', '图表组件'];
    for (const entry of GRAPHIC_TYPE_MAP) {
      expect(validCategories).toContain(entry.category);
    }
  });
});

describe('matchGraphicTypes', () => {
  it('Should match "water pump" to waterpump', () => {
    const result = matchGraphicTypes('创建3台水泵');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('waterpump');
  });

  it('Should match "pressure gauge" to pressuregauge', () => {
    const result = matchGraphicTypes('需要压力表');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('pressuregauge');
  });

  it('Should match "valve" to valve', () => {
    const result = matchGraphicTypes('添加一个阀门');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('valve');
  });

  it('Should match "temperature sensor" to tempsensor', () => {
    const result = matchGraphicTypes('需要温度传感器');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('tempsensor');
  });

  it('Should match "flow meter" to flowmeter', () => {
    const result = matchGraphicTypes('安装流量计');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('flowmeter');
  });

  it('Should match "motor" to motor', () => {
    const result = matchGraphicTypes('需要一台电机');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('motor');
  });

  it('Should match "transformer" to transformer2w', () => {
    const result = matchGraphicTypes('添加变压器');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('transformer2w');
  });

  it('Should match "circuit breaker" to breaker', () => {
    const result = matchGraphicTypes('安装断路器');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('breaker');
  });

  it('Should match "conveyor belt" to conveyerbelt', () => {
    const result = matchGraphicTypes('需要传送带');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('conveyerbelt');
  });

  it('Should match "ball mill" to ballmill', () => {
    const result = matchGraphicTypes('球磨机监控');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('ballmill');
  });

  it('Should match "chart" to chart', () => {
    const result = matchGraphicTypes('添加趋势图表');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('chart');
  });

  it('Multiple keywords should return multiple matches (sorted by score)', () => {
    const result = matchGraphicTypes('泵站需要水泵和压力表和流量计');
    expect(result.length).toBeGreaterThanOrEqual(3);
    // water pump scores highest (3 letters + exact match)
    // but waterpump and pump both match "pump"; waterpump scores higher due to exact match of "water pump"
  });

  it('Non-matching description should return an empty array', () => {
    const result = matchGraphicTypes('xyz不存在的设备');
    expect(result).toEqual([]);
  });

  it('Empty string should return an empty array', () => {
    const result = matchGraphicTypes('');
    expect(result).toEqual([]);
  });
});

describe('getSceneCreationSystemPrompt', () => {
  it('Should return a non-empty string', () => {
    const prompt = getSceneCreationSystemPrompt();
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('Should include workflow explanations', () => {
    const prompt = getSceneCreationSystemPrompt();
    expect(prompt).toContain('scene.createPage');
    expect(prompt).toContain('scene.addGraphic');
    expect(prompt).toContain('scene.autoLayout');
    expect(prompt).toContain('scene.setBinding');
  });

  it('Should include graphic quick-reference category headings', () => {
    const prompt = getSceneCreationSystemPrompt();
    expect(prompt).toContain('工业组件');
    expect(prompt).toContain('电力组件');
    expect(prompt).toContain('矿产组件');
  });

  it('Should include layout strategy explanations', () => {
    const prompt = getSceneCreationSystemPrompt();
    expect(prompt).toContain('网格布局');
    expect(prompt).toContain('流式布局');
    expect(prompt).toContain('环形布局');
  });

  it('Should include a pump station scenario example', () => {
    const prompt = getSceneCreationSystemPrompt();
    expect(prompt).toContain('泵站监控');
    expect(prompt).toContain('waterpump');
  });

  it('Should include a power distribution scenario example', () => {
    const prompt = getSceneCreationSystemPrompt();
    expect(prompt).toContain('配电柜监控');
  });

  it('Should include notes and precautions', () => {
    const prompt = getSceneCreationSystemPrompt();
    expect(prompt).toContain('注意事项');
    expect(prompt).toContain('工具调用最多');
  });
});

describe('isSceneCreationIntent', () => {
  it('The page_create intent should return true', () => {
    expect(isSceneCreationIntent('page_create')).toBe(true);
  });

  it('The graphic_add intent should return true', () => {
    expect(isSceneCreationIntent('graphic_add')).toBe(true);
  });

  it('The scene_create intent should return true', () => {
    expect(isSceneCreationIntent('scene_create')).toBe(true);
  });

  it('Non-scene intents should return false', () => {
    expect(isSceneCreationIntent('kb_query')).toBe(false);
    expect(isSceneCreationIntent('plugin_gen')).toBe(false);
    expect(isSceneCreationIntent('alarm_query')).toBe(false);
  });

  it('An undefined intent should return false', () => {
    expect(isSceneCreationIntent(undefined)).toBe(false);
  });

  it('Empty string should return false', () => {
    expect(isSceneCreationIntent('')).toBe(false);
  });
});
