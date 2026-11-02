// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * PluginGeneratorAgent unit tests — P1-T05
 *
 * Covers:
 *   - Plugin config inference (type/label/category/renderBackend)
 *   - Schema inference (switch/status lamp/label/numeric/pipe)
 *   - Render backend inference (Canvas2D/Vue/SVG/CSS/Three3D)
 *   - System Prompt building (including drawing guides for all render backends)
 *   - Category keyword mapping (industrial/chart/form/custom)
 */

import { describe, it, expect } from 'vitest';
import { PluginGeneratorAgent } from '../../ai/plugin-generator-agent';

describe('PluginGeneratorAgent', () => {
  const agent = new PluginGeneratorAgent();

  // ────── Config inference ──────

  describe('Configuration inference', () => {
    it('"Create a valve plugin with a switch and status lamp" → infers industrial category', () => {
      const result = agent.analyze('创建一个带开关和状态灯的阀门插件');
      expect(result.config.category).toBe('industrial');
      expect(result.config.label).toContain('阀门');
    });

    it('"Generate a pump monitoring graphic" → infers industrial + canvas2d', () => {
      const result = agent.analyze('生成一个泵监控图元');
      expect(result.config.category).toBe('industrial');
      expect(result.config.renderBackend).toBe('canvas2d');
    });

    it('Should default to the Canvas 2D render backend', () => {
      const result = agent.analyze('创建一个温度计插件');
      expect(result.config.renderBackend).toBe('canvas2d');
    });

    it('Input containing "3D" should infer three3d', () => {
      const result = agent.analyze('创建一个3D管道插件');
      expect(result.config.renderBackend).toBe('three3d');
    });

    it('Input containing "Vue组件" should infer vue', () => {
      const result = agent.analyze('创建一个Vue组件表单插件');
      expect(result.config.renderBackend).toBe('vue');
    });

    it('Input containing "SVG" should infer svg-dom', () => {
      const result = agent.analyze('创建一个SVG图表插件');
      expect(result.config.renderBackend).toBe('svg-dom');
    });
  });

  // ────── Schema inference ──────

  describe('Schema inference', () => {
    it('"with switch" → infers isOn (boolean)', () => {
      const result = agent.analyze('创建带开关的阀门插件');
      const names = result.config.schema.fields.map((f) => f.name);
      expect(names).toContain('isOn');
      const isOn = result.config.schema.fields.find((f) => f.name === 'isOn');
      expect(isOn!.type).toBe('boolean');
    });

    it('"with status lamp" → infers status/statusColor (select+color)', () => {
      const result = agent.analyze('创建带状态灯的插件');
      const names = result.config.schema.fields.map((f) => f.name);
      expect(names).toContain('status');
      expect(names).toContain('statusColor');
    });

    it('"temperature/pressure/flow" → infers minValue/maxValue/unit', () => {
      const result = agent.analyze('创建温度显示仪表');
      const names = result.config.schema.fields.map((f) => f.name);
      expect(names).toContain('minValue');
      expect(names).toContain('maxValue');
      expect(names).toContain('unit');
    });

    it('"label/text" → infers label/fontSize/textColor', () => {
      const result = agent.analyze('创建带标签文字的面板');
      const names = result.config.schema.fields.map((f) => f.name);
      expect(names).toContain('label');
      expect(names).toContain('fontSize');
      expect(names).toContain('textColor');
    });

    it('"pipe/valve body/pump body" → infers bodyColor', () => {
      const result = agent.analyze('创建管道插件');
      const names = result.config.schema.fields.map((f) => f.name);
      expect(names).toContain('bodyColor');
    });

    it('Should generate default properties (label/textColor/bgColor) when there are no keywords', () => {
      const result = agent.analyze('创建一个自定义的通用组件');
      const names = result.config.schema.fields.map((f) => f.name);
      expect(names.length).toBeGreaterThanOrEqual(3);
      expect(names).toContain('label');
      expect(names).toContain('textColor');
      expect(names).toContain('bgColor');
    });
  });

  // ────── System Prompt ──────

  describe('System Prompt building', () => {
    it('Should include plugin configuration info', () => {
      const result = agent.analyze('创建阀门插件');
      expect(result.systemPrompt).toContain('Smart-SCADA v7 插件开发专家');
    });

    it('Should include render-backend drawing guidelines', () => {
      const result = agent.analyze('创建阀门插件');
      expect(result.systemPrompt).toContain('Canvas 2D');
    });

    it('Should include the property schema', () => {
      const result = agent.analyze('创建带开关的阀门插件');
      expect(result.systemPrompt).toContain('interface Props');
      expect(result.systemPrompt).toContain('isOn');
    });

    it('Should generate the messages array', () => {
      const result = agent.analyze('创建阀门插件');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
    });

    it('buildSystemPrompt should be consistent with the analyze result', () => {
      const analyzeResult = agent.analyze('创建阀门插件');
      const prompt = agent.buildSystemPrompt(analyzeResult.config);
      expect(prompt).toBe(analyzeResult.systemPrompt);
    });
  });

  // ────── Category inference ──────

  describe('Category inference', () => {
    const categoryCases = [
      ['阀门', 'industrial'],
      ['泵', 'industrial'],
      ['电机', 'industrial'],
      ['传感器', 'industrial'],
      ['仪表', 'industrial'],
      ['开关', 'industrial'],
      ['指示灯', 'industrial'],
      ['管道', 'industrial'],
      ['液位', 'industrial'],
      ['温度', 'industrial'],
      ['压力', 'industrial'],
      ['流量', 'industrial'],
      ['图表', 'chart'],
      ['趋势', 'chart'],
      ['报表', 'chart'],
      ['表单', 'form'],
      ['输入框', 'form'],
      ['按钮', 'form'],
    ] as const;

    for (const [keyword, expected] of categoryCases) {
      it(`"Create ${keyword}plugin" → category="${expected}"`, () => {
        const result = agent.analyze(`创建${keyword}插件`);
        expect(result.config.category).toBe(expected);
      });
    }

    it('Should return "custom" when no keywords match', () => {
      const result = agent.analyze('Create some mysterious alien technology');
      expect(result.config.category).toBe('custom');
    });
  });

  // ────── Typical scenarios ──────

  describe('Typical scenarios: P1-T05 acceptance criteria', () => {
    it('"Create a valve plugin with a switch and status lamp" should generate complete configuration', () => {
      const result = agent.analyze('创建一个带开关和状态灯的阀门插件');

      // Verify the full config structure
      expect(result.config.type).toBeTruthy();
      expect(result.config.label).toContain('阀门');
      expect(result.config.category).toBe('industrial');
      expect(result.config.renderBackend).toBe('canvas2d');

      // The Schema should contain a switch and a status lamp
      const fieldNames = result.config.schema.fields.map((f) => f.name);
      expect(fieldNames).toContain('isOn');
      expect(fieldNames).toContain('statusColor');
      expect(fieldNames).toContain('bodyColor');

      // The System Prompt should contain all required parts
      expect(result.systemPrompt.length).toBeGreaterThan(500);
      expect(result.systemPrompt).toContain('插件配置');
      expect(result.systemPrompt).toContain('属性 Schema');
      expect(result.systemPrompt).toContain('绘制指引');
      expect(result.systemPrompt).toContain('输出要求');
    });

    it('"Create a pump station process flow diagram" should infer industrial + canvas2d', () => {
      const result = agent.analyze('Create a pump station process flow diagram');
      expect(result.config.category).toBe('industrial');
      expect(result.config.renderBackend).toBe('canvas2d');
    });

    it('"Create a data trend chart" should infer chart category', () => {
      const result = agent.analyze('创建一个数据趋势图');
      expect(result.config.category).toBe('chart');
    });

    it('"Create a login form component" should infer form category + Vue backend', () => {
      const result = agent.analyze('创建一个登录表单组件');
      expect(result.config.category).toBe('form');
      expect(result.config.renderBackend).toBe('vue');
    });
  });
});
