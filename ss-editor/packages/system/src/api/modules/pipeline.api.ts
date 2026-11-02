// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';
import type {
  PipelineMetricsSnapshot,
  PipelineTimingBreakdown,
  StepTimingStats,
  ProtocolMetrics,
  ProtocolSummary,
} from '../types/pipeline';

/**
 * Pipeline metrics API
 *
 * Backend endpoints (provided by PipelineMetricsController):
 * - GET /api/v1/pipeline/metrics                    — Prometheus text format
 * - GET /api/v1/pipeline/metrics/json               — JSON snapshot (global aggregation)
 * - GET /api/v1/pipeline/metrics/percentiles        — P50/P95/P99 latency statistics
 * - GET /api/v1/pipeline/metrics/breakdowns         — duration breakdown (flame-graph data)
 * - GET /api/v1/pipeline/metrics/diagnostic         — diagnostics
 * - GET /api/v1/pipeline/metrics/protocols          — protocols with metric data
 * - GET /api/v1/pipeline/metrics/protocol?protocol= — metrics by protocol
 */
export const pipelineApi = {
  /** Get metrics in Prometheus text format */
  getPrometheusMetrics(): Promise<string> {
    return client
      .get('/pipeline/metrics', { responseType: 'text', transformResponse: (x) => x })
      .then((res) => res.data as string);
  },

  /** Get the metrics snapshot in JSON format */
  getJsonMetrics(): Promise<ApiResponse<PipelineMetricsSnapshot>> {
    return client.get('/pipeline/metrics/json').then((res) => res.data);
  },

  /** Get per-step duration statistics (P50/P95/P99) */
  getPercentiles(): Promise<ApiResponse<StepTimingStats[]>> {
    return client.get('/pipeline/metrics/percentiles').then((res) => res.data);
  },

  /** Get the duration breakdown of the last N pipeline runs (flame-graph data) */
  getBreakdowns(limit?: number): Promise<ApiResponse<PipelineTimingBreakdown[]>> {
    const params = limit !== undefined ? { limit } : undefined;
    return client.get('/pipeline/metrics/breakdowns', { params }).then((res) => res.data);
  },

  /**
     * Get diagnostic info (used to troubleshoot missing pipeline metric data).
     * Returns the orchestrator internal state, the scheduler task list, and automatic diagnostic conclusions.
     */
  getDiagnostic(): Promise<ApiResponse<any>> {
    return client.get('/pipeline/metrics/diagnostic').then((res) => res.data);
  },

  /** Get the list of protocols with metric data */
  getProtocols(): Promise<ApiResponse<ProtocolSummary[]>> {
    return client.get('/pipeline/metrics/protocols').then((res) => res.data);
  },

  /** Get metric details by protocol */
  getProtocolMetrics(protocol: string): Promise<ApiResponse<ProtocolMetrics>> {
    return client.get('/pipeline/metrics/protocol', { params: { protocol } }).then((res) => res.data);
  },
};
