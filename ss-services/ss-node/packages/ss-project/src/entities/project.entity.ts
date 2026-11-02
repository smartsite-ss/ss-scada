// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ProjectInfo } from './project-info.interface';

export class Project {
  /** Project unique identifier (full pinyin kebab-case; used as the directory name / DB isolation / InfluxDB bucket / Redis key) */
  projectId: string;
  /** tenantId multi-tenant reserved field (currently = projectId, preset for future multi-tenancy) */
  tenantId: string;
  /** Project name (display name) */
  projectName: string;
  description: string;
  version: string;
  config: Record<string, any>;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  pages?: any[];
  /** Project location (project directory absolute path, computed at runtime) */
  projectPath?: string;
  /** Database location (project database directory absolute path, computed at runtime) */
  databasePath?: string;
  /** Project address */
  address?: string;
  /** Longitude (decimal string) */
  longitude?: string;
  /** Latitude (decimal string) */
  latitude?: string;
  /** Person in charge */
  owner?: string;
  /** Project cover image relative path (e.g. "images/cover-1234567890.png") */
  image?: string;
  /** Project enabled state (true=enabled, false=disabled). Disabled projects do not collect, do not show in the device tree, and are not counted in home statistics */
  enabled: boolean;
  /** Page count (computed at runtime, not written into projectinfo.json) */
  pageCount?: number;
  /** Project directory total size (bytes, computed at runtime, not written into projectinfo.json) */
  folderSize?: number;

  constructor(partial?: Partial<Project>) {
    if (partial) {
      Object.assign(this, partial);
    }
    // enabled defaults to false (disabled), compatible with legacy projectinfo.json lacking this field
    if (this.enabled === undefined) {
      this.enabled = false;
    }
  }

  toProjectInfo(): ProjectInfo {
    return {
      projectId: this.projectId,
      tenantId: this.tenantId,
      projectName: this.projectName,
      description: this.description,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
      config: this.config || {},
      address: this.address,
      longitude: this.longitude,
      latitude: this.latitude,
      owner: this.owner,
      image: this.image,
      enabled: this.enabled,
    };
  }
}
