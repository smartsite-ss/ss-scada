// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Alarm statistics type definitions
 * Aligned with the backend ss-alarm AlarmStatisticsService
 */

/** Statistics by severity level */
export interface LevelStatistics {
  level: string;
  count: number;
}

/** Statistics by device */
export interface DeviceStatistics {
  deviceId: string;
  count: number;
}

/** Time-series data point */
export interface TimeSeriesPoint {
  time: string;
  count: number;
}

/** Trend analysis */
export interface TrendAnalysis {
  currentPeriod: { startDate: string; endDate: string; count: number };
  previousPeriod: { startDate: string; endDate: string; count: number };
  change: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
}

/** Most frequent alarms */
export interface TopAlarm {
  ruleName: string;
  message: string;
  count: number;
  level: string;
}

/** Response time statistics */
export interface ResponseTimeStats {
  average: number;
  median: number;
  max: number;
  min: number;
  totalSamples: number;
}

/** Alarm combined summary */
export interface AlarmSummary {
  projectId: string;
  totalAlarms: number;
  byLevel: Record<string, number>;
  byDevice: Record<string, number>;
  trend: TrendAnalysis;
}
