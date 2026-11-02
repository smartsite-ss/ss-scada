// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { AuditLoggerService } from './audit-logger.service';
import { AuditLogQueryDto } from './audit-log-query.dto';

/**
 * Security audit-log REST API Controller - query and hash-chain verification endpoints for security audit logs
 *
 * Follows the EventLogController pattern:
 * - Route prefix: /system/audit-logs
 * - Permissions: accessible to all logged-in users (audit logs serve security-compliance review)
 * - 3 endpoints: paginated query / hash-chain verification / statistics overview
 *
 * Data source: the {logDir}/audit/audit-%DATE%.log file,
 * written automatically by AuditLoggerService when security events occur (hash-chain tamper protection).
 */
@ApiTags('安全审计日志')
@Controller('system/audit-logs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuditLogController {
  constructor(private readonly auditLoggerService: AuditLoggerService) {}

  /**
   * Query security audit logs with pagination
   * Supports date / type / severity / userId / username filters
   */
  @Get()
  @ApiOperation({ summary: '查询安全审计日志（分页，支持多维筛选）' })
  @ApiQuery({ name: 'date', required: false, description: '日期（YYYY-MM-DD，默认今天）' })
  @ApiQuery({ name: 'startTime', required: false, description: '开始时间（YYYY-MM-DD，与 date 互斥）' })
  @ApiQuery({ name: 'endTime', required: false, description: '结束时间（YYYY-MM-DD）' })
  @ApiQuery({ name: 'type', required: false, description: '事件类型（如 auth.login.success）' })
  @ApiQuery({ name: 'severity', required: false, description: '严重级别（info/warning/critical）' })
  @ApiQuery({ name: 'userId', required: false, description: '用户 ID' })
  @ApiQuery({ name: 'username', required: false, description: '用户名' })
  @ApiQuery({ name: 'page', required: false, description: '页码（默认 1）' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页条数（默认 20，最大 100）' })
  async findEntries(@Query() query: AuditLogQueryDto) {
    return this.auditLoggerService.findEntries({
      date: query.date,
      startTime: query.startTime,
      endTime: query.endTime,
      type: query.type,
      severity: query.severity,
      userId: query.userId,
      username: query.username,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * Verify the hash-chain integrity of a given day's audit logs
   * Used to detect tampering during security review
   */
  @Get('verify')
  @ApiOperation({ summary: '验证审计日志哈希链完整性（防篡改检测）' })
  @ApiQuery({ name: 'date', required: false, description: '日期（YYYY-MM-DD，默认今天）' })
  async verifyChain(@Query('date') date?: string) {
    return this.auditLoggerService.verifyChain(date);
  }

  /**
   * Get the audit-log statistics overview
   * Includes total count, distribution by type/severity, and hash-chain integrity status
   */
  @Get('stats')
  @ApiOperation({ summary: '审计日志统计概览（含哈希链完整性状态）' })
  @ApiQuery({ name: 'date', required: false, description: '日期（YYYY-MM-DD，默认今天）' })
  async getStats(@Query('date') date?: string) {
    return this.auditLoggerService.getStats(date);
  }
}
