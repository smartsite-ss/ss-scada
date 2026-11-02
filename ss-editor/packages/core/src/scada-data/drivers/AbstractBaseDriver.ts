// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { IDataSourceDriver } from './IDataSourceDriver';
import type { DataSourceConfig, DataSourceStatus, TagValue, TagMeta } from '../types/data-source.types';

/**
 * AbstractBaseDriver — abstract base class for data source drivers
 *
 * Encapsulates boilerplate shared by the 5 drivers:
 * - _callbacks array + the onData / offData / _notify trio
 * - _tags set + default subscribe / unsubscribe implementations
 * - _status field + getStatus
 * - write() defaults to throwing UnsupportedError
 * - getAvailableTags() defaults to an empty array
 * - Exponential-backoff retry utility _withRetry
 * - staleData degradation push, with the unified quality code 'stale'
 *
 * Subclasses only implement: connect / disconnect / _fetchOnce (business logic)
 */
export abstract class AbstractBaseDriver implements IDataSourceDriver {
  protected _status: DataSourceStatus = 'disconnected';
  protected _callbacks: Array<(values: TagValue[]) => void> = [];
  protected _tags: string[] = [];
  protected _staleData: TagValue[] | null = null;

  /** Shared config for subclasses; resolved and written by the subclass on connect */
  protected _rawConfig: DataSourceConfig | null = null;

  /** Default max retry count; subclasses can override */
  protected _maxRetries = 3;

  /** Current retry count (reset to zero after each success) */
  protected _retryCount = 0;

  abstract connect(config: DataSourceConfig): Promise<void>;

  abstract disconnect(): Promise<void>;

  /** Default subscribe implementation: merge and dedupe; subclasses can override to add event listeners etc. */
  subscribe(tagIds: string[]): void {
    this._tags = [...new Set([...this._tags, ...tagIds])];
  }

  /** Default unsubscribe implementation: difference filtering */
  unsubscribe(tagIds: string[]): void {
    this._tags = this._tags.filter((t) => !tagIds.includes(t));
  }

  onData(callback: (values: TagValue[]) => void): void {
    this._callbacks.push(callback);
  }

  offData(callback: (values: TagValue[]) => void): void {
    this._callbacks = this._callbacks.filter((c) => c !== callback);
  }

  getStatus(): DataSourceStatus {
    return this._status;
  }

  /** Write operations not supported by default; writable drivers such as StaticDataSource override this */
  async write(_tagId: string, _value: unknown): Promise<void> {
    throw new Error(`${this.constructor.name} does not support write operations`);
  }

  getAvailableTags(): TagMeta[] {
    return [];
  }

  /**
   * Notify all onData callbacks; each callback has its own try/catch so one failure does not affect others.
   */
  protected _notify(values: TagValue[]): void {
    for (const cb of this._callbacks) {
      try { cb(values); } catch { void 0; }
    }
  }

  /**
   * Push stale degradation data. Unified quality code 'stale', eliminating the pre-existing
   * semantic divergence between HttpPolling/SqlQuery.
   * @param fallbackQuality optional, overrides the default 'stale' (to preserve driver-specific semantics)
   */
  protected _notifyStaleData(fallbackQuality: TagValue['quality'] = 'stale'): void {
    if (!this._staleData || this._staleData.length === 0) return;
    const now = Date.now();
    this._notify(this._staleData.map((v) => ({
      ...v,
      quality: fallbackQuality,
      timestamp: now,
    })));
  }

  /**
   * Exponential-backoff retry utility.
   * - Backoff formula: min(1000 * 2^(retry-1), 30000)
   * - On success _retryCount resets to zero
   * - Beyond _maxRetries, push stale degradation data and throw the last error
   *
   * @param fn the async operation to retry
   * @param staleFallbackQuality quality code used on degradation
   */
  protected async _withRetry<T>(
    fn: () => Promise<T>,
    staleFallbackQuality: TagValue['quality'] = 'stale',
  ): Promise<T> {
    try {
      const result = await fn();
      this._retryCount = 0;
      return result;
    } catch (err: unknown) {
      this._retryCount++;
      this._status = 'error';

      if (this._retryCount <= this._maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, this._retryCount - 1), 30000);
        await new Promise((r) => setTimeout(r, delay));
        return this._withRetry(fn, staleFallbackQuality);
      }

      // Beyond max retries, push degradation data
      this._notifyStaleData(staleFallbackQuality);
      throw err;
    }
  }
}
