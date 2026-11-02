// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';
import type { OfflineCacheStats, OfflineCacheFlushResult } from '../types/offline-cache';

/**
 * Offline cache API
 *
 * Backend endpoints (provided by OfflineCacheController, global prefix /api/v1):
 * - GET    /api/v1/pipeline/offline-cache/stats  — get cache statistics
 * - POST   /api/v1/pipeline/offline-cache/flush  — flush the buffer (send to clients)
 * - DELETE /api/v1/pipeline/offline-cache        — clear the buffer
 */
export const offlineCacheApi = {
  /** Get offline cache statistics */
  getStats(): Promise<ApiResponse<OfflineCacheStats>> {
    return client.get('/pipeline/offline-cache/stats').then((res) => res.data);
  },

  /** Flush the buffer (send cached messages to clients) */
  flush(maxBatch?: number): Promise<ApiResponse<OfflineCacheFlushResult>> {
    return client
      .post('/pipeline/offline-cache/flush', undefined, { params: { maxBatch } })
      .then((res) => res.data);
  },

  /** Clear the buffer */
  clear(): Promise<ApiResponse<null>> {
    return client.delete('/pipeline/offline-cache').then((res) => res.data);
  },
};
