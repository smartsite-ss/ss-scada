// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/** Trend style for a single variable; fields aligned with the reference component LineCommon/config.vue */
export interface TrendSeriesStyle {
  lineStyle: {
    /** Line width */
    width: number;
    /** Line type: solid / dashed / dotted */
    type: 'solid' | 'dashed' | 'dotted';
    /** Line color (variable's primary color) */
    color: string;
  };
  /** Solid point size (px; 0 means hidden) */
  symbolSize: number;
  /** Data label */
  label: {
    show: boolean;
    fontSize: number;
    color: string;
    /** Label position */
    position: 'top' | 'left' | 'right' | 'bottom';
  };
  /** Area fill */
  areaStyle: {
    show: boolean;
    /** Three-stop gradient (start / middle / end) */
    colorStops: Array<{ offset: number; color: string }>;
    /** Opacity 0~1 */
    opacity: number;
  };
}

/** A bound tag variable + its trend style (shared by tag-trend and history-trend) */
export interface ChartTagBinding {
  /** Owning project ID (required to locate the InfluxDB bucket for history queries) */
  projectId: string;
  /** Device UUID primary key */
  deviceId: string;
  /** Device code (human-readable, for display) */
  deviceCode: string;
  /** Device name (for display) */
  deviceName: string;
  /** Tag ID (unique identifier for subscription / query) */
  tagId: string;
  /** Tag name (for display) */
  tagName: string;
  /** Tag data type */
  dataType: string;
  /** Per-variable trend style */
  style: TrendSeriesStyle;
}

/** A bound tag variable (without trend style; for variable charts like gauge/bar/pie/radar/waterpolo/progress) */
export interface ChartVariableBinding {
  /** Owning project ID (required to locate the InfluxDB bucket for history queries) */
  projectId: string;
  /** Device UUID primary key */
  deviceId: string;
  /** Device code (human-readable, for display) */
  deviceCode: string;
  /** Device name (for display) */
  deviceName: string;
  /** Tag ID (unique identifier for subscription / query) */
  tagId: string;
  /** Tag name (for display) */
  tagName: string;
  /** Tag data type */
  dataType: string;
}

/** Chart container style input (background/border/radius/shadow; aligned with tag-trend / history-trend) */
export interface ChartContainerStyleInput {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: string;
  borderRadius: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
}
