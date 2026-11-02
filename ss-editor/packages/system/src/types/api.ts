// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export interface ApiResponse<T = any> {
  data: T;
  message: string;
  timestamp: string;
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  details?: Array<{ field: string; message: string }>;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  keyword?: string;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationInfo;
}

export interface PaginatedApiResponse<T> {
  data: T[];
  pagination: PaginationInfo;
  message: string;
  timestamp: string;
}

export interface LoginDto {
  username: string;
  password: string;
}

export interface RegisterDto {
  username: string;
  password: string;
  email: string;
  displayName?: string;
}

export interface UserInfo {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  role: 'admin' | 'user' | 'viewer';
}

/**
 * S-C03: tokens are transported via HttpOnly Cookie; accessToken/refreshToken are optional
 * (Cookie mode returns only user in the response body; Bearer header mode returns the full token pair)
 */
export interface AuthResult {
  accessToken?: string;
  refreshToken?: string;
  user: UserInfo;
}

export interface RefreshResult {
  accessToken?: string;
  refreshToken?: string;
}

/** Project resource status */
export interface ResourceStatus {
  status: 'ok' | 'missing' | 'error' | 'empty';
  path: string;
  size?: number;
}

/** Resource diagnostics collection */
export interface DiagnoseResources {
  projectinfo?: ResourceStatus;
  dbDir?: ResourceStatus;
  rtdbDir?: ResourceStatus;
  pagesDir?: ResourceStatus;
  templateDir?: ResourceStatus;
  systemDb?: ResourceStatus;
  eventDb?: ResourceStatus;
}

/** Project diagnostic result */
export interface DiagnoseResult {
  projectName: string;
  projectId: string;
  /** Multi-tenant reserved (currently = projectId) */
  tenantId: string;
  resources: DiagnoseResources;
  health: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  dbMode: string;
}

export interface Project {
  /** Project code (backend projectId field, variable-naming format, no Chinese) */
  projectId: string;
  /** tenantId multi-tenant reserved field (currently = projectId, preset for future multi-tenant expansion) */
  tenantId: string;
  /** Project display name */
  projectName: string;
  description?: string;
  version?: string;
  config?: any;
  createdBy?: string;
  updatedBy?: string;
  pages?: Page[];
  createdAt?: string;
  updatedAt?: string;
  /** Project location (absolute path of the project directory) */
  projectPath?: string;
  /** Database location (absolute path of the project database directory) */
  databasePath?: string;
  /** Project address */
  address?: string;
  /** Longitude (decimal string) */
  longitude?: string;
  /** Latitude (decimal string) */
  latitude?: string;
  /** Person in charge */
  owner?: string;
  /** Project cover image relative path (e.g. images/cover-1234567890.png) */
  image?: string;
  /**
   * Project enabled state (true = enabled, false = disabled).
   * Disabled projects do not collect data, do not appear in the device tree/device monitoring, and are excluded from home statistics.
   * Defaults to false (new projects are disabled by default; collection starts only after manual enabling).
   */
  enabled?: boolean;
  /** Page count (computed at runtime, not written into projectinfo.json) */
  pageCount?: number;
  /** Total project directory size (bytes, computed at runtime, not written into projectinfo.json) */
  folderSize?: number;
}

export interface Page {
  id: string;
  name: string;
  order: number;
  config?: any;
  graphics?: any[];
  projectId: string;
}

export type DeviceType = 'modbus_tcp' | 'modbus_rtu' | 'opc_ua' | 'mqtt';

export type DeviceStatus = 'offline' | 'connecting' | 'online' | 'degraded' | 'error';

export type TagDataType = 'boolean' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64' | 'string';

export interface Device {
  id: string;
  /** Device code (unique device identifier within the project) */
  deviceCode: string;
  deviceName: string;
  nameAlias?: string;
  description?: string;
  type: DeviceType;
  driver?: string;
  config?: Record<string, any>;
  connection?: Record<string, any>;
  status: DeviceStatus;
  projectId: string;
  tags?: DataTag[];
  templateId?: string;
  templateVersion?: string;
  templateAppliedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  lastOnlineAt?: string;
  lastDataAt?: string;
  errorCount?: number;
  lastErrorAt?: string;
  lastErrorMsg?: string;
  scanRate?: number;
  offlinePeriod?: number;
  groupId?: string;
  /** Runtime collection diagnostic data (pushed by DeviceStateManager) */
  _diagnostics?: {
    retryCount?: number;
    circuitState?: 'closed' | 'open' | 'half-open';
    consecutiveFailures?: number;
    lastErrorAt?: number;
  };
}

export interface DataTag {
  id: string;
  name: string;
  description?: string;
  address: string;
  dataType: TagDataType;
  direction?: 'read' | 'write' | 'read-write';
  config?: Record<string, any>;
  scale?: number;
  offset?: number;
  scanRate?: number;
  enabled?: boolean;
  deviceId: string;
  createdAt?: string;
  updatedAt?: string;
  // Display and alarm related fields (kept consistent with the backend DataTag entity)
  unit?: string;
  displayFormat?: string;
  alarmHigh?: number;
  alarmLow?: number;
  alarmHighHigh?: number;
  alarmLowLow?: number;
}

export interface DeviceGroup {
  id: string;
  name: string;
  description?: string;
  projectId: string;
  parentId?: string;
  sortOrder?: number;
  parent?: DeviceGroup;
  children?: DeviceGroup[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DeviceSummary {
  id: string;
  /** Device code (unique device identifier within the project) */
  deviceCode: string;
  deviceName: string;
  type: DeviceType;
  status: DeviceStatus;
}

export interface DeviceTree {
  group: {
    id: string;
    name: string;
    sortOrder: number;
    parentId?: string;
  };
  children: DeviceTree[];
  devices: DeviceSummary[];
}

/** Project device tree (including the group tree and ungrouped root devices) */
export interface ProjectDeviceTree {
  projectId: string;
  projectName: string;
  groups: DeviceTree[];
  rootDevices: DeviceSummary[];
}

export interface DeviceDiagnosticResult {
  deviceId: string;
  timestamp: string;
  reachable: boolean;
  latencyMs: number;
  protocolStatus: 'ok' | 'warning' | 'error';
  details: Record<string, any>;
  suggestions: string[];
}

export interface PingResult {
  reachable: boolean;
  latencyMs: number;
}

export type AlarmLevel = 'info' | 'warning' | 'error' | 'critical';

export type AlarmStatus = 'active' | 'acknowledged' | 'cleared' | 'shelved';

export type AlarmCondition = 'gt' | 'lt' | 'eq' | 'neq' | 'gte' | 'lte' | 'range_in' | 'range_out';

export interface AlarmRule {
  id: string;
  name: string;
  description?: string;
  level: AlarmLevel;
  condition: AlarmCondition;
  conditionValue: string;
  enabled: boolean;
  debounceMs: number;
  alarmType?: string;
  /** Whether to auto-clear the alarm when the value recovers (Phase 5) */
  autoClear?: boolean;
  projectId: string;
  tagId: string;
  tag?: { id: string; name: string; address: string };
  createdAt: string;
  updatedAt: string;
}

export interface AlarmRecord {
  id: string;
  ruleId: string;
  rule?: AlarmRule;
  deviceId?: string;
  deviceName?: string;
  tagId?: string;
  tagName?: string;
  message: string;
  triggerValue: number;
  level: AlarmLevel;
  status: AlarmStatus;
  alarmType?: string;
  dispositionType?: string;
  /** Whether it is a real-time alarm (Phase 5): true = real-time (not cleared) / false = historical (cleared) */
  isActive?: boolean;
  /** Clear reason (Phase 5): auto = condition auto-recovered / manual = manually cleared / rule_disabled = rule disabled */
  clearReason?: string;
  /** Auto-recovery time (Phase 5): present only when clearReason = auto */
  recoveredAt?: string;
  /** Collected value at auto recovery (Phase 5) */
  recoveredValue?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  clearedAt?: string;
  clearedBy?: string;
  shelvedAt?: string;
  shelvedBy?: string;
  shelveReason?: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlarmStatistics {
  total: number;
  active: number;
  acknowledged: number;
  cleared: number;
  shelved: number;
  byStatus: Record<string, number>;
  byLevel: Record<string, number>;
}

export interface AlarmTrend {
  date: string;
  count: number;
  level: string;
}

export interface AlarmTopRule {
  ruleId: string;
  ruleName: string;
  count: number;
  lastTriggered: string;
}

export interface DeviceStats {
  deviceId: string;
  deviceName: string;
  count: number;
}

export interface TagStats {
  tagId: string;
  tagName: string;
  count: number;
}

export interface AlarmSuppressionRule {
  id: string;
  type: string;
  targetIds: string[];
  enabled: boolean;
  startTime?: string;
  endTime?: string;
}

export interface AlarmEscalationRule {
  id: string;
  name: string;
  delayMs: number;
  fromLevel: string;
  toLevel: string;
  channels: string[];
}

export type ScriptStatus = 'draft' | 'active' | 'paused' | 'error';

export type ScriptTriggerType = 'manual' | 'scheduled' | 'event' | 'pipeline';

export interface Script {
  id: string;
  name: string;
  description?: string;
  code: string;
  status: ScriptStatus;
  triggerType: ScriptTriggerType;
  triggerConfig?: Record<string, any>;
  allowNetwork?: boolean;
  allowFileSystem?: boolean;
  timeoutMs?: number;
  memoryLimitMb?: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptExecution {
  id: string;
  scriptId: string;
  trigger: string;
  status: string;
  result?: string;
  error?: string;
  durationMs: number;
  memoryUsedMb: number;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
}

export interface SystemConfig {
  id?: string;
  key: string;
  value: string;
  description?: string;
  type?: string;
  updatedAt?: string;
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'error';
  uptime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
  timestamp: string;
  details?: Record<string, any>;
}

export interface SystemInfo {
  appName: string;
  version: string;
  buildTime: string;
  nodeVersion: string;
  platform: string;
  cpuCores: number;
  totalMemory: string;
  pid: number;
  uptime: string;
  timezone: string;
  apiUrl: string;
}

export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId: string;
  username: string;
  ip: string;
  userAgent: string;
  details?: Record<string, any>;
  status: 'success' | 'failure';
  createdAt: string;
}

// ==================== System configuration management ====================

/** Configuration category */
export type ConfigCategory =
  | 'application'
  | 'database'
  | 'security'
  | 'collection'
  | 'communication'
  | 'storage'
  | 'logging'
  | 'i18n'
  | 'monitoring';

/** Configuration value type */
export type ConfigValueType = 'string' | 'number' | 'boolean' | 'enum' | 'password';

/** Configuration metadata */
export interface ConfigMetadata {
  key: string;
  category: ConfigCategory;
  description: string;
  defaultValue?: string;
  type: ConfigValueType;
  enumValues?: string[];
  sensitive: boolean;
  editable: boolean;
  hotReloadable: boolean;
  restartRequired: boolean;
  envFile: boolean;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

/** Configuration item display view (metadata + current value) */
export interface ConfigItemView {
  key: string;
  category: ConfigCategory;
  categoryLabel: string;
  description: string;
  defaultValue?: string;
  type: string;
  enumValues?: string[];
  sensitive: boolean;
  editable: boolean;
  hotReloadable: boolean;
  restartRequired: boolean;
  envFile: boolean;
  validation?: { min?: number; max?: number; pattern?: string };
  value: string;
  source: 'env' | 'db' | 'default' | 'null';
}

/** Configuration update result */
export interface ConfigUpdateResult {
  key: string;
  value: string;
  restartRequired: boolean;
  hotReloadable: boolean;
  envFileUpdated: boolean;
  addedToPendingRestart: boolean;
}

/** Restart status */
export type RestartStatus = 'idle' | 'pending' | 'restarting' | 'exited' | 'ready' | 'failed';

/** Restart status info */
export interface RestartState {
  status: RestartStatus;
  triggeredBy?: string;
  triggeredAt?: number;
  oldPid?: number;
  newPid?: number;
  errorMessage?: string;
  markerPath: string;
}
