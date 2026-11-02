// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';

/** Service name (string type, supports custom third-party services) */
export type BaseServiceName = string;

/** Service running state */
export type ServiceRunStatus = 'running' | 'stopped' | 'error' | 'unknown';

/** Service status information */
export interface ServiceStatus {
  id: string;
  name: BaseServiceName;
  displayName: string;
  status: ServiceRunStatus;
  pid?: number;
  port?: number;
  portReachable: boolean;
  processRunning: boolean;
  startedAt?: string;
  uptimeSeconds?: number;
  binaryExists: boolean;
  configExists: boolean;
  dataDirExists: boolean;
  logDirExists: boolean;
  autoStart: boolean;
  processGuard: boolean;
  errorMessage?: string;
}

/** Service operation result */
export interface ServiceActionResult {
  success: boolean;
  action: 'start' | 'stop' | 'restart';
  name: BaseServiceName;
  message: string;
  pid?: number;
  durationMs: number;
}

/** Service configuration entity */
export interface BaseServiceConfig {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  binaryPath?: string;
  startArgs?: string;
  configPath?: string;
  logDir?: string;
  dataDir?: string;
  processName?: string;
  port?: number;
  startScript?: string;
  stopScript?: string;
  enabled: boolean;
  autoStart: boolean;
  processGuard: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Create service DTO */
export interface CreateBaseServiceDto {
  name: string;
  displayName: string;
  description?: string;
  binaryPath?: string;
  startArgs?: string;
  configPath?: string;
  logDir?: string;
  dataDir?: string;
  processName?: string;
  port?: number;
  startScript?: string;
  stopScript?: string;
  enabled?: boolean;
  autoStart?: boolean;
  processGuard?: boolean;
  sortOrder?: number;
}

/** Update service DTO */
export type UpdateBaseServiceDto = Partial<CreateBaseServiceDto>

/** Config file information */
export interface ServiceConfig {
  content: string;
  path: string;
  size: number;
  updatedAt?: string;
}

/** Save config result */
export interface SaveConfigResult {
  success: boolean;
  path: string;
  backupPath?: string;
}

/** Log entry */
export interface ServiceLogEntry {
  filename: string;
  size: number;
  modifiedAt?: string;
  lines: string[];
  totalLines: number;
}

/** Log cleanup result */
export interface ClearLogsResult {
  cleared: string[];
}

/** InfluxDB Setup status */
export interface InfluxSetupStatus {
  reachable: boolean;
  initialized: boolean;
  tokenConfigured: boolean;
}

/** InfluxDB Setup result */
export interface InfluxSetupResult {
  success: boolean;
  message: string;
  token?: string;
  org?: string;
  bucket?: string;
  details?: Record<string, any>;
}

/** InfluxDB health status */
export interface InfluxHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version?: string;
  commit?: string;
  responseTimeMs?: number;
  error?: string;
}

/** InfluxDB Bucket */
export interface InfluxBucket {
  id: string;
  name: string;
  orgID?: string;
  description?: string;
  retentionPeriodHrs?: number;
  storageBytes?: number;
  createdAt?: string;
  updatedAt?: string;
  /** measurement count */
  measurementCount?: number;
  /** Last write time (ISO string) */
  lastWriteAt?: string;
  /** Total data points (approximate) */
  dataPointCount?: number;
}

/** InfluxDB environment configuration */
export interface InfluxConfig {
  url: string;
  org: string;
  bucket: string;
  tokenConfigured: boolean;
  tokenMasked: string;
}

/** NanoMQ health status */
export interface NanomqHealthStatus {
  reachable: boolean;
  responseTimeMs?: number;
  error?: string;
}

export const baseServicesApi = {
  /** Get all base service statuses */
  list(): Promise<ApiResponse<ServiceStatus[]>> {
    return client.get('/base-services').then((res) => res.data);
  },

  /** Get all service configuration list */
  listConfig(): Promise<ApiResponse<BaseServiceConfig[]>> {
    return client.get('/base-services/config/list').then((res) => res.data);
  },

  /** Add a service */
  create(dto: CreateBaseServiceDto): Promise<ApiResponse<BaseServiceConfig>> {
    return client.post('/base-services', dto).then((res) => res.data);
  },

  /** Update a service configuration */
  update(name: string, dto: UpdateBaseServiceDto): Promise<ApiResponse<BaseServiceConfig>> {
    return client.put(`/base-services/${name}`, dto).then((res) => res.data);
  },

  /** Delete a service */
  remove(name: string): Promise<ApiResponse<{ success: boolean }>> {
    return client.delete(`/base-services/${name}`).then((res) => res.data);
  },

  /** Get a single service status */
  getStatus(name: BaseServiceName): Promise<ApiResponse<ServiceStatus>> {
    return client.get(`/base-services/${name}/status`).then((res) => res.data);
  },

  /** Start a service */
  start(name: BaseServiceName): Promise<ApiResponse<ServiceActionResult>> {
    return client.post(`/base-services/${name}/start`).then((res) => res.data);
  },

  /** Stop a service */
  stop(name: BaseServiceName): Promise<ApiResponse<ServiceActionResult>> {
    return client.post(`/base-services/${name}/stop`).then((res) => res.data);
  },

  /** Restart a service */
  restart(name: BaseServiceName): Promise<ApiResponse<ServiceActionResult>> {
    return client.post(`/base-services/${name}/restart`).then((res) => res.data);
  },

  /** Read the config file */
  getConfig(name: BaseServiceName): Promise<ApiResponse<ServiceConfig>> {
    return client.get(`/base-services/${name}/config`).then((res) => res.data);
  },

  /** Save the config file */
  saveConfig(name: BaseServiceName, content: string): Promise<ApiResponse<SaveConfigResult>> {
    return client.put(`/base-services/${name}/config`, { content }).then((res) => res.data);
  },

  /** Get logs */
  getLogs(name: BaseServiceName, limit?: number): Promise<ApiResponse<ServiceLogEntry[]>> {
    const params = limit ? { limit } : {};
    return client.get(`/base-services/${name}/logs`, { params }).then((res) => res.data);
  },

  /** Clear logs */
  clearLogs(name: BaseServiceName): Promise<ApiResponse<ClearLogsResult>> {
    return client.delete(`/base-services/${name}/logs`).then((res) => res.data);
  },

  // ==================== InfluxDB initialization ====================

  /** Detect the InfluxDB setup status */
  checkInfluxSetup(): Promise<ApiResponse<InfluxSetupStatus>> {
    return client.get('/base-services/influxdb/setup/status').then((res) => res.data);
  },

  /** Detect the InfluxDB running health status */
  checkInfluxHealth(): Promise<ApiResponse<InfluxHealthStatus>> {
    return client.get('/base-services/influxdb/health').then((res) => res.data);
  },

  /** One-click InfluxDB initialization */
  setupInfluxDB(body?: { username?: string; password?: string; org?: string; bucket?: string }): Promise<ApiResponse<InfluxSetupResult>> {
    return client.post('/base-services/influxdb/setup', body).then((res) => res.data);
  },

  /** Get the InfluxDB bucket list */
  listInfluxBuckets(): Promise<ApiResponse<InfluxBucket[]>> {
    return client.get('/base-services/influxdb/buckets').then((res) => res.data);
  },

  /** Export InfluxDB bucket data as CSV (returns a Blob, carries authentication) */
  exportBucketData(bucketName: string, start?: string): Promise<Blob> {
    return client
      .get(`/base-services/influxdb/buckets/${encodeURIComponent(bucketName)}/export`, {
        params: { start },
        responseType: 'blob',
      })
      .then((res) => res.data);
  },

  /** Get the InfluxDB environment configuration */
  getInfluxConfig(): Promise<ApiResponse<InfluxConfig>> {
    return client.get('/base-services/influxdb/config').then((res) => res.data);
  },

  // ==================== NanoMQ health detection ====================

  /** Detect the NanoMQ MQTT broker health status */
  checkNanomqHealth(): Promise<ApiResponse<NanomqHealthStatus>> {
    return client.get('/base-services/nanomq/health').then((res) => res.data);
  },
};
