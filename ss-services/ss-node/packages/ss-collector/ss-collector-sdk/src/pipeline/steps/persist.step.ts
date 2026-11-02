// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PipelineContext, PipelineStep } from '../pipeline-orchestrator';

import { IPersistWriter, DataPoint } from '../interfaces';
import { PersistWriterRegistry } from '../persist-writer-registry';
import { PipelineMetricsService } from '../pipeline-metrics.service';
import { OfflineCacheService } from '../offline-cache.service';

/**
 * PersistStep - persistence step
 *
 * Change history (P0-1 + P2-1 + P2-2 + P3):
 * Originally each ctx called every writer's write() for a single record, causing:
 * - 1000 tags x 1Hz = 1000 HSET network round-trips per second
 * - Slow InfluxDB writes (50ms+) dragged down the whole Pipeline cycle via Promise.all
 *
 * Now switched to a "periodic batch aggregation" mode:
 * 1. When process(ctx) runs, build a DataPoint and append it to each writer's buffer
 * 2. On a trigger (buffer full >= maxBatchSize, or timer maxFlushIntervalMs elapsed) run flush()
 * 3. flush() processes by priority:
 *    - critical writer (Redis/SQLite): await writer.writeBatch(points)
 *    - best_effort writer (InfluxDB): void writer.writeBatch(points) (fire-and-forget)
 * 4. Use Promise.allSettled instead of Promise.all; one writer's failure does not affect others
 * 5. Flush failures are recorded to lastBatchErrors and surfaced to ctx.errors on the next process(ctx)
 *
 * Error-surfacing strategy (P1-2):
 * Because batch aggregation cannot precisely attribute an error to a specific ctx, a "carried by next ctx" strategy is used:
 * - On flush failure, record { writerName, message, timestamp } to lastBatchErrors
 * - At the start of the next process(ctx), check and write it into ctx.errors, then clear
 * - This lets PublishStep detect persistence anomalies via ctx.errors
 *
 * Precision control (P3 - 2026-07-27):
 * Before storing, PersistStep rounds the value per tagConfig.displayFormat:
 * - %.Nf -> keep N decimals (e.g. 3.14159, %.2f -> 3.14)
 * - %d / %i / %.0f / %X -> integer
 * - empty / unsupported format -> keep the original value
 * This makes historical-data queries return display-ready precision values natively, so the frontend needs far fewer formatTagValue calls.
 * Note: only DataPoint.value (stored) is affected; ctx.transformedValue is left untouched (used by FormatStep/PublishStep).
 */
@Injectable()
export class PersistStep implements PipelineStep, OnModuleInit, OnModuleDestroy {
  readonly name = 'Persist';
  readonly order = 6;

  private readonly logger = new Logger(PersistStep.name);

  /** Immediately flush when a single writer's buffer reaches this threshold (avoid memory buildup) */
  private readonly maxBatchSize = 200;
  /** Periodic flush interval (ms), guaranteeing the max latency never exceeds this value */
  private readonly maxFlushIntervalMs = 200;

  /** Per-writer pending-write buffer: writerName -> DataPoint[] */
  private readonly bufferByWriter = new Map<string, DataPoint[]>();
  /** Timer handle */
  private flushTimer: NodeJS.Timeout | null = null;
  /** Flag indicating a flush is in progress (prevent re-entrancy) */
  private flushing = false;

  /** Errors from the last flush (surfaced to ctx.errors on the next process) */
  private lastBatchErrors: Array<{ step: string; message: string; code?: string }> = [];

  constructor(
    private readonly writerRegistry: PersistWriterRegistry,
    private readonly metricsService?: PipelineMetricsService,
    private readonly offlineCache?: OfflineCacheService,
  ) {}

  onModuleInit(): void {
    const writers = this.writerRegistry.getWriters();
    const names = writers.map((w) => `${w.name}(${w.priority ?? 'critical'})`).join(', ');
    this.logger.log(
      `PersistStep initialized — ${writers.length} persist writer(s): [${names}]` +
        ` (batchSize=${this.maxBatchSize}, flushInterval=${this.maxFlushIntervalMs}ms)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Flush the remaining buffer on module destroy, to avoid data loss
    this.logger.log('PersistStep destroying — flushing remaining buffer');
    this.stopTimer();
    await this.flushAll();
    // Notify each writer to flush itself (e.g. SQLite writer still has an internal buffer to flush to disk)
    await Promise.allSettled(
      this.writers.map((w) =>
        w.flush().catch((err) => {
          this.logger.error(`${w.name} flush on destroy failed: ${err.message}`);
        }),
      ),
    );
  }

  private get writers(): IPersistWriter[] {
    return this.writerRegistry.getWriters();
  }

  async process(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldPersist) {
      return ctx;
    }

    // Surface the last batch's flush errors (P1-2 error-surfacing mechanism)
    if (this.lastBatchErrors.length > 0) {
      for (const err of this.lastBatchErrors) {
        ctx.errors.push(err);
      }
      this.lastBatchErrors = [];
    }

    // Round per displayFormat precision before storing (P3), without modifying ctx.transformedValue
    const roundedValue = this.roundByDisplayFormat(
      ctx.transformedValue,
      ctx.tagConfig?.displayFormat,
    );

    const dataPoint: DataPoint = {
      tagId: ctx.tagId,
      deviceId: ctx.deviceId,
      projectId: ctx.projectId,
      deviceCode: ctx.deviceCode,
      deviceName: ctx.deviceName,
      value: roundedValue,
      quality: ctx.quality,
      timestamp: new Date(),
    };

    // Append to each active writer's buffer (skip disabled writers to avoid counting no-ops in metrics)
    for (const writer of this.writers) {
      if (writer.isActive && !writer.isActive()) continue;
      const buf = this.bufferByWriter.get(writer.name) ?? [];
      buf.push(dataPoint);
      this.bufferByWriter.set(writer.name, buf);
    }

    // Trigger 1: any writer buffer full -> flush immediately
    const shouldFlushImmediately = Array.from(this.bufferByWriter.values()).some(
      (buf) => buf.length >= this.maxBatchSize,
    );

    if (shouldFlushImmediately) {
      await this.flushAll();
    } else {
      // Trigger 2: timer not started -> start it
      this.ensureTimer();
    }

    return ctx;
  }

  /**
   * Flush all writers' buffers immediately
   *
   * Implementation details:
   * - Use Promise.allSettled instead of Promise.all; one writer's failure does not affect others
   * - critical writer: await writeBatch
   * - best_effort writer: void writeBatch (fire-and-forget, non-blocking)
   * - Errors are uniformly recorded to lastBatchErrors and surfaced to ctx.errors on the next process
   */
  async flushAll(): Promise<void> {
    // Prevent re-entrancy: if the last flush has not finished, skip (the timer will trigger again next cycle)
    if (this.flushing) {
      return;
    }
    this.flushing = true;

    // Snapshot the current buffer and clear it (avoid mutation during iteration)
    const snapshot = new Map(this.bufferByWriter);
    this.bufferByWriter.clear();
    this.stopTimer();

    if (snapshot.size === 0) {
      this.flushing = false;
      return;
    }

    const writers = this.writers;
    const criticalTasks: Array<Promise<void>> = [];
    const bestEffortTasks: Array<Promise<void>> = [];

    for (const writer of writers) {
      const points = snapshot.get(writer.name);
      if (!points || points.length === 0) continue;

      const task = this.executeWriterWriteBatch(writer, points);
      if (writer.priority === 'best_effort') {
        bestEffortTasks.push(task);
      } else {
        criticalTasks.push(task);
      }
    }

    // critical writer: await synchronously (guarantee key data is persisted)
    if (criticalTasks.length > 0) {
      await Promise.allSettled(criticalTasks);
    }

    // best_effort writer: trigger asynchronously, do not await (avoid InfluxDB slow writes dragging down the Pipeline)
    // Errors are caught inside the task and recorded to lastBatchErrors
    for (const task of bestEffortTasks) {
      void task;
    }

    this.flushing = false;
  }

  /**
   * Run a single writer's writeBatch, capturing errors to lastBatchErrors
   */
  private async executeWriterWriteBatch(
    writer: IPersistWriter,
    points: DataPoint[],
  ): Promise<void> {
    // Count only ACTIVE history-storage Writers (InfluxDB / SQLite) by data point,
    // non-history Writers (RedisLatestValue etc.) or disabled Writers are not counted in persistence-write metrics
    const isHistorical = writer.name === 'InfluxDB' || writer.name === 'SQLite';
    const shouldRecord = isHistorical && (!writer.isActive || writer.isActive());
    try {
      await writer.writeBatch(points);
      if (shouldRecord) {
        for (let i = 0; i < points.length; i++) {
          this.metricsService?.recordPersistWrite(true);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : `${writer.name} writeBatch failed`;
      this.logger.error(`${writer.name} writeBatch error (${points.length} points): ${errorMsg}`);
      if (shouldRecord) {
        for (let i = 0; i < points.length; i++) {
          this.metricsService?.recordPersistWrite(false);
        }
      }
      this.lastBatchErrors.push({
        step: `${this.name}:${writer.name}`,
        message: errorMsg,
        code: 'PERSIST_ERROR',
      });
      // Write failed -> buffer into the offline cache, retry after recovery later
      if (this.offlineCache) {
        for (const p of points) {
          this.offlineCache.buffer(p.tagId, {
            tagId: p.tagId,
            deviceId: p.deviceId,
            projectId: p.projectId,
            value: p.value === undefined || p.value === null ? null : Number(p.value),
            quality: p.quality || 'bad',
            timestamp: p.timestamp,
            bufferedAt: Date.now(),
          });
        }
      }
    }
  }

  private ensureTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // Trigger asynchronously, do not block the current call stack
      void this.flushAll();
    }, this.maxFlushIntervalMs);
  }

  private stopTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Passthrough interface: expose buffer state for monitoring/diagnostics */
  getBufferStats(): Array<{ writer: string; buffered: number }> {
    return this.writers.map((w) => ({
      writer: w.name,
      buffered: this.bufferByWriter.get(w.name)?.length ?? 0,
    }));
  }

  /** Passthrough interface: expose the most recent flush error (for diagnostic endpoints) */
  getLastError(): Array<{ step: string; message: string; code?: string }> {
    return [...this.lastBatchErrors];
  }

  getWriters(): string[] {
    return this.writers.map((w) => w.name);
  }

  /**
   * Round a numeric value to the precision specified by displayFormat.
   *
   * Same format semantics as FormatStep, but only controls precision (keeps the number type), does not produce a string:
   * - %.Nf -> keep N decimals (toFixed + Number to strip trailing zeros)
   * - %d / %i / %.0f -> integer
   * - %X / %x (with width like %04X) -> integer
   * - empty / unsupported format -> return the original value
   *
   * Note: bool / string values are not precision-processed; returned as-is, preserving type semantics.
   */
  private roundByDisplayFormat(
    value: number | boolean | string | null,
    displayFormat?: string,
  ): number | boolean | string | null {
    // Non-numeric types returned directly, no precision control applied
    if (typeof value === 'boolean' || typeof value === 'string') return value;
    if (value === null || value === undefined || !displayFormat) return value;

    const num = Number(value);
    if (Number.isNaN(num)) return value;

    // Float format: %.Nf
    const floatMatch = displayFormat.match(/^%\.(\d+)f$/);
    if (floatMatch) {
      const decimals = parseInt(floatMatch[1], 10);
      return Number(num.toFixed(decimals));
    }

    // Integer format + hex format
    if (
      displayFormat === '%d' ||
      displayFormat === '%i' ||
      displayFormat === '%.0f' ||
      /^%\d*[Xx]$/.test(displayFormat)
    ) {
      return Math.round(num);
    }

    return value;
  }
}
