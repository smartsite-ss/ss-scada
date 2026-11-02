// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Request retry queue
 *
 * While the backend is disconnected, write operations (POST/PUT/PATCH/DELETE) are enqueued,
 * and automatically re-sent in FIFO order once the backend recovers.
 *
 * - Queue limit: 50 entries; excess requests are rejected directly
 * - Request expiry: 5 minutes; expired requests are skipped on re-send
 * - Maximum retry count: 3
 */

import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

export interface QueuedRequest {
  id: string;
  config: InternalAxiosRequestConfig;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  enqueuedAt: number;
  retryCount: number;
  maxRetry: number;
}

export interface QueueStats {
  size: number;
  oldest: number | null;
}

const MAX_QUEUE_SIZE = 50;
const MAX_AGE = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_RETRY = 3;

let requestCounter = 0;

export class RequestQueue {
  private queue: QueuedRequest[] = [];
  private isFlushing = false;
  private sizeChangeListeners: Array<(stats: QueueStats) => void> = [];

  /** Enqueue (called by the response interceptor) */
  enqueue(
    config: InternalAxiosRequestConfig,
    resolve: (value: any) => void,
    reject: (reason: any) => void,
    maxRetry: number = DEFAULT_MAX_RETRY,
  ): boolean {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return false;
    }

    const request: QueuedRequest = {
      id: `req_${Date.now()}_${++requestCounter}`,
      config,
      resolve,
      reject,
      enqueuedAt: Date.now(),
      retryCount: 0,
      maxRetry,
    };

    this.queue.push(request);
    this.notifySizeChange();
    return true;
  }

  /** Flush the queue (called when the backend recovers) */
  async flush(client: AxiosInstance): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const batch = [...this.queue];
    this.queue = [];
    this.notifySizeChange();

    for (const request of batch) {
      // Check expiry
      if (Date.now() - request.enqueuedAt > MAX_AGE) {
        request.reject(new Error('REQUEST_EXPIRED'));
        continue;
      }

      // Check retry count
      if (request.retryCount >= request.maxRetry) {
        request.reject(new Error('MAX_RETRY_EXCEEDED'));
        continue;
      }

      request.retryCount++;

      try {
        const response = await client(request.config);
        request.resolve(response);
      } catch (error) {
        // Re-send failed: re-enqueue if retries remain
        if (request.retryCount < request.maxRetry) {
          this.queue.push(request);
          this.notifySizeChange();
        } else {
          request.reject(error);
        }
      }
    }

    this.isFlushing = false;
  }

  /** Clear the queue (all requests reject) */
  clear(): void {
    const rejected = this.queue;
    this.queue = [];
    rejected.forEach((req) => req.reject(new Error('QUEUE_CLEARED')));
    this.notifySizeChange();
  }

  /** Queue statistics */
  getStats(): QueueStats {
    if (this.queue.length === 0) {
      return { size: 0, oldest: null };
    }
    return {
      size: this.queue.length,
      oldest: this.queue[0].enqueuedAt,
    };
  }

  /** Register a queue size change listener */
  onSizeChange(cb: (stats: QueueStats) => void): void {
    this.sizeChangeListeners.push(cb);
  }

  private notifySizeChange(): void {
    const stats = this.getStats();
    this.sizeChangeListeners.forEach((cb) => {
      try {
        cb(stats);
      } catch {
        // Ignore listener errors
      }
    });
  }
}

/** Global singleton */
export const requestQueue = new RequestQueue();
