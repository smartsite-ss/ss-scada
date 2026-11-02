// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '../event-bus/event-bus.service';
import { EventLogService } from '../event-log/event-log.service';
import { DeviceStatus } from '@ss-node/ss-sdk';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Device statistics (grouped by protocol) */
export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  error: number;
  other: number;
}

/** Diagnostic data of a device in-memory state record */
export interface DeviceDiagnostics {
  /** Collection-scheduler retry count */
  retryCount?: number;
  /** Circuit-breaker state */
  circuitState?: 'closed' | 'open' | 'half-open';
  /** Consecutive failure count */
  consecutiveFailures?: number;
  /** Last error time (epoch ms) */
  lastErrorAt?: number;
}

/** Device in-memory state record */
export interface DeviceStateRecord {
  deviceId: string;
  projectId: string;
  protocol: string;
  status: DeviceStatus;
  /** Last successful collection timestamp */
  lastHeartbeat: number;
  /** Last data time */
  lastDataAt: number | null;
  /** Last online time */
  lastOnlineAt: number | null;
  /** Last offline time */
  lastOfflineAt: number | null;
  /** Collection period (ms); 0 = detection disabled */
  scanRate: number;
  /** Offline period (ms); no data report beyond this period is treated as offline */
  offlinePeriod: number;
  /** Failed-tag list while in DEGRADED state */
  failingTags: string[];
  /** Total tag count (for health computation) */
  totalTags: number;
  /** Online tag count */
  onlineTags: number;
  /** Last error message */
  lastErrorMessage: string | null;
  /** Collection diagnostics (pushed by scheduler/plugin layer) */
  diagnostics: DeviceDiagnostics | null;
}

/** Device statistics grouped by protocol */
export interface AllDeviceStats {
  [protocol: string]: DeviceStats;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Unified Device State Manager (UDSM)
 *
 * The single authoritative source of device state in the system. All modules (collector,
 * plugin management, frontend API, WebSocket push) read/write device state through this class.
 *
 * Responsibilities:
 * - Maintain the in-memory deviceId -> DeviceStateRecord map
 * - Emit the unified `device:statusChanged` event via EventBus on state change
 * - Built-in heartbeat detection timer (@Cron every 5 seconds)
 * - Provide per-protocol/global statistics queries
 */
@Injectable()
export class DeviceStateManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceStateManager.name);

  /** Device-state in-memory map */
  private readonly stateMap = new Map<string, DeviceStateRecord>();

  /** Heartbeat timeout multiplier: scanRate x 4 */
  private readonly HEARTBEAT_TIMEOUT_MULTIPLIER = 4;
  /** Default scanRate (30 seconds) */
  private readonly DEFAULT_SCAN_RATE_MS = 30_000;
  /** Heartbeat-check interval (5 seconds) */
  private readonly HEARTBEAT_CHECK_INTERVAL_MS = 5_000;
  /** Heartbeat timer */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly configService: ConfigService,
    @Optional() private readonly eventLogService?: EventLogService,
  ) {}

  onModuleInit(): void {
    const interval =
      this.configService.get<number>('DEVICE_HEARTBEAT_CHECK_INTERVAL_MS') ||
      this.HEARTBEAT_CHECK_INTERVAL_MS;
    this.startHeartbeatTimer(interval);

    // wrap helper: auto-trace handling result and business effect via EventLogService.wrapSubscriber
    const wrap = <T extends any[]>(
      eventType: string,
      handler: (...args: T) => Promise<Record<string, any> | void>,
    ): ((...args: T) => Promise<void>) => {
      const traced = this.eventLogService
        ? this.eventLogService.wrapSubscriber(eventType, 'DeviceStateManager', handler)
        : async (...args: T) => { await handler(...args); };
      return async (...args: T) => {
        try { await traced(...args); }
        catch (err) { this.logger.error(`Handler for ${eventType} failed: ${(err as Error).message}`); }
      };
    };

    // Subscribe to timer-config change events, supporting runtime hot updates
    this.eventBus.on('timer:configChanged', wrap('timer:configChanged', async (payload: { id: string; interval: number }) => {
      if (payload.id === 'DEVICE_HEARTBEAT_CHECK_INTERVAL_MS') {
        this.restartHeartbeatTimer(payload.interval);
        return { heartbeatIntervalUpdated: true, newInterval: payload.interval };
      }
    }));

    // Subscribe to device-update events, supporting scanRate / offlinePeriod hot updates
    this.eventBus.on(
      'device.updated',
      wrap('device.updated', async (payload: {
        deviceId: string;
        changedFields: string[];
        scanRate?: number;
        offlinePeriod?: number;
      }) => {
        const record = this.stateMap.get(payload.deviceId);
        if (!record) return;

        const result: Record<string, any> = { deviceId: payload.deviceId };
        if (payload.changedFields.includes('scanRate') && payload.scanRate) {
          record.scanRate = payload.scanRate;
          this.logger.log(
            `Device ${payload.deviceId} scanRate hot-reloaded to ${payload.scanRate}ms`,
          );
          result.scanRateUpdated = true;
          result.newScanRate = payload.scanRate;
        }

        if (payload.changedFields.includes('offlinePeriod') && payload.offlinePeriod) {
          record.offlinePeriod = payload.offlinePeriod;
          this.logger.log(
            `Device ${payload.deviceId} offlinePeriod hot-reloaded to ${payload.offlinePeriod}ms`,
          );
          result.offlinePeriodUpdated = true;
          result.newOfflinePeriod = payload.offlinePeriod;
        }
        return result;
      }),
    );

    this.logger.log(`DeviceStateManager initialized (heartbeat interval: ${interval}ms)`);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
  }

  /** Start/restart the heartbeat-detection timer */
  private startHeartbeatTimer(interval: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), interval);
  }

  /** Hot-update the heartbeat-check interval at runtime */
  restartHeartbeatTimer(newInterval: number): void {
    this.startHeartbeatTimer(newInterval);
    this.logger.log(`Heartbeat check interval hot-reloaded to ${newInterval}ms`);
  }

  // -------------------------------------------------------------------------
  // State writes
  // -------------------------------------------------------------------------

  /** Register or update a device tracking record */
  registerDevice(params: {
    deviceId: string;
    projectId: string;
    protocol: string;
    scanRate?: number;
    offlinePeriod?: number;
    initialStatus?: DeviceStatus;
    totalTags?: number;
  }): DeviceStateRecord {
    const existing = this.stateMap.get(params.deviceId);
    if (existing) {
      existing.protocol = params.protocol ?? existing.protocol;
      existing.scanRate = params.scanRate ?? existing.scanRate;
      existing.offlinePeriod = params.offlinePeriod ?? existing.offlinePeriod;
      if (params.totalTags !== undefined) {
        existing.totalTags = params.totalTags;
      }
      return existing;
    }

    const record: DeviceStateRecord = {
      deviceId: params.deviceId,
      projectId: params.projectId,
      protocol: params.protocol,
      status: params.initialStatus ?? DeviceStatus.OFFLINE,
      lastHeartbeat: 0,
      lastDataAt: null,
      lastOnlineAt: null,
      lastOfflineAt: params.initialStatus === DeviceStatus.OFFLINE ? Date.now() : null,
      scanRate: params.scanRate ?? this.DEFAULT_SCAN_RATE_MS,
      offlinePeriod:
        params.offlinePeriod ??
        (params.scanRate ?? this.DEFAULT_SCAN_RATE_MS) * this.HEARTBEAT_TIMEOUT_MULTIPLIER,
      failingTags: [],
      totalTags: params.totalTags ?? 0,
      onlineTags: 0,
      lastErrorMessage: null,
      diagnostics: null,
    };

    this.stateMap.set(params.deviceId, record);
    return record;
  }

  /** Unregister device tracking */
  unregisterDevice(deviceId: string): void {
    this.stateMap.delete(deviceId);
  }

  /**
   * Unregister tracking records for all devices under a project (called when a project is disabled)
   *
   * Iterates the in-memory state table and removes all devices matching projectId.
   * Does not access the project DB directly; the caller handles persistence and task-scheduler cleanup.
   *
   * @param projectId project ID
   * @returns the unregistered device ID list (for the caller to further clean up task schedulers/plugins)
   */
  unregisterProjectDevices(projectId: string): string[] {
    const removedDeviceIds: string[] = [];
    for (const [deviceId, record] of this.stateMap) {
      if (record.projectId === projectId) {
        this.stateMap.delete(deviceId);
        removedDeviceIds.push(deviceId);
      }
    }
    return removedDeviceIds;
  }

  /** Set device online (collection succeeded) */
  setOnline(deviceId: string, dataTimestamp?: number): void {
    const record = this.stateMap.get(deviceId);
    if (!record) {
      this.logger.warn(`setOnline: device ${deviceId} not tracked`);
      return;
    }

    const now = Date.now();
    const prevStatus = record.status;
    record.status = DeviceStatus.ONLINE;
    record.lastHeartbeat = now;
    record.lastDataAt = dataTimestamp ?? now;
    record.lastErrorMessage = null;
    record.diagnostics = null; // clear diagnostic data after recovery

    if (prevStatus !== DeviceStatus.ONLINE) {
      // Update last-online time only on state transition (not-online -> online), avoiding jitter with real-time data
      record.lastOnlineAt = now;
      this.logger.log(`Device ${deviceId}: ${prevStatus} → online`);
      this.emitStatusChanged(record, prevStatus);
    }
  }

  /** Set device offline */
  setOffline(deviceId: string, reason?: string): void {
    const record = this.stateMap.get(deviceId);
    if (!record) return;

    const prevStatus = record.status;
    if (prevStatus === DeviceStatus.OFFLINE) return;

    record.status = DeviceStatus.OFFLINE;
    record.lastOfflineAt = Date.now();

    this.logger.log(`Device ${deviceId}: ${prevStatus} → offline${reason ? ` (${reason})` : ''}`);
    this.emitStatusChanged(record, prevStatus);
  }

  /** Set device error */
  setError(deviceId: string, errorMessage?: string): void {
    const record = this.stateMap.get(deviceId);
    if (!record) return;

    const prevStatus = record.status;
    record.status = DeviceStatus.ERROR;
    record.lastErrorMessage = errorMessage ?? null;

    this.logger.warn(
      `Device ${deviceId}: ${prevStatus} → error${errorMessage ? ` (${errorMessage})` : ''}`,
    );
    this.emitStatusChanged(record, prevStatus);
  }

  /** Set device collection diagnostics (pushed by scheduler/plugin layer) */
  setDiagnostics(deviceId: string, diagnostics: DeviceDiagnostics): void {
    const record = this.stateMap.get(deviceId);
    if (!record) return;
    record.diagnostics = { ...record.diagnostics, ...diagnostics };
  }

  /** Set device to DEGRADED (some tags failing) */
  setDegraded(deviceId: string, failingTagIds: string[], errorMessage?: string): void {
    const record = this.stateMap.get(deviceId);
    if (!record) return;

    const prevStatus = record.status;
    record.status = DeviceStatus.DEGRADED;
    record.failingTags = failingTagIds;
    record.onlineTags = record.totalTags - failingTagIds.length;
    record.lastErrorMessage = errorMessage ?? null;

    this.logger.warn(
      `Device ${deviceId}: ${prevStatus} → degraded (${failingTagIds.length}/${record.totalTags} tags failing)`,
    );
    this.emitStatusChanged(record, prevStatus);
  }

  /** Update the failed-tag list of a DEGRADED device */
  updateFailingTags(deviceId: string, failingTagIds: string[]): void {
    const record = this.stateMap.get(deviceId);
    if (!record) return;

    record.failingTags = failingTagIds;
    record.onlineTags = record.totalTags - failingTagIds.length;

    if (failingTagIds.length === 0 && record.status === DeviceStatus.DEGRADED) {
      // All tags recovered -> back to ONLINE
      this.setOnline(deviceId);
    } else if (failingTagIds.length > 0 && record.status === DeviceStatus.ONLINE) {
      // Failed tags present -> enter DEGRADED
      this.setDegraded(deviceId, failingTagIds);
    }
  }

  /** Get a device's tag health (0-1) */
  getTagHealth(deviceId: string): number | null {
    const record = this.stateMap.get(deviceId);
    if (!record || record.totalTags === 0) return null;
    return record.onlineTags / record.totalTags;
  }

  /** Update the heartbeat timestamp */
  touchHeartbeat(deviceId: string): void {
    const record = this.stateMap.get(deviceId);
    if (record) {
      record.lastHeartbeat = Date.now();
    }
  }

  // -------------------------------------------------------------------------
  // State reads
  // -------------------------------------------------------------------------

  getState(deviceId: string): DeviceStateRecord | undefined {
    return this.stateMap.get(deviceId);
  }

  getAllStates(): ReadonlyMap<string, DeviceStateRecord> {
    return this.stateMap;
  }

  /** Get the active device ID list under a protocol */
  getDeviceIdsByProtocol(protocol: string): string[] {
    const ids: string[] = [];
    for (const [id, record] of this.stateMap) {
      if (record.protocol === protocol) {
        ids.push(id);
      }
    }
    return ids;
  }

  /** Get statistics by protocol */
  getStatsByProtocol(protocol: string): DeviceStats {
    let total = 0;
    let online = 0;
    let offline = 0;
    let error = 0;
    let other = 0;

    for (const [, record] of this.stateMap) {
      if (record.protocol !== protocol) continue;
      total++;
      switch (record.status) {
        case DeviceStatus.ONLINE:
          online++;
          break;
        case DeviceStatus.OFFLINE:
          offline++;
          break;
        case DeviceStatus.ERROR:
          error++;
          break;
        default:
          other++;
      }
    }

    return { total, online, offline, error, other };
  }

  /** Get statistics for all protocols */
  getAllStats(): AllDeviceStats {
    const result: AllDeviceStats = {};
    for (const [, record] of this.stateMap) {
      const stats = result[record.protocol] || {
        total: 0,
        online: 0,
        offline: 0,
        error: 0,
        other: 0,
      };
      stats.total++;
      switch (record.status) {
        case DeviceStatus.ONLINE:
          stats.online++;
          break;
        case DeviceStatus.OFFLINE:
          stats.offline++;
          break;
        case DeviceStatus.ERROR:
          stats.error++;
          break;
        default:
          stats.other++;
      }
      result[record.protocol] = stats;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Heartbeat detection
  // -------------------------------------------------------------------------

  /** Heartbeat check (triggered by setInterval every 5 seconds) */
  private checkHeartbeats(): void {
    const now = Date.now();
    for (const [deviceId, record] of this.stateMap) {
      // Only check online state
      if (record.status !== DeviceStatus.ONLINE) continue;

      // offlinePeriod or scanRate of 0 means heartbeat detection is disabled
      const offlinePeriod =
        record.offlinePeriod > 0
          ? record.offlinePeriod
          : record.scanRate * this.HEARTBEAT_TIMEOUT_MULTIPLIER;
      if (offlinePeriod <= 0) continue;

      if (record.lastHeartbeat > 0 && now - record.lastHeartbeat > offlinePeriod) {
        this.setOffline(deviceId, 'heartbeat timeout');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internal methods
  // -------------------------------------------------------------------------

  private emitStatusChanged(record: DeviceStateRecord, prevStatus: DeviceStatus): void {
    this.eventBus.emit('device:statusChanged', {
      deviceId: record.deviceId,
      projectId: record.projectId,
      protocol: record.protocol,
      status: record.status,
      previousStatus: prevStatus,
      timestamp: Date.now(),
    });
  }
}
