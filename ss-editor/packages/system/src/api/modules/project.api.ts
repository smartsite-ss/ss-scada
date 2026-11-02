// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import { resolveBackendResourceUrl } from '../../utils/resource-url';
import type { ApiResponse, PaginatedApiResponse, PaginationParams, Project } from '../types/api';

export interface CreateProjectDto {
  projectName: string;
  /** tenantId multi-tenant reserved field (currently = projectId); auto-equals projectId when omitted */
  tenantId?: string;
  /** Project code (projectId, variable-naming format, no Chinese); auto-generated from the name's pinyin initials when omitted */
  projectId?: string;
  description?: string;
  /** Project version number; the backend defaults to 1.0.0 when omitted */
  version?: string;
  config?: Record<string, any>;
  /** Project address */
  address?: string;
  /** Longitude (decimal string) */
  longitude?: string;
  /** Latitude (decimal string) */
  latitude?: string;
  /** Person in charge */
  owner?: string;
  /** Project cover image relative path */
  image?: string;
  /**
     * Project enabled state (true = enabled, false = disabled). Defaults to false (disabled) when omitted.
     * Data collection only starts after enabling; disabling immediately stops collection and hides the project from the device tree/device monitoring.
     */
  enabled?: boolean;
}

export interface UpdateProjectDto {
  description?: string;
  version?: string;
  config?: Record<string, any>;
  address?: string;
  longitude?: string;
  latitude?: string;
  owner?: string;
  /** Project cover image relative path */
  image?: string;
  /**
     * Project enabled state (true = enabled, false = disabled).
     * Toggling dynamically starts/stops collection: enable → load devices and register tasks; disable → immediately stop collection and clean up state.
     */
  enabled?: boolean;
}

export interface ExportData {
  version: string;
  exportedAt: string;
  project: {
    name: string;
    description?: string;
    config?: Record<string, any>;
    pages: Array<{
      name: string;
      order: number;
      config?: Record<string, any>;
      graphics?: any[];
    }>;
  };
}

/** Aggregated device statistics */
export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  connecting: number;
  degraded: number;
  error: number;
  totalTags: number;
}

/** Aggregated alarm statistics */
export interface AggregatedAlarmStats {
  total: number;
  active: number;
  acknowledged: number;
  cleared: number;
  shelved: number;
}

/** System overview statistics */
export interface SystemOverview {
  projectCount: number;
  totalDbSize: number;
  totalPageCount: number;
  deviceStats: DeviceStats;
  alarmStats: AggregatedAlarmStats;
}

export const projectApi = {
  /** Get the system overview statistics */
  getOverview(): Promise<SystemOverview> {
    return client.get('/projects/overview').then((res) => {
      const d = res.data;
      return (d && d.data) || d;
    });
  },

  list(
    params: PaginationParams,
    /** Whether to include disabled projects (pass true when the admin page views all; defaults to false for home statistics/device tree, etc.) */
    includeDisabled?: boolean,
  ): Promise<PaginatedApiResponse<Project>> {
    const query = includeDisabled ? { ...params, includeDisabled: 'true' } : params;
    return client.get('/projects', { params: query }).then((res) => res.data);
  },

  getById(projectId: string): Promise<ApiResponse<Project>> {
    return client.get(`/projects/${projectId}`).then((res) => res.data);
  },

  create(dto: CreateProjectDto): Promise<ApiResponse<Project>> {
    return client.post('/projects', dto).then((res) => res.data);
  },

  update(projectId: string, dto: UpdateProjectDto): Promise<ApiResponse<Project>> {
    return client.patch(`/projects/${projectId}`, dto).then((res) => res.data);
  },

  delete(projectId: string): Promise<void> {
    return client.delete(`/projects/${projectId}`);
  },

  exportProjectZip(
    projectId: string,
    options?: { includePages?: boolean; includeProjectDb?: boolean; includeRtdb?: boolean },
  ): Promise<Blob> {
    const params = new URLSearchParams();
    if (options) {
      if (options.includePages !== undefined) params.set('includePages', String(options.includePages));
      if (options.includeProjectDb !== undefined) params.set('includeProjectDb', String(options.includeProjectDb));
      if (options.includeRtdb !== undefined) params.set('includeRtdb', String(options.includeRtdb));
    }
    const query = params.toString();
    const url = query ? `/projects/${projectId}/export?${query}` : `/projects/${projectId}/export`;
    return client.post(url, null, {
      responseType: 'blob',
      timeout: 0, // export can take a long time (VACUUM + compression + large file transfer), timeout disabled
    }).then((res) => res.data);
  },

  importProjectZip(file: File, overwrite: boolean = false): Promise<ApiResponse<Project>> {
    const formData = new FormData();
    formData.append('file', file);
    return client.post(`/projects/import?overwrite=${overwrite}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0, // import can take a long time (extraction + copying large files + database initialization), timeout disabled
    }).then((res) => res.data);
  },

  checkProjectExists(projectId: string): Promise<boolean> {
    return client.get(`/projects/${projectId}`).then(() => true).catch(() => false);
  },

  savePages(projectId: string, pages: Array<Record<string, any>>): Promise<ApiResponse<any>> {
    return client.post(`/projects/${projectId}/pages/save`, { pages }).then((res) => res.data);
  },

  getProjectsDir(projectId: string): Promise<ApiResponse<{ projectsDir: string; exists: boolean }>> {
    return client.get(`/projects/${projectId}/pages/projects-dir`).then((res) => res.data);
  },

  /** Export all project pages as a ZIP */
  exportPagesZip(projectId: string): Promise<Blob> {
    return client.post(`/projects/${projectId}/pages/export`, null, {
      responseType: 'blob',
      timeout: 0, // page export may contain many files, timeout disabled
    }).then((res) => res.data);
  },

  /** Import pages into a project (ZIP file) */
  importPagesZip(projectId: string, file: File, overwrite: boolean = false): Promise<ApiResponse<{ importedCount: number; warnings: string[] }>> {
    const formData = new FormData();
    formData.append('file', file);
    return client.post(`/projects/${projectId}/pages/import?overwrite=${overwrite}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((res) => res.data);
  },

  /** Diagnose project resource integrity */
  diagnose(projectId: string): Promise<DiagnoseResult> {
    return client.post<ApiResponse<DiagnoseResult>>(`/projects/${projectId}/diagnose`).then((res) => res.data.data);
  },

  /** Get project management info */
  getManageInfo(projectId: string): Promise<ManageInfo> {
    return client.get<ApiResponse<ManageInfo>>(`/projects/${projectId}/manage-info`).then((res) => res.data.data);
  },

  /** Initialize missing project resources */
  initResources(projectId: string, resources?: string[]): Promise<{
    initialized: string[];
    skipped: string[];
    warnings: string[];
    healthAfter?: string;
  }> {
    const body: Record<string, any> = {};
    if (resources && resources.length > 0) {
      body.resources = resources;
    }
    return client.post<ApiResponse<{
      initialized: string[];
      skipped: string[];
      warnings: string[];
      healthAfter?: string;
    }>>(`/projects/${projectId}/init-resources`, body).then((res) => res.data.data);
  },

  /** Get the default project configuration */
  getDefaultProject(): Promise<ApiResponse<{ projectId: string | null }>> {
    return client.get<ApiResponse<{ projectId: string | null }>>('/projects/default-config').then((res) => res.data);
  },

  /** Set the default project */
  setDefaultProject(projectId: string): Promise<ApiResponse<{ success: boolean; projectId: string }>> {
    return client.put<ApiResponse<{ success: boolean; projectId: string }>>('/projects/default-config', { projectId }).then((res) => res.data);
  },

  /** Clear the default project */
  clearDefaultProject(): Promise<ApiResponse<{ success: boolean }>> {
    return client.delete<ApiResponse<{ success: boolean }>>('/projects/default-config').then((res) => res.data);
  },

  /** Upload the project cover image (multipart/form-data) */
  uploadImage(projectId: string, file: File): Promise<ApiResponse<{ success: boolean; image: string }>> {
    const formData = new FormData();
    formData.append('file', file);
    return client.post(`/projects/${projectId}/image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((res) => res.data);
  },

  /** Get the project cover image URL (usable directly in <img :src>; the backend @Public requires no auth) */
  getImageUrl(projectId: string): string {
    // <img> does not go through the fetch/XHR interceptor; the desktop app needs it rewritten to the backend absolute address (see resource-url.ts)
    return resolveBackendResourceUrl(`/api/v1/projects/${projectId}/image`);
  },
};

import type { DiagnoseResult } from '../../types/api';

/** Project management info */
export interface ManageInfo {
  projectName: string;
  /** Multi-tenant reserved (currently = projectId) */
  tenantId: string;
  projectId: string;
  version: string;
  description: string;
  projectPath: string;
  databasePath: string;
  rtdbPath: string;
  pageCount: number;
  dbSize: number;
  rtdbSize: number;
  dbMode: string;
  image?: string;
  address?: string;
  longitude?: string;
  latitude?: string;
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}