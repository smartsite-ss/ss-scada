// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Data query type definitions
 * Aligned with the backend ss-storage DataQueryController
 */

/** Historical data query parameters */
export interface HistoryQueryParams {
  /** Tag ID list */
  tagIds?: string[];
  /** Start time */
  startTime?: Date;
  /** End time */
  endTime?: Date;
  /** Result limit */
  limit?: number;
  /** Offset */
  offset?: number;
  /** Sort order */
  order?: 'asc' | 'desc';
  /** Aggregation configuration */
  aggregation?: {
    function: 'avg' | 'max' | 'min' | 'sum' | 'count';
    interval?: string;
  };
}

/** Data point */
export interface DataPoint {
  tagId: string;
  value: number | string | boolean | null;
  timestamp: string;
  quality?: string;
}

/** Aggregated data point */
export interface AggregatedPoint {
  tagId: string;
  value: number;
  timestamp: string;
  count?: number;
}

/** Aggregation query parameters */
export interface AggregatedQueryParams {
  tagIds: string[];
  startTime: Date;
  endTime: Date;
  function: 'avg' | 'max' | 'min' | 'sum' | 'count';
  interval?: string;
}
