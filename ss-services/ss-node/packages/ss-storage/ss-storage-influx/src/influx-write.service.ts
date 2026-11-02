// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { InfluxBucketService } from './influx-bucket.service';

export interface InfluxWritePoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number | string | boolean>;
  timestamp?: Date | number;
}

interface BatchBuffer {
  points: InfluxWritePoint[];
  timer: NodeJS.Timeout | null;
}

/**
 * CODE-03: custom InfluxDB HTTP error carrying the HTTP status and bucket name,
 * letting upper layers distinguish 404 (bucket missing) from other network/server errors.
 */
export class InfluxHttpException extends Error {
  constructor(
    public readonly status: number,
    public readonly bucket: string,
    message: string,
  ) {
    super(message);
    this.name = 'InfluxHttpException';
  }
}

@Injectable()
export class InfluxWriteService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InfluxWriteService.name);

  private batchBuffer = new Map<string, BatchBuffer>();
  private flushTimeoutMs = 5000;
  private maxBatchSize = 1000;
  private enabled = true;

  private totalWritten = 0;
  private totalErrors = 0;

  /** Whether the backend is unreachable (persistent flag: set true on failure, false on success) */
  private _backendUnreachable = false;

  /** CODE-02: circuit-breaker quiet period — timestamp of the last error/summary log; no repeated error/warn within 30s */
  private _lastErrorLogTime = 0;
  private readonly _silenceWindowMs = 30_000;
  /** Dropped points accumulated during the quiet period (for periodic summary output) */
  private _silencedErrorCount = 0;
  /** CODE-02: exponential backoff — timestamp of the next allowed write attempt (ms) */
  private _nextRetryTime = 0;
  private _consecutiveFailures = 0;

  /** CODE-03: known-unavailable buckets (404 etc.) — subsequent writes skip them directly, no more retries */
  private readonly _unavailableBuckets = new Set<string>();

  /** CODE-05: per-fetch timeout (ms), preventing an indefinitely hung InfluxDB from blocking the event loop */
  private readonly fetchTimeoutMs = 5000;

  constructor(@Optional() private readonly bucketService?: InfluxBucketService) {}

  onModuleInit(): void {
    this.logger.log(
      `InfluxWriteService initialized (enabled: ${this.enabled}, batch: ${this.maxBatchSize}, flush: ${this.flushTimeoutMs}ms, fetchTimeout: ${this.fetchTimeoutMs}ms, per-project buckets: ${!!this.bucketService})`,
    );
  }

  onModuleDestroy(): void {
    this.flushAll();
  }

  configure(options: { enabled?: boolean; flushTimeoutMs?: number; maxBatchSize?: number }): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.flushTimeoutMs) this.flushTimeoutMs = options.flushTimeoutMs;
    if (options.maxBatchSize) this.maxBatchSize = options.maxBatchSize;
  }

  async writePoint(point: InfluxWritePoint): Promise<void> {
    if (!this.enabled) return;

    const key = `${point.measurement}:${point.tags?.projectId || 'default'}`;

    let buffer = this.batchBuffer.get(key);
    if (!buffer) {
      buffer = { points: [], timer: null };
      this.batchBuffer.set(key, buffer);
    }

    buffer.points.push(point);

    if (buffer.points.length >= this.maxBatchSize) {
      await this.flushBuffer(key);
    } else if (!buffer.timer) {
      buffer.timer = setTimeout(() => {
        // Catch errors during async flush (already recorded via lastFlushError, checked by the next writeBatch)
        this.flushBuffer(key).catch(() => {});
      }, this.flushTimeoutMs);
    }
  }

  async writePoints(points: InfluxWritePoint[]): Promise<void> {
    for (const point of points) {
      await this.writePoint(point);
    }
  }

  private async flushBuffer(key: string): Promise<void> {
    const buffer = this.batchBuffer.get(key);
    if (!buffer || buffer.points.length === 0) return;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    const points = buffer.points.splice(0);
    this.batchBuffer.delete(key);

    // CODE-02: during the backoff window, abandon this batch directly (points already removed from the buffer),
    // avoiding a fetch failure + log spam every 5s after the breaker opens.
    // Does not throw → does not trigger the upper PersistStep breaker; silently dropped inside this service only.
    if (this._backendUnreachable && Date.now() < this._nextRetryTime) {
      this._silencedErrorCount += points.length;
      this.maybeLogSilencedSummary();
      return;
    }

    try {
      // Send grouped by bucket
      const projectId = points[0]?.tags?.projectId;
      const bucket =
        projectId && this.bucketService
          ? await this.bucketService.getBucket(projectId)
          : this.getDefaultBucket();

      // CODE-03: skip buckets known to be 404 directly, no more useless retries
      if (this._unavailableBuckets.has(bucket)) {
        this._silencedErrorCount += points.length;
        this.maybeLogSilencedSummary();
        return;
      }

      await this.sendToInfluxDB(points, bucket);
      this.totalWritten += points.length;

      // Write succeeded: reset the breaker, backoff, and quiet-period counters
      if (this._backendUnreachable || this._silencedErrorCount > 0) {
        this.logger.warn(
          `InfluxDB recovered after ${this._silencedErrorCount} points dropped during circuit-open window`,
        );
      }
      this._backendUnreachable = false;
      this._consecutiveFailures = 0;
      this._nextRetryTime = 0;
      this._silencedErrorCount = 0;
      this._lastErrorLogTime = 0;

      if (this.totalWritten % 1000 === 0) {
        this.logger.log(`InfluxDB write progress: ${this.totalWritten} points written`);
      }
    } catch (error) {
      this.totalErrors += points.length;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // CODE-03: 404 (bucket missing) — mark the bucket unavailable, no more retries;
      // do not set _backendUnreachable (the backend itself is reachable, only the bucket config is wrong),
      // and do not throw, to avoid tripping the upper PersistStep breaker.
      if (error instanceof InfluxHttpException && error.status === 404) {
        if (!this._unavailableBuckets.has(error.bucket)) {
          this._unavailableBuckets.add(error.bucket);
          this.logger.error(
            `InfluxDB bucket "${error.bucket}" not found (HTTP 404) — future writes to this bucket will be skipped. ` +
              `Please verify INFLUXDB_BUCKET / per-project bucket configuration.`,
          );
        }
        return;
      }

      // CODE-02: network error → breaker + exponential backoff + rate-limited error logging
      this._backendUnreachable = true;
      this._consecutiveFailures += 1;
      // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 60s
      const backoffMs = Math.min(
        1000 * Math.pow(2, this._consecutiveFailures - 1),
        60_000,
      );
      this._nextRetryTime = Date.now() + backoffMs;
      this._silencedErrorCount += points.length;

      // Error log rate limit: first error within 30s, then debug only (not written to file at production LOG_LEVEL=info)
      const now = Date.now();
      if (now - this._lastErrorLogTime >= this._silenceWindowMs) {
        this.logger.error(
          `InfluxDB write failed (${points.length} points, backoff=${backoffMs}ms): ${errorMsg}`,
        );
        this._lastErrorLogTime = now;
      } else {
        this.logger.debug(
          `InfluxDB write failed (suppressed, ${points.length} points): ${errorMsg}`,
        );
      }
      throw error;
    }
  }

  /**
   * CODE-02: periodically output a warn summary during the quiet period,
   * avoiding a complete log blackout (helps ops awareness) without per-second error spam.
   */
  private maybeLogSilencedSummary(): void {
    const now = Date.now();
    if (now - this._lastErrorLogTime >= this._silenceWindowMs) {
      const nextRetryIn = Math.max(0, this._nextRetryTime - now);
      this.logger.warn(
        `InfluxDB backend unreachable — ${this._silencedErrorCount} points dropped during silence window (next retry in ${nextRetryIn}ms)`,
      );
      this._lastErrorLogTime = now;
      this._silencedErrorCount = 0;
    }
  }

  private getDefaultBucket(): string {
    return process.env.INFLUXDB_BUCKET || 'ss_node_data';
  }

  private async sendToInfluxDB(points: InfluxWritePoint[], bucket: string): Promise<void> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';
    const org = process.env.INFLUXDB_ORG || 'ss-org';

    const lines = points
      .map((point) => {
        const measurement = point.measurement;
        const tagStr = Object.entries(point.tags || {})
          .map(([k, v]) => `${k}=${String(v).replace(/[,= ]/g, '\\$&')}`)
          .join(',');

        const fieldStr = Object.entries(point.fields || {})
          .map(([k, v]) => {
            if (typeof v === 'string') return `${k}="${v}"`;
            if (typeof v === 'boolean') return `${k}=${v}`;
            return `${k}=${v}`;
          })
          .join(',');

        const ts = point.timestamp
          ? ` ${point.timestamp instanceof Date ? point.timestamp.getTime() * 1000000 : point.timestamp}`
          : '';

        return `${measurement},${tagStr} ${fieldStr}${ts}`;
      })
      .join('\n');

    // CODE-05: add a 5s timeout to fetch (AbortSignal.timeout), preventing an indefinitely hung InfluxDB from blocking the event loop
    let response: Response;
    try {
      response = await fetch(`${url}/api/v2/write?org=${org}&bucket=${bucket}&precision=ns`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: lines,
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
      });
    } catch (err) {
      // Wrap the timeout/network error message (keeps the original message for diagnostics)
      throw new Error(`InfluxDB write fetch failed: ${(err as Error).message}`);
    }

    if (!response.ok && response.status !== 204) {
      const errorBody = await response.text().catch(() => 'unknown');
      // CODE-03: throw with the HTTP status so callers can distinguish 404 from network errors
      throw new InfluxHttpException(
        response.status,
        bucket,
        `InfluxDB HTTP ${response.status}: ${errorBody}`,
      );
    }
  }

  flushAll(): void {
    for (const key of this.batchBuffer.keys()) {
      this.flushBuffer(key).catch(() => {});
    }
  }

  /** Whether the backend is reachable (persistent flag: false on any failure, back to true on success) */
  get isBackendReachable(): boolean {
    return !this._backendUnreachable;
  }

  getStats() {
    return {
      enabled: this.enabled,
      totalWritten: this.totalWritten,
      totalErrors: this.totalErrors,
      pendingBuffers: this.batchBuffer.size,
      maxBatchSize: this.maxBatchSize,
      backendUnreachable: this._backendUnreachable,
      unavailableBuckets: Array.from(this._unavailableBuckets),
      nextRetryInMs: Math.max(0, this._nextRetryTime - Date.now()),
    };
  }
}
