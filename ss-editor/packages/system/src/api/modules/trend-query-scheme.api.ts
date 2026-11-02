// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';

/** Trend query scheme */
export interface TrendQueryScheme {
  id: string;
  name: string;
  projectId: string;
  deviceId: string;
  tagIds: string;
  startTime: string | null;
  endTime: string | null;
  interpolationMode: string;
  interpolationInterval: number;
  presetRange: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface CreateTrendQuerySchemeDto {
  name: string;
  projectId: string;
  deviceId: string;
  tagIds: string[];
  startTime?: string;
  endTime?: string;
  interpolationMode?: string;
  interpolationInterval?: number;
  presetRange?: string;
}

export const trendQuerySchemeApi = {
  /** Get all query schemes under a project */
  list(projectId: string): Promise<TrendQueryScheme[]> {
    return client
      .get('/trend-query-schemes', { params: { projectId } })
      .then((res) => res.data?.data ?? res.data);
  },

  /** Create a query scheme */
  create(dto: CreateTrendQuerySchemeDto): Promise<TrendQueryScheme> {
    return client
      .post('/trend-query-schemes', dto)
      .then((res) => res.data?.data ?? res.data);
  },

  /** Update a query scheme */
  update(id: string, dto: Partial<CreateTrendQuerySchemeDto>): Promise<TrendQueryScheme> {
    return client
      .patch(`/trend-query-schemes/${id}`, dto)
      .then((res) => res.data?.data ?? res.data);
  },

  /** Delete a query scheme */
  delete(id: string): Promise<{ success: boolean }> {
    return client
      .delete(`/trend-query-schemes/${id}`)
      .then((res) => res.data?.data ?? res.data);
  },
};