// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';

/**
 * WebSocket message-metrics snapshot
 */
export interface WebSocketMetricsSnapshot {
  // ── By event type ──
  broadcastCounts: Record<string, number>;
  broadcastErrors: Record<string, number>;
  // ── By push target ──
  roomHitStats: Record<string, { broadcasts: number; totalRecipients: number }>;
  // ── Offline-cache statistics ──
  offlineCacheHits: number;
  offlineCacheMisses: number;
  // ── Latency statistics ──
  bridgeLatencyMs: { count: number; totalMs: number; avgMs: number; maxMs: number };
  // ── Global counters ──
  totalBroadcasts: number;
  totalRecipients: number;
  // ── Time info ──
  startedAt: number;
  snapshotAt: number;
}

/**
 * WebSocket metrics-collection service
 *
 * Monitors the message "incoming/outgoing" process and "message efficiency":
 * - Incoming: DataPushBridge receives an EventBus event -> record event type, source, elapsed time
 * - Outgoing: Gateway broadcasts to rooms -> record target room, recipient count
 *
 * Exposed via the /api/v1/ws/metrics endpoint.
 */
@Injectable()
export class WebSocketMetricsService {
  private readonly logger = new Logger(WebSocketMetricsService.name);

  // ── By event type ──
  private readonly broadcastCounts = new Map<string, number>();
  private readonly broadcastErrors = new Map<string, number>();

  // ── By target room ──
  private readonly roomHitStats = new Map<
    string,
    { broadcasts: number; totalRecipients: number }
  >();

  // ── Offline-cache statistics ──
  private offlineCacheHits = 0;
  private offlineCacheMisses = 0;

  // ── DataPushBridge processing latency ──
  private bridgeLatencyCount = 0;
  private bridgeLatencyTotalMs = 0;
  private bridgeLatencyMaxMs = 0;

  // ── Global counters ──
  private totalBroadcasts = 0;
  private totalRecipients = 0;

  private readonly startedAt = Date.now();

  /**
   * Record one broadcast (called by ScadaWebSocketGateway)
   * @param event WebSocket event name (e.g. data:update, alarm:trigger)
   * @param room target room name
   * @param recipientCount number of receiving clients
   */
  recordBroadcast(event: string, room: string, recipientCount: number): void {
    this.totalBroadcasts++;
    this.totalRecipients += recipientCount;

    // Count by event type
    this.broadcastCounts.set(event, (this.broadcastCounts.get(event) || 0) + 1);

    // Track room hit statistics
    const roomStat = this.roomHitStats.get(room) || { broadcasts: 0, totalRecipients: 0 };
    roomStat.broadcasts++;
    roomStat.totalRecipients += recipientCount;
    this.roomHitStats.set(room, roomStat);
  }

  /**
   * Record one broadcast error
   */
  recordBroadcastError(event: string): void {
    this.broadcastErrors.set(event, (this.broadcastErrors.get(event) || 0) + 1);
  }

  /**
   * Record DataPushBridge processing latency (from receiving the EventBus event to calling gateway broadcast)
   */
  recordBridgeLatency(event: string, durationMs: number): void {
    this.bridgeLatencyCount++;
    this.bridgeLatencyTotalMs += durationMs;
    if (durationMs > this.bridgeLatencyMaxMs) {
      this.bridgeLatencyMaxMs = durationMs;
    }
  }

  /**
   * Record an offline-cache hit
   */
  recordOfflineCacheHit(): void {
    this.offlineCacheHits++;
  }

  /**
   * Record an offline-cache miss (no offline clients)
   */
  recordOfflineCacheMiss(): void {
    this.offlineCacheMisses++;
  }

  /**
   * Get the metrics snapshot
   */
  getSnapshot(): WebSocketMetricsSnapshot {
    const avgMs =
      this.bridgeLatencyCount > 0
        ? Math.round((this.bridgeLatencyTotalMs / this.bridgeLatencyCount) * 100) / 100
        : 0;

    return {
      broadcastCounts: Object.fromEntries(this.broadcastCounts),
      broadcastErrors: Object.fromEntries(this.broadcastErrors),
      roomHitStats: Object.fromEntries(this.roomHitStats),
      offlineCacheHits: this.offlineCacheHits,
      offlineCacheMisses: this.offlineCacheMisses,
      bridgeLatencyMs: {
        count: this.bridgeLatencyCount,
        totalMs: this.bridgeLatencyTotalMs,
        avgMs,
        maxMs: this.bridgeLatencyMaxMs,
      },
      totalBroadcasts: this.totalBroadcasts,
      totalRecipients: this.totalRecipients,
      startedAt: this.startedAt,
      snapshotAt: Date.now(),
    };
  }

  /**
   * Get Prometheus text-format metrics
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const snapshot = this.getSnapshot();
    const uptimeSec = Math.max(1, (snapshot.snapshotAt - snapshot.startedAt) / 1000);

    // ws_broadcasts_total
    lines.push('# HELP ws_broadcasts_total Total WebSocket broadcasts by event type');
    lines.push('# TYPE ws_broadcasts_total counter');
    for (const [event, count] of Object.entries(snapshot.broadcastCounts)) {
      lines.push(`ws_broadcasts_total{event="${event}"} ${count}`);
    }
    lines.push('');

    // ws_broadcast_errors_total
    lines.push('# HELP ws_broadcast_errors_total WebSocket broadcast errors by event type');
    lines.push('# TYPE ws_broadcast_errors_total counter');
    for (const [event, count] of Object.entries(snapshot.broadcastErrors)) {
      lines.push(`ws_broadcast_errors_total{event="${event}"} ${count}`);
    }
    lines.push('');

    // ws_total_broadcasts
    lines.push('# HELP ws_total_broadcasts Total WebSocket broadcasts (all events)');
    lines.push('# TYPE ws_total_broadcasts counter');
    lines.push(`ws_total_broadcasts ${snapshot.totalBroadcasts}`);
    lines.push('');

    // ws_total_recipients
    lines.push('# HELP ws_total_recipients Total message recipients (sum of room sizes)');
    lines.push('# TYPE ws_total_recipients counter');
    lines.push(`ws_total_recipients ${snapshot.totalRecipients}`);
    lines.push('');

    // ws_broadcast_rate
    lines.push('# HELP ws_broadcast_rate Broadcasts per second since startup');
    lines.push('# TYPE ws_broadcast_rate gauge');
    lines.push(`ws_broadcast_rate ${(snapshot.totalBroadcasts / uptimeSec).toFixed(2)}`);
    lines.push('');

    // ws_bridge_latency_ms
    lines.push('# HELP ws_bridge_latency_ms DataPushBridge processing latency stats');
    lines.push('# TYPE ws_bridge_latency_ms gauge');
    lines.push(`ws_bridge_latency_ms_avg ${snapshot.bridgeLatencyMs.avgMs}`);
    lines.push(`ws_bridge_latency_ms_max ${snapshot.bridgeLatencyMs.maxMs}`);
    lines.push('');

    // ws_offline_cache
    lines.push('# HELP ws_offline_cache_hits_total Offline message cache hits');
    lines.push('# TYPE ws_offline_cache_hits_total counter');
    lines.push(`ws_offline_cache_hits_total ${snapshot.offlineCacheHits}`);
    lines.push(`ws_offline_cache_misses_total ${snapshot.offlineCacheMisses}`);
    lines.push('');

    // ws_room_recipients
    lines.push('# HELP ws_room_recipients Total recipients by room');
    lines.push('# TYPE ws_room_recipients counter');
    for (const [room, stat] of Object.entries(snapshot.roomHitStats)) {
      lines.push(`ws_room_recipients{room="${room}"} ${stat.totalRecipients}`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Reset all metrics (mainly for testing)
   */
  reset(): void {
    this.broadcastCounts.clear();
    this.broadcastErrors.clear();
    this.roomHitStats.clear();
    this.offlineCacheHits = 0;
    this.offlineCacheMisses = 0;
    this.bridgeLatencyCount = 0;
    this.bridgeLatencyTotalMs = 0;
    this.bridgeLatencyMaxMs = 0;
    this.totalBroadcasts = 0;
    this.totalRecipients = 0;
    this.logger.debug('WebSocket metrics reset');
  }
}
