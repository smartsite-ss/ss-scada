// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Request deduplication utility
 *
 * GET requests with identical parameters share the same Promise while pending,
 * avoiding duplicate network overhead when multiple components fire the same request simultaneously.
 *
 * Usage:
 *   const dedupKey = `GET:/api/v1/projects/${projectId}/devices`;
 *   const result = await requestDedup.dedup(dedupKey, () => client.get(url));
 *
 * Cancel requests on component unmount:
 *   const controller = new AbortController();
 *   onMounted(() => fetchData(controller.signal));
 *   onUnmounted(() => controller.abort());
 */

type PendingEntry = {
  promise: Promise<any>;
  controller: AbortController;
};

class RequestDedup {
  private pending = new Map<string, PendingEntry>();

  /**
   * Execute a deduplicated request: requests with the same key share the same Promise while pending
   * @param key Dedup key (recommended format: `METHOD:URL`)
   * @param fn Request factory function receiving an AbortSignal
   * @returns The request result
   */
  async dedup<T>(key: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) {
      return existing.promise as Promise<T>;
    }

    const controller = new AbortController();
    const promise = fn(controller.signal)
      .finally(() => {
        // Remove from pending after the request completes, regardless of success or failure
        this.pending.delete(key);
      });

    this.pending.set(key, { promise, controller });
    return promise;
  }

  /**
   * Cancel the pending request of a specified key
   */
  cancel(key: string): void {
    const entry = this.pending.get(key);
    if (entry) {
      entry.controller.abort();
      this.pending.delete(key);
    }
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    this.pending.forEach((entry) => {
      entry.controller.abort();
    });
    this.pending.clear();
  }

  /**
   * Check whether there are pending requests
   */
  hasPending(key: string): boolean {
    return this.pending.has(key);
  }
}

export const requestDedup = new RequestDedup();