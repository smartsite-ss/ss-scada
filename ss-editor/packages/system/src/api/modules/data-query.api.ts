// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { DataPoint, AggregatedPoint, HistoryQueryParams, AggregatedQueryParams } from '../types/data-query';

/**
 * Data query API
 *
 * Backend endpoints (provided by DataQueryController, global prefix /api/v1):
 * - GET /api/v1/data/history     — query historical data
 * - GET /api/v1/data/latest      — get the latest value
 * - GET /api/v1/data/aggregated  — get aggregated data
 * - GET /api/v1/data/all-latest  — get all latest values in a project
 */
export const dataQueryApi = {
  /** Query historical data */
  getHistory(params: HistoryQueryParams): Promise<DataPoint[]> {
    return client
      .get('/data/history', {
        params: {
          tagIds: params.tagIds?.join(','),
          startTime: params.startTime?.toISOString(),
          endTime: params.endTime?.toISOString(),
          limit: params.limit,
          offset: params.offset,
          order: params.order,
          aggFunction: params.aggregation?.function,
          aggInterval: params.aggregation?.interval,
        },
      })
      .then((res) => res.data?.data ?? res.data);
  },

  /** Get the latest value of a specified tag */
  getLatest(tagIds: string[]): Promise<DataPoint[]> {
    return client
      .get('/data/latest', { params: { tagIds: tagIds.join(',') } })
      .then((res) => res.data?.data ?? res.data);
  },

  /** Get aggregated data */
  getAggregated(params: AggregatedQueryParams): Promise<AggregatedPoint[]> {
    return client
      .get('/data/aggregated', {
        params: {
          tagIds: params.tagIds.join(','),
          startTime: params.startTime.toISOString(),
          endTime: params.endTime.toISOString(),
          function: params.function,
          interval: params.interval,
        },
      })
      .then((res) => res.data?.data ?? res.data);
  },

  /** Get the latest values of all tags in a project */
  getAllLatest(projectId: string): Promise<DataPoint[]> {
    return client
      .get('/data/all-latest', { params: { projectId } })
      .then((res) => res.data?.data ?? res.data);
  },

  /**
     * Trend chart query (uses POST /data/trend/query, supports LTTB downsampling + interpolation)
     */
  queryTrend(params: {
    tagIds: string[];
    startTime: string;
    endTime: string;
    maxPoints?: number;
    projectId?: string;
    /** Interpolation mode: raw | linear | step */
    interpolation?: string;
    /** Interpolation interval (milliseconds) */
    interval?: number;
  }): Promise<{ data: Array<{ tagId: string; data: Array<{ timestamp: string; value: number | null }> }>; pagination: { total: number } }> {
    return client
      .post('/data/trend/query', params)
      .then((res) => ({ data: res.data?.data, pagination: res.data?.pagination }));
  },
};
