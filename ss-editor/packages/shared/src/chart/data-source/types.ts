// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ChartVariableBinding } from '../types';

/** Data source loading state */
export type ChartDataSourceState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/**
 * Unified output model for data source fetch results.
 * The three data source types (static / api / database) normalize their results
 * into this structure, hiding the source differences.
 *
 * Conventions:
 * - static / api / database(aggregate) use `source` as the primary output (with dimensions referencing columns);
 * - database(series / latest) use `series` as the primary output (time-series [time, value] or single values).
 */
export interface ChartDataResult {
  /** Dimensions (column names; aligned with ECharts dataset.dimensions) */
  dimensions: string[];
  /** Data rows (aligned with ECharts dataset.source) */
  source: Array<Record<string, unknown>>;
  /** Series-level data (time-series / latest values; used directly by series.data) */
  series?: Array<{
    tagId: string;
    name: string;
    /** Time-series: [time, value]; latest: single element */
    data: Array<[number, number]> | Array<number>;
  }>;
  /** Loading state */
  state: ChartDataSourceState;
  /** Error message (when state === 'error') */
  error?: string;
}

/** Data source type: determines component category (static/api → chart; database → system) */
export type ChartDataSourceType = 'static' | 'api' | 'database';

/** Database data source sub-mode */
export type DatabaseSourceMode = 'series' | 'latest' | 'aggregate';

/**
 * Chart data source abstraction interface (lifecycle).
 * The data source is only responsible for "fetching + normalizing";
 * the Graphic is only responsible for "reading ChartDataResult to build the ECharts option".
 */
export interface ChartDataSource {
  readonly type: ChartDataSourceType;

  /** One-shot fetch (history / static / API first load) */
  load(): Promise<ChartDataResult>;

  /** Subscribe to realtime (database series/latest mode; static/api default to no-op) */
  subscribe(): void;

  /** Unsubscribe + clean up resources */
  unsubscribe(): void;

  /** Realtime data change listener (WS batch refresh / polling); returns an unsubscribe function */
  onChange(listener: (result: ChartDataResult) => void): () => void;
}

/** Static data source config */
export interface StaticSourceConfig {
  /** Dimension definitions */
  dimensions: string[];
  /** Data rows (aligned with ECharts dataset.source) */
  source: Array<Record<string, unknown>>;
}

/** API data source response → dataset field mapping */
export interface ApiMappingConfig {
  /** Dimension column names */
  dimensions: string[];
  /** Category / dimension value field */
  categoryField: string;
  /** Value field */
  valueField: string;
}

/** API data source config */
export interface ApiSourceConfig {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: 'GET' | 'POST';
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (POST) */
  body?: Record<string, unknown>;
  /** Response data path (e.g. 'data.list', supports dot-path for nested access) */
  dataPath?: string;
  /** Polling interval (ms; 0 means no polling) */
  pollingInterval?: number;
  /** Timeout (ms) */
  timeout?: number;
  /** Failed-retry count */
  retryCount?: number;
  /** Response → dataset field mapping */
  mapping: ApiMappingConfig;
}

/** Database (variable-related) data source config */
export interface DatabaseSourceConfig {
  /** Data mode */
  mode: DatabaseSourceMode;
  /** Bound tag variables */
  tags: ChartVariableBinding[];
  /** series mode: time-series query params */
  seriesConfig?: {
    startTime?: string;
    endTime?: string;
    maxPoints?: number;
    /** Interpolation method: raw / linear / step */
    interpolation?: 'raw' | 'linear' | 'step';
    /** Interpolation interval (ms) */
    interval?: number;
    /** Whether to subscribe to WS realtime */
    realtime?: boolean;
  };
  /** aggregate mode: aggregation params */
  aggregateConfig?: {
    function: 'avg' | 'max' | 'min' | 'sum' | 'count';
    interval?: string;
  };
}

/** Unified chart data source config (written to component customProps.dataSource) */
export interface ChartDataSourceConfig {
  /** Data source type (determines component category) */
  type: ChartDataSourceType;
  /** Static data source config */
  staticConfig?: StaticSourceConfig;
  /** API data source config */
  apiConfig?: ApiSourceConfig;
  /** Database (variable-related) data source config */
  databaseConfig?: DatabaseSourceConfig;
}
