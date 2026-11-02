// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * S-M02: audit context - request-level security info passed from Controller to Service
 *
 * Used to record the client IP and User-Agent when a security event fires,
 * facilitating compliance review and attack tracing.
 */
export interface AuditContext {
  /** Client IP (supports proxy-forwarding scenarios, extracted by the Controller's getClientIp) */
  ip?: string;
  /** User-Agent (browser/client identifier) */
  userAgent?: string;
}
