// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Controller, Get, Logger } from '@nestjs/common';
import { WebSocketMetricsService } from './websocket-metrics.service';
import { ScadaWebSocketGateway } from './websocket.gateway';
import { ConnectionMonitorService } from './connection-monitor.service';
import { OfflineMessageCacheService } from './offline-message-cache.service';

/**
 * WebSocket monitoring-metrics Controller
 *
 * Provides message incoming/outgoing monitoring and message-efficiency statistics:
 * - GET /api/v1/ws/metrics            -- JSON metric snapshot
 * - GET /api/v1/ws/metrics/prometheus -- Prometheus text format
 * - GET /api/v1/ws/metrics/connections -- connection details
 * - GET /api/v1/ws/metrics/diagnostic  -- diagnostics (troubleshooting missing messages / no data)
 */
@Controller('ws/metrics')
export class WebSocketMetricsController {
  private readonly logger = new Logger(WebSocketMetricsController.name);

  constructor(
    private readonly metricsService: WebSocketMetricsService,
    private readonly wsGateway: ScadaWebSocketGateway,
    private readonly connectionMonitor: ConnectionMonitorService,
    private readonly offlineCache: OfflineMessageCacheService,
  ) {}

  /** JSON-format metric snapshot */
  @Get()
  getJsonMetrics() {
    const snapshot = this.metricsService.getSnapshot();
    if (snapshot.totalBroadcasts === 0) {
      this.logger.warn(
        'getJsonMetrics: totalBroadcasts=0 - WebSocket has never broadcast a message. ' +
          'Possible causes: 1) no collection task running 2) no EventBus events 3) DataPushBridge not initialized.',
      );
    }
    return snapshot;
  }

  /** Prometheus text-format metrics */
  @Get('prometheus')
  getPrometheusMetrics(): string {
    return this.metricsService.getPrometheusMetrics();
  }

  /** Connection details (integrating ConnectionMonitorService) */
  @Get('connections')
  getConnectionDetails() {
    const monitorStats = this.connectionMonitor.getStats();
    const gatewayMetrics = this.wsGateway.getMetrics();

    return {
      monitor: monitorStats,
      gateway: gatewayMetrics,
      onlineUserIds: Array.from(this.wsGateway.getOnlineUserIds()),
    };
  }

  /**
   * Diagnostic endpoint: returns the WebSocket message-chain status in one shot, troubleshooting "messages with no data".
   * Returns raw data (uniformly wrapped by the global TransformInterceptor); shape aligned with the frontend WsDiagnosticInfo:
   * { conclusions, suggestions, details }.
   *
   * Troubleshooting guide:
   * - totalBroadcasts === 0 -> messages never broadcast; check DataPushBridge and collection tasks
   * - broadcastCounts has data but roomHitStats' totalRecipients === 0 -> no client subscribed
   * - bridgeLatencyMs.count > 0 but broadcastCounts empty -> Bridge received events but did not broadcast
   * - offlineCacheHits > 0 -> offline clients are caching messages
   */
  @Get('diagnostic')
  getDiagnostic() {
    const metricsSnapshot = this.metricsService.getSnapshot();
    const monitorStats = this.connectionMonitor.getStats();
    const gatewayMetrics = this.wsGateway.getMetrics();
    const onlineUserIds = this.wsGateway.getOnlineUserIds();

    const diagnosis = this.buildDiagnosis(metricsSnapshot, monitorStats, gatewayMetrics);

    this.logger.log(
      `getDiagnostic: broadcasts=${metricsSnapshot.totalBroadcasts}, ` +
        `recipients=${metricsSnapshot.totalRecipients}, ` +
        `connections=${monitorStats.totalConnections}, ` +
        `onlineUsers=${onlineUserIds.size}`,
    );

    return {
      conclusions: diagnosis,
      suggestions: [],
      details: {
        timestamp: new Date().toISOString(),
        metrics: metricsSnapshot,
        connections: {
          monitor: monitorStats,
          gateway: gatewayMetrics,
          onlineUserCount: onlineUserIds.size,
        },
      },
    };
  }

  /**
   * Auto-generate diagnostic conclusions from the current state
   */
  private buildDiagnosis(metrics: any, monitor: any, gateway: any): string[] {
    const conclusions: string[] = [];

    // Check message broadcasting
    if (metrics.totalBroadcasts === 0) {
      conclusions.push(
        '❌ WebSocket 从未广播过消息 — 检查: 1) 采集任务是否运行 2) EventBus 是否触发 data_point_changed/device:statusChanged/alarm_triggered 3) DataPushBridge 是否初始化',
      );
    } else {
      conclusions.push(
        `✅ 已广播 ${metrics.totalBroadcasts} 次消息，共 ${metrics.totalRecipients} 个接收者`,
      );

      // Check the event-type distribution
      const eventTypes = Object.keys(metrics.broadcastCounts);
      conclusions.push(`📊 广播事件类型: ${eventTypes.join(', ')}`);
    }

    // Check Bridge latency
    if (metrics.bridgeLatencyMs.count > 0) {
      conclusions.push(
        `✅ DataPushBridge 处理 ${metrics.bridgeLatencyMs.count} 次，平均耗时 ${metrics.bridgeLatencyMs.avgMs}ms，最大 ${metrics.bridgeLatencyMs.maxMs}ms`,
      );
    }

    // Check connections
    if (monitor.totalConnections === 0) {
      conclusions.push('❌ 无 WebSocket 客户端连接 — 前端未连接或连接失败');
    } else {
      conclusions.push(`✅ 当前 ${monitor.totalConnections} 个客户端连接`);

      // Check room subscriptions
      if (gateway.roomCount === 0) {
        conclusions.push('⚠️ 无房间订阅 — 客户端未订阅任何项目/设备/标签房间');
      } else {
        conclusions.push(`✅ 已订阅 ${gateway.roomCount} 个房间`);
      }
    }

    // Check the offline cache
    if (metrics.offlineCacheHits > 0) {
      conclusions.push(`✅ 离线缓存命中 ${metrics.offlineCacheHits} 次（有客户端曾离线）`);
    }

    // Check room hit rate (whether there are pushes to empty rooms)
    const roomStats = metrics.roomHitStats || {};
    const emptyRooms = Object.entries(roomStats).filter(
      ([, stat]: [string, any]) => stat.totalRecipients === 0,
    );
    if (emptyRooms.length > 0) {
      conclusions.push(
        `⚠️ ${emptyRooms.length} 个房间推送但无接收者: ${emptyRooms
          .map(([r]: [string, any]) => r)
          .slice(0, 5)
          .join(', ')}`,
      );
    }

    return conclusions;
  }
}
