// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '../event-bus/event-bus.service';
import { ScadaWebSocketGateway } from './websocket.gateway';
import { OfflineMessageCacheService } from './offline-message-cache.service';
import { WebSocketMetricsService } from './websocket-metrics.service';
import type {
  DataPointChangedEvent,
  DeviceStatusChangedEvent,
  AlarmTriggeredEvent,
} from '../event-bus/event-bus.types';

/**
 * Data push bridge
 *
 * Monitors the "incoming" leg of messages: EventBus event -> DataPushBridge -> ScadaWebSocketGateway
 *
 * Each processing records:
 * - message trace log (trace): event type + key fields + elapsed time
 * - metric counters: bridgeLatency, offlineCache hit/miss
 */
@Injectable()
export class DataPushBridge implements OnModuleInit {
  private readonly logger = new Logger(DataPushBridge.name);

  /** Log sampling rate: for high-frequency events (data_point_changed) log only 1 of every N entries, avoiding log flooding */
  private static readonly DATA_POINT_LOG_SAMPLE_RATE = 100;
  private dataPointLogCounter = 0;

  /** P2 optimization: data_point_changed batch buffer with a 200ms merge window */
  private batchBuffer = new Map<
    string,
    Array<{
      tagId: string;
      tagName: string;
      value: number | null;
      quality: string;
      timestamp: string;
    }>
  >();
  private batchFlushTimer: NodeJS.Timeout | null = null;
  private static readonly BATCH_FLUSH_INTERVAL_MS = 200;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly wsGateway: ScadaWebSocketGateway,
    private readonly offlineCache: OfflineMessageCacheService,
    private readonly metricsService: WebSocketMetricsService,
  ) {}

  onModuleInit(): void {
    this.eventBus.on('data_point_changed', (event: DataPointChangedEvent) => {
      this.handleDataPointChanged(event);
    });

    // Unified event: device:statusChanged emitted by DeviceStateManager
    this.eventBus.on('device:statusChanged', (event: any) => {
      this.handleDeviceStatusChanged(event as DeviceStatusChangedEvent);
    });

    // Legacy event-name compatibility (remove in a later version)
    this.eventBus.on('device_status_changed', (event: DeviceStatusChangedEvent) => {
      this.handleDeviceStatusChanged(event);
    });

    this.eventBus.on('alarm_triggered', (event: AlarmTriggeredEvent) => {
      this.handleAlarmTriggered(event);
    });

    this.eventBus.on(
      'alarm_acknowledged',
      (event: {
        alarmId: string;
        projectId: string;
        acknowledgedBy: string;
        timestamp: number;
      }) => {
        this.handleAlarmAcknowledged(event);
      },
    );

    this.eventBus.on(
      'alarm.cleared',
      (event: { alarmId: string; projectId: string; clearedBy: string; timestamp: number }) => {
        this.handleAlarmCleared(event);
      },
    );

    this.eventBus.on(
      'alarm.recovered',
      (event: {
        recordId: string;
        projectId: string;
        recoveredValue: string;
        recoveredAt: Date;
        ruleId?: string;
        ruleName?: string;
      }) => {
        this.handleAlarmRecovered(event);
      },
    );

    this.logger.log(
      'DataPushBridge initialized — EventBus → WebSocket bridge active (with metrics)',
    );
  }

  private handleDataPointChanged(event: DataPointChangedEvent): void {
    const startMs = Date.now();
    const timestamp = new Date(event.timestamp).toISOString();

    // P2 optimization: batch buffer replaces per-record broadcastTagUpdate; multiple pushes within a 200ms merge window coalesce into one
    const projectBuffer = this.batchBuffer.get(event.projectId) || [];
    projectBuffer.push({
      tagId: event.tagId,
      tagName: '',
      value: event.value,
      quality: event.quality,
      timestamp,
    });
    this.batchBuffer.set(event.projectId, projectBuffer);

    // Start the 200ms flush timer (with a self-stop mechanism if not started)
    if (!this.batchFlushTimer) {
      this.batchFlushTimer = setInterval(
        () => this.flushBatch(),
        DataPushBridge.BATCH_FLUSH_INTERVAL_MS,
      );
    }

    const durationMs = Date.now() - startMs;
    this.metricsService.recordBridgeLatency('data_point_changed', durationMs);

    // Sampled log: record once every 100 entries, avoiding high-frequency log flooding
    this.dataPointLogCounter++;
    if (this.dataPointLogCounter % DataPushBridge.DATA_POINT_LOG_SAMPLE_RATE === 0) {
      this.logger.log(
        `data_point_changed #${this.dataPointLogCounter} tag=${event.tagId} ${durationMs}ms`,
      );
    }
  }

  /** P2 optimization: flush the batch buffer, calling gateway broadcastBatchUpdate */
  private flushBatch(): void {
    if (this.batchBuffer.size === 0) {
      // No data; stop the timer (self-stop mechanism)
      if (this.batchFlushTimer) {
        clearInterval(this.batchFlushTimer);
        this.batchFlushTimer = null;
      }
      return;
    }

    for (const [projectId, tags] of this.batchBuffer.entries()) {
      this.wsGateway.broadcastBatchUpdate(projectId, tags);
    }
    this.batchBuffer.clear();
  }

  private handleDeviceStatusChanged(event: DeviceStatusChangedEvent): void {
    const startMs = Date.now();
    const timestamp = new Date(event.timestamp).toISOString();

    const payload = {
      event: 'deviceStatusChanged',
      deviceId: event.deviceId,
      fromStatus: event.previousStatus || 'unknown',
      toStatus: event.status,
      errorMessage: event.errorMessage,
      timestamp,
    };

    this.wsGateway.broadcastDeviceStatus(event.projectId, event.deviceId, {
      fromStatus: payload.fromStatus,
      toStatus: payload.toStatus,
      errorMessage: payload.errorMessage,
      timestamp,
    });

    // Cache device-status change messages for offline clients
    this.cacheForOffline('device:statusChange', payload);

    const durationMs = Date.now() - startMs;
    this.metricsService.recordBridgeLatency('device:statusChanged', durationMs);
    this.logger.log(
      `device:statusChanged device=${event.deviceId} ${payload.fromStatus}→${payload.toStatus} ${durationMs}ms`,
    );
  }

  private handleAlarmTriggered(event: AlarmTriggeredEvent): void {
    const startMs = Date.now();
    const timestamp = new Date(event.timestamp).toISOString();

    const payload = {
      event: 'alarmTriggered',
      alarmId: event.alarmId,
      ruleName: '',
      tagName: '',
      level: event.level,
      value: event.value ?? 0,
      message: event.message,
      timestamp,
    };

    this.wsGateway.broadcastAlarmTrigger(event.projectId, {
      alarmId: payload.alarmId,
      ruleName: payload.ruleName,
      tagName: payload.tagName,
      level: payload.level,
      value: payload.value,
      message: payload.message,
      timestamp,
    });

    // Cache alarm-trigger messages for offline clients
    this.cacheForOffline('alarm:trigger', payload);

    const durationMs = Date.now() - startMs;
    this.metricsService.recordBridgeLatency('alarm_triggered', durationMs);
    this.logger.log(
      `alarm_triggered alarmId=${event.alarmId} level=${event.level} ${durationMs}ms`,
    );
  }

  private handleAlarmAcknowledged(event: {
    alarmId: string;
    projectId: string;
    acknowledgedBy: string;
    timestamp: number;
  }): void {
    const startMs = Date.now();
    const timestamp = new Date(event.timestamp).toISOString();

    this.wsGateway.broadcastAlarmAcknowledged(event.projectId, {
      alarmId: event.alarmId,
      acknowledgedBy: event.acknowledgedBy,
      timestamp,
    });

    const durationMs = Date.now() - startMs;
    this.metricsService.recordBridgeLatency('alarm_acknowledged', durationMs);
    this.logger.log(
      `alarm_acknowledged alarmId=${event.alarmId} by=${event.acknowledgedBy} ${durationMs}ms`,
    );
  }

  private handleAlarmCleared(event: {
    alarmId: string;
    projectId: string;
    clearedBy: string;
    timestamp: number;
  }): void {
    const startMs = Date.now();
    const timestamp = new Date(event.timestamp).toISOString();

    this.wsGateway.broadcastAlarmCleared(event.projectId, {
      alarmId: event.alarmId,
      clearedBy: event.clearedBy,
      timestamp,
    });

    const durationMs = Date.now() - startMs;
    this.metricsService.recordBridgeLatency('alarm.cleared', durationMs);
    this.logger.log(`alarm.cleared alarmId=${event.alarmId} by=${event.clearedBy} ${durationMs}ms`);
  }

  private handleAlarmRecovered(event: {
    recordId: string;
    projectId: string;
    recoveredValue: string;
    recoveredAt: Date;
    ruleId?: string;
    ruleName?: string;
  }): void {
    const startMs = Date.now();
    const timestamp =
      event.recoveredAt instanceof Date
        ? event.recoveredAt.toISOString()
        : new Date(event.recoveredAt).toISOString();

    this.wsGateway.broadcastAlarmRecovered(event.projectId, {
      alarmId: event.recordId,
      recoveredValue: event.recoveredValue,
      ruleName: event.ruleName,
      timestamp,
    });

    const durationMs = Date.now() - startMs;
    this.metricsService.recordBridgeLatency('alarm.recovered', durationMs);
    this.logger.log(
      `alarm.recovered recordId=${event.recordId} value=${event.recoveredValue} ${durationMs}ms`,
    );
  }

  /**
   * Cache messages for offline clients
   * Finds registered clients currently offline and caches the message into their offline queues
   * @param event event name
   * @param data message data
   */
  cacheForOffline(event: string, data: unknown): void {
    const onlineIds = this.wsGateway.getOnlineUserIds();
    const offlineIds = this.offlineCache.getOfflineClientIds(onlineIds);

    if (offlineIds.length === 0) {
      this.metricsService.recordOfflineCacheMiss();
      return;
    }

    for (const clientId of offlineIds) {
      this.offlineCache.cacheMessage(clientId, event, data);
    }
    this.metricsService.recordOfflineCacheHit();

    this.logger.debug(`Cached offline message for ${offlineIds.length} client(s): event=${event}`);
  }
}
