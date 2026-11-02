// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { DataQuality } from '../types';

// ==================== Error code mapping ====================

/** Mapping from error codes to HTTP status codes */
export const ERROR_CODE_HTTP_STATUS: Record<string, number> = {
  // Data collection errors
  DATA_001: 500,
  DATA_002: 504,
  DATA_003: 500,
  DATA_004: 422,

  // Device errors
  DEV_001: 500,
  DEV_002: 503,
  DEV_003: 502,

  // Alarm errors
  ALM_001: 500,
  ALM_002: 500,

  // System errors
  SYS_001: 500,
  SYS_002: 500,
  SYS_003: 500,

  // Authentication errors
  AUTH_001: 401,
  AUTH_002: 403,
  AUTH_003: 401,

  // Common errors
  VALIDATION_001: 400,
  NOT_FOUND_001: 404,
};

/** Mapping from error codes to i18n message keys */
export const ERROR_CODE_I18N_KEY: Record<string, string> = {
  DATA_001: 'error.data.acquisition_failed',
  DATA_002: 'error.data.protocol_timeout',
  DATA_003: 'error.data.persistence_failed',
  DATA_004: 'error.data.quality_issue',
  DEV_001: 'error.device.error',
  DEV_002: 'error.device.offline',
  DEV_003: 'error.device.read_error',
  ALM_001: 'error.alarm.error',
  ALM_002: 'error.alarm.notification_failed',
  SYS_001: 'error.system.internal',
  SYS_002: 'error.system.config_error',
  SYS_003: 'error.system.storage_error',
  AUTH_001: 'error.auth.unauthorized',
  AUTH_002: 'error.auth.forbidden',
  AUTH_003: 'error.auth.token_expired',
  VALIDATION_001: 'error.validation.invalid_input',
  NOT_FOUND_001: 'error.not_found',
};

// ==================== Base error class ====================

export abstract class ScadaError extends Error {
  abstract readonly code: string;
  abstract readonly category: string;
  abstract readonly severity: string;
  abstract readonly recoverable: boolean;
  readonly timestamp: string = new Date().toISOString();

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }

  /** Get the corresponding HTTP status code */
  getHttpStatus(): number {
    return ERROR_CODE_HTTP_STATUS[this.code] ?? 500;
  }

  /** Get the corresponding i18n key */
  getI18nKey(): string {
    return ERROR_CODE_I18N_KEY[this.code] ?? 'error.unknown';
  }

  /** Serialize to JSON */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
      severity: this.severity,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
      name: this.name,
    };
  }
}

// ==================== Business exception base class ====================

export class BusinessException extends ScadaError {
  readonly code: string;
  readonly category: string;
  readonly severity: string;
  readonly recoverable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options?: {
      category?: string;
      severity?: string;
      recoverable?: boolean;
      details?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.code = code;
    this.category = options?.category ?? 'business';
    this.severity = options?.severity ?? 'error';
    this.recoverable = options?.recoverable ?? true;
    this.details = options?.details;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      details: this.details,
    };
  }
}

// ==================== Predefined business exceptions ====================

/** Authentication exception */
export class AuthenticationException extends BusinessException {
  constructor(message: string = 'Authentication failed') {
    super('AUTH_001', message, { category: 'auth', severity: 'error' });
  }
}

/** Permission exception */
export class ForbiddenException extends BusinessException {
  constructor(message: string = 'Access denied') {
    super('AUTH_002', message, { category: 'auth', severity: 'warn' });
  }
}

/** Token expiration exception */
export class TokenExpiredException extends BusinessException {
  constructor(message: string = 'Token expired') {
    super('AUTH_003', message, { category: 'auth', severity: 'warn' });
  }
}

/** Validation exception */
export class ValidationException extends BusinessException {
  constructor(message: string = 'Validation failed', details?: Record<string, unknown>) {
    super('VALIDATION_001', message, {
      category: 'validation',
      severity: 'warn',
      details,
    });
  }
}

/** Resource not found exception */
export class NotFoundException extends BusinessException {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super('NOT_FOUND_001', message, { category: 'resource', severity: 'warn' });
  }
}

// ── Data Acquisition Errors ──

export class DataAcquisitionError extends ScadaError {
  readonly code: string = 'DATA_001';
  readonly category: string = 'data';
  readonly severity: string = 'error';
  readonly recoverable: boolean = true;
}

export class ProtocolTimeoutError extends DataAcquisitionError {
  readonly code: string = 'DATA_002';
  constructor(protocol: string, timeout: number) {
    super(`Protocol ${protocol} timed out after ${timeout}ms`);
  }
}

export class DataPersistenceError extends DataAcquisitionError {
  readonly code: string = 'DATA_003';
  readonly severity: string = 'fatal';
  readonly recoverable = false;
  constructor(storage: string, detail: string) {
    super(`Data persistence failed on ${storage}: ${detail}`);
  }
}

export class DataQualityError extends DataAcquisitionError {
  readonly code: string = 'DATA_004';
  readonly severity: string = 'warn';
  constructor(tagId: string, quality: DataQuality) {
    super(`Data quality issue for tag ${tagId}: ${quality}`);
  }
}

// ── Device Errors ──

export class DeviceError extends ScadaError {
  readonly code: string = 'DEV_001';
  readonly category: string = 'device';
  readonly severity: string = 'error';
  readonly recoverable = true;
}

export class DeviceOfflineError extends DeviceError {
  readonly code: string = 'DEV_002';
  constructor(deviceId: string) {
    super(`Device ${deviceId} is offline`);
  }
}

export class DeviceReadError extends DeviceError {
  readonly code: string = 'DEV_003';
  constructor(deviceId: string, address: string, detail: string) {
    super(`Failed to read device ${deviceId} address ${address}: ${detail}`);
  }
}

// ── Alarm Errors ──

export class AlarmError extends ScadaError {
  readonly code: string = 'ALM_001';
  readonly category: string = 'alarm';
  readonly severity: string = 'error';
  readonly recoverable = true;
  constructor(detail: string) {
    super(`Alarm error: ${detail}`);
  }
}

export class AlarmNotificationError extends AlarmError {
  readonly code: string = 'ALM_002';
  readonly severity: string = 'warn';
  constructor(channel: string, detail: string) {
    super(`Alarm notification failed on ${channel}: ${detail}`);
  }
}

// ── System Errors ──

export class SystemError extends ScadaError {
  readonly code: string = 'SYS_001';
  readonly category: string = 'system';
  readonly severity: string = 'fatal';
  readonly recoverable = false;
}

export class ConfigError extends SystemError {
  readonly code: string = 'SYS_002';
  constructor(key: string, detail: string) {
    super(`Configuration error for ${key}: ${detail}`);
  }
}

export class StorageError extends SystemError {
  readonly code: string = 'SYS_003';
  constructor(storage: string, detail: string) {
    super(`Storage error on ${storage}: ${detail}`);
  }
}
