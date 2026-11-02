// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * ScriptGeneratorAgent unit tests — P1-T06
 *
 * Covers:
 *   - analyze(): trigger matching + System Prompt building
 *   - buildSystemPrompt(): injects 26 ScriptAPIs
 *   - Trigger-type code template injection (dataChange/timer/event/manual)
 *   - ChatMessage building
 *   - Typical scenario acceptance
 */

import { describe, it, expect } from 'vitest';
import { ScriptGeneratorAgent } from '../../ai/script-generator-agent';

describe('ScriptGeneratorAgent', () => {
  const agent = new ScriptGeneratorAgent();

  // ────── analyze() ──────

  describe('analyze() triggers matching + Prompt building', () => {
    it('Should match the dataChange trigger type correctly', () => {
      const result = agent.analyze('当温度超过80度时触发告警');
      expect(result.trigger.type).toBe('dataChange');
      expect(result.trigger.tagId).toBe('temperature');
    });

    it('Should match the timer trigger type correctly', () => {
      const result = agent.analyze('每10秒读取一次压力值');
      expect(result.trigger.type).toBe('timer');
    });

    it('Should match the event trigger type correctly', () => {
      const result = agent.analyze('点击确认按钮时保存数据');
      expect(result.trigger.type).toBe('event');
    });

    it('Should match the manual trigger type correctly', () => {
      const result = agent.analyze('手动执行数据清理');
      expect(result.trigger.type).toBe('manual');
    });

    it('Should return unknown when unrecognized', () => {
      const result = agent.analyze('只是一个描述性的对话');
      expect(result.trigger.type).toBe('unknown');
    });
  });

  // ────── System Prompt content ──────

  describe('System Prompt content', () => {
    it('Should contain 26 ScriptAPI docs', () => {
      const result = agent.analyze('当温度超过80度时触发告警');

      // Check whether key APIs appear in the System Prompt
      const requiredAPIs = [
        'readTag',
        'writeTag',
        'getTagQuality',
        'setGraphicProps',
        'showGraphic',
        'hideGraphic',
        'moveGraphic',
        'rotateGraphic',
        'triggerAlarm',
        'acknowledgeAlarm',
        'clearAlarm',
        'getActiveAlarms',
        'switchPage',
        'getCurrentPageId',
        'fetch',
        'setTimeout',
        'setInterval',
        'sleep',
        'notify',
        'log',
        'clamp',
        'mapRange',
        'colorForValue',
      ];

      for (const api of requiredAPIs) {
        expect(result.systemPrompt).toContain(api);
      }
    });

    it('Should include sandbox environment explanations', () => {
      const result = agent.analyze('当温度超过80度时触发告警');
      expect(result.systemPrompt).toContain('沙箱');
      expect(result.systemPrompt).toContain('api');
      expect(result.systemPrompt).toContain('禁止使用');
    });

    it('Should include trigger configuration info (dataChange)', () => {
      const result = agent.analyze('当温度超过80度时触发告警');
      expect(result.systemPrompt).toContain('触发配置');
      expect(result.systemPrompt).toContain('dataChange');
      expect(result.systemPrompt).toContain('temperature');
    });

    it('Should prompt for manual selection with an unknown trigger type', () => {
      const result = agent.analyze('hello');
      expect(result.systemPrompt).toContain('未能自动匹配触发类型');
      expect(result.systemPrompt).toContain('选择合适的触发方式');
    });

    it('Should include code convention explanations', () => {
      const result = agent.analyze('当温度超过80度时触发告警');
      expect(result.systemPrompt).toContain('api');
      expect(result.systemPrompt).toContain('const');
      expect(result.systemPrompt).toContain('export');
    });
  });

  // ────── Trigger templates ──────

  describe('Trigger type code templates', () => {
    it('The dataChange template should contain tag ID and condition', () => {
      const result = agent.analyze('当温度超过80度时触发告警');
      expect(result.systemPrompt).toContain('temperature');
      expect(result.systemPrompt).toContain('>');
      expect(result.systemPrompt).toContain('80');
    });

    it('The timer template should contain the interval', () => {
      const result = agent.analyze('每5秒执行一次');
      expect(result.systemPrompt).toContain('timer');
    });

    it('The event template should contain the graphic ID', () => {
      const result = agent.analyze('点击启动按钮时开机');
      expect(result.systemPrompt).toContain('event');
    });
  });

  // ────── ChatMessage building ──────

  describe('ChatMessage building', () => {
    it('Should generate system + user messages', () => {
      const result = agent.analyze('当温度超过80度时触发告警');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
    });

    it('The user message should contain the original input', () => {
      const input = '当温度超过80度时触发告警';
      const result = agent.analyze(input);
      expect(result.messages[1].content).toContain(input);
    });
  });

  // ────── Typical scenarios (P1-T06 acceptance criteria) ──────

  describe('Typical scenario acceptance', () => {
    it('"When temperature exceeds 80 degrees, trigger alarm" should generate a System Prompt containing alarm APIs', () => {
      const result = agent.analyze('当温度超过80度时触发告警');

      // Trigger matching
      expect(result.trigger.type).toBe('dataChange');

      // The System Prompt should include the triggerAlarm API
      expect(result.systemPrompt).toContain('triggerAlarm');
      expect(result.systemPrompt).toContain('readTag');

      // It should include the code template
      expect(result.systemPrompt).toContain('dataChange 触发');
    });

    it('"Query device status every 30 seconds" should be timer-triggered', () => {
      const result = agent.analyze('每30秒查询一次设备状态');
      expect(result.trigger.type).toBe('timer');
    });

    it('"When the alarm acknowledge button is clicked, clear the alarm" should be event-triggered', () => {
      const result = agent.analyze('点击报警确认按钮时清除告警');
      expect(result.trigger.type).toBe('event');
      expect(result.trigger.graphicId).toBe('报警确认');
    });

    it('"When pressure is below 1.5, close the valve" should match the <= condition', () => {
      const result = agent.analyze('当压力低于1.5时关闭阀门');
      expect(result.trigger.type).toBe('dataChange');
      expect(result.trigger.tagId).toBe('pressure');
      expect(result.trigger.condition).toBe('<');
      expect(result.trigger.threshold).toBe(1.5);
    });

    it('"Generate a run report every 1 hour" should be timer (3,600,000ms)', () => {
      const result = agent.analyze('每1小时生成一次运行报告');
      expect(result.trigger.type).toBe('timer');
      expect(result.trigger.interval).toBe(3_600_000);
    });
  });

  // ────── Singleton export ──────

  describe('Singleton', () => {
    it('The exported scriptGeneratorAgent should be a ScriptGeneratorAgent instance', async () => {
      const { scriptGeneratorAgent: sga } = await import('../../ai/script-generator-agent');
      expect(sga).toBeInstanceOf(ScriptGeneratorAgent);
    });
  });
});
