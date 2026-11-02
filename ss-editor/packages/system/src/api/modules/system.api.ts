// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type {
  ApiResponse,
  SystemConfig,
  SystemHealth,
  SystemInfo,
  ErrorLog,
  LogEntry,
  ConfigMetadata,
  OperationLog,
  ConfigItemView,
  ConfigUpdateResult,
  RestartState,
  SecurityAuditLogEntry,
} from '../types/api';

export const systemApi = {
  getHealth(): Promise<ApiResponse<SystemHealth>> {
    return client.get('/system/health').then((res) => res.data);
  },

  getHealthDetails(): Promise<ApiResponse<SystemHealth>> {
    return client.get('/health/detailed').then((res) => res.data);
  },

  getDiskInfo(): Promise<ApiResponse<any>> {
    return client.get('/health/disk-info').then((res) => res.data);
  },

  getInfo(): Promise<ApiResponse<SystemInfo>> {
    return client.get('/system/info').then((res) => res.data);
  },

  getConfigs(): Promise<ApiResponse<SystemConfig[]>> {
    return client.get('/system/configs').then((res) => res.data);
  },

  getConfig(key: string): Promise<ApiResponse<SystemConfig>> {
    return client.get(`/system/configs/${key}`).then((res) => res.data);
  },

  saveConfig(key: string, value: string, description?: string): Promise<ApiResponse<SystemConfig>> {
    return client.post('/system/configs', { key, value, description }).then((res) => res.data);
  },

  deleteConfig(key: string): Promise<void> {
    return client.delete(`/system/configs/${key}`);
  },

  getOperationLogs(params?: {
    page?: number;
    pageSize?: number;
    action?: string;
    status?: string;
    username?: string;
    userId?: string;
    resource?: string;
    startTime?: string;
    endTime?: string;
  }): Promise<ApiResponse<{ items: OperationLog[]; total: number; page: number; pageSize: number }>> {
    return client.get('/system/operation-logs', { params }).then((res) => res.data);
  },

  /** Clean up expired operation logs (removes logs older than the specified number of days) */
  cleanExpiredOperationLogs(days: number): Promise<ApiResponse<{ deleted: number }>> {
    return client.delete(`/system/operation-logs/expired?days=${days}`).then((res) => res.data);
  },

  /** Clear all operation logs */
  cleanAllOperationLogs(): Promise<ApiResponse<{ deleted: number }>> {
    return client.delete('/system/operation-logs/all').then((res) => res.data);
  },

  // ==================== Error logs ====================

  /** Query error logs (paged) */
  getErrorLogs(params?: {
    level?: string;
    module?: string;
    startTime?: string;
    endTime?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ApiResponse<{ data: ErrorLog[]; total: number; page: number; pageSize: number }>> {
    return client.get('/system/error-logs', { params }).then((res) => res.data);
  },

  /** Error log statistics */
  getErrorStats(): Promise<
    ApiResponse<{
      total: number;
      byLevel: { level: string; count: number }[];
      byModule: { module: string; count: number }[];
      recentErrors: ErrorLog[];
    }>
  > {
    return client.get('/system/error-logs/stats').then((res) => res.data);
  },

  /** Delete a single error log */
  deleteErrorLog(id: string): Promise<ApiResponse<{ ok: boolean }>> {
    return client.delete(`/system/error-logs/${id}`).then((res) => res.data);
  },

  /** Clean up expired error logs */
  cleanupErrorLogs(days: number): Promise<ApiResponse<{ ok: boolean; deleted: number }>> {
    return client.delete(`/system/error-logs/cleanup/${days}`).then((res) => res.data);
  },

  // ==================== Application runtime logs ====================

  /** Query historical logs */
  getAppLogs(params?: {
    level?: string;
    module?: string;
    keyword?: string;
    lines?: number;
  }): Promise<ApiResponse<LogEntry[]>> {
    return client.get('/system/logs', { params }).then((res) => res.data);
  },

  /** Get the log file list */
  getLogFiles(): Promise<ApiResponse<string[]>> {
    return client.get('/system/logs/files').then((res) => res.data);
  },

  /** Download a log file (returns a download URL; filename is passed via query to support subdirectory paths) */
  getLogDownloadUrl(filename: string): string {
    return `/system/logs/download?filename=${encodeURIComponent(filename)}`;
  },

  // ==================== Phase 5: system configuration management ====================

  /** Get all configuration item metadata (with category info and configuration item lists) */
  getConfigMetadata(): Promise<
    ApiResponse<{
      categories: Record<string, ConfigMetadata[]>;
      items: ConfigMetadata[];
    }>
  > {
    return client.get('/system/configs/metadata').then((res) => res.data);
  },

  /** Get all configuration items (with metadata + current value + source) */
  getAllWithMeta(): Promise<ApiResponse<ConfigItemView[]>> {
    return client.get('/system/configs/full').then((res) => res.data);
  },

  /** Update a configuration item (supports hot-reload flag, env file writing, description) */
  updateConfigWithMeta(
    key: string,
    value: string,
    options?: { writeEnv?: boolean; description?: string },
  ): Promise<ApiResponse<ConfigUpdateResult>> {
    return client
      .patch(`/system/configs/${key}`, {
        value,
        writeEnv: options?.writeEnv ?? false,
        description: options?.description,
      })
      .then((res) => res.data);
  },

  /** Get the list of configuration items pending restart */
  getRestartRequired(): Promise<ApiResponse<{ keys: string[]; count: number }>> {
    return client.get('/system/configs/restart-required/list').then((res) => res.data);
  },

  /** Clear the pending-restart list */
  clearRestartRequired(): Promise<ApiResponse<void>> {
    return client.post('/system/configs/restart-required/clear').then((res) => res.data);
  },

  // ==================== Phase 5: system restart ====================

  /** Trigger a system restart */
  triggerRestart(): Promise<ApiResponse<RestartState>> {
    return client.post('/system/restart').then((res) => res.data);
  },

  /** Get the restart status */
  getRestartStatus(): Promise<ApiResponse<RestartState>> {
    return client.get('/system/restart/status').then((res) => res.data);
  },

  /** Clear the restart marker file */
  clearRestartMarker(): Promise<ApiResponse<void>> {
    return client.post('/system/restart/clear-marker').then((res) => res.data);
  },

  // ==================== Security audit logs (S-M02) ====================

  /** Query security audit logs (paged, multi-dimensional filtering supported) */
  getSecurityAuditLogs(params?: {
    date?: string;
    type?: string;
    severity?: string;
    userId?: string;
    username?: string;
    page?: number;
    pageSize?: number;
  }): Promise<
    ApiResponse<{
      items: SecurityAuditLogEntry[];
      total: number;
      page: number;
      pageSize: number;
      date: string;
    }>
  > {
    return client.get('/system/audit-logs', { params }).then((res) => res.data);
  },

  /** Verify the audit log hash-chain integrity (tamper detection) */
  verifyAuditChain(date?: string): Promise<
    ApiResponse<{
      valid: boolean;
      totalEntries: number;
      brokenAtIndex: number | null;
      brokenReason?: string;
      date: string;
    }>
  > {
    return client
      .get('/system/audit-logs/verify', { params: { date } })
      .then((res) => res.data);
  },

  /** Get the audit log statistics overview (including hash-chain integrity status) */
  getAuditStats(date?: string): Promise<
    ApiResponse<{
      total: number;
      byType: Record<string, number>;
      bySeverity: Record<string, number>;
      chainValid: boolean;
      date: string;
    }>
  > {
    return client
      .get('/system/audit-logs/stats', { params: { date } })
      .then((res) => res.data);
  },
};