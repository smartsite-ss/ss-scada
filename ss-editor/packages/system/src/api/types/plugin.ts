// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export type PluginCategory = 'industrial_bus' | 'iot' | 'power' | 'building' | 'custom';
export type PluginStatus = 'active' | 'inactive' | 'registered' | 'error' | 'unregistered';
export type PluginTransport = 'tcp' | 'serial' | 'ws' | 'tls' | 'other';

export interface PluginInfo {
  protocol: string;
  displayName: string;
  version: string;
  description?: string;
  category: PluginCategory;
  transport: PluginTransport;
  status: PluginStatus;
  isolationMode: string;
  supportedDataTypes: string[];
  defaultConnection: Record<string, any>;
  enabledByDefault: boolean;
  tags?: string[];
  registeredAt?: string;
  activatedAt?: string;
  metrics?: PluginMetrics;
  errorMessage?: string;
  /** Runtime process name (child_process / in_process mode) */
  processName?: string;
  /** Runtime process PID (child_process / in_process mode) */
  processId?: number;
  /** Runtime thread ID (worker_thread mode only) */
  threadId?: number;
}

export interface PluginMetrics {
  totalConnections: number;
  activeConnections: number;
  totalReads: number;
  totalErrors: number;
  avgResponseTime: number;
  uptime: number;
}

export interface PluginStatusInfo {
  protocol: string;
  status: PluginStatus;
  uptime: number;
  activeConnections: number;
  totalReads: number;
  totalErrors: number;
  errorMessage?: string;
}

export interface PluginConnectionSchema {
  type: string;
  required: string[];
  properties: Record<string, {
    type: string;
    title: string;
    default?: any;
    minimum?: number;
    maximum?: number;
    description?: string;
  }>;
}

export interface PluginUpdateCheck {
  protocol: string;
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  updateAvailable: boolean;
}

export interface PluginHealthCheck {
  totalPlugins: number;
  activePlugins: number;
  inactivePlugins: number;
  errorPlugins: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

/** Active collection device info */
export interface ActiveDeviceInfo {
  deviceId: string;
  deviceName: string;
  projectId: string;
  projectName: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
}

/** Plugin active device list response */
export interface PluginActiveDevices {
  protocol: string;
  count: number;
  devices: ActiveDeviceInfo[];
}

/** Plugin related device statistics */
export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  error: number;
  other: number;
}

/** Process performance metrics */
export interface ProcessMetrics {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  cpuUsage: number;
  uptime: number;
}

/** Plugin monitor data */
export interface PluginMonitorData {
  protocol: string;
  metrics: ProcessMetrics;
  /** Process info */
  processName: string;
  processId: number;
  /** Thread ID (worker_thread mode only) */
  threadId?: number;
  isolationMode: string;
  logs: string[];
  logFilePath: string;
}

/** Plugin runtime configuration (persisted to the JSON file under PLUGIN_CONFIG_DIR) */
export interface PluginRuntimeConfig {
  isolationMode?: string;
  /** Persisted activation state (restored on backend restart) */
  activated?: boolean;
}