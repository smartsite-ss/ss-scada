// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type {
  ApiResponse,
  EventLogItem,
  EventLogQueryParams,
} from '../types/api';

/**
 * Event log API — calls the backend /system/event-logs endpoints
 *
 * Follows the getOperationLogs pattern of system.api.ts:
 * - Sends GET requests via client (the axios instance)
 * - Passes query parameters via params
 * - Returns the ApiResponse<T> format
 */
export const eventLogApi = {
  /** Query event logs (paged, multi-dimensional filtering supported) */
  getEventLogs(
    params?: EventLogQueryParams,
  ): Promise<ApiResponse<{ items: EventLogItem[]; total: number }>> {
    return client.get('/system/event-logs', { params }).then((res) => res.data);
  },

  /** Query event log details (including subscriber tracing records and business effects) */
  getEventLogDetail(id: string): Promise<ApiResponse<EventLogItem>> {
    return client.get(`/system/event-logs/${id}`).then((res) => res.data);
  },

  /** Query failed/partially failed events (ops diagnostics, not paged) */
  getFailedEventLogs(
    params?: { projectId?: string; startTime?: string; endTime?: string },
  ): Promise<ApiResponse<EventLogItem[]>> {
    return client.get('/system/event-logs/failed', { params }).then((res) => res.data);
  },

  /** Clear all event logs (ops operation, irreversible) */
  clearEventLogs(): Promise<ApiResponse<{ deleted: number }>> {
    return client.delete('/system/event-logs').then((res) => res.data);
  },
};
