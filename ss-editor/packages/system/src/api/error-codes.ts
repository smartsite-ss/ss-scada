// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Error code → i18n key mapping
 *
 * Kept in sync with ERROR_CODE_I18N_KEY in the backend ss-sdk/src/errors/index.ts.
 * The `code` field in the backend error response body (e.g. 'DEV_002') is mapped to the corresponding i18n key here,
 * which is then translated by vue-i18n into the error message in the current language.
 */

/** Error code → i18n key mapping table */
export const ERROR_CODE_I18N_KEY: Record<string, string> = {
  // Data collection errors
  DATA_001: 'error.data.acquisition_failed',
  DATA_002: 'error.data.protocol_timeout',
  DATA_003: 'error.data.persistence_failed',
  DATA_004: 'error.data.quality_issue',
  // Device errors
  DEV_001: 'error.device.error',
  DEV_002: 'error.device.offline',
  DEV_003: 'error.device.read_error',
  // Alarm errors
  ALM_001: 'error.alarm.error',
  ALM_002: 'error.alarm.notification_failed',
  // System errors
  SYS_001: 'error.system.internal',
  SYS_002: 'error.system.config_error',
  SYS_003: 'error.system.storage_error',
  // Authentication errors
  AUTH_001: 'error.auth.unauthorized',
  AUTH_002: 'error.auth.forbidden',
  AUTH_003: 'error.auth.token_expired',
  // Generic HTTP error codes
  FORBIDDEN: 'error.auth.forbidden',
  UNAUTHORIZED: 'error.auth.unauthorized',
  // Generic errors
  VALIDATION_001: 'error.validation.invalid_input',
  NOT_FOUND_001: 'error.not_found',
};

/**
 * Get the corresponding i18n key for an error code
 * @param code The `code` field in the backend error response
 * @returns The i18n key, or undefined when there is no match
 */
export function mapErrorCodeToI18n(code: string): string | undefined {
  return ERROR_CODE_I18N_KEY[code];
}
