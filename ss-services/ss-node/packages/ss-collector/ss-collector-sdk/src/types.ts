// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Common type definitions for collection plugins
 */

/** Data quality level */
export type Quality = 'good' | 'uncertain' | 'bad';

/** Value transform config */
export interface TransformConfig {
  /** Scale factor, default 1 */
  scale?: number;
  /** Offset, default 0 */
  offset?: number;
  /** Decimal precision, default 2 */
  precision?: number;
}

/** Collection read result (unified interface) */
export interface CollectorReadResult {
  tagId: string;
  value: any;
  /** Raw untransformed value (optional, for debugging and auditing) */
  rawValue?: any;
  timestamp: Date;
  quality: Quality;
  error?: string;
}

/** Channel validation error item */
export interface FieldError {
  field: string;
  message: string;
}

/** Collector base connection config (recommended base for each protocol's Config) */
export interface BaseConnectionConfig {
  /** Request timeout (ms) */
  timeout?: number;
  /** Reconnect interval (ms) */
  reconnectInterval?: number;
}

/** Collector base device config (recommended base for each protocol's DeviceConfig) */
export interface BaseDeviceConfig extends BaseConnectionConfig {
  /** Device ID */
  id: string;
  /** Connection parameters */
  connection: Record<string, any>;
}

// ============================================================================
// Protocol adapter interface (migrated from ss-core to ss-collector-sdk on 2026-07-17)
// ============================================================================

/** Channel validation error item (already defined in this file, keep the original definition) */
// FieldError is already defined above; not repeated here

/** Channel config validation result */
export interface ChannelValidationResult {
  valid: boolean;
  errors: FieldError[];
}

/**
 * Device context - passed in at connect(), carries the complete device information.
 *
 * Mapped from the Device entity; it is a plain data object (no ORM metadata),
 * safe to serialize and pass across worker_thread / child_process.
 */
export interface IDeviceContext {
  /** Device ID (UUID) */
  id: string;
  /** Device code (unique within the project) */
  deviceCode?: string;
  /** Device name */
  name: string;
  /** Protocol identifier (e.g. 'modbus_tcp', 'virtual') */
  protocol: string;
  /** Driver name */
  driver?: string;
  /** Connection config (protocol-specific: host/port/unitId, etc.) */
  connection: Record<string, any>;
  /** Collection interval (ms) */
  scanRate?: number;
  /** Offline interval (ms) */
  offlinePeriod?: number;
  /** Device template ID */
  templateId?: string;
  /** Project ID */
  projectId?: string;
}

/**
 * Tag context - passed in at readTag()/writeTag(), carries the complete variable information.
 *
 * Mapped from the DataTag entity; it is a plain data object.
 */
export interface ITagContext {
  /** Tag ID */
  id: string;
  /** Tag name */
  name: string;
  /** Protocol address (e.g. Modbus register address) */
  address: string;
  /** Data type */
  dataType: string;
  /** Scale factor */
  scale?: number;
  /** Offset */
  offset?: number;
  /** Collection interval (ms) */
  scanRate?: number;
  /** Unit */
  unit?: string;
  /** Description */
  description?: string;
  /** Device ID */
  deviceId?: string;
  /** Device name (for logging) */
  deviceName?: string;
  /** Project ID */
  projectId?: string;
  /** Maximum retry count */
  maxRetries?: number;
  /** Read/write direction */
  direction?: 'read' | 'write' | 'read-write';
  /** Extra protocol-specific config (e.g. S7's dbNumber/byteOffset/bitOffset) */
  [key: string]: any;
}

/**
 * Protocol adapter interface - all collection plugins must implement this interface.
 *
 * Defines standard methods for connection management, tag read/write, channel validation, lifecycle hooks, etc.
 */
export interface IProtocolAdapter {
  connect(device: IDeviceContext): Promise<any>;
  disconnect(client: any): Promise<void>;
  readTag(client: any, tag: ITagContext): Promise<{ tagId: string; value: any; timestamp: Date }>;
  writeTag(client: any, tag: ITagContext, value: any): Promise<void>;

  /** Validate channel config - protocol-specific semantic validation (IP format, port range, connectivity, etc.) */
  validateChannelConfig(config: Record<string, any>): Promise<ChannelValidationResult>;

  /**
   * Called when the plugin is activated (optional)
   * Used for the plugin's own initialization: start connection pool, load driver, register internal state, etc.
   * Independent of whether devices are loaded - called even when there are no devices.
   */
  onActivate?(): Promise<void> | void;

  /**
   * Called when the plugin is deactivated (optional)
   * Used to release resources: close connection pool, free driver, unregister state, etc.
   */
  onDeactivate?(): Promise<void> | void;
}
