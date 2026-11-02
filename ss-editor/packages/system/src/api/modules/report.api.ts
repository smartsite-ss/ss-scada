// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse, PaginatedApiResponse } from '../types/api';

// ==================== Type definitions ====================

/** Report type (consistent with the backend ReportType enum) */
export type ReportType = 'daily' | 'monthly' | 'custom' | 'alarm' | 'trend';

/** Report status (consistent with the backend ReportStatus enum) */
export type ReportStatus = 'generating' | 'completed' | 'failed';

/** Report granularity */
export type ReportGranularity = 'hour' | 'day' | 'month';

/** Report trend direction */
export type ReportTrend = 'up' | 'down' | 'stable';

/** Chart type */
export type ReportChartType = 'line' | 'bar' | 'pie' | 'table';

/** Report summary */
export interface ReportSummary {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  totalAlarms: number;
  avgDataQuality: number;
  [key: string]: unknown;
}

/** Report metric item */
export interface ReportItem {
  label: string;
  value: number | string;
  unit?: string;
  trend?: ReportTrend;
  changePercent?: number;
}

/** Chart dataset */
export interface ReportChartDataset {
  label: string;
  data: number[];
  color?: string;
}

/** Report chart */
export interface ReportChart {
  type: ReportChartType;
  title: string;
  labels: string[];
  datasets: ReportChartDataset[];
}

/** Report data (nested under Report.data) */
export interface ReportData {
  summary?: ReportSummary;
  items?: ReportItem[];
  charts?: ReportChart[];
}

/** Report configuration */
export interface ReportConfig {
  timeRange?: { start: string; end: string };
  metrics?: string[];
  tagIds?: string[];
  deviceIds?: string[];
  alarmLevels?: string[];
  granularity?: ReportGranularity;
  groupBy?: string[];
}

/**
 * Report response object (consistent with the backend CachedReport structure)
 * Note: summary/items/charts are nested under the data field
 */
export interface Report {
  id: string;
  type: ReportType;
  projectId: string;
  date?: string;
  month?: string;
  dateRange?: string;
  config?: Record<string, unknown>;
  generatedAt: string;
  data: ReportData;
}

/** Export report result */
export interface ReportExportResult {
  reportId: string;
  format: 'pdf' | 'excel';
  fileName: string;
  filePath: string;
  fileUrl: string;
  exportedAt: string;
  status: ReportStatus;
}

/** Saved report configuration */
export interface SavedReportConfig {
  id: string;
  projectId: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  createdAt: string;
}

// ==================== DTO definitions ====================

export interface GenerateDailyReportDto {
  date: string;
}

export interface GenerateMonthlyReportDto {
  month: string;
}

export interface GenerateCustomReportDto {
  startDate: string;
  endDate: string;
  metrics?: string[];
  tagIds?: string[];
  deviceIds?: string[];
  granularity?: ReportGranularity;
}

export interface AlarmReportDto {
  startDate: string;
  endDate: string;
  levels?: string[];
  deviceIds?: string[];
}

export interface TrendReportDto {
  startDate: string;
  endDate: string;
  tagIds: string[];
  granularity?: ReportGranularity;
}

export interface ExportReportDto {
  format: 'pdf' | 'excel';
}

export interface ReportQueryParams {
  type?: ReportType;
  status?: ReportStatus;
  page?: number;
  pageSize?: number;
}

export interface SaveReportConfigDto {
  name: string;
  description?: string;
  config: Record<string, unknown>;
}

// ==================== API methods ====================

const buildUrl = (projectId: string, path: string) =>
  `/projects/${projectId}/reports${path}`;

export const reportApi = {
  /** Generate a daily report */
  generateDaily(projectId: string, dto: GenerateDailyReportDto): Promise<ApiResponse<Report>> {
    return client.post(buildUrl(projectId, '/daily'), dto).then((res) => res.data);
  },

  /** Generate a monthly report */
  generateMonthly(projectId: string, dto: GenerateMonthlyReportDto): Promise<ApiResponse<Report>> {
    return client.post(buildUrl(projectId, '/monthly'), dto).then((res) => res.data);
  },

  /** Generate a custom report */
  generateCustom(projectId: string, dto: GenerateCustomReportDto): Promise<ApiResponse<Report>> {
    return client.post(buildUrl(projectId, '/custom'), dto).then((res) => res.data);
  },

  /** Generate an alarm report */
  generateAlarm(projectId: string, dto: AlarmReportDto): Promise<ApiResponse<Report>> {
    return client.post(buildUrl(projectId, '/alarm'), dto).then((res) => res.data);
  },

  /** Generate a trend report */
  generateTrend(projectId: string, dto: TrendReportDto): Promise<ApiResponse<Report>> {
    return client.post(buildUrl(projectId, '/trend'), dto).then((res) => res.data);
  },

  /**
     * Export a report
     * The backend route is POST projects/:projectId/reports/:reportId/export (not GET)
     */
  exportReport(
    projectId: string,
    reportId: string,
    dto: ExportReportDto,
  ): Promise<ApiResponse<ReportExportResult>> {
    return client.post(buildUrl(projectId, `/${reportId}/export`), dto).then((res) => res.data);
  },

  /** Query the report list */
  queryReports(
    projectId: string,
    params?: ReportQueryParams,
  ): Promise<PaginatedApiResponse<Report>> {
    return client.get(buildUrl(projectId, ''), { params }).then((res) => res.data);
  },

  /** Save a report configuration */
  saveReportConfig(
    projectId: string,
    dto: SaveReportConfigDto,
  ): Promise<ApiResponse<SavedReportConfig>> {
    return client.post(buildUrl(projectId, '/configs'), dto).then((res) => res.data);
  },

  /** Get the report configuration list */
  getReportConfigs(projectId: string): Promise<ApiResponse<SavedReportConfig[]>> {
    return client.get(buildUrl(projectId, '/configs')).then((res) => res.data);
  },
};
