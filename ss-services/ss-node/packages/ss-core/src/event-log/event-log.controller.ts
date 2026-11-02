// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Controller, Get, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../core/auth/guards/jwt-auth.guard';
import { EventLogService } from './event-log.service';
import { EventLogQueryDto } from './event-log-query.dto';

/**
 * Event-log REST API Controller - query endpoints for config-change event logs
 *
 * Follows the OperationLogController pattern:
 * - Route prefix: /system/event-logs
 * - Permissions: accessible to all logged-in users (event logs are for ops diagnostics, not ADMIN-only)
 * - 3 endpoints: paginated query / failed list / detail
 *
 * Data source: the evt_event_log table in the global ss-node.db,
 * written automatically by EventLogService on EventBus emit.
 */
@ApiTags('事件日志')
@Controller('system/event-logs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EventLogController {
  constructor(private readonly eventLogService: EventLogService) {}

  /**
   * Query event logs with pagination
   * Supports projectId / eventType / status / emittedBy / time-range filters
   */
  @Get()
  @ApiOperation({ summary: '查询事件日志（分页，支持多维筛选）' })
  @ApiQuery({ name: 'projectId', required: false, description: '项目 ID' })
  @ApiQuery({ name: 'eventType', required: false, description: '事件类型（如 device.created）' })
  @ApiQuery({ name: 'status', required: false, description: '事件状态（emitted/processing/processed/partial/failed）' })
  @ApiQuery({ name: 'emittedBy', required: false, description: '操作者（用户 ID / 系统服务名）' })
  @ApiQuery({ name: 'startTime', required: false, description: '起始时间（ISO 8601）' })
  @ApiQuery({ name: 'endTime', required: false, description: '结束时间（ISO 8601）' })
  @ApiQuery({ name: 'page', required: false, description: '页码（默认 1）' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页条数（默认 20，最大 100）' })
  @ApiQuery({ name: 'hasSubscribers', required: false, description: '仅看有订阅者追踪记录的事件（true/false）' })
  async findByFilter(@Query() query: EventLogQueryDto) {
    const filter: Parameters<EventLogService['findByFilter']>[0] = {
      projectId: query.projectId,
      eventType: query.eventType,
      status: query.status,
      emittedBy: query.emittedBy,
      page: query.page,
      pageSize: query.pageSize,
      hasSubscribers: query.hasSubscribers,
    };

    // ISO date string -> Date object
    if (query.startTime) {
      filter.startTime = new Date(query.startTime);
    }
    if (query.endTime) {
      filter.endTime = new Date(query.endTime);
    }

    return this.eventLogService.findByFilter(filter);
  }

  /**
   * Query failed/partially failed events (fast ops triage)
   * No pagination; returns all failed events (newest first)
   */
  @Get('failed')
  @ApiOperation({ summary: '查询失败/部分失败的事件（运维诊断）' })
  @ApiQuery({ name: 'projectId', required: false, description: '项目 ID（可选筛选）' })
  @ApiQuery({ name: 'startTime', required: false, description: '起始时间（ISO 8601）' })
  @ApiQuery({ name: 'endTime', required: false, description: '结束时间（ISO 8601）' })
  async findFailed(
    @Query('projectId') projectId?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    const filter: Parameters<EventLogService['findFailed']>[0] = {};
    if (projectId) filter.projectId = projectId;
    if (startTime) filter.startTime = new Date(startTime);
    if (endTime) filter.endTime = new Date(endTime);

    return this.eventLogService.findFailed(filter);
  }

  /**
   * Query a single event-log detail (with full subscribers records)
   */
  @Get(':id')
  @ApiOperation({ summary: '事件日志详情（含订阅者追踪记录和业务效果）' })
  async findOne(@Param('id') id: string) {
    return this.eventLogService.findOne(id);
  }

  /**
   * Clear all event logs (ops operation, use with caution)
   */
  @Delete()
  @ApiOperation({ summary: '清空所有事件日志（运维操作，不可恢复）' })
  async clearAll() {
    return this.eventLogService.clearAll();
  }
}
