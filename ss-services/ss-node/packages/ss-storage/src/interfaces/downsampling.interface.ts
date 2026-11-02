// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Downsampling feature injection token, used to optionally inject the InfluxDB adapter instance.
 * When the InfluxDB adapter is registered in the DI container, DownsamplingService can obtain it via this token.
 */
export const INFLUXDB_ADAPTER = 'INFLUXDB_ADAPTER';

/**
 * Downsampling aggregation function type.
 * - mean: average value
 * - max: maximum value
 * - min: minimum value
 * - last: last value
 */
export type DownsamplingAggregation = 'mean' | 'max' | 'min' | 'last';

/**
 * Downsampling granularity type.
 * - 1h: aggregated by hour
 * - 1d: aggregated by day
 */
export type DownsamplingGranularity = '1h' | '1d';

/**
 * A single downsampling task configuration.
 */
export interface DownsamplingTask {
  /** Source measurement name, e.g. "tag_values" */
  measurement: string;
  /** Aggregation window granularity, e.g. '1h', '1d', '7d' */
  granularity: string;
  /** Aggregation function */
  aggregation: DownsamplingAggregation;
  /** Target measurement retention days (0 means retain forever) */
  retentionDays: number;
  /** Target measurement name the downsampling results are written to, e.g. "tag_values_1h" */
  targetMeasurement: string;
}

/**
 * Overall downsampling configuration.
 */
export interface DownsamplingConfig {
  /** Whether downsampling is enabled */
  enabled: boolean;
  /** Downsampling task list */
  tasks: DownsamplingTask[];
}

/**
 * Downsampling execution result.
 */
export interface DownsamplingResult {
  /** Source measurement */
  measurement: string;
  /** Target measurement */
  targetMeasurement: string;
  /** Aggregation granularity */
  granularity: string;
  /** Number of data points processed */
  processedCount: number;
  /** Number of data points written */
  writtenCount: number;
  /** Execution duration (milliseconds) */
  duration: number;
  /** Whether it succeeded */
  success: boolean;
  /** Error message (on failure) */
  error?: string;
}
