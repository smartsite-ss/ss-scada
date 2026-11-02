// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';

export interface RoleInfo {
  id: string;
  name: string;
  code: string;
  description: string;
  permissions: string[];
  menuIds: string[];
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoleDto {
  name: string;
  code: string;
  description?: string;
  permissions?: string[];
  menuIds?: string[];
  sortOrder?: number;
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
  permissions?: string[];
  menuIds?: string[];
  sortOrder?: number;
}

/** Project authorization DTO */
export interface ProjectAuthDto {
  roleId: string;
  projectId: string;
  permission: 'read' | 'write' | 'admin';
}

/** Device authorization DTO */
export interface DeviceAuthDto {
  roleId: string;
  projectId: string;
  deviceId: string;
  permission: 'read' | 'write';
}

export const roleApi = {
  getRoles(): Promise<ApiResponse<RoleInfo[]>> {
    return client.get('/roles').then((res) => res.data);
  },

  getRole(id: string): Promise<ApiResponse<RoleInfo>> {
    return client.get(`/roles/${id}`).then((res) => res.data);
  },

  createRole(dto: CreateRoleDto): Promise<ApiResponse<RoleInfo>> {
    return client.post('/roles', dto).then((res) => res.data);
  },

  updateRole(id: string, dto: UpdateRoleDto): Promise<ApiResponse<RoleInfo>> {
    return client.put(`/roles/${id}`, dto).then((res) => res.data);
  },

  deleteRole(id: string): Promise<void> {
    return client.delete(`/roles/${id}`);
  },

  // ──────── Data authorization API (added in v7.0) ────────

  /** Get the project authorization list of a role */
  getProjectAuths(roleId: string): Promise<ApiResponse<ProjectAuthDto[]>> {
    return client.get(`/roles/${roleId}/project-auths`).then((res) => res.data);
  },

  /** Set the project authorizations of a role (full replacement) */
  setProjectAuths(roleId: string, auths: Omit<ProjectAuthDto, 'roleId'>[]): Promise<ApiResponse<void>> {
    return client.put(`/roles/${roleId}/project-auths`, auths).then((res) => res.data);
  },

  /** Get the device authorization list of a role under a project */
  getDeviceAuths(roleId: string, projectId: string): Promise<ApiResponse<DeviceAuthDto[]>> {
    return client.get(`/roles/${roleId}/device-auths`, { params: { projectId } }).then((res) => res.data);
  },

  /** Set the device authorizations of a role under a project (full replacement) */
  setDeviceAuths(roleId: string, projectId: string, auths: Omit<DeviceAuthDto, 'roleId' | 'projectId'>[]): Promise<ApiResponse<void>> {
    return client.put(`/roles/${roleId}/device-auths`, auths, { params: { projectId } }).then((res) => res.data);
  },

  // ──────── Permission audit log API (added in v7.0) ────────

  /** Query permission audit logs */
  getAuditLogs(params?: {
    page?: number;
    pageSize?: number;
    operatorId?: string;
    action?: string;
    targetType?: string;
    targetId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<ApiResponse<{ items: any[]; total: number }>> {
    return client.get('/roles/audit-logs', { params }).then((res) => res.data);
  },

  // ──────── Permission code registry (added in v8.0) ────────

  /** Get the permission code registry (with categories and tags, replacing the frontend hardcoded PERMISSION_CATEGORIES) */
  getPermissionsRegistry(): Promise<
    ApiResponse<{
      categories: { module: string; label: string; codes: { code: string; label: string }[] }[];
    }>
  > {
    return client.get('/system/menu/permissions/registry', { _silent: true } as any).then((res) => res.data);
  },
};
