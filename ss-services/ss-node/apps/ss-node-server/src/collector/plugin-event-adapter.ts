// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventBusService, DeviceStateManager, ProjectDatabaseService } from '@ss-node/ss-core';
import { PluginRegistry, PluginLifecycleEvent } from '@ss-node/ss-collector-sdk';
import { DataTag } from '@ss-node/ss-device';
import { DeviceLoadingService } from './device-loading.service';
import { TaskRegistrationService } from './task-registration.service';
import { DevicePersistenceService } from './device-persistence.service';

/**
 * Plugin event adapter
 *
 * Subscribes to and handles plugin lifecycle events (register/activate/deactivate) and
 * device-state-change events, coordinating the sub-services to reload devices, register
 * tasks and persist state.
 */
@Injectable()
export class PluginEventAdapter {
  private readonly logger = new Logger(PluginEventAdapter.name);

  /** Available project list (updated by the Bootstrap) */
  private availableProjects: string[] = [];

  /** Plugin-ready callback */
  private onPluginsReady?: () => void;

  /** Whether the plugin is ready */
  private pluginsReady = false;
  private registeredPluginCount = 0;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly deviceLoadingService: DeviceLoadingService,
    private readonly taskRegistrationService: TaskRegistrationService,
    private readonly devicePersistenceService: DevicePersistenceService,
    private readonly deviceStateManager: DeviceStateManager,
    private readonly projectDbService: ProjectDatabaseService,
    @Optional() private readonly pluginRegistry?: PluginRegistry,
  ) {}

  /** Update the available project list */
  setAvailableProjects(projects: string[]): void {
    this.availableProjects = projects;
  }

  /**
   * Listen for plugin registration completion and trigger the callback when ready
   *
   * @param onReady the plugin-ready callback
   */
  listenForPluginsReady(onReady: () => void): void {
    this.onPluginsReady = onReady;

    // If PluginRegistry is not injected, trigger the callback directly
    if (!this.pluginRegistry) {
      this.logger.warn('PluginRegistry not available, loading devices without plugin filtering');
      this.pluginsReady = true;
      // Delay device loading by 100ms so the HTTP server is ready first, avoiding a block on app.listen()
      setTimeout(() => this.onPluginsReady?.(), 100);
      return;
    }

    const currentPlugins = this.pluginRegistry.listPlugins();
    this.registeredPluginCount = currentPlugins.length;

    // Listen for subsequent plugin.registered events
    this.eventBus.on('plugin.registered', (event: PluginLifecycleEvent) => {
      this.registeredPluginCount++;
      this.logger.log(`Plugin registered (${this.registeredPluginCount}): ${event.protocol}`);

      // Once at least one plugin exists, start loading devices
      if (!this.pluginsReady && this.registeredPluginCount >= 1) {
        this.pluginsReady = true;
        this.onPluginsReady?.();
      }
    });

    // If plugins already exist, start directly
    if (currentPlugins.length > 0) {
      this.pluginsReady = true;
      // Delay device loading by 100ms so the HTTP server is ready first, avoiding a block on app.listen()
      setTimeout(() => this.onPluginsReady?.(), 100);
    }
  }

  /**
   * Subscribe to plugin lifecycle events and device-state-change events
   */
  subscribeToPluginEvents(): void {
    // DeviceStateManager uniformly emits the device:statusChanged event
    // Listen for the dirty flag to drive persistence
    this.eventBus.on(
      'device:statusChanged',
      (event: { deviceId: string; previousStatus: string }) => {
        this.devicePersistenceService.markDeviceDirty(event.deviceId);
      },
    );

    // After plugin activation, re-scan devices to pick up those matching the protocol
    this.eventBus.on('plugin.activated', (event: PluginLifecycleEvent) => {
      this.logger.log(`Plugin activated: ${event.protocol} — reloading devices`);
      this.handlePluginActivated(event.protocol.toLowerCase());
    });

    // On plugin deactivation, mark all online devices of that protocol as offline
    this.eventBus.on('plugin.deactivated', (event: PluginLifecycleEvent) => {
      this.handlePluginDeactivated(event.protocol.toLowerCase());
    });

    // Plugin-isolate crash: mark all devices of that protocol as errored, carrying crash details
    this.eventBus.on(
      'plugin.isolation.crash',
      (event: { protocol: string; error: string; mode: string }) => {
        this.handlePluginIsolationCrash(event.protocol.toLowerCase(), event.error, event.mode);
      },
    );

    this.logger.log('Plugin event subscriptions initialized');
  }

  /**
   * Handle plugin-activation events: reload devices matching the protocol and register collection tasks
   */
  private async handlePluginActivated(protocol: string): Promise<void> {
    try {
      const skipDeviceIds = this.taskRegistrationService.getRegisteredDeviceIds();
      const newDevices = await this.deviceLoadingService.reloadDevicesForProtocol(
        protocol,
        this.availableProjects,
        skipDeviceIds,
      );

      // Register collection tasks for the new devices
      for (const device of newDevices) {
        const ds = await this.projectDbService.getSystemDb(
          this.deviceStateManager.getState(device.id)?.projectId || '',
        );
        const tagRepo = ds.getRepository(DataTag);
        const projectName = this.deviceStateManager.getState(device.id)?.projectId || '';
        await this.taskRegistrationService.registerTasksForDevice(
          device,
          protocol,
          tagRepo,
          projectName,
        );
      }

      const totalTasks = this.taskRegistrationService.getTaskCount();
      this.logger.log(
        `Plugin "${protocol}" activation complete: +${newDevices.length} devices, total tasks: ${totalTasks}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle plugin activation for "${protocol}": ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle plugin-deactivation events: mark all devices of that protocol as offline
   */
  private handlePluginDeactivated(protocol: string): void {
    const deviceIds = this.deviceStateManager.getDeviceIdsByProtocol(protocol);
    this.logger.log(
      `Plugin deactivated: ${protocol} — marking ${deviceIds.length} devices offline`,
    );

    for (const deviceId of deviceIds) {
      this.deviceStateManager.setOffline(deviceId, 'Plugin deactivated');
      this.devicePersistenceService.markDeviceDirty(deviceId);
    }
  }

  /**
   * Handle plugin-isolate crash events: mark all devices of that protocol as errored
   */
  private handlePluginIsolationCrash(protocol: string, errorMsg: string, mode: string): void {
    const deviceIds = this.deviceStateManager.getDeviceIdsByProtocol(protocol);
    if (deviceIds.length === 0) return;

    const errorDetail = `Plugin isolation crash (${mode}): ${errorMsg}`;
    this.logger.warn(
      `Plugin isolation crash: ${protocol} (${mode}) — marking ${deviceIds.length} devices as error`,
    );

    for (const deviceId of deviceIds) {
      this.deviceStateManager.setError(deviceId, errorDetail);
      this.deviceStateManager.setDiagnostics(deviceId, {
        circuitState: 'open',
        lastErrorAt: Date.now(),
      });
      this.devicePersistenceService.markDeviceDirty(deviceId);
    }
  }
}
