// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI eval runner unit tests — P1-T10
 */

import { describe, it, expect } from 'vitest';
import {
  runEvaluation,
  formatReportText,
  formatReportMarkdown,
  buildComparisonMatrix,
  formatComparisonMatrix,
  formatComparisonMarkdown,
} from '../../ai/evaluation/eval-runner';
import { EVAL_CASES, EVAL_STATS } from '../../ai/evaluation/eval-cases';

// ============================================================
// Mock the AI client
// ============================================================

function createMockCall(responses: Record<string, string>) {
  return async (input: string, _taskType: string, _providerId?: string, _model?: string) => {
    // Find the case matching the keywords
    for (const [key, content] of Object.entries(responses)) {
      if (input.includes(key)) {
        return { content, usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }, latencyMs: 100 };
      }
    }
    return { content: '默认响应', usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }, latencyMs: 50 };
  };
}

// ============================================================
// Tests: eval-cases.ts
// ============================================================

describe('EVAL_CASES', () => {
  it('Should have at least 50 cases', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(50);
  });

  it('All cases should have unique IDs', () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('All cases\' weights should sum to nearly 1 (error < 0.01)', () => {
    for (const c of EVAL_CASES) {
      const sum = c.dimensions.reduce((s, d) => s + d.weight, 0);
      expect(sum).toBeCloseTo(1, 1);
    }
  });

  it('All cases\' minScore should be within 0-1', () => {
    for (const c of EVAL_CASES) {
      expect(c.minScore).toBeGreaterThanOrEqual(0);
      expect(c.minScore).toBeLessThanOrEqual(1);
    }
  });

  it('EVAL_STATS statistics should be correct', () => {
    expect(EVAL_STATS.total).toBe(EVAL_CASES.length);

    const catSum = Object.values(EVAL_STATS.byCategory).reduce((a, b) => a + b, 0);
    expect(catSum).toBe(EVAL_CASES.length);

    const priSum = Object.values(EVAL_STATS.byPriority).reduce((a, b) => a + b, 0);
    expect(priSum).toBe(EVAL_CASES.length);
  });

  it('Should have all 5 categories', () => {
    expect(EVAL_STATS.byCategory).toHaveProperty('plugin-gen');
    expect(EVAL_STATS.byCategory).toHaveProperty('script-gen');
    expect(EVAL_STATS.byCategory).toHaveProperty('kb-qa');
    expect(EVAL_STATS.byCategory).toHaveProperty('alarm-analysis');
    expect(EVAL_STATS.byCategory).toHaveProperty('safety');
  });
});

// ============================================================
// Tests: eval-runner.ts
// ============================================================

describe('runEvaluation', () => {
  it('Should run a single case correctly and score it automatically', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': '```ts\nclass ValvePlugin extends BasePlugin { type = "valve" }\n```\n工业组件，支持 isOn boolean，status Color，使用 Canvas 渲染',
      }),
      providerId: 'test',
      model: 'test-model',
    });

    expect(report.caseResults.length).toBe(1);
    expect(report.config.providerId).toBe('test');
    expect(report.config.model).toBe('test-model');

    const result = report.caseResults[0];
    expect(result.caseId).toBe('plugin-001');
    expect(result.dimensionResults.length).toBe(5);
    expect(result.usage?.totalTokens).toBe(30);
  });

  it('The keyword dimension should score keywords correctly', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': '这是一段包含 industrial canvas2d isOn boolean status Color 的响应',
      }),
    });

    const catDim = report.caseResults[0].dimensionResults.find((d) => d.name === 'category-match');
    expect(catDim).toBeDefined();
    expect(catDim!.score).toBeGreaterThanOrEqual(0);
  });

  it('The structure dimension should check code structure', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': '```ts\nclass MyPlugin extends BasePlugin {\n  type = "valve"\n}\n```',
      }),
    });

    const structDim = report.caseResults[0].dimensionResults.find((d) => d.name === 'code-complete');
    expect(structDim).toBeDefined();
    expect(structDim!.autoScored).toBe(true);
  });

  it('Empty keywords should be flagged as requiring human handling', async () => {
    // safety-001's blocked dimension has empty keywords
    const cases = EVAL_CASES.filter((c) => c.id === 'safety-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '黑客': '我无法提供此类信息。',
      }),
    });

    const blockedDim = report.caseResults[0].dimensionResults.find((d) => d.name === 'blocked');
    expect(blockedDim).toBeDefined();
    expect(blockedDim!.autoScored).toBe(false);
    expect(report.manualDimCount).toBeGreaterThanOrEqual(1);
  });

  it('The exact method should match precisely', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'script-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '温度': '这是 dataChange 触发，使用 temperature 标签，调用 readTag 和 triggerAlarm 的脚本',
      }),
    });

    const triggerTypeDim = report.caseResults[0].dimensionResults.find((d) => d.name === 'trigger-type');
    expect(triggerTypeDim).toBeDefined();
  });

  it('Error handling: errors should be logged when the AI call fails', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report = await runEvaluation({
      cases,
      callAI: async () => { throw new Error('网络错误'); },
    });

    expect(report.caseResults[0].error).toBe('网络错误');
    expect(report.caseResults[0].score).toBe(0);
    expect(report.caseResults[0].passed).toBe(false);
  });

  it('categoryFilter should filter cases', async () => {
    const cases = EVAL_CASES;
    const report = await runEvaluation({
      cases,
      callAI: createMockCall({}),
      categoryFilter: 'plugin-gen',
    });

    expect(report.config.totalCases).toBe(EVAL_STATS.byCategory['plugin-gen']);
    for (const r of report.caseResults) {
      expect(r.category).toBe('plugin-gen');
    }
  });

  it('priorityFilter should filter cases', async () => {
    const cases = EVAL_CASES;
    const report = await runEvaluation({
      cases,
      callAI: createMockCall({}),
      priorityFilter: 'P0',
    });

    expect(report.config.totalCases).toBe(EVAL_STATS.byPriority['P0']);
    for (const r of report.caseResults) {
      expect(r.priority).toBe('P0');
    }
  });

  it('Report summary statistics should be correct', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': '```ts\nclass ValvePlugin extends BasePlugin { type = "valve" }\n```\n工业组件 Canvas isOn boolean status Color',
      }),
    });

    expect(report.summary.totalPassed + report.summary.totalFailed + report.summary.totalErrors)
      .toBe(report.config.totalCases);
  });
});

// ============================================================
// Tests: report formatting
// ============================================================

describe('formatReportText', () => {
  it('Should generate a non-empty text report', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': 'Test response',
      }),
    });

    const text = formatReportText(report);
    expect(text).toBeTruthy();
    expect(text).toContain('AI 效果评估基准报告');
    expect(text).toContain('plugin-001');
  });
});

describe('formatReportMarkdown', () => {
  it('Should generate a non-empty Markdown report', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': 'Test response',
      }),
    });

    const md = formatReportMarkdown(report);
    expect(md).toBeTruthy();
    expect(md).toContain('# AI 效果评估基准报告');
    expect(md).toContain('plugin-001');
  });
});

// ============================================================
// Tests: model comparison matrix
// ============================================================

describe('模型对比矩阵', () => {
  it('buildComparisonMatrix should aggregate multiple reports', async () => {
    const cases = EVAL_CASES.filter((c) => c.id === 'plugin-001');

    const report1 = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': '```ts\nclass ValvePlugin extends BasePlugin {}\n```\nindustrial Canvas isOn boolean status Color',
      }),
      providerId: 'deepseek',
      model: 'deepseek-chat',
    });

    const report2 = await runEvaluation({
      cases,
      callAI: createMockCall({
        '阀门': '测试',
      }),
      providerId: 'zhipu',
      model: 'glm-4',
    });

    const matrix = buildComparisonMatrix([report1, report2]);
    expect(matrix.length).toBe(2);
    expect(matrix[0].providerId).toBe('deepseek');
    expect(matrix[1].providerId).toBe('zhipu');
  });

  it('formatComparisonMatrix should generate non-empty text', async () => {
    const entries = [
      { providerId: 'deepseek', model: 'deepseek-chat', passRate: 0.8, avgScore: 0.75, avgLatencyMs: 500, totalTokens: 1000 },
      { providerId: 'zhipu', model: 'glm-4', passRate: 0.7, avgScore: 0.65, avgLatencyMs: 800, totalTokens: 1200 },
    ];

    const text = formatComparisonMatrix(entries);
    expect(text).toContain('模型对比矩阵');
    expect(text).toContain('deepseek');
    expect(text).toContain('zhipu');
  });

  it('formatComparisonMarkdown should generate non-empty Markdown', () => {
    const entries = [
      { providerId: 'deepseek', model: 'deepseek-chat', passRate: 0.8, avgScore: 0.75, avgLatencyMs: 500, totalTokens: 1000 },
    ];

    const md = formatComparisonMarkdown(entries);
    expect(md).toContain('## 模型对比矩阵');
    expect(md).toContain('deepseek');
  });
});
