// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI evaluation runner — P1-T10
 *
 * Automated evaluation pipeline: runs 50+ benchmark cases, auto-scores and generates comparison reports.
 *
 * Core capabilities:
 *   - Auto scoring: five methods — keyword / exact / contains / regex / structure
 *   - Manual marking: cases with the manual method are marked as requiring human evaluation
 *   - Weighted aggregation: computes the weighted total score by dimension weights
 *   - Report output: both text and Markdown formats
 *   - Model comparison: aggregated comparison matrix from multiple reports
 *
 * Usage:
 *   import { runEvaluation, formatReportText } from './eval-runner';
 *   import { EVAL_CASES } from './eval-cases';
 *
 *   const report = await runEvaluation({
 *     cases: EVAL_CASES,
 *     callAI: async (input, taskType) => aiClient.chat({...}),
 *     providerId: 'deepseek',
 *     model: 'deepseek-chat',
 *   });
 *
 *   console.log(formatReportText(report));
 */

import { EvalCase, EvalDimension } from './eval-cases';

// ============================================================
// Configuration
// ============================================================

export interface EvalRunConfig {
  /** Evaluation case list */
  cases: EvalCase[];
  /** AI call function (injected by the caller; can be a real LLM or a Mock) */
  callAI: (
    input: string,
    taskType: string,
    providerId?: string,
    model?: string,
  ) => Promise<EvalAIResponse>;
  /** Provider ID */
  providerId?: string;
  /** Model name */
  model?: string;
  /** Run only cases of the given category */
  categoryFilter?: string;
  /** Run only cases of the given priority */
  priorityFilter?: string;
  /** Delay between cases (ms), to avoid rate limits */
  throttleMs?: number;
}

export interface EvalAIResponse {
  /** LLM response text */
  content: string;
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Response latency (ms); computed automatically if not provided */
  latencyMs?: number;
}

// ============================================================
// Result types
// ============================================================

export interface EvalCaseResult {
  caseId: string;
  caseName: string;
  category: string;
  priority: string;
  input: string;
  response: string;
  passed: boolean;
  score: number;
  minScore: number;
  dimensionResults: EvalDimensionResult[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs?: number;
  error?: string;
}

export interface EvalDimensionResult {
  name: string;
  weight: number;
  score: number;
  method: string;
  details: string;
  autoScored: boolean;
}

export interface EvalReport {
  config: { providerId?: string; model?: string; totalCases: number };
  summary: EvalSummary;
  byCategory: Record<string, CategoryStat>;
  byPriority: Record<string, CategoryStat>;
  caseResults: EvalCaseResult[];
  manualDimCount: number;
  generatedAt: string;
}

export interface EvalSummary {
  totalPassed: number;
  totalFailed: number;
  totalErrors: number;
  passRate: number;
  avgScore: number;
  avgLatencyMs: number;
  totalTokens: number;
}

export interface CategoryStat {
  total: number;
  passed: number;
  avgScore: number;
}

// ============================================================
// Main entry
// ============================================================

/**
 * Run the evaluation pipeline
 */
export async function runEvaluation(config: EvalRunConfig): Promise<EvalReport> {
  const { callAI, providerId, model, throttleMs = 0 } = config;
  let cases = [...config.cases];

  if (config.categoryFilter) {
    cases = cases.filter((c) => c.category === config.categoryFilter);
  }
  if (config.priorityFilter) {
    cases = cases.filter((c) => c.priority === config.priorityFilter);
  }

  const results: EvalCaseResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    try {
      const startTime = Date.now();
      const aiResponse = await callAI(evalCase.input, evalCase.taskType, providerId, model);
      const latencyMs = aiResponse.latencyMs ?? (Date.now() - startTime);

      const dimensionResults = evalCase.dimensions.map((d) =>
        scoreDimension(d, aiResponse.content),
      );
      const totalScore = dimensionResults.reduce(
        (sum, d) => sum + d.score * d.weight,
        0,
      );
      const passed = totalScore >= evalCase.minScore;

      results.push({
        caseId: evalCase.id,
        caseName: evalCase.name,
        category: evalCase.category,
        priority: evalCase.priority,
        input: evalCase.input,
        response: aiResponse.content,
        passed,
        score: Math.round(totalScore * 100) / 100,
        minScore: evalCase.minScore,
        dimensionResults,
        usage: aiResponse.usage,
        latencyMs,
      });
    } catch (err: any) {
      results.push({
        caseId: evalCase.id,
        caseName: evalCase.name,
        category: evalCase.category,
        priority: evalCase.priority,
        input: evalCase.input,
        response: '',
        passed: false,
        score: 0,
        minScore: evalCase.minScore,
        dimensionResults: [],
        error: err?.message || String(err),
      });
    }

    // Rate limiting
    if (throttleMs > 0 && i < cases.length - 1) {
      await sleep(throttleMs);
    }
  }

  return buildReport(results, { providerId, model });
}

// ============================================================
// Dimension scoring
// ============================================================

function scoreDimension(
  dim: EvalDimension,
  response: string,
): EvalDimensionResult {
  switch (dim.method) {
    case 'keyword':
      return scoreKeywordDim(dim, response);
    case 'exact':
      return scoreExactDim(dim, response);
    case 'contains':
      return scoreContainsDim(dim, response);
    case 'regex':
      return scoreRegexDim(dim, response);
    case 'structure':
      return scoreStructureDim(dim, response);
    case 'manual':
      return {
        name: dim.name,
        weight: dim.weight,
        score: 0,
        method: 'manual',
        details: dim.description || '需人工评估',
        autoScored: false,
      };
    default:
      return {
        name: dim.name,
        weight: dim.weight,
        score: 0,
        method: dim.method,
        details: '未知评估方法',
        autoScored: false,
      };
  }
}

function scoreKeywordDim(
  dim: EvalDimension,
  response: string,
): EvalDimensionResult {
  const keywords = dim.keywords || [];
  if (keywords.length === 0) {
    return {
      name: dim.name,
      weight: dim.weight,
      score: 0,
      method: 'keyword',
      details: dim.description || '空关键词，需人工评估',
      autoScored: false,
    };
  }

  const lower = response.toLowerCase();
  const found = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  const score = found.length / keywords.length;

  return {
    name: dim.name,
    weight: dim.weight,
    score: Math.round(score * 100) / 100,
    method: 'keyword',
    details: `命中 ${found.length}/${keywords.length}: [${found.join(', ')}]`,
    autoScored: true,
  };
}

function scoreExactDim(
  dim: EvalDimension,
  response: string,
): EvalDimensionResult {
  const expected =
    typeof dim.expected === 'string' ? dim.expected : dim.expected?.[0] || '';
  const match = response.trim() === expected || response.includes(expected);
  return {
    name: dim.name,
    weight: dim.weight,
    score: match ? 1 : 0,
    method: 'exact',
    details: match ? `匹配 "${expected}"` : `期望 "${expected}"`,
    autoScored: true,
  };
}

function scoreContainsDim(
  dim: EvalDimension,
  response: string,
): EvalDimensionResult {
  const expectedList = Array.isArray(dim.expected)
    ? dim.expected
    : [dim.expected || ''];
  const found = expectedList.filter((e) => response.includes(e));
  const score = expectedList.length > 0 ? found.length / expectedList.length : 0;
  return {
    name: dim.name,
    weight: dim.weight,
    score: Math.round(score * 100) / 100,
    method: 'contains',
    details: `命中 ${found.length}/${expectedList.length}`,
    autoScored: true,
  };
}

function scoreRegexDim(
  dim: EvalDimension,
  response: string,
): EvalDimensionResult {
  const pattern =
    typeof dim.expected === 'string' ? dim.expected : dim.expected?.[0] || '';
  try {
    const re = new RegExp(pattern);
    const match = re.test(response);
    return {
      name: dim.name,
      weight: dim.weight,
      score: match ? 1 : 0,
      method: 'regex',
      details: match ? `匹配 /${pattern}/` : `不匹配 /${pattern}/`,
      autoScored: true,
    };
  } catch {
    return {
      name: dim.name,
      weight: dim.weight,
      score: 0,
      method: 'regex',
      details: `无效正则: /${pattern}/`,
      autoScored: false,
    };
  }
}

function scoreStructureDim(
  dim: EvalDimension,
  response: string,
): EvalDimensionResult {
  const checks = dim.structureChecks || [];
  if (checks.length === 0) {
    return {
      name: dim.name,
      weight: dim.weight,
      score: 0,
      method: 'structure',
      details: dim.description || '无结构检查项',
      autoScored: false,
    };
  }

  let passed = 0;
  const details: string[] = [];

  for (const check of checks) {
    let ok = false;
    if (check.pattern) {
      try {
        ok = new RegExp(check.pattern).test(response);
      } catch {
        ok = false;
      }
    }
    if (check.keyword) {
      ok = response.toLowerCase().includes(check.keyword.toLowerCase());
    }
    details.push(`${ok ? '✓' : '✗'} ${check.name}`);
    if (ok) passed++;
  }

  const score = passed / checks.length;
  return {
    name: dim.name,
    weight: dim.weight,
    score: Math.round(score * 100) / 100,
    method: 'structure',
    details: details.join(', '),
    autoScored: true,
  };
}

// ============================================================
// Report generation
// ============================================================

function buildReport(
  results: EvalCaseResult[],
  opts: { providerId?: string; model?: string },
): EvalReport {
  const passed = results.filter((r) => r.passed && !r.error);
  const failed = results.filter((r) => !r.passed && !r.error);
  const errors = results.filter((r) => r.error);

  const totalLatency = results.reduce((s, r) => s + (r.latencyMs || 0), 0);
  const totalTokens = results.reduce(
    (s, r) => s + (r.usage?.totalTokens || 0),
    0,
  );
  const validResults = results.filter((r) => r.score > 0 || r.passed);
  const avgScore =
    validResults.length > 0
      ? validResults.reduce((s, r) => s + r.score, 0) / validResults.length
      : 0;
  const manualDimCount = results.reduce(
    (s, r) => s + r.dimensionResults.filter((d) => !d.autoScored).length,
    0,
  );

  // Category aggregation
  const byCategory: Record<string, CategoryStat> = {};
  const byPriority: Record<string, CategoryStat> = {};

  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, passed: 0, avgScore: 0 };
    }
    byCategory[r.category].total++;
    if (r.passed) byCategory[r.category].passed++;

    if (!byPriority[r.priority]) {
      byPriority[r.priority] = { total: 0, passed: 0, avgScore: 0 };
    }
    byPriority[r.priority].total++;
    if (r.passed) byPriority[r.priority].passed++;
  }

  for (const cat of Object.keys(byCategory)) {
    const catResults = results.filter(
      (r) => r.category === cat && (r.score > 0 || r.passed),
    );
    byCategory[cat].avgScore =
      catResults.length > 0
        ? Math.round(
            (catResults.reduce((s, r) => s + r.score, 0) / catResults.length) *
              100,
          ) / 100
        : 0;
  }

  for (const pri of Object.keys(byPriority)) {
    const priResults = results.filter(
      (r) => r.priority === pri && (r.score > 0 || r.passed),
    );
    byPriority[pri].avgScore =
      priResults.length > 0
        ? Math.round(
            (priResults.reduce((s, r) => s + r.score, 0) / priResults.length) *
              100,
          ) / 100
        : 0;
  }

  return {
    config: {
      providerId: opts.providerId,
      model: opts.model,
      totalCases: results.length,
    },
    summary: {
      totalPassed: passed.length,
      totalFailed: failed.length,
      totalErrors: errors.length,
      passRate:
        results.length > 0
          ? Math.round((passed.length / results.length) * 100) / 100
          : 0,
      avgScore: Math.round(avgScore * 100) / 100,
      avgLatencyMs:
        results.length > 0 ? Math.round(totalLatency / results.length) : 0,
      totalTokens,
    },
    byCategory,
    byPriority,
    caseResults: results,
    manualDimCount,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================
// Report formatting
// ============================================================

/** Generate a plain-text report */
export function formatReportText(report: EvalReport): string {
  const lines: string[] = [];
  const { config, summary } = report;

  lines.push('='.repeat(60));
  lines.push('  AI 效果评估基准报告');
  lines.push('='.repeat(60));
  lines.push(`  生成时间: ${report.generatedAt}`);
  lines.push(`  供应商: ${config.providerId || '(未指定)'}`);
  lines.push(`  模型: ${config.model || '(未指定)'}`);
  lines.push(`  用例数: ${config.totalCases}`);
  lines.push('');

  lines.push('── 总览 ──');
  lines.push(
    `  通过: ${summary.totalPassed} | 失败: ${summary.totalFailed} | 错误: ${summary.totalErrors}`,
  );
  lines.push(`  通过率: ${(summary.passRate * 100).toFixed(1)}%`);
  lines.push(`  平均分: ${summary.avgScore.toFixed(2)}`);
  lines.push(`  平均延迟: ${summary.avgLatencyMs}ms`);
  lines.push(`  总 Token: ${summary.totalTokens}`);
  lines.push(`  需人工评估维度: ${report.manualDimCount}`);
  lines.push('');

  lines.push('── 按场景 ──');
  lines.push(
    `  ${'场景'.padEnd(16)} ${'总数'.padStart(4)} ${'通过'.padStart(4)} ${'均分'.padStart(6)}`,
  );
  const catNames: Record<string, string> = {
    'plugin-gen': '插件生成',
    'script-gen': '脚本生成',
    'kb-qa': '知识问答',
    'alarm-analysis': '告警分析',
    safety: '安全防护',
  };
  for (const [cat, stat] of Object.entries(report.byCategory)) {
    lines.push(
      `  ${(catNames[cat] || cat).padEnd(16)} ${String(stat.total).padStart(4)} ${String(stat.passed).padStart(4)} ${stat.avgScore.toFixed(2).padStart(6)}`,
    );
  }
  lines.push('');

  lines.push('── 按优先级 ──');
  for (const [pri, stat] of Object.entries(report.byPriority)) {
    lines.push(
      `  ${pri}: ${stat.passed}/${stat.total} 通过, 均分 ${stat.avgScore.toFixed(2)}`,
    );
  }
  lines.push('');

  lines.push('── 详细结果 ──');
  for (const r of report.caseResults) {
    const icon = r.error ? 'X' : r.passed ? 'P' : 'F';
    lines.push(
      `  [${icon}] [${r.category}] ${r.caseId}: ${r.caseName}`,
    );
    lines.push(
      `     得分: ${r.score.toFixed(2)}/${r.minScore}${r.latencyMs ? ` | ${r.latencyMs}ms` : ''}`,
    );
    if (r.error) {
      lines.push(`     错误: ${r.error}`);
    } else {
      for (const d of r.dimensionResults) {
        const flag = d.autoScored ? '' : ' [需人工]';
        lines.push(
          `     - ${d.name} (${d.method}, w=${d.weight}): ${d.score.toFixed(2)} ${d.details}${flag}`,
        );
      }
    }
  }

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('  注：标记 [需人工] 的维度需手动评估后更新报告');
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/** Generate a Markdown report */
export function formatReportMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  const { config, summary } = report;

  lines.push('# AI 效果评估基准报告');
  lines.push('');
  lines.push('| 项目 | 值 |');
  lines.push('|------|-----|');
  lines.push(`| 生成时间 | ${report.generatedAt} |`);
  lines.push(`| 供应商 | ${config.providerId || '(未指定)'} |`);
  lines.push(`| 模型 | ${config.model || '(未指定)'} |`);
  lines.push(`| 用例数 | ${config.totalCases} |`);
  lines.push(`| 通过率 | ${(summary.passRate * 100).toFixed(1)}% |`);
  lines.push(`| 平均分 | ${summary.avgScore.toFixed(2)} |`);
  lines.push(`| 平均延迟 | ${summary.avgLatencyMs}ms |`);
  lines.push(`| 总 Token | ${summary.totalTokens} |`);
  lines.push('');

  lines.push('## 场景统计');
  lines.push('');
  lines.push('| 场景 | 总数 | 通过 | 均分 |');
  lines.push('|------|------|------|------|');
  const catNames: Record<string, string> = {
    'plugin-gen': '插件生成',
    'script-gen': '脚本生成',
    'kb-qa': '知识问答',
    'alarm-analysis': '告警分析',
    safety: '安全防护',
  };
  for (const [cat, stat] of Object.entries(report.byCategory)) {
    lines.push(
      `| ${catNames[cat] || cat} | ${stat.total} | ${stat.passed} | ${stat.avgScore.toFixed(2)} |`,
    );
  }
  lines.push('');

  lines.push('## 按优先级');
  lines.push('');
  for (const [pri, stat] of Object.entries(report.byPriority)) {
    lines.push(
      `- **${pri}**: ${stat.passed}/${stat.total} 通过, 均分 ${stat.avgScore.toFixed(2)}`,
    );
  }
  lines.push('');

  lines.push('## 详细结果');
  lines.push('');
  for (const r of report.caseResults) {
    const icon = r.error ? '❌' : r.passed ? '✅' : '❌';
    lines.push(`### ${icon} ${r.caseId}: ${r.caseName}`);
    lines.push(
      `- **分类**: ${r.category} | **优先级**: ${r.priority}`,
    );
    lines.push(`- **得分**: ${r.score.toFixed(2)} / ${r.minScore}`);
    if (r.latencyMs) lines.push(`- **延迟**: ${r.latencyMs}ms`);
    if (r.usage) lines.push(`- **Token**: ${r.usage.totalTokens}`);
    if (r.error) {
      lines.push(`- **错误**: ${r.error}`);
    } else {
      lines.push('');
      for (const d of r.dimensionResults) {
        const flag = d.autoScored ? '' : ' 🔴需人工';
        lines.push(
          `  - \`${d.name}\` (${d.method}, w=${d.weight}): **${d.score.toFixed(2)}** ${d.details}${flag}`,
        );
      }
    }
    lines.push('');
  }

  if (report.manualDimCount > 0) {
    lines.push('---');
    lines.push(
      `> 注：共 ${report.manualDimCount} 个维度需人工评估后更新报告`,
    );
  }

  return lines.join('\n');
}

// ============================================================
// Model comparison matrix
// ============================================================

export interface ModelComparisonEntry {
  providerId: string;
  model: string;
  passRate: number;
  avgScore: number;
  avgLatencyMs: number;
  totalTokens: number;
}

/** Build a model comparison matrix from multiple reports */
export function buildComparisonMatrix(reports: EvalReport[]): ModelComparisonEntry[] {
  return reports.map((r) => ({
    providerId: r.config.providerId || 'unknown',
    model: r.config.model || 'unknown',
    passRate: r.summary.passRate,
    avgScore: r.summary.avgScore,
    avgLatencyMs: r.summary.avgLatencyMs,
    totalTokens: r.summary.totalTokens,
  }));
}

/** Format the model comparison matrix (text) */
export function formatComparisonMatrix(entries: ModelComparisonEntry[]): string {
  if (entries.length === 0) return '无对比数据';

  const lines: string[] = [];
  lines.push('模型对比矩阵');
  lines.push('='.repeat(85));
  lines.push(
    `${'供应商'.padEnd(16)} ${'模型'.padEnd(22)} ${'通过率'.padStart(8)} ${'均分'.padStart(6)} ${'延迟'.padStart(8)} ${'Token'.padStart(8)}`,
  );
  lines.push('-'.repeat(85));
  for (const e of entries) {
    lines.push(
      `${e.providerId.padEnd(16)} ${e.model.padEnd(22)} ${(e.passRate * 100).toFixed(1).padStart(7)}% ${e.avgScore.toFixed(2).padStart(6)} ${String(e.avgLatencyMs).padStart(7)}ms ${String(e.totalTokens).padStart(8)}`,
    );
  }
  lines.push('='.repeat(85));
  return lines.join('\n');
}

/** Format the model comparison matrix (Markdown) */
export function formatComparisonMarkdown(entries: ModelComparisonEntry[]): string {
  if (entries.length === 0) return '无对比数据';

  const lines: string[] = [];
  lines.push('## 模型对比矩阵');
  lines.push('');
  lines.push('| 供应商 | 模型 | 通过率 | 均分 | 延迟 | Token |');
  lines.push('|--------|------|--------|------|------|-------|');
  for (const e of entries) {
    lines.push(
      `| ${e.providerId} | ${e.model} | ${(e.passRate * 100).toFixed(1)}% | ${e.avgScore.toFixed(2)} | ${e.avgLatencyMs}ms | ${e.totalTokens} |`,
    );
  }
  return lines.join('\n');
}

// ============================================================
// Utilities
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
