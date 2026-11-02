// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { use } from 'echarts/core';
import {
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  ScatterChart,
  RadarChart,
  FunnelChart,
  HeatmapChart,
  TreemapChart,
  SankeyChart,
  GraphChart,
} from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DataZoomComponent,
  VisualMapComponent,
  GeoComponent,
  DatasetComponent,
  TransformComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

let registered = false;

/**
 * Register ECharts chart types and components centrally (on-demand imports).
 * Shared by tag-trend / history-trend and later chart/tag components,
 * avoiding each Graphic calling use() separately and causing duplication.
 */
export function registerChartModules(): void {
  if (registered) return;
  use([
    // Chart types
    BarChart,
    LineChart,
    PieChart,
    GaugeChart,
    ScatterChart,
    RadarChart,
    FunnelChart,
    HeatmapChart,
    TreemapChart,
    SankeyChart,
    GraphChart,
    // Components
    TitleComponent,
    TooltipComponent,
    LegendComponent,
    GridComponent,
    DataZoomComponent,
    VisualMapComponent,
    GeoComponent,
    DatasetComponent,
    TransformComponent,
    // Renderer
    CanvasRenderer,
  ]);
  registered = true;
}
