// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI evaluation — P1-T10
 *
 * Evaluation framework: 50+ benchmark cases + auto scoring + report generation + model comparison matrix
 */

export {
  EVAL_CASES,
  EVAL_STATS,
} from './eval-cases';
export type {
  EvalCase,
  EvalDimension,
  EvalStructureCheck,
} from './eval-cases';

export {
  runEvaluation,
  formatReportText,
  formatReportMarkdown,
  buildComparisonMatrix,
  formatComparisonMatrix,
  formatComparisonMarkdown,
} from './eval-runner';
export type {
  EvalRunConfig,
  EvalAIResponse,
  EvalCaseResult,
  EvalDimensionResult,
  EvalReport,
  EvalSummary,
  CategoryStat,
  ModelComparisonEntry,
} from './eval-runner';
