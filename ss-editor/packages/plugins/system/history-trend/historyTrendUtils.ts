// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ChartTagBinding, TrendSeriesStyle } from '@scada-editor/shared';

// Types and default styles are uniformly provided by the shared chart base; re-exported here to keep the external API compatible
export type { TrendSeriesStyle };
/** A single bound tag variable (always includes projectId, aligned with ChartTagBinding) */
export type HistoryTrendTagBinding = ChartTagBinding;
export { DEFAULT_TREND_COLORS, createDefaultSeriesStyle } from '@scada-editor/shared';
