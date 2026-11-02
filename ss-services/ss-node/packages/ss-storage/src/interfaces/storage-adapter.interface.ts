// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export interface DataPoint {
  tagId: string;
  deviceId: string;
  projectId: string;
  value: number | string | boolean;
  timestamp: Date;
  quality: number; // 0-100
  metadata?: Record<string, any>;
}

export interface QueryOptions {
  tagIds?: string[];
  deviceIds?: string[];
  /** Multi-project isolation routing: when specified, queries the project isolation unit (bucket / database); otherwise uses the default isolation unit */
  projectId?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  aggregation?: {
    function: 'avg' | 'max' | 'min' | 'sum' | 'count';
    interval?: string; // '1m', '5m', '1h', '1d'
  };
  /** Interpolation method: aligned with the upper-layer InterpolationType (raw=skip empty windows / linear=linear / step=hold previous value) */
  interpolation?: 'raw' | 'linear' | 'step';
}

export interface WriteResult {
  success: boolean;
  written: number;
  failed: number;
  errors?: Error[];
}

/**
 * Adapter capability declaration: upper layers (data-query.service / reports / trend API) degrade accordingly before calling,
 * avoiding discovering the lack of support at runtime (e.g. InfluxDB 3 Core has no compactor and cannot delete).
 */
export interface AdapterCapabilities {
  /** Whether delete() is supported; InfluxDB 3 Core = false (no compactor) */
  delete: boolean;
  /** Whether interpolation is natively supported; when false the upper layer falls back to application-layer interpolation or raw */
  interpolation: boolean;
  /** Whether server-side aggregation is supported; when false the upper layer fetches raw points and aggregates locally */
  aggregation: boolean;
}

export interface StorageAdapter {
  readonly name: string;
  /** Engine type identifier ('influxdb2' / 'influxdb3' / 'tdengine' / ...), used for configuration and observability */
  readonly engineType: string;
  /** Capability declaration; upper layers degrade by capability (delete/interpolation/aggregation) */
  readonly capabilities: AdapterCapabilities;
  write(points: DataPoint[]): Promise<WriteResult>;
  read(options: QueryOptions): Promise<DataPoint[]>;
  delete(options: { tagIds?: string[]; before?: Date }): Promise<number>;
  health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }>;
  close(): Promise<void>;
}

/**
 * Capability-not-supported error: for capabilities declared false in capabilities,
 * the adapter throws this error directly in the corresponding method; upper layers should check capabilities and degrade before calling.
 */
export class NotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSupportedError';
  }
}
