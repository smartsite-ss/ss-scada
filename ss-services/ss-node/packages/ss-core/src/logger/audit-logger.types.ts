// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * S-M02: audit-log type definitions
 *
 * Dedicated security-event channel, supporting hash-chain tamper protection and compliance review.
 * Each audit log contains prevHash + hash forming a hash chain; any tampering breaks the chain.
 */

/**
 * Audit-event severity
 * - info: routine security events (login success, logout, etc.)
 * - warning: suspicious events (login failure, password verification failure, etc.)
 * - critical: severe security events (account lockout, token used after revocation, etc.)
 */
export type AuditSeverity = 'info' | 'warning' | 'critical';

/**
 * Audit-event types
 *
 * Naming convention: {module}.{action}.{result}
 * e.g. auth.login.success, auth.password.failed
 */
export type AuditEventType =
  // Authentication events
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.login.locked'
  | 'auth.refresh.success'
  | 'auth.refresh.failed'
  | 'auth.logout'
  | 'auth.password.changed'
  | 'auth.password.failed'
  // WeChat scan-login events
  | 'auth.wechat.login.success'
  | 'auth.wechat.login.failed'
  | 'auth.wechat.user_created'
  // Mini-program WeChat login events (01 - account & auth)
  | 'auth.wechat_mp.login.success'
  | 'auth.wechat_mp.login.failed'
  | 'auth.wechat_mp.login.binding_required'
  | 'auth.wechat_mp.bind.success'
  | 'auth.wechat_mp.bind.failed'
  | 'auth.wechat_mp.password_login.success'
  | 'auth.wechat_mp.password_login.failed'
  | 'auth.wechat_mp.unbind'
  // User-management events
  | 'user.created'
  | 'user.deleted'
  | 'user.role_changed'
  // Permission events
  | 'permission.denied'
  | 'permission.granted'
  // System events
  | 'system.config_changed'
  | 'system.data_exported';

/**
 * Audit event - data passed in by the caller
 */
export interface AuditEvent {
  /** Event type */
  type: AuditEventType;
  /** Severity */
  severity: AuditSeverity;
  /** User ID */
  userId?: string;
  /** Username */
  username?: string;
  /** Client IP */
  ip?: string;
  /** User-Agent */
  userAgent?: string;
  /** Event details (arbitrary structured data, for compliance review) */
  details?: Record<string, any>;
}

/**
 * Audit-log entry - the complete record written to disk (with hash-chain fields)
 */
export interface AuditLogEntry extends AuditEvent {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Hash chain: the previous record's hash (64 '0's for the genesis record) */
  prevHash: string;
  /** Hash chain: the current record's hash = SHA256(prevHash + canonical_json(entry_without_hash)) */
  hash: string;
}

/**
 * Hash-chain verification result
 */
export interface AuditChainVerificationResult {
  /** Whether the hash chain is intact (not tampered) */
  valid: boolean;
  /** Total number of log entries verified */
  totalEntries: number;
  /** First break position (1-based index); null when valid=true */
  brokenAtIndex: number | null;
  /** Break-reason description */
  brokenReason?: string;
  /** Verified date (YYYY-MM-DD) */
  date: string;
}

/**
 * Audit-log query filter conditions
 */
export interface AuditLogQueryFilter {
  /** Date (YYYY-MM-DD), defaults to today */
  date?: string;
  /** Start time (YYYY-MM-DD or ISO 8601), mutually exclusive with date (startTime/endTime take priority) */
  startTime?: string;
  /** End time (YYYY-MM-DD or ISO 8601) */
  endTime?: string;
  /** Event-type filter */
  type?: string;
  /** Severity filter (info/warning/critical) */
  severity?: string;
  /** User ID filter */
  userId?: string;
  /** Username filter */
  username?: string;
  /** Page number (default 1) */
  page?: number;
  /** Items per page (default 20, max 100) */
  pageSize?: number;
}

/**
 * Audit-log query result (paginated)
 */
export interface AuditLogQueryResult {
  /** The current page's audit entries (descending, newest first) */
  items: AuditLogEntry[];
  /** Total number of entries matching the filter */
  total: number;
  /** Current page number */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Queried date (YYYY-MM-DD) */
  date: string;
}

/**
 * Audit-log statistics
 */
export interface AuditLogStats {
  /** Total audit-log entries for the day */
  total: number;
  /** Statistics by event type */
  byType: Record<string, number>;
  /** Statistics by severity */
  bySeverity: Record<string, number>;
  /** Whether the hash chain is intact */
  chainValid: boolean;
  /** Statistics date (YYYY-MM-DD) */
  date: string;
}
