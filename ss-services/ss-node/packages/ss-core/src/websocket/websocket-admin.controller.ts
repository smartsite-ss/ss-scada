// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Controller, Get, Delete, Post, Put, Param, Body, Logger } from '@nestjs/common';
import { ScadaWebSocketGateway } from './websocket.gateway';
import { ConnectionMonitorService } from './connection-monitor.service';
import { ConnectionLimiterService, ConnectionLimiterConfig } from './connection-limiter.service';
import { WebSocketMetricsService } from './websocket-metrics.service';

/**
 * WebSocket admin REST API
 *
 * Provides connection management, config management, and combined monitoring:
 * - GET    /api/v1/ws/admin/overview                  -- combined overview (metrics + monitor + limiter + gateway)
 * - GET    /api/v1/ws/admin/connections               -- all connection detail list
 * - DELETE /api/v1/ws/admin/connections/:socketId     -- force-disconnect a given connection
 * - POST   /api/v1/ws/admin/connections/cleanup-idle  -- clean up idle connections
 * - GET    /api/v1/ws/admin/config                    -- get connection-limit config
 * - PUT    /api/v1/ws/admin/config                    -- update connection-limit config
 *
 * Note: all methods return raw data; the global TransformInterceptor uniformly wraps it into the
 * { code, data, message, timestamp } envelope. Do NOT pre-wrap here manually (a missing timestamp field
 * would cause the interceptor to wrap a second time, so the frontend's res.data ends up one layer deep and the real payload is unreachable).
 */
@Controller('ws/admin')
export class WebSocketAdminController {
  private readonly logger = new Logger(WebSocketAdminController.name);

  constructor(
    private readonly wsGateway: ScadaWebSocketGateway,
    private readonly connectionMonitor: ConnectionMonitorService,
    private readonly connectionLimiter: ConnectionLimiterService,
    private readonly metricsService: WebSocketMetricsService,
  ) {}

  /** Combined overview: aggregates metrics / monitor / limiter / gateway data */
  @Get('overview')
  getOverview() {
    return {
      metrics: this.metricsService.getSnapshot(),
      monitor: this.connectionMonitor.getStats(),
      limiter: this.connectionLimiter.getStats(),
      gateway: this.wsGateway.getMetrics(),
    };
  }

  /** All connection detail list */
  @Get('connections')
  getConnections() {
    const snapshots = this.connectionMonitor.getAllSnapshots();
    return {
      total: snapshots.length,
      connections: snapshots,
    };
  }

  /** Force-disconnect a given connection */
  @Delete('connections/:socketId')
  forceDisconnect(@Param('socketId') socketId: string) {
    const success = this.wsGateway.forceDisconnect(socketId);
    this.logger.log(`Admin force disconnect: ${socketId} → ${success ? 'success' : 'not found'}`);
    return { success, socketId };
  }

  /** Clean up idle connections */
  @Post('connections/cleanup-idle')
  cleanupIdle() {
    const idleSocketIds = this.connectionLimiter.checkIdleConnections();
    let cleaned = 0;
    for (const socketId of idleSocketIds) {
      if (this.wsGateway.forceDisconnect(socketId)) {
        cleaned++;
      }
    }
    this.logger.log(`Admin cleanup idle connections: ${cleaned}/${idleSocketIds.length}`);
    return { cleaned, total: idleSocketIds.length };
  }

  /** Get connection-limit config */
  @Get('config')
  getConfig() {
    return this.connectionLimiter.getConfig();
  }

  /** Update connection-limit config */
  @Put('config')
  updateConfig(@Body() body: Partial<ConnectionLimiterConfig>) {
    this.connectionLimiter.updateConfig(body);
    return this.connectionLimiter.getConfig();
  }
}
