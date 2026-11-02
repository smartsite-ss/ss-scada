// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Pipeline metrics type definitions
 * Aligned with the backend ss-core/src/pipeline
 */

/** Pipeline metrics snapshot (JSON format) */
export interface PipelineMetricsSnapshot {
  /** Total pipeline executions */
  pipeline_executions_total: number;
  /** Successful pipeline executions */
  pipeline_executions_success: number;
  /** Failed pipeline executions */
  pipeline_executions_error: number;
  /** Duration of the most recent pipeline execution (ms) */
  pipeline_duration_ms: number;
  /** Current pipeline queue depth */
  pipeline_queue_depth: number;
  /** Current active task count */
  pipeline_active_tasks: number;
  /** Duration of the most recent execution per step (ms) */
  step_duration_ms: Record<string, number>;
  /** Cumulative error count per step */
  step_error_count: Record<string, number>;
  /** Total protocol read count */
  protocol_read_total: number;
  /** Protocol read error count */
  protocol_read_errors: number;
  /** Total deadband filter count */
  deadband_filtered_total: number;
  /** Cache hit count */
  cache_hit_total: number;
  /** Cache miss count */
  cache_miss_total: number;
  /** Total persistence write count */
  persist_write_total: number;
  /** Persistence write error count */
  persist_write_errors: number;
}

/** Single-step duration record (for the flame graph) */
export interface StepTimingRecord {
  stepName: string;
  durationMs: number;
  timestamp: number;
  isError: boolean;
  tagId: string;
  deviceId: string;
}

/** Pipeline overall duration breakdown */
export interface PipelineTimingBreakdown {
  pipelineTotalMs: number;
  steps: StepTimingRecord[];
  tagId: string;
  deviceId: string;
  timestamp: number;
}

/** Step duration statistics (including P50/P95/P99) */
export interface StepTimingStats {
  stepName: string;
  order: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  totalCalls: number;
  errorCount: number;
  errorRate: number;
}

/** Metrics by protocol dimension (aligned with the backend ProtocolMetrics) */
export interface ProtocolMetrics {
  totalReads: number;
  totalErrors: number;
  totalConnections: number;
  activeConnections: number;
  avgResponseTime: number;
  lastActivity: Date | null;
}

/** Protocol list item (for the filter dropdown) */
export interface ProtocolSummary {
  protocol: string;
  totalReads: number;
  activeConnections: number;
  lastActivity: Date | null;
}
