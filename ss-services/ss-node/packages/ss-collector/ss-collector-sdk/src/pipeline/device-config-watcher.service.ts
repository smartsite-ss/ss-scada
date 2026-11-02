// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EventBusService, EventLogService } from '@ss-node/ss-core';
import { IsolationFactory, PluginRegistry } from '../plugins';
import type { ShardRef } from '../plugins/isolation/isolation.types';
import { EnhancedScheduler } from './scheduler/enhanced-scheduler';

/**
 * Device config-change watcher
 *
 * Listens for device.created / updated / deleted events and synchronously updates the collector layer's connections and scheduled tasks.
 * All EventBus operations run in the main process; the isolation body receives connect/disconnect commands via executor IPC.
 *
 * Business-effect tracking (#6 event persistence):
 * - Each handler is wrapped via EventLogService.wrapSubscriber, which automatically records processing status and business effects
 * - The handler returns business-effect objects such as { connectionId, tagsLoaded, tasksRegistered, deviceOnline }
 * - On failure it throws an exception, which wrapSubscriber captures and records as failed
 */
@Injectable()
export class DeviceConfigWatcher implements OnModuleInit {
  private readonly logger = new Logger(DeviceConfigWatcher.name);

  /** Current active device -> ShardRef / TaskRef map */
  private activeDevices = new Map<string, { shard: ShardRef }>();

  constructor(
    private readonly eventBus: EventBusService,
    @Optional() private readonly pluginRegistry?: PluginRegistry,
    @Optional() private readonly isolationFactory?: IsolationFactory,
    @Optional() private readonly scheduler?: EnhancedScheduler,
    /** Event-log service - used to track each handler's processing result and business effect (#6 event persistence) */
    @Optional() private readonly eventLogService?: EventLogService,
  ) {}

  onModuleInit(): void {
    // Wrap helper:
    // - If EventLogService is available, wrapSubscriber automatically records processing status and business effects
    // - The outer try/catch captures errors rethrown by wrapSubscriber, avoiding unhandled rejection from the synchronous EventBus.emit
    //   unhandled rejection caused by not awaiting an async handler
    const wrap = <T extends any[]>(
      eventType: string,
      handler: (...args: T) => Promise<Record<string, any> | void>,
    ): ((...args: T) => Promise<void>) => {
      const traced = this.eventLogService
        ? this.eventLogService.wrapSubscriber(
            eventType,
            'DeviceConfigWatcher',
            handler,
          )
        : async (...args: T) => {
            await handler(...args);
          };

      // Outer capture: wrapSubscriber rethrows on failure; catch here to prevent unhandled rejection
      return async (...args: T) => {
        try {
          await traced(...args);
        } catch (err) {
          this.logger.error(
            `Handler for ${eventType} failed: ${(err as Error).message}`,
          );
        }
      };
    };

    this.eventBus.on('device.created', wrap('device.created', this.onDeviceCreated.bind(this) as any));
    this.eventBus.on('device.updated', wrap('device.updated', this.onDeviceUpdated.bind(this) as any));
    this.eventBus.on('device.deleted', wrap('device.deleted', this.onDeviceDeleted.bind(this) as any));
    this.eventBus.on('device.enabled', wrap('device.enabled', this.onDeviceEnabled.bind(this) as any));
    this.eventBus.on('device.disabled', wrap('device.disabled', this.onDeviceDisabled.bind(this) as any));
    this.logger.log('DeviceConfigWatcher initialized, listening for device events');
  }

  /**
   * Device created -> establish connection + register scheduled task
   *
   * Business effect: returns connectionId, whether the device is online, and whether the connection was newly created
   * On failure it throws (recorded as failed by wrapSubscriber)
   */
  private async onDeviceCreated(event: {
    deviceId: string;
    projectId: string;
    protocol: string;
    connection: Record<string, any>;
    scanRate: number;
  }): Promise<Record<string, any>> {
    this.logger.log(`Device created: ${event.deviceId} (${event.protocol})`);

    // ensureConnection throws on failure and is captured by wrapSubscriber
    const connectionId = await this.ensureConnection(
      event.deviceId,
      event.protocol,
      event.connection,
    );

    return {
      connectionId,
      deviceOnline: true,
      connectionRebuilt: false,
      tagsLoaded: 0, // tag loading is handled by EnhancedScheduler / CollectorBootstrap
      tasksRegistered: 0, // task registration is handled by EnhancedScheduler
      protocol: event.protocol,
    };
  }

  /**
   * Device updated -> apply incremental operations based on changedFields
   *
   * Business effect: returns per-field results (whether the connection was rebuilt, scanRate updated, tagsChanged triggered)
   */
  private async onDeviceUpdated(event: {
    deviceId: string;
    projectId: string;
    protocol: string;
    changedFields: string[];
    connection?: Record<string, any>;
    scanRate?: number;
    driver?: string;
  }): Promise<Record<string, any>> {
    const { deviceId, protocol, changedFields } = event;
    this.logger.log(
      `Device updated: ${deviceId} (${protocol}), changedFields=${JSON.stringify(changedFields)}`,
    );

    const result: {
      fieldsProcessed: string[];
      connectionRebuilt: boolean;
      connectionId: string | null;
      scanRateUpdated: boolean;
      tasksUpdated: number;
      tagsChangedEmitted: boolean;
      deviceOnline: boolean;
    } = {
      fieldsProcessed: [],
      connectionRebuilt: false,
      connectionId: null,
      scanRateUpdated: false,
      tasksUpdated: 0,
      tagsChangedEmitted: false,
      deviceOnline: false,
    };

    // Channel config changed: disconnect old connection -> establish new connection
    if (changedFields.includes('connection') && event.connection) {
      await this.disconnectDevice(deviceId);
      const newConnectionId = await this.ensureConnection(
        deviceId,
        protocol,
        event.connection,
      );
      result.fieldsProcessed.push('connection');
      result.connectionRebuilt = true;
      result.connectionId = newConnectionId;
      result.deviceOnline = true;
      this.logger.log(`Device ${deviceId} connection rebuilt`);
    }

    // Collection driver changed: disconnect old connection -> rebuild with new driver -> reload tasks
    if (changedFields.includes('driver') && event.driver) {
      await this.disconnectDevice(deviceId);
      const newConnectionId = await this.ensureConnection(
        deviceId,
        event.driver,
        event.connection || {},
      );
      // After a driver change a reload is needed; emit tagsChanged so the upper layer reloads tasks
      this.eventBus.emit('device.tagsChanged', {
        deviceId,
        projectId: event.projectId,
        protocol: event.driver,
        changeType: 'driver_switch',
        timestamp: Date.now(),
      });
      result.fieldsProcessed.push('driver');
      result.connectionRebuilt = true;
      result.connectionId = newConnectionId;
      result.tagsChangedEmitted = true;
      result.deviceOnline = true;
      this.logger.log(
        `Device ${deviceId} driver changed to ${event.driver}, connection rebuilt`,
      );
    }

    // Collection frequency changed: update the scheduler
    if (changedFields.includes('scanRate') && event.scanRate) {
      if (this.scheduler) {
        const updated = this.scheduler.updateTaskInterval(deviceId, event.scanRate);
        result.fieldsProcessed.push('scanRate');
        result.scanRateUpdated = true;
        result.tasksUpdated = updated;
        this.logger.log(
          `Device ${deviceId} scanRate changed to ${event.scanRate}ms (${updated} tasks updated)`,
        );
      } else {
        this.logger.warn(
          `Device ${deviceId} scanRate changed to ${event.scanRate}ms but scheduler unavailable`,
        );
      }
    }

    // Tag change: forward the device.tagsChanged event; the upper-layer CollectorBootstrap reloads tasks
    if (changedFields.includes('tags')) {
      this.eventBus.emit('device.tagsChanged', {
        deviceId,
        projectId: event.projectId,
        protocol: event.protocol,
        changeType: 'template_sync',
        timestamp: Date.now(),
      });
      result.fieldsProcessed.push('tags');
      result.tagsChangedEmitted = true;
      this.logger.log(`Device ${deviceId} tags changed, emitted tagsChanged event`);
    }

    // If no field was handled but it was still called, mark the device online (if a connection already exists)
    if (result.fieldsProcessed.length === 0) {
      result.deviceOnline = this.activeDevices.has(deviceId);
      result.connectionId =
        this.activeDevices.get(deviceId)?.shard.connectionId ?? null;
    }

    return result;
  }

  /**
   * Device deleted -> disconnect + remove scheduled task
   *
   * Business effect: returns whether the connection was closed and whether the device was removed from the collector layer
   */
  private async onDeviceDeleted(event: {
    deviceId: string;
  }): Promise<Record<string, any>> {
    this.logger.log(`Device deleted: ${event.deviceId}`);

    const hadConnection = this.activeDevices.has(event.deviceId);
    await this.disconnectDevice(event.deviceId);
    this.activeDevices.delete(event.deviceId);

    return {
      deviceRemoved: true,
      connectionClosed: hadConnection,
      deviceId: event.deviceId,
    };
  }

  /**
   * Device enabled -> reuse the onDeviceCreated flow
   */
  private async onDeviceEnabled(event: {
    deviceId: string;
    projectId: string;
    protocol: string;
    connection: Record<string, any>;
    scanRate: number;
  }): Promise<Record<string, any>> {
    const result = await this.onDeviceCreated(event);
    return { ...result, action: 'enabled' };
  }

  /**
   * Device disabled -> reuse the onDeviceDeleted flow
   */
  private async onDeviceDisabled(event: {
    deviceId: string;
  }): Promise<Record<string, any>> {
    const result = await this.onDeviceDeleted(event);
    return { ...result, action: 'disabled' };
  }

  /**
   * Ensure the device connection is established, supporting three isolation modes
   * - in_process: call adapter.connect() directly
   * - worker_thread/child_process: call executor.connect()
   *
   * @returns connectionId (used for business-effect tracking)
   * @throws throws when the connection fails
   */
  async ensureConnection(
    deviceId: string,
    protocol: string,
    connection: Record<string, any>,
  ): Promise<string> {
    if (!this.isolationFactory) {
      this.logger.warn('IsolationFactory not available, skipping ensureConnection');
      return 'unavailable';
    }

    const executor = this.isolationFactory.getExecutor(protocol);
    const shard = await executor.connect({
      id: deviceId,
      name: deviceId,
      protocol,
      connection,
    });
    this.activeDevices.set(deviceId, { shard });
    return shard.connectionId;
  }

  /**
   * Disconnect the device, supporting three isolation modes
   *
   * @returns whether an existing connection was actually disconnected (false means the device was not online)
   */
  async disconnectDevice(deviceId: string): Promise<boolean> {
    const record = this.activeDevices.get(deviceId);
    if (!record) return false;

    try {
      const executor = this.isolationFactory?.getExecutor(record.shard.protocol);
      if (executor) {
        await executor.disconnect(record.shard);
      }
    } catch (err) {
      // Disconnect failure is not thrown, to avoid affecting subsequent ensureConnection
      this.logger.warn(
        `disconnectDevice ${deviceId} failed (will still remove from active map): ${(err as Error).message}`,
      );
    }
    this.activeDevices.delete(deviceId);
    return true;
  }

  getActiveDevices(): Map<string, { shard: ShardRef }> {
    return new Map(this.activeDevices);
  }
}
