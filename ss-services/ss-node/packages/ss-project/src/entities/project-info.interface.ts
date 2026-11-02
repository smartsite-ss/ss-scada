// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export interface ProjectInfo {
  /** Project unique identifier (full pinyin kebab-case; used as the directory name / DB isolation / InfluxDB bucket / Redis key) */
  projectId: string;
  /** tenantId multi-tenant reserved field (currently = projectId, preset for future multi-tenancy) */
  tenantId: string;
  /** Project name (display name) */
  projectName: string;
  description: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  config: Record<string, any>;
  /** Project address */
  address?: string;
  /** Longitude (decimal string, e.g. "116.404") */
  longitude?: string;
  /** Latitude (decimal string, e.g. "39.915") */
  latitude?: string;
  /** Person in charge */
  owner?: string;
  /** Project cover image relative path (e.g. "images/cover-1234567890.png") */
  image?: string;
  /** Project enabled state (true=enabled, false=disabled). Disabled projects do not collect, do not show in the device tree, and are not counted in home statistics */
  enabled?: boolean;
}
