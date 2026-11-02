// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type {
  ApiResponse,
  PaginatedApiResponse,
  PaginationParams,
  Device,
  DataTag,
  DeviceGroup,
  DeviceTree,
  DeviceDiagnosticResult,
  PingResult,
} from '../types/api';

export interface CreateDeviceDto {
  deviceCode: string;
  deviceName: string;
  nameAlias?: string;
  description?: string;
  type?: string;                           // device type (derived from the template, no longer manually selected)
  templateId: string;                     // device template ID (required)
  templateVersion?: string;               // template version, defaults to the latest
  driver: string;                         // collection driver plugin (required, ss-collector plugin name)
  connection: Record<string, any>;        // channel-specific configuration (required)
  scanRate?: number;
  offlinePeriod?: number;
  heartbeatInterval?: number;
  groupId?: string;
}

export interface UpdateDeviceDto {
  deviceCode?: string;
  deviceName?: string;
  nameAlias?: string;
  description?: string;
  type?: string;
  templateId?: string;
  driver?: string;
  config?: Record<string, any>;
  connection?: Record<string, any>;
  scanRate?: number;
  offlinePeriod?: number;
  groupId?: string;
}

export interface CreateDataTagDto {
  name: string;
  address: string;
  dataType: string;
  deviceId?: string;
  projectId?: string;
  scale?: number;
  offset?: number;
  scanRate?: number;
  config?: Record<string, unknown>;
}

export interface UpdateDataTagDto {
  name?: string;
  address?: string;
  dataType?: string;
  scale?: number;
  offset?: number;
  scanRate?: number;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface CreateDeviceGroupDto {
  name: string;
  description?: string;
  parentId?: string;
  sortOrder?: number;
}

export interface UpdateDeviceGroupDto {
  name?: string;
  description?: string;
  parentId?: string;
  sortOrder?: number;
}

export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  connecting: number;
  degraded: number;
  error: number;
  totalTags: number;
}

const buildUrl = (projectId: string, path: string) =>
  `/projects/${projectId}/devices${path}`;

export const deviceApi = {
  /** Get device statistics (total, counts per status, total tags) */
  getDeviceStats(projectId: string): Promise<ApiResponse<DeviceStats>> {
    return client.get(buildUrl(projectId, '/stats')).then((res) => res.data);
  },

  list(projectId: string, params?: PaginationParams): Promise<PaginatedApiResponse<Device>> {
    const queryParams = params ? {
      page: params.page,
      pageSize: params.pageSize,
      search: params.keyword,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    } : undefined;
    return client.get(buildUrl(projectId, ''), { params: queryParams }).then((res) => res.data);
  },

  getById(projectId: string, deviceId: string): Promise<ApiResponse<Device>> {
    return client.get(buildUrl(projectId, `/${deviceId}`)).then((res) => res.data);
  },

  create(projectId: string, dto: CreateDeviceDto): Promise<ApiResponse<Device>> {
    return client.post(buildUrl(projectId, ''), dto).then((res) => res.data);
  },

  update(projectId: string, deviceId: string, dto: UpdateDeviceDto): Promise<ApiResponse<Device>> {
    return client.patch(buildUrl(projectId, `/${deviceId}`), dto).then((res) => res.data);
  },

  delete(projectId: string, deviceId: string): Promise<void> {
    return client.delete(buildUrl(projectId, `/${deviceId}`));
  },

  addTag(projectId: string, deviceId: string, dto: CreateDataTagDto): Promise<ApiResponse<DataTag>> {
    return client.post(buildUrl(projectId, `/${deviceId}/tags`), dto).then((res) => res.data);
  },

  updateTag(projectId: string, deviceId: string, tagId: string, dto: UpdateDataTagDto): Promise<ApiResponse<DataTag>> {
    return client.patch(buildUrl(projectId, `/${deviceId}/tags/${tagId}`), dto).then((res) => res.data);
  },

  deleteTag(projectId: string, deviceId: string, tagId: string): Promise<void> {
    return client.delete(buildUrl(projectId, `/${deviceId}/tags/${tagId}`));
  },

  /**
     * Query the tag list of a device (the single authoritative entry shared by the admin and mobile clients, see architecture design 07-API design spec §3.3).
     * Route: GET /projects/:projectId/devices/:deviceId/tags
     * Replaces the old implementation that misread deviceApi.getById().tags (the backend findOne did not join tags, yielding undefined).
     */
  listTagsByDevice(
    projectId: string,
    deviceId: string,
    params?: { page?: number; pageSize?: number; keyword?: string; dataType?: string; enabled?: boolean },
  ): Promise<PaginatedApiResponse<DataTag>> {
    return client.get(buildUrl(projectId, `/${deviceId}/tags`), { params }).then((res) => res.data);
  },

  listGroups(projectId: string): Promise<ApiResponse<DeviceGroup[]>> {
    return client.get(buildUrl(projectId, '/groups')).then((res) => res.data);
  },

  getGroupTree(projectId: string): Promise<ApiResponse<DeviceTree[]>> {
    return client.get(buildUrl(projectId, '/groups/tree')).then((res) => res.data);
  },

  getGroupById(projectId: string, groupId: string): Promise<ApiResponse<DeviceGroup>> {
    return client.get(buildUrl(projectId, `/groups/${groupId}`)).then((res) => res.data);
  },

  createGroup(projectId: string, dto: CreateDeviceGroupDto): Promise<ApiResponse<DeviceGroup>> {
    return client.post(buildUrl(projectId, '/groups'), dto).then((res) => res.data);
  },

  updateGroup(projectId: string, groupId: string, dto: UpdateDeviceGroupDto): Promise<ApiResponse<DeviceGroup>> {
    return client.patch(buildUrl(projectId, `/groups/${groupId}`), dto).then((res) => res.data);
  },

  deleteGroup(projectId: string, groupId: string): Promise<void> {
    return client.delete(buildUrl(projectId, `/groups/${groupId}`));
  },

  getGroupPath(projectId: string, groupId: string): Promise<ApiResponse<DeviceGroup[]>> {
    return client.get(buildUrl(projectId, `/groups/${groupId}/path`)).then((res) => res.data);
  },

  moveDevice(projectId: string, deviceId: string, targetGroupId: string | null): Promise<ApiResponse<Device>> {
    return client.post(buildUrl(projectId, `/${deviceId}/move`), { targetGroupId }).then((res) => res.data);
  },

  diagnostic(projectId: string, deviceId: string): Promise<ApiResponse<DeviceDiagnosticResult>> {
    return client.post(buildUrl(projectId, `/${deviceId}/diagnostic`)).then((res) => res.data);
  },

  ping(projectId: string, deviceId: string, host: string, port?: number): Promise<ApiResponse<PingResult>> {
    return client.post(buildUrl(projectId, `/${deviceId}/ping`), null, { params: { host, port } }).then((res) => res.data);
  },

  // ===== Extended methods: data queries and template operations =====

  getLatestValues(projectId: string, deviceId: string): Promise<ApiResponse<Record<string, any>>> {
    return client.get(buildUrl(projectId, `/${deviceId}/data/latest`)).then((res) => res.data);
  },

  getHistory(projectId: string, deviceId: string, params: { tagId: string; start: string; end: string }): Promise<ApiResponse<any>> {
    return client.get(buildUrl(projectId, `/${deviceId}/data/history`), { params }).then((res) => res.data);
  },

  writeTagValue(projectId: string, deviceId: string, body: { tagId: string; value: any }): Promise<ApiResponse<any>> {
    return client.post(buildUrl(projectId, `/${deviceId}/data/write`), body).then((res) => res.data);
  },

  /** Write a device tag value (writes to the real device via the protocol adapter) */
  controlWriteTag(projectId: string, deviceId: string, tagId: string, body: { value: any; reason?: string }): Promise<ApiResponse<any>> {
    return client.post(buildUrl(projectId, `/${deviceId}/tags/${tagId}/write`), body).then((res) => res.data);
  },

  /** Query write-back operation logs (paged + filtered, single device) */
  queryControlLogs(projectId: string, deviceId: string, params?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    startDate?: string;
    endDate?: string;
    success?: boolean;
  }): Promise<PaginatedApiResponse<any>> {
    return client.get(buildUrl(projectId, `/${deviceId}/control-logs`), { params }).then((res) => res.data);
  },

  /** Query project-level write-back operation logs (paged + filtered, across devices) */
  queryProjectControlLogs(projectId: string, params?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    startDate?: string;
    endDate?: string;
    success?: boolean;
    deviceName?: string;
  }): Promise<PaginatedApiResponse<any>> {
    return client.get(buildUrl(projectId, `/control-logs`), { params }).then((res) => res.data);
  },

  applyTemplate(projectId: string, deviceId: string, templateId: string): Promise<ApiResponse<any>> {
    return client.post(buildUrl(projectId, `/${deviceId}/templates/${templateId}/apply`)).then((res) => res.data);
  },

  syncTemplate(projectId: string, deviceId: string, templateId: string): Promise<ApiResponse<any>> {
    return client.post(buildUrl(projectId, `/${deviceId}/templates/${templateId}/sync`)).then((res) => res.data);
  },

  exportSnapshot(projectId: string): Promise<ApiResponse<any>> {
    return client.get(buildUrl(projectId, '/data/snapshot')).then((res) => res.data);
  },

  /** Ping a host address directly (without depending on a device object) */
  pingDevice(host: string, port?: number): Promise<ApiResponse<PingResult>> {
    return client.post('/devices/ping', { host, port }).then((res) => res.data);
  },
};