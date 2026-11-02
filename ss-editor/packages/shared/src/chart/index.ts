// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export type { TrendSeriesStyle, ChartTagBinding, ChartVariableBinding, ChartContainerStyleInput } from './types';
export { DEFAULT_TREND_COLORS, createDefaultSeriesStyle } from './trend';
export { formatNumber } from './format';
export { registerChartModules } from './echarts';
export { buildContainerStyle } from './container';
export { buildTrendChartOption, type TrendChartOptionInput } from './option';

// Data source abstraction (static / api / database)
export * from './data-source';

// Categorical chart option builders (bar / pie / radar / gauge)
export {
  buildBarChartOption,
  buildPieChartOption,
  buildRadarChartOption,
  latestSeriesToCategoryResult,
  type CategoryChartOptionInput,
} from './option-categorical';
export { buildGaugeChartOption, type GaugeChartOptionInput } from './option-gauge';

// Data source lifecycle composable (reused by Vue SFC Graphics)
export { useChartSource, type ChartSourceDeps } from './useChartSource';
