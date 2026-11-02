// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Collection plugin metadata - describes a collection plugin's capabilities, config and dependencies
 */
export interface CollectorPluginMeta {
  /** Unique plugin identifier (corresponds to DeviceType) */
  protocol: string;

  /** Display name */
  displayName: string;

  /** Semantic version */
  version: string;

  /** Plugin description */
  description: string;

  /** Author/organization */
  author?: string;

  /** Protocol category */
  category: PluginCategory;

  /** Transport layer type */
  transport: 'tcp' | 'serial' | 'ws' | 'tls' | 'other';

  /** Config JSON Schema (validation rules for channel connection config) */
  connectionSchema: Record<string, any>;

  /** Default connection config */
  defaultConnection: Record<string, any>;

  /** Supported tag data types */
  supportedDataTypes: string[];

  /** Other npm packages this depends on */
  dependencies?: Record<string, string>;

  /** Icon (optional, base64 or URL) */
  icon?: string;

  /** Tag list (for frontend display) */
  tags?: string[];

  /** Whether enabled by default */
  enabledByDefault: boolean;

  /**
   * Isolation mode (added, default in_process)
   *
   * Determines the environment in which the plugin's adapter runs.
   * - in_process:   adapter invoked directly in the main thread (default, best performance)
   * - worker_thread:adapter runs in a separate Worker thread (crash isolation)
   * - child_process:adapter runs in a separate child process (full isolation)
   */
  isolationMode?: IsolationMode;

  /**
   * Isolation config (only effective in worker_thread / child_process mode)
   */
  isolation?: IsolationConfig;
}

/** Collection plugin isolation mode */
export enum IsolationMode {
  /** In-process mode: adapter invoked directly in the main thread (default, best performance) */
  IN_PROCESS = 'in_process',
  /** Worker thread mode: adapter runs in a separate Worker thread (crash isolation, low memory overhead) */
  WORKER_THREAD = 'worker_thread',
  /** Child process mode: adapter runs in a separate child process (full isolation, most secure) */
  CHILD_PROCESS = 'child_process',
}

/** Isolation config */
export interface IsolationConfig {
  /** Maximum parallel request count (default 50) */
  maxParallel?: number;
  /** Single-request timeout ms (default 10000) */
  requestTimeoutMs?: number;
  /** Auto-restart after crash (default true) */
  autoRestart?: boolean;
  /** Startup timeout ms (default 30000) */
  startupTimeoutMs?: number;
  /** Idle time before reclaiming (0 = never reclaim, default 300000 = 5 minutes) */
  idleTimeoutMs?: number;
  /** Maximum restart count (0 = unlimited, default 5) */
  maxRestarts?: number;
  /** Child process entry script path (child_process only; auto-inferred if omitted) */
  entryScript?: string;
}

/** Plugin category enum */
export enum PluginCategory {
  INDUSTRIAL_BUS = 'industrial_bus',
  IOT = 'iot',
  POWER = 'power',
  BUILDING = 'building',
  CUSTOM = 'custom',
}

/** Registered plugin instance */
export interface RegisteredPlugin {
  meta: CollectorPluginMeta;
  adapter: any;
  status: PluginStatus;
  registeredAt: Date;
  activatedAt?: Date;
  metrics: PluginMetrics;
  errorMessage?: string;
}

/** Plugin status */
export type PluginStatus = 'discovered' | 'registered' | 'active' | 'inactive' | 'error';

/** Plugin runtime metrics */
export interface PluginMetrics {
  totalConnections: number;
  activeConnections: number;
  totalReads: number;
  totalErrors: number;
  avgResponseTime: number;
  uptime: number;
  lastActivity: Date | null;
}

/** Plugin filter criteria */
export interface PluginFilter {
  status?: PluginStatus;
  category?: PluginCategory;
}

/** Discovered plugin */
export interface DiscoveredPlugin {
  meta: CollectorPluginMeta;
  packageName: string;
  packageVersion: string;
  module?: any;
  adapter?: any;
  status: PluginStatus;
  error?: string;
}

/** PluginModule config options */
export interface PluginModuleOptions {
  autoDiscover?: boolean;
  scanExternal?: boolean;
}

export interface ActiveDeviceInfo {
  deviceId: string;
  deviceName: string;
  projectId: string;
  projectName: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  lastOnlineAt: Date | null;
  lastOfflineAt: Date | null;
}

/** Statistics for devices associated with a plugin */
export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  error: number;
  other: number;
}

/** Active device tracker - injected by the collection startup layer, queried by the plugin-details interface */
export const ACTIVE_DEVICE_TRACKER = 'ACTIVE_DEVICE_TRACKER';

export interface IActiveDeviceTracker {
  /** Get the active collection device ID list for a protocol */
  getActiveDeviceIds(protocol: string): string[];
  /** Get active device details */
  getActiveDeviceInfo(deviceId: string): ActiveDeviceInfo | undefined;
  /** Get device statistics associated with a protocol (online/offline/other) */
  getDeviceStats(protocol: string): DeviceStats;
}

// ---------------------------------------------------------------------------
// Provider scanner - decouples from @nestjs/core DiscoveryService to avoid DI token mismatch caused by pnpm duplicate packages
// ---------------------------------------------------------------------------

/** Provider scanner token */
export const PROVIDER_SCANNER = 'PROVIDER_SCANNER';

/** Decomposed ProviderWrapper (minimal interface, no external class references) */
export interface IProviderWrapper {
  instance: unknown;
  metatype: unknown;
}

/** Provider scanner interface */
export interface IProviderScanner {
  getProviders(): IProviderWrapper[];
}
