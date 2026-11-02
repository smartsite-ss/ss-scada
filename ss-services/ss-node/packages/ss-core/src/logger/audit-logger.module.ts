// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, Global } from '@nestjs/common';
import { AuditLoggerService } from './audit-logger.service';
import { AuditLogController } from './audit-log.controller';

/**
 * S-M02: dedicated audit-log channel module
 *
 * Global module providing AuditLoggerService for injection by all modules.
 *
 * Audit logs are written to {LOG_DIR}/audit/audit-%DATE%.log, separate from app and error logs,
 * retained for 365 days (compliance requirement), with hash-chain tamper protection.
 *
 * AuditLogController provides REST APIs:
 * - GET /system/audit-logs -- paginated audit-log query
 * - GET /system/audit-logs/verify -- verify hash-chain integrity
 * - GET /system/audit-logs/stats -- audit-log statistics overview
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLoggerService],
  exports: [AuditLoggerService],
})
export class AuditLoggerModule {}
