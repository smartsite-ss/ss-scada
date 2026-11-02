// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import { StepTimeoutError, StepExecutionError } from './errors';
import { PipelineContext, PipelineStep, StepMetrics, PipelineValue } from './pipeline.types';
import { PipelineMetricsService } from './pipeline-metrics.service';

export { PipelineContext, PipelineStep, StepMetrics, PipelineValue };

/** Single-step duration record (for flame graph) */
export interface StepTimingRecord {
  stepName: string;
  durationMs: number;
  timestamp: number;
  isError: boolean;
  tagId: string;
  deviceId: string;
}

/** Pipeline overall timing breakdown */
export interface PipelineTimingBreakdown {
  pipelineTotalMs: number;
  steps: StepTimingRecord[];
  tagId: string;
  deviceId: string;
  timestamp: number;
}

/** Step duration statistics */
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

@Injectable()
export class PipelineOrchestrator {
  private readonly logger = new Logger(PipelineOrchestrator.name);
  private steps: PipelineStep[] = [];
  private metrics = new Map<string, StepMetrics>();
  private stepTimeoutMs = 10000;

  /** Recent N step-duration records (for flame graph / timing analysis) */
  private readonly timingHistory: StepTimingRecord[] = [];
  private readonly MAX_TIMING_HISTORY = 1000;

  /** Recent N Pipeline overall timing breakdowns */
  private readonly breakdownHistory: PipelineTimingBreakdown[] = [];
  private readonly MAX_BREAKDOWN_HISTORY = 100;

  constructor(@Optional() private readonly metricsService?: PipelineMetricsService) {}

  registerStep(step: PipelineStep): void {
    this.steps.push(step);
    this.steps.sort((a, b) => a.order - b.order);
    this.metrics.set(step.name, {
      stepName: step.name,
      totalCalls: 0,
      totalDurationMs: 0,
      errorCount: 0,
      lastCallAt: null,
      lastDurationMs: null,
    });

    const startOrder = this.steps[0]?.order || 0;
    const endOrder = this.steps[this.steps.length - 1]?.order || 0;
    this.logger.log(
      `Pipeline registered: ${this.steps.map((s) => `${s.name}(${s.order})`).join(' → ')} ` +
        `[order: ${startOrder}-${endOrder}]`,
    );
  }

  async execute(initialContext: PipelineContext): Promise<PipelineContext> {
    const pipelineStart = Date.now();
    let ctx: PipelineContext = {
      ...initialContext,
      errors: initialContext.errors || [],
    };

    ctx.startTime = pipelineStart;

    // If no steps are registered, return early (avoid a meaningless empty execution)
    if (this.steps.length === 0) {
      this.logger.warn('Pipeline execute called but no steps registered — skipping');
      return ctx;
    }

    const stepTimings: StepTimingRecord[] = [];

    for (const step of this.steps) {
      const stepStart = Date.now();

      try {
        ctx = await this.withTimeout(step.process(ctx), this.stepTimeoutMs, step.name);
        const durationMs = Date.now() - stepStart;
        this.recordMetric(step.name, durationMs, false);
        stepTimings.push({
          stepName: step.name,
          durationMs,
          timestamp: stepStart,
          isError: false,
          tagId: ctx.tagId,
          deviceId: ctx.deviceId,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorCode =
          error instanceof StepTimeoutError
            ? 'STEP_TIMEOUT'
            : error instanceof StepExecutionError
              ? 'STEP_EXECUTION'
              : 'UNKNOWN';

        const durationMs = Date.now() - stepStart;
        ctx.errors.push({ step: step.name, message: errorMsg, code: errorCode });
        this.recordMetric(step.name, durationMs, true);
        stepTimings.push({
          stepName: step.name,
          durationMs,
          timestamp: stepStart,
          isError: true,
          tagId: ctx.tagId,
          deviceId: ctx.deviceId,
        });
        this.logger.warn(`Pipeline step "${step.name}" failed for tag ${ctx.tagId}: ${errorMsg}`, {
          deviceId: ctx.deviceId,
          tagId: ctx.tagId,
          step: step.name,
          code: errorCode,
        });

        // Mark quality on exception but keep running subsequent steps (so CacheUpdate/Persist record the error state)
        if (!ctx.quality || ctx.quality === 'unknown' || ctx.quality === 'good') {
          ctx.quality = 'bad';
        }
        // Continue execution, do not break
      }
    }

    const totalMs = Date.now() - pipelineStart;

    // Record the timing breakdown
    this.recordTimingHistory(stepTimings);
    this.recordBreakdown({
      pipelineTotalMs: totalMs,
      steps: stepTimings,
      tagId: ctx.tagId,
      deviceId: ctx.deviceId,
      timestamp: pipelineStart,
    });

    // Sync to the Prometheus metric service
    if (this.metricsService) {
      const success = ctx.errors.length === 0;
      this.metricsService.recordExecution(success, totalMs);
      // Global protocol-read counter
      this.metricsService.recordProtocolRead(success);
      // Record per protocol (so plugin cards show real metrics)
      this.metricsService.recordProtocolReadDetailed(
        ctx.deviceType,
        success,
        totalMs,
        ctx.deviceId,
      );
    }

    // Completion log: emit only on anomaly (errors>0 or quality not in {good, unknown}),
    // normal collection is fully silent - periodic summaries are emitted centrally by EnhancedScheduler.emitCollectionSummary(),
    // to avoid flooding the screen with every tag every cycle at DEBUG level.
    const isAbnormal =
      ctx.errors.length > 0 || (ctx.quality !== 'good' && ctx.quality !== 'unknown');
    if (isAbnormal) {
      this.logger.warn(
        `Pipeline execute END (abnormal) — tag=${ctx.tagName || ctx.tagId}` +
          `, device=${ctx.deviceName || ctx.deviceId}` +
          ` (tid=${ctx.tagId}, deviceId=${ctx.deviceId}), ` +
          `totalMs=${totalMs}, errors=${ctx.errors.length}, quality=${ctx.quality}, ` +
          `historySize=${this.timingHistory.length}`,
      );
    }

    return ctx;
  }

  setStepTimeout(ms: number): void {
    this.stepTimeoutMs = ms;
  }

  getMetrics(): Map<string, StepMetrics> {
    return new Map(this.metrics);
  }

  getStepOrder(): string[] {
    return [...this.steps].sort((a, b) => a.order - b.order).map((s) => s.name);
  }

  /** Get the recent N Pipeline timing breakdowns (for flame-graph visualization) */
  getTimingBreakdowns(limit?: number): PipelineTimingBreakdown[] {
    const count = limit ?? this.breakdownHistory.length;
    return this.breakdownHistory.slice(-count);
  }

  /** Get the recent N step-duration records */
  getTimingHistory(limit?: number): StepTimingRecord[] {
    const count = limit ?? this.timingHistory.length;
    return this.timingHistory.slice(-count);
  }

  /**
   * Diagnostic info: expose internal state, for troubleshooting "metrics have no data".
   * Accessed via the /api/v1/pipeline/metrics/diagnostic endpoint.
   */
  getDiagnosticInfo() {
    return {
      registeredSteps: this.steps.map((s) => ({ name: s.name, order: s.order })),
      stepCount: this.steps.length,
      timingHistorySize: this.timingHistory.length,
      timingHistoryCapacity: this.MAX_TIMING_HISTORY,
      breakdownHistorySize: this.breakdownHistory.length,
      breakdownHistoryCapacity: this.MAX_BREAKDOWN_HISTORY,
      metricsServiceInjected: !!this.metricsService,
      stepTimeoutMs: this.stepTimeoutMs,
      perStepMetrics: Array.from(this.metrics.entries()).map(([name, m]) => ({
        stepName: name,
        totalCalls: m.totalCalls,
        totalDurationMs: m.totalDurationMs,
        errorCount: m.errorCount,
        lastCallAt: m.lastCallAt,
        lastDurationMs: m.lastDurationMs,
      })),
    };
  }

  /** Get per-step duration statistics (P50/P95/P99), ordered by Pipeline sequence */
  getStepTimingStats(): StepTimingStats[] {
    // Build the stepName -> order map
    const orderMap = new Map<string, number>();
    for (const step of this.steps) {
      orderMap.set(step.name, step.order);
    }

    const stepDurations = new Map<string, number[]>();

    for (const record of this.timingHistory) {
      if (!stepDurations.has(record.stepName)) {
        stepDurations.set(record.stepName, []);
      }
      stepDurations.get(record.stepName)!.push(record.durationMs);
    }

    const stats: StepTimingStats[] = [];
    for (const [stepName, durations] of stepDurations) {
      const sorted = [...durations].sort((a, b) => a - b);
      const metric = this.metrics.get(stepName);
      const totalCalls = metric?.totalCalls ?? 0;
      const errorCount = metric?.errorCount ?? 0;

      stats.push({
        stepName,
        order: orderMap.get(stepName) ?? 99,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        avgMs: durations.reduce((s, v) => s + v, 0) / durations.length,
        p50Ms: this.percentile(sorted, 50),
        p95Ms: this.percentile(sorted, 95),
        p99Ms: this.percentile(sorted, 99),
        totalCalls,
        errorCount,
        errorRate: totalCalls > 0 ? errorCount / totalCalls : 0,
      });
    }

    return stats.sort((a, b) => a.order - b.order);
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  private recordTimingHistory(records: StepTimingRecord[]): void {
    this.timingHistory.push(...records);
    // Keep within the cap
    while (this.timingHistory.length > this.MAX_TIMING_HISTORY) {
      this.timingHistory.shift();
    }
  }

  private recordBreakdown(breakdown: PipelineTimingBreakdown): void {
    this.breakdownHistory.push(breakdown);
    while (this.breakdownHistory.length > this.MAX_BREAKDOWN_HISTORY) {
      this.breakdownHistory.shift();
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, stepName: string): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new StepTimeoutError(stepName, { step: stepName }));
      }, ms);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  private recordMetric(stepName: string, durationMs: number, isError: boolean): void {
    const metric = this.metrics.get(stepName);
    if (!metric) return;

    metric.totalCalls++;
    metric.totalDurationMs += durationMs;
    if (isError) metric.errorCount++;
    metric.lastCallAt = Date.now();
    metric.lastDurationMs = durationMs;

    // Sync to the Prometheus metric service
    if (this.metricsService) {
      this.metricsService.recordStepDuration(stepName, durationMs);
      if (isError) {
        this.metricsService.recordStepError(stepName);
      }
    }
  }
}
