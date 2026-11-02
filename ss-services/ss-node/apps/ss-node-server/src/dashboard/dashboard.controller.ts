// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Homepage dashboard aggregation endpoint (module 02)
 *
 * GET /projects/:projectId/dashboard/summary
 * Returns device five-state stats + today's alarm severity counts + active unacknowledged alarm count (server-side 30s cache)
 */
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard, Roles, UserRole } from '@ss-node/ss-core';
import { DashboardService, DashboardSummary } from './dashboard.service';

@ApiTags('仪表盘')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.USER, UserRole.VIEWER)
  @ApiOperation({ summary: '获取仪表盘聚合摘要（30s 服务端缓存）' })
  @ApiQuery({ name: 'refresh', required: false, description: 'true 时绕过缓存重新聚合' })
  getSummary(
    @Param('projectId') projectId: string,
    @Query('refresh') refresh?: string,
    @Req() req?: any,
  ): Promise<DashboardSummary> {
    return this.dashboardService.getSummary(projectId, refresh === 'true', req?.user?.roleId);
  }
}
