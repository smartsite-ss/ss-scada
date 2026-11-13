// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import {
  DeviceStateManager,
  DeviceStateRecord,
  ProjectDatabaseService,
  EventBusService,
  EventLogService,
} from '@ss-node/ss-core';
import { Device, DataTag } from '@ss-node/ss-device';
import { DeviceStatus } from '@ss-node/ss-sdk';
import { IActiveDeviceTracker, ActiveDeviceInfo, DeviceStats } from '@ss-node/ss-collector-sdk';
import type { DeviceTagsChangedEvent, TemplateDevicesSyncedEvent } from '@ss-node/ss-core';

import { DeviceLoadingService } from './device-loading.service';
import { TaskRegistrationService } from './task-registration.service';
import { DevicePersistenceService } from './device-persistence.service';
import { PluginEventAdapter } from './plugin-event-adapter';

/**
 * Collector bootstrap (coordination layer)
 *
 * Runs after the NestJS app finishes initializing all modules (OnApplicationBootstrap):
 * 1. Wait for plugin registration to complete
 * 2. Scan all project directories -> load devices -> register collection tasks
 * 3. Start periodic state persistence
 * 4. Subscribe to plugin lifecycle events
 *
 * Responsibilities are split into the following sub-services:
 * - DeviceLoadingService       -> device loading and state registration
 * - TaskRegistrationService    -> collection-task registration and management
 * - DevicePersistenceService   -> device-state persistence
 * - PluginEventAdapter         -> plugin event handling
 *
 * Business-effect tracking (#6 event persistence):
 * - project:enabled / project:disabled / device.tagsChanged events are wrapped via wrapSubscriber
 * - the handler returns a business-effect object (devicesLoaded / tasksRegistered / protocolsActive, etc.)
 * - on failure wrapSubscriber records it as failed; the outer catch avoids unhandled rejection
 */
@Injectable()
export class DeviceCollectorBootstrap
  implements OnApplicationBootstrap, OnModuleDestroy, IActiveDeviceTracker
{
  private readonly logger = new Logger(DeviceCollectorBootstrap.name);

  /** Discovered project list (for reload) */
  private availableProjects: string[] = [];

  constructor(
    private readonly deviceLoadingService: DeviceLoadingService,
    private readonly taskRegistrationService: TaskRegistrationService,
    private readonly devicePersistenceService: DevicePersistenceService,
    private readonly pluginEventAdapter: PluginEventAdapter,
    private readonly deviceStateManager: DeviceStateManager,
    private readonly configService: ConfigService,
    private readonly projectDbService: ProjectDatabaseService,
    private readonly eventBus: EventBusService,
    /** Event-log service - tracks handler results and business effects (#6 event persistence) */
    @Optional() private readonly eventLogService?: EventLogService,
  ) {}

  /**
   * Wrap an event handler: automatically track results and business effects via EventLogService.wrapSubscriber
   *
   * - If EventLogService is available, record processing state (processing/processed/failed) and business effects
   * - The outer try/catch captures errors re-thrown by wrapSubscriber, avoiding unhandled rejection
   * - On failure it still records business effects (e.g. partially loaded device count)
   */
  private wrapHandler<T extends any[]>(
    eventType: string,
    subscriberName: string,
    handler: (...args: T) => Promise<Record<string, any> | void>,
  ): (...args: T) => Promise<void> {
    const traced = this.eventLogService
      ? this.eventLogService.wrapSubscriber(eventType, subscriberName, handler)
      : async (...args: T) => {
          await handler(...args);
        };

    return async (...args: T) => {
      try {
        await traced(...args);
      } catch (err) {
        this.logger.error(
          `Handler for ${eventType} failed: ${(err as Error).message}`,
        );
      }
    };
  }

  // -----------------------------------------------------------------------
  //  Lifecycle
  // -----------------------------------------------------------------------

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('CollectorBootstrap starting - waiting for plugin registration...');

    // Subscribe to device-tag-changed events (template sync / tag edits -> collector reloads tasks)
    // Wrapped via wrapHandler to auto-record processing state and business effects (#6 event persistence)
    this.eventBus.on(
      'device.tagsChanged',
      this.wrapHandler(
        'device.tagsChanged',
        'DeviceCollectorBootstrap',
        async (event: DeviceTagsChangedEvent): Promise<Record<string, any>> => {
          this.logger.log(
            `Tags changed for device ${event.deviceId} (${event.changeType}), reloading tasks...`,
          );
          const ds = await this.projectDbService.getSystemDb(event.projectId);
          const tagRepo = ds.getRepository(DataTag);
          const deviceRepo = ds.getRepository(Device);
          const device = await deviceRepo.findOne({
            where: { id: event.deviceId },
          });
          if (!device) {
            this.logger.warn(
              `Device ${event.deviceId} not found in project ${event.projectId}, skip tag reload`,
            );
            return {
              deviceId: event.deviceId,
              tasksReloaded: 0,
              tagsCount: 0,
              deviceFound: false,
            };
          }

          const tagsCount = await tagRepo.count({
            where: { deviceId: event.deviceId },
          });
          await this.taskRegistrationService.reloadDeviceTasks(
            event.deviceId,
            event.projectId,
            event.protocol,
            device,
            tagRepo,
          );

          // On driver switch, also update the protocol in DeviceStateManager to avoid wrong results when querying by protocol
          let protocolUpdated = false;
          if (event.changeType === 'driver_switch') {
            this.deviceStateManager.registerDevice({
              deviceId: event.deviceId,
              projectId: event.projectId,
              protocol: event.protocol,
            });
            protocolUpdated = true;
            this.logger.log(
              `DeviceStateManager protocol updated for ${event.deviceId} → ${event.protocol}`,
            );
          }

          return {
            deviceId: event.deviceId,
            tasksReloaded: 1,
            tagsCount,
            protocol: event.protocol,
            changeType: event.changeType,
            protocolUpdated,
            deviceFound: true,
          };
        },
      ),
    );

    // Subscribe to template-sync batch events - reload all affected devices' point tables in parallel batches
    this.eventBus.on('template.devices-synced', async (event: TemplateDevicesSyncedEvent) => {
      const { deviceIds, projectId, protocol, summary } = event;
      this.logger.log(
        `Template sync completed: ${deviceIds.length} device(s) need point-table reload` +
          (summary ? ` (added ${summary.added} / updated ${summary.updated} / removed ${summary.removed})` : ''),
      );

      const ds = await this.projectDbService.getSystemDb(projectId);
      const tagRepo = ds.getRepository(DataTag);
      const deviceRepo = ds.getRepository(Device);

      // Parallel in batches, capping SQLite concurrency
      const BATCH = 15;
      for (let i = 0; i < deviceIds.length; i += BATCH) {
        await Promise.all(
          deviceIds.slice(i, i + BATCH).map(async (deviceId) => {
            try {
              const device = await deviceRepo.findOne({ where: { id: deviceId } });
              if (!device) return;
              await this.taskRegistrationService.reloadDeviceTasks(
                deviceId,
                projectId,
                protocol,
                device,
                tagRepo,
              );
            } catch (err: any) {
              this.logger.error(`Failed to reload point table for device ${deviceId}: ${err.message}`);
            }
          }),
        );
      }

      this.logger.log(`Template sync point-table reload completed: ${deviceIds.length} device(s)`);
    });

    // Subscribe to project enable-state change events (dynamic start/stop of collection)
    // - project:enabled  -> load the project's devices and register collection tasks
    // - project:disabled -> stop all the project's device tasks and unregister state records
    this.subscribeToProjectStatusChanges();

    // Subscribe to plugin lifecycle events (activate/deactivate)
    this.pluginEventAdapter.subscribeToPluginEvents();

    // Start periodic persistence
    this.devicePersistenceService.startPeriodicPersistence();

    // Listen for plugin registration completion; start loading devices once ready
    this.pluginEventAdapter.listenForPluginsReady(() => {
      this.startDeviceLoading();
    });

    this.logger.log('CollectorBootstrap initialized, awaiting plugins...');
  }

  onModuleDestroy(): void {
    this.devicePersistenceService.stopPeriodicPersistence();
    this.logger.log('CollectorBootstrap destroyed');
  }

  // -----------------------------------------------------------------------
  //  IActiveDeviceTracker implementation
  // -----------------------------------------------------------------------

  getActiveDeviceIds(protocol: string): string[] {
    return this.deviceStateManager.getDeviceIdsByProtocol(protocol.toLowerCase());
  }

  getActiveDeviceInfo(deviceId: string): ActiveDeviceInfo | undefined {
    const state = this.deviceStateManager.getState(deviceId);
    if (!state) return undefined;
    const deviceName = this.deviceLoadingService.getDeviceName(deviceId);
    return {
      deviceId: state.deviceId,
      deviceName,
      projectId: state.projectId,
      projectName: state.projectId,
      status:
        state.status === DeviceStatus.ONLINE
          ? 'online'
          : state.status === DeviceStatus.OFFLINE
            ? 'offline'
            : state.status === DeviceStatus.CONNECTING
              ? 'connecting'
              : 'error',
      lastOnlineAt: state.lastOnlineAt ? new Date(state.lastOnlineAt) : null,
      lastOfflineAt: state.lastOfflineAt ? new Date(state.lastOfflineAt) : null,
    };
  }

  getDeviceStats(protocol: string): DeviceStats {
    return this.deviceStateManager.getStatsByProtocol(protocol.toLowerCase());
  }

  // -----------------------------------------------------------------------
  //  Project enable-state change (dynamic start/stop of collection)
  // -----------------------------------------------------------------------

  /**
   * Subscribe to project enable-state change events
   *
   * - `project:enabled`  -> load the project's devices and register collection tasks, also add to availableProjects
   * - `project:disabled` -> stop all the project's device tasks and unregister DeviceStateManager records
   *
   * Emitter: ProjectService.update() detects an enabled-field change and emits via EventBus.
   *
   * Business-effect tracking (#6 event persistence):
   * - wrapped via wrapHandler to auto-record processing state and business effects
   * - project:enabled  returns { devicesLoaded, tasksRegistered, protocolsActive, dataSourceOpened }
   * - project:disabled returns { devicesUnregistered, tasksStopped }
   */
  private subscribeToProjectStatusChanges(): void {
    this.eventBus.on(
      'project:enabled',
      this.wrapHandler(
        'project:enabled',
        'DeviceCollectorBootstrap',
        async (payload: { projectId: string }): Promise<Record<string, any>> => {
          const { projectId } = payload;
          this.logger.log(`Event "project:enabled" received: ${projectId}`);

          // Add to the available-projects list (deduplicated)
          if (!this.availableProjects.includes(projectId)) {
            this.availableProjects.push(projectId);
            this.pluginEventAdapter.setAvailableProjects(this.availableProjects);
          }

          // Load devices and register state (DeviceLoadingService already registers them with DeviceStateManager internally)
          const loadedByProtocol =
            await this.deviceLoadingService.loadProjectDevices(projectId);

          // Register collection tasks for the loaded devices
          await this.registerTasksForLoadedDevices(loadedByProtocol);

          const totalLoaded = Object.values(loadedByProtocol).reduce(
            (sum, devices) => sum + devices.length,
            0,
          );
          this.logger.log(
            `Project ${projectId} enabled: ${totalLoaded} devices loaded, tasks registered`,
          );

          return {
            projectId,
            devicesLoaded: totalLoaded,
            tasksRegistered: totalLoaded,
            protocolsActive: Object.keys(loadedByProtocol),
            dataSourceOpened: true,
          };
        },
      ),
    );

    this.eventBus.on(
      'project:disabled',
      this.wrapHandler(
        'project:disabled',
        'DeviceCollectorBootstrap',
        async (payload: { projectId: string }): Promise<Record<string, any>> => {
          const { projectId } = payload;
          this.logger.log(`Event "project:disabled" received: ${projectId}`);

          // First unregister the project's devices from DeviceStateManager and collect their IDs
          const deviceIds = this.deviceStateManager.unregisterProjectDevices(projectId);

          // Stop these devices' collection tasks (unregister scheduled tasks and clean deviceTaskMap)
          this.taskRegistrationService.stopProjectTasks(deviceIds);

          // Remove from the available-projects list
          const idx = this.availableProjects.indexOf(projectId);
          if (idx >= 0) {
            this.availableProjects.splice(idx, 1);
            this.pluginEventAdapter.setAvailableProjects(this.availableProjects);
          }

          // Clean the device-name map in DeviceLoadingService (avoid memory leaks)
          for (const deviceId of deviceIds) {
            this.deviceLoadingService.deleteDeviceName(deviceId);
          }

          this.logger.log(
            `Project ${projectId} disabled: ${deviceIds.length} devices unregistered, tasks stopped`,
          );

          return {
            projectId,
            devicesUnregistered: deviceIds.length,
            tasksStopped: deviceIds.length,
          };
        },
      ),
    );
  }

  // -----------------------------------------------------------------------
  //  Device loading flow
  // -----------------------------------------------------------------------

  /**
   * Start the device-loading flow:
   * scan project directories -> load devices -> register collection tasks -> compensate already-active plugins
   */
  private async startDeviceLoading(): Promise<void> {
    this.logger.log('Starting device loading from project databases...');

    try {
      const projectsDir = this.resolveProjectsDir();
      const result = await this.deviceLoadingService.loadAllDevices(projectsDir);

      // Update the available-projects list
      this.availableProjects = this.scanProjectNames(projectsDir);
      this.pluginEventAdapter.setAvailableProjects(this.availableProjects);

      // Register collection tasks for the loaded devices
      await this.registerTasksForLoadedDevices(result.loadedByProtocol);

      const totalDevices = this.deviceStateManager.getAllStates().size;
      const totalTasks = this.taskRegistrationService.getTaskCount();
      // Per-protocol device counts (for diagnostics)
      const allStats = this.deviceStateManager.getAllStats();
      const byProtocol: Record<string, number> = {};
      for (const [protocol, stats] of Object.entries(allStats)) {
        byProtocol[protocol] = stats.total;
      }
      this.logger.log(
        `Device loading complete: ${totalDevices} devices by protocol: ${JSON.stringify(byProtocol)}, ${totalTasks} tasks registered`,
      );

      // Compensate already-active plugins: if a plugin activated before CollectorBootstrap subscribed
      await this.compensateActivePlugins();
    } catch (error) {
      this.logger.error(`Device loading failed: ${(error as Error).message}`);
    }
  }

  /**
   * Register collection tasks for already-loaded devices
   */
  private async registerTasksForLoadedDevices(
    loadedByProtocol: Record<string, Device[]>,
  ): Promise<void> {
    for (const [protocol, devices] of Object.entries(loadedByProtocol)) {
      for (const device of devices) {
        const ds = await this.projectDbService.getSystemDb(device.projectId);
        const tagRepo = ds.getRepository(DataTag);
        await this.taskRegistrationService.registerTasksForDevice(
          device,
          protocol,
          tagRepo,
          device.projectId,
        );
      }
    }
  }

  /**
   * Compensate already-active plugins: find active plugins with no device records and re-scan/load them
   */
  private async compensateActivePlugins(): Promise<void> {
    const skipDeviceIds = this.taskRegistrationService.getRegisteredDeviceIds();
    const compensationResults = await this.deviceLoadingService.compensateActivePlugins(
      this.availableProjects,
      skipDeviceIds,
    );

    for (const { protocol, devices } of compensationResults) {
      for (const device of devices) {
        const ds = await this.projectDbService.getSystemDb(device.projectId);
        const tagRepo = ds.getRepository(DataTag);
        await this.taskRegistrationService.registerTasksForDevice(
          device,
          protocol,
          tagRepo,
          device.projectId,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  //  Public query API (for debugging/monitoring)
  // -----------------------------------------------------------------------

  getDeviceStateEntries(): ReadonlyMap<string, DeviceStateRecord> {
    return this.deviceStateManager.getAllStates();
  }

  getDeviceTaskCount(): number {
    return this.taskRegistrationService.getTaskCount();
  }

  // -----------------------------------------------------------------------
  //  Batch device operations
  // -----------------------------------------------------------------------

  /** Enable device collection */
  async enableDevice(deviceId: string): Promise<void> {
    this.taskRegistrationService.enableDeviceTasks(deviceId);
  }

  /** Disable device collection */
  async disableDevice(deviceId: string): Promise<void> {
    this.taskRegistrationService.disableDeviceTasks(deviceId);
  }

  /** Batch-enable devices */
  async enableDevices(deviceIds: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.taskRegistrationService.enableDevices(deviceIds);
  }

  /** Batch-disable devices */
  async disableDevices(deviceIds: string[]): Promise<{ success: string[]; failed: string[] }> {
    return this.taskRegistrationService.disableDevices(deviceIds);
  }

  /** Get device collection enable state */
  isDeviceEnabled(deviceId: string): boolean {
    return this.taskRegistrationService.isDeviceTasksEnabled(deviceId);
  }

  // -----------------------------------------------------------------------
  //  Utility methods
  // -----------------------------------------------------------------------

  /**
   * Resolve PROJECTS_DIR to an absolute path
   *
   * Relative-path base:
   * - dev mode:  __dirname up 4 levels = ss-services/ss-node (this file is in apps/ss-node-server/src/collector/ or dist/collector/)
   *   In .env.ss, PROJECTS_DIR=${DATA_DIR}/projects and DATA_DIR=../../ss-run/ss/data resolves relative to ss-services/ss-node
   * - prod mode: process.cwd() = ss-run/ss/services/ss-node
   *   In .env, PROJECTS_DIR=../../data/projects resolves relative to that directory
   *
   * Fix history: before v1.4 we used process.cwd(), which in dev mode is apps/ss-node-server, so
   * ../../ss-run/ss/data/projects resolved to ss-services/ss-node/ss-run/... (non-existent) and
   * DeviceLoadingService found no project directories, printing "Found 0 project directories" at startup.
   * Kept consistent with project.service.ts getProjectsDir() and app.module.ts getDatabaseConfig().
   */
  private resolveProjectsDir(): string {
    const rawDir = this.configService.get<string>('PROJECTS_DIR') || '';
    if (!rawDir) {
      // When unconfigured, fall back to the default project directory
      const fallbackRoot =
        process.env.NODE_ENV === 'production'
          ? process.cwd()
          : path.resolve(__dirname, '..', '..', '..', '..');
      return path.resolve(fallbackRoot, 'data', 'projects');
    }
    if (path.isAbsolute(rawDir)) {
      return rawDir;
    }
    const projectRoot =
      process.env.NODE_ENV === 'production'
        ? process.cwd()
        : path.resolve(__dirname, '..', '..', '..', '..');
    return path.resolve(projectRoot, rawDir);
  }

  /**
   * Scan the list of project directory names (enabled projects only)
   *
   * Consistent with DeviceLoadingService.scanProjectDirectories: read each project's
   * projectinfo.json and return only projects where enabled === true. Disabled projects
   * are excluded from availableProjects so compensateActivePlugins will not wrongly load their devices.
   */
  private scanProjectNames(projectsDir: string): string[] {
    if (!fs.existsSync(projectsDir)) return [];
    return fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((projectName) => {
        try {
          const infoPath = path.join(projectsDir, projectName, 'projectinfo.json');
          if (!fs.existsSync(infoPath)) return false;
          const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
          if (info.enabled !== true) {
            this.logger.log(`Skipping disabled project: ${projectName} (enabled=false)`);
            return false;
          }
          return true;
        } catch {
          return false;
        }
      });
  }
}
