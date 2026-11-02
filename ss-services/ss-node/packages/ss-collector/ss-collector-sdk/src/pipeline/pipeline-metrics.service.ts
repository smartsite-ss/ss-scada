// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';

export interface PipelineMetricsSnapshot {
  pipeline_executions_total: number;
  pipeline_executions_success: number;
  pipeline_executions_error: number;
  pipeline_duration_ms: number;
  pipeline_queue_depth: number;
  pipeline_active_tasks: number;
  step_duration_ms: Record<string, number>;
  step_error_count: Record<string, number>;
  protocol_read_total: number;
  protocol_read_errors: number;
  deadband_filtered_total: number;
  cache_hit_total: number;
  cache_miss_total: number;
  persist_write_total: number;
  persist_write_errors: number;
}

/** Metric entry per protocol dimension */
interface ProtocolMetricsEntry {
  totalReads: number;
  totalErrors: number;
  totalConnections: number;
  /** Recent N read durations (ms), used to compute the average response time */
  recentDurations: number[];
  /** Active-device set per protocol (deviceId -> last-active timestamp ms) */
  activeDevices: Map<string, number>;
  lastActivity: number | null;
}

/** Externally-exposed metrics per protocol (aligned with PluginMetrics) */
export interface ProtocolMetrics {
  totalReads: number;
  totalErrors: number;
  totalConnections: number;
  activeConnections: number;
  avgResponseTime: number;
  lastActivity: Date | null;
}

/**
 * Pipeline-level Prometheus metric collection service.
 * Uses pure in-memory counters, no external dependency; exposed via API endpoints.
 */
@Injectable()
export class PipelineMetricsService {
  private readonly logger = new Logger(PipelineMetricsService.name);

  // --- Global counters ---
  private pipelineExecutionsTotal = 0;
  private pipelineExecutionsSuccess = 0;
  private pipelineExecutionsError = 0;

  // --- Histogram / gauge ---
  private pipelineDurationMs = 0;

  // --- Gauge ---
  private pipelineQueueDepth = 0;
  private pipelineActiveTasks = 0;

  // --- Per-step dimension ---
  private stepDurationMs = new Map<string, number>();
  private stepErrorCount = new Map<string, number>();

  // --- Protocol reads ---
  private protocolReadTotal = 0;
  private protocolReadErrors = 0;

  // --- Deadband filtering ---
  private deadbandFilteredTotal = 0;

  // --- Cache ---
  private cacheHitTotal = 0;
  private cacheMissTotal = 0;

  // --- Persistence ---
  private persistWriteTotal = 0;
  private persistWriteErrors = 0;

  // --- Per-protocol dimension ---
  private protocolMetrics = new Map<string, ProtocolMetricsEntry>();
  /** Active-device window: a device read within the last 5 minutes is considered active */
  private readonly ACTIVE_DEVICE_WINDOW_MS = 5 * 60 * 1000;
  /** Keep the recent N read durations for averaging */
  private readonly MAX_RECENT_DURATIONS = 100;

  // ═══════════════════════════════════════════════════════════════
  // Recording methods
  // ═══════════════════════════════════════════════════════════════

  /** Record one Pipeline execution result */
  recordExecution(success: boolean, durationMs: number): void {
    this.pipelineExecutionsTotal++;
    if (success) {
      this.pipelineExecutionsSuccess++;
    } else {
      this.pipelineExecutionsError++;
    }
    this.pipelineDurationMs = durationMs;
  }

  /** Set the current queue depth */
  setQueueDepth(depth: number): void {
    this.pipelineQueueDepth = depth;
  }

  /** Set the current active task count */
  setActiveTasks(count: number): void {
    this.pipelineActiveTasks = count;
  }

  /** Record a step's execution duration */
  recordStepDuration(step: string, durationMs: number): void {
    this.stepDurationMs.set(step, durationMs);
  }

  /** Record a step's error */
  recordStepError(step: string): void {
    const current = this.stepErrorCount.get(step) || 0;
    this.stepErrorCount.set(step, current + 1);
  }

  /** Record one protocol read */
  recordProtocolRead(success: boolean): void {
    this.protocolReadTotal++;
    if (!success) {
      this.protocolReadErrors++;
    }
  }

  /** Record one deadband filter */
  recordDeadband(): void {
    this.deadbandFilteredTotal++;
  }

  /** Record one cache hit */
  recordCacheHit(): void {
    this.cacheHitTotal++;
  }

  /** Record one cache miss */
  recordCacheMiss(): void {
    this.cacheMissTotal++;
  }

  /** Record one persistence write */
  recordPersistWrite(success: boolean): void {
    this.persistWriteTotal++;
    if (!success) {
      this.persistWriteErrors++;
    }
  }

  // ── Per-protocol dimension ──────────────────────────────────────────────

  /**
   * Record one protocol-scoped read (called after PipelineOrchestrator.execute completes)
   *
   * @param protocol device protocol (deviceType)
   * @param success  whether this pipeline execution succeeded
   * @param durationMs duration of this pipeline execution
   * @param deviceId  optional, device ID (used to count active connections)
   */
  recordProtocolReadDetailed(
    protocol: string,
    success: boolean,
    durationMs: number,
    deviceId?: string,
  ): void {
    if (!protocol) return;
    const entry = this.getOrCreateProtocolEntry(protocol);
    entry.totalReads++;
    if (!success) {
      entry.totalErrors++;
    }
    // Maintain a ring buffer of the recent N durations
    entry.recentDurations.push(durationMs);
    if (entry.recentDurations.length > this.MAX_RECENT_DURATIONS) {
      entry.recentDurations.shift();
    }
    // Active-device tracking
    if (deviceId) {
      const now = Date.now();
      const isNew = !entry.activeDevices.has(deviceId);
      entry.activeDevices.set(deviceId, now);
      if (isNew) {
        entry.totalConnections++;
      }
    }
    entry.lastActivity = Date.now();
  }

  /** Get the aggregated metrics for a given protocol (merged into plugin cards by PluginManagerService) */
  getProtocolMetrics(protocol: string): ProtocolMetrics | null {
    const entry = this.protocolMetrics.get(protocol);
    if (!entry) return null;
    return this.computeProtocolMetrics(entry);
  }

  /** Get aggregated metrics for all protocols */
  getAllProtocolMetrics(): Record<string, ProtocolMetrics> {
    const result: Record<string, ProtocolMetrics> = {};
    for (const [protocol, entry] of this.protocolMetrics) {
      result[protocol] = this.computeProtocolMetrics(entry);
    }
    return result;
  }

  private getOrCreateProtocolEntry(protocol: string): ProtocolMetricsEntry {
    let entry = this.protocolMetrics.get(protocol);
    if (!entry) {
      entry = {
        totalReads: 0,
        totalErrors: 0,
        totalConnections: 0,
        recentDurations: [],
        activeDevices: new Map(),
        lastActivity: null,
      };
      this.protocolMetrics.set(protocol, entry);
    }
    return entry;
  }

  private computeProtocolMetrics(entry: ProtocolMetricsEntry): ProtocolMetrics {
    const now = Date.now();
    // Evict devices outside the window and count active connections
    let activeConnections = 0;
    for (const [deviceId, lastSeen] of entry.activeDevices) {
      if (now - lastSeen < this.ACTIVE_DEVICE_WINDOW_MS) {
        activeConnections++;
      } else {
        entry.activeDevices.delete(deviceId);
      }
    }
    // Compute the average response time
    const avgResponseTime =
      entry.recentDurations.length > 0
        ? Math.round(
            entry.recentDurations.reduce((a, b) => a + b, 0) / entry.recentDurations.length,
          )
        : 0;
    return {
      totalReads: entry.totalReads,
      totalErrors: entry.totalErrors,
      totalConnections: entry.totalConnections,
      activeConnections,
      avgResponseTime,
      lastActivity: entry.lastActivity ? new Date(entry.lastActivity) : null,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Export methods
  // ═══════════════════════════════════════════════════════════════

  /** Return the current metric snapshot (JSON format) */
  getMetricsSnapshot(): PipelineMetricsSnapshot {
    return {
      pipeline_executions_total: this.pipelineExecutionsTotal,
      pipeline_executions_success: this.pipelineExecutionsSuccess,
      pipeline_executions_error: this.pipelineExecutionsError,
      pipeline_duration_ms: this.pipelineDurationMs,
      pipeline_queue_depth: this.pipelineQueueDepth,
      pipeline_active_tasks: this.pipelineActiveTasks,
      step_duration_ms: Object.fromEntries(this.stepDurationMs),
      step_error_count: Object.fromEntries(this.stepErrorCount),
      protocol_read_total: this.protocolReadTotal,
      protocol_read_errors: this.protocolReadErrors,
      deadband_filtered_total: this.deadbandFilteredTotal,
      cache_hit_total: this.cacheHitTotal,
      cache_miss_total: this.cacheMissTotal,
      persist_write_total: this.persistWriteTotal,
      persist_write_errors: this.persistWriteErrors,
    };
  }

  /** Return metrics in Prometheus text format */
  getMetrics(): string {
    const lines: string[] = [];

    // pipeline_executions_total
    lines.push('# HELP pipeline_executions_total Total pipeline executions');
    lines.push('# TYPE pipeline_executions_total counter');
    lines.push(`pipeline_executions_total ${this.pipelineExecutionsTotal}`);
    lines.push('');

    // pipeline_executions_success
    lines.push('# HELP pipeline_executions_success Successful pipeline executions');
    lines.push('# TYPE pipeline_executions_success counter');
    lines.push(`pipeline_executions_success ${this.pipelineExecutionsSuccess}`);
    lines.push('');

    // pipeline_executions_error
    lines.push('# HELP pipeline_executions_error Failed pipeline executions');
    lines.push('# TYPE pipeline_executions_error counter');
    lines.push(`pipeline_executions_error ${this.pipelineExecutionsError}`);
    lines.push('');

    // pipeline_duration_ms
    lines.push('# HELP pipeline_duration_ms Pipeline execution duration in milliseconds');
    lines.push('# TYPE pipeline_duration_ms gauge');
    lines.push(`pipeline_duration_ms ${this.pipelineDurationMs}`);
    lines.push('');

    // pipeline_queue_depth
    lines.push('# HELP pipeline_queue_depth Current pipeline queue depth');
    lines.push('# TYPE pipeline_queue_depth gauge');
    lines.push(`pipeline_queue_depth ${this.pipelineQueueDepth}`);
    lines.push('');

    // pipeline_active_tasks
    lines.push('# HELP pipeline_active_tasks Currently active pipeline tasks');
    lines.push('# TYPE pipeline_active_tasks gauge');
    lines.push(`pipeline_active_tasks ${this.pipelineActiveTasks}`);
    lines.push('');

    // step_duration_ms
    lines.push('# HELP step_duration_ms Per-step execution duration in milliseconds');
    lines.push('# TYPE step_duration_ms gauge');
    for (const [step, duration] of this.stepDurationMs) {
      lines.push(`step_duration_ms{step="${step}"} ${duration}`);
    }
    lines.push('');

    // step_error_count
    lines.push('# HELP step_error_count Per-step error count');
    lines.push('# TYPE step_error_count counter');
    for (const [step, count] of this.stepErrorCount) {
      lines.push(`step_error_count{step="${step}"} ${count}`);
    }
    lines.push('');

    // protocol_read_total
    lines.push('# HELP protocol_read_total Total protocol reads');
    lines.push('# TYPE protocol_read_total counter');
    lines.push(`protocol_read_total ${this.protocolReadTotal}`);
    lines.push('');

    // protocol_read_errors
    lines.push('# HELP protocol_read_errors Protocol read errors');
    lines.push('# TYPE protocol_read_errors counter');
    lines.push(`protocol_read_errors ${this.protocolReadErrors}`);
    lines.push('');

    // deadband_filtered_total
    lines.push('# HELP deadband_filtered_total Deadband filtered count');
    lines.push('# TYPE deadband_filtered_total counter');
    lines.push(`deadband_filtered_total ${this.deadbandFilteredTotal}`);
    lines.push('');

    // cache_hit_total
    lines.push('# HELP cache_hit_total Cache hits');
    lines.push('# TYPE cache_hit_total counter');
    lines.push(`cache_hit_total ${this.cacheHitTotal}`);
    lines.push('');

    // cache_miss_total
    lines.push('# HELP cache_miss_total Cache misses');
    lines.push('# TYPE cache_miss_total counter');
    lines.push(`cache_miss_total ${this.cacheMissTotal}`);
    lines.push('');

    // persist_write_total
    lines.push('# HELP persist_write_total Persist writes');
    lines.push('# TYPE persist_write_total counter');
    lines.push(`persist_write_total ${this.persistWriteTotal}`);
    lines.push('');

    // persist_write_errors
    lines.push('# HELP persist_write_errors Persist write errors');
    lines.push('# TYPE persist_write_errors counter');
    lines.push(`persist_write_errors ${this.persistWriteErrors}`);
    lines.push('');

    return lines.join('\n');
  }

  /** Reset all metrics (mainly for tests) */
  reset(): void {
    this.pipelineExecutionsTotal = 0;
    this.pipelineExecutionsSuccess = 0;
    this.pipelineExecutionsError = 0;
    this.pipelineDurationMs = 0;
    this.pipelineQueueDepth = 0;
    this.pipelineActiveTasks = 0;
    this.stepDurationMs.clear();
    this.stepErrorCount.clear();
    this.protocolReadTotal = 0;
    this.protocolReadErrors = 0;
    this.deadbandFilteredTotal = 0;
    this.cacheHitTotal = 0;
    this.cacheMissTotal = 0;
    this.persistWriteTotal = 0;
    this.persistWriteErrors = 0;
    this.protocolMetrics.clear();

    this.logger.debug('Pipeline metrics reset');
  }
}
