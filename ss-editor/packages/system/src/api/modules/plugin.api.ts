// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';
import type {
  PluginInfo,
  PluginStatusInfo,
  PluginConnectionSchema,
  PluginUpdateCheck,
  PluginHealthCheck,
  PluginActiveDevices,
  DeviceStats,
  PluginMonitorData,
  PluginRuntimeConfig,
} from '../types/plugin';

export const pluginApi = {
  list(params?: { status?: string; category?: string }): Promise<ApiResponse<PluginInfo[]>> {
    return client.get('/plugins', { params }).then((res) => res.data);
  },

  discover(): Promise<ApiResponse<void>> {
    return client.post('/plugins/discover').then((res) => res.data);
  },

  getByProtocol(protocol: string): Promise<ApiResponse<PluginInfo>> {
    return client.get(`/plugins/${protocol}`).then((res) => res.data);
  },

  activate(protocol: string): Promise<ApiResponse<PluginInfo>> {
    return client.post(`/plugins/${protocol}/activate`).then((res) => res.data);
  },

  deactivate(protocol: string): Promise<ApiResponse<PluginInfo>> {
    return client.post(`/plugins/${protocol}/deactivate`).then((res) => res.data);
  },

  getStatus(protocol: string): Promise<ApiResponse<PluginStatusInfo>> {
    return client.get(`/plugins/${protocol}/status`).then((res) => res.data);
  },

  getSchema(protocol: string): Promise<ApiResponse<PluginConnectionSchema>> {
    return client.get(`/plugins/${protocol}/schema`).then((res) => res.data);
  },

  checkUpdate(protocol: string): Promise<ApiResponse<PluginUpdateCheck>> {
    return client.get(`/plugins/${protocol}/check-update`).then((res) => res.data);
  },

  update(protocol: string): Promise<ApiResponse<PluginInfo>> {
    return client.post(`/plugins/${protocol}/update`).then((res) => res.data);
  },

  rollback(protocol: string): Promise<ApiResponse<PluginInfo>> {
    return client.post(`/plugins/${protocol}/rollback`).then((res) => res.data);
  },

  health(): Promise<ApiResponse<PluginHealthCheck>> {
    return client.get('/plugins/health').then((res) => res.data);
  },

  /** Validate the channel configuration */
  validateChannelConfig(protocol: string, config: Record<string, any>): Promise<ApiResponse<{ valid: boolean; errors: Array<{ field: string; message: string }> }>> {
    return client.post(`/plugins/${protocol}/validate`, config).then((res) => res.data);
  },

  /** Get the list of active devices being collected by a plugin */
  getActiveDevices(protocol: string): Promise<ApiResponse<PluginActiveDevices>> {
    return client.get(`/plugins/${protocol}/active-devices`).then((res) => res.data);
  },

  /** Get device statistics for all plugins (online/offline counts) */
  getDeviceStats(): Promise<ApiResponse<Record<string, DeviceStats>>> {
    return client.get('/plugins/device-stats').then((res) => res.data);
  },

  /** Get plugin runtime monitoring data (memory/CPU + collection logs) */
  getMonitor(protocol: string): Promise<ApiResponse<PluginMonitorData>> {
    return client.get(`/plugins/${protocol}/monitor`).then((res) => res.data);
  },

  /** Clear plugin collection logs */
  clearMonitorLogs(protocol: string): Promise<ApiResponse<{ cleared: boolean }>> {
    return client.delete(`/plugins/${protocol}/monitor/logs`).then((res) => res.data);
  },

  // -----------------------------------------------------------------------
  //  Runtime configuration persistence
  // -----------------------------------------------------------------------

  /** Get the plugin runtime configuration */
  getPluginConfig(protocol: string): Promise<ApiResponse<PluginRuntimeConfig>> {
    return client.get(`/plugins/${protocol}/config`).then((res) => res.data);
  },

  /** Update the plugin runtime configuration (e.g. isolation mode) */
  updatePluginConfig(
    protocol: string,
    config: { isolationMode?: string },
  ): Promise<ApiResponse<PluginRuntimeConfig>> {
    return client.put(`/plugins/${protocol}/config`, config).then((res) => res.data);
  },

  /** Restart the plugin (reloads the executor after configuration changes such as isolation mode) */
  restartPlugin(protocol: string): Promise<ApiResponse<{ protocol: string; isolationMode: string; elapsed: number }>> {
    return client.post(`/plugins/${protocol}/restart`).then((res) => res.data);
  },
};