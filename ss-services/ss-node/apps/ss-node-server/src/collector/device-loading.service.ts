// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DeviceStateManager, ProjectDatabaseService } from '@ss-node/ss-core';
import { PluginRegistry } from '@ss-node/ss-collector-sdk';
import { Device } from '@ss-node/ss-device';
import { DeviceStatus } from '@ss-node/ss-sdk';
import { DataSource } from 'typeorm';

/** Device-loading result */
export interface DeviceLoadingResult {
  totalDevices: number;
  loadedByProtocol: Record<string, Device[]>;
  skippedDevices: number;
}

/**
 * Device loading service
 *
 * Scans and loads devices from project databases, groups them by protocol,
 * and registers them with DeviceStateManager for state tracking.
 */
@Injectable()
export class DeviceLoadingService {
  private readonly logger = new Logger(DeviceLoadingService.name);

  /** Device-name map (queried by IActiveDeviceTracker) */
  private readonly deviceNameMap = new Map<string, string>();

  constructor(
    private readonly projectDbService: ProjectDatabaseService,
    @Optional() private readonly pluginRegistry?: PluginRegistry,
    private readonly deviceStateManager?: DeviceStateManager,
  ) {}

  /**
   * Load devices from all projects
   *
   * @param projectsDir path to the projects directory
   * @returns device-loading results grouped by protocol
   */
  async loadAllDevices(projectsDir: string): Promise<DeviceLoadingResult> {
    const projectDirs = this.scanProjectDirectories(projectsDir);
    this.logger.log(`Found ${projectDirs.length} project directories`);

    const result: DeviceLoadingResult = {
      totalDevices: 0,
      loadedByProtocol: {},
      skippedDevices: 0,
    };

    // Load all project databases in parallel (no concurrency limit)
    const projectResults = await Promise.all(
      projectDirs.map((projectName) => this.loadDevicesFromProject(projectName)),
    );

    for (const projectResult of projectResults) {
      this.mergeResults(result, projectResult);
    }

    return result;
  }

  /**
   * Load devices of a single enabled project (called when a project is enabled at runtime)
   *
   * @param projectId the project ID
   * @returns device list grouped by protocol
   */
  async loadProjectDevices(projectId: string): Promise<Record<string, Device[]>> {
    const result = await this.loadDevicesFromProject(projectId);
    this.logger.log(
      `Loaded ${result.totalDevices} devices from project ${projectId} (enabled at runtime)`,
    );
    return result.loadedByProtocol;
  }

  /**
   * Reload devices for a specific protocol (called after a plugin is activated)
   *
   * @param protocol the protocol name
   * @param availableProjects the list of available projects
   * @param skipDeviceIds the set of device IDs to skip
   * @returns the list of devices whose tasks need registering
   */
  async reloadDevicesForProtocol(
    protocol: string,
    availableProjects: string[],
    skipDeviceIds: Set<string>,
  ): Promise<Device[]> {
    this.logger.log(`Reloading devices for protocol "${protocol}"...`);
    this.logger.log(`  availableProjects: [${availableProjects.join(', ')}]`);

    const newDevices: Device[] = [];

    for (const projectName of availableProjects) {
      let ds: DataSource;
      try {
        ds = await this.projectDbService.getSystemDb(projectName);
      } catch (err) {
        this.logger.warn(`  Failed to open DB for "${projectName}": ${(err as Error).message}`);
        continue;
      }

      const deviceRepo = ds.getRepository(Device);
      let devices: Device[];
      try {
        devices = await deviceRepo.find({ where: { projectId: projectName } });
      } catch (err) {
        this.logger.warn(
          `  Failed to query devices for "${projectName}": ${(err as Error).message}`,
        );
        continue;
      }

      this.logger.log(`  Project "${projectName}": ${devices.length} devices found`);
      for (const device of devices) {
        const deviceProtocol = (device.driver || '').toLowerCase();
        this.logger.log(
          `    Device ${device.id}: driver="${device.driver}", protocol="${deviceProtocol}"`,
        );
        if (deviceProtocol !== protocol) continue;

        const plugin = this.pluginRegistry?.getPlugin(protocol);
        if (!this.pluginRegistry) {
          this.logger.warn(`    Skipped ${device.id}: PluginRegistry is null/undefined`);
          continue;
        } else if (!plugin) {
          this.logger.warn(
            `    Skipped ${device.id}: plugin "${protocol}" not found in registry. Available: [${this.pluginRegistry
              .listPlugins()
              .map((p: any) => `${p.meta.protocol}(${p.status})`)
              .join(', ')}]`,
          );
          continue;
        } else if (plugin.status !== 'active') {
          this.logger.warn(
            `    Skipped ${device.id}: plugin "${protocol}" status="${plugin.status}" (not active)`,
          );
          continue;
        }

        if (skipDeviceIds.has(device.id)) {
          this.logger.debug(`    Skipped ${device.id}: already registered`);
          continue;
        }

        // Register the device with the state manager
        this.ensureDeviceTracked(device, protocol, projectName);
        newDevices.push(device);
      }
    }

    this.logger.log(`Protocol "${protocol}" reload complete: +${newDevices.length} devices`);

    return newDevices;
  }

  /**
   * Compensate already-active plugins: find active plugins with no device records in the state manager
   *
   * @param availableProjects the list of available projects
   * @param skipDeviceIds the set of device IDs to skip
   * @returns the list of devices whose tasks need registering
   */
  async compensateActivePlugins(
    availableProjects: string[],
    skipDeviceIds: Set<string>,
  ): Promise<{ protocol: string; devices: Device[] }[]> {
    if (!this.pluginRegistry) return [];

    const activePlugins = this.pluginRegistry.listPlugins().filter((p) => p.status === 'active');
    if (activePlugins.length === 0) return [];

    // Collect the protocols covered by loaded devices
    const loadedProtocols = new Set<string>();
    for (const [, state] of this.deviceStateManager!.getAllStates()) {
      loadedProtocols.add(state.protocol);
    }

    const results: { protocol: string; devices: Device[] }[] = [];

    for (const plugin of activePlugins) {
      const protocol = plugin.meta.protocol.toLowerCase();
      if (loadedProtocols.has(protocol)) {
        this.logger.debug(
          `Plugin "${protocol}" already has ${this.deviceStateManager!.getStatsByProtocol(protocol).total} devices loaded, skip compensation`,
        );
        continue;
      }

      this.logger.log(
        `Compensating already-active plugin "${protocol}" — no devices loaded yet, reloading...`,
      );
      const devices = await this.reloadDevicesForProtocol(
        protocol,
        availableProjects,
        skipDeviceIds,
      );
      if (devices.length > 0) {
        results.push({ protocol, devices });
      }
    }

    return results;
  }

  /** Get device name */
  getDeviceName(deviceId: string): string {
    return this.deviceNameMap.get(deviceId) || deviceId;
  }

  /** Set device name */
  setDeviceName(deviceId: string, name: string): void {
    this.deviceNameMap.set(deviceId, name);
  }

  /** Clear the device-name map (called when a project is disabled, to avoid memory leaks) */
  deleteDeviceName(deviceId: string): void {
    this.deviceNameMap.delete(deviceId);
  }

  /**
   * Load devices from a single project's system.db
   */
  private async loadDevicesFromProject(projectName: string): Promise<DeviceLoadingResult> {
    let ds: DataSource;
    try {
      ds = await this.projectDbService.getSystemDb(projectName);
    } catch {
      this.logger.warn(`Failed to open database for project "${projectName}", skipping`);
      return { totalDevices: 0, loadedByProtocol: {}, skippedDevices: 0 };
    }

    const deviceRepo = ds.getRepository(Device);

    let devices: Device[];
    try {
      devices = await deviceRepo.find({ where: { projectId: projectName } });
    } catch {
      this.logger.warn(`Failed to query devices for project "${projectName}"`);
      return { totalDevices: 0, loadedByProtocol: {}, skippedDevices: 0 };
    }

    if (devices.length === 0) {
      this.logger.log(`Project "${projectName}": no devices found`);
      return { totalDevices: 0, loadedByProtocol: {}, skippedDevices: 0 };
    }

    this.logger.log(`Project "${projectName}": ${devices.length} devices total`);

    const loadedByProtocol: Record<string, Device[]> = {};
    let skippedCount = 0;
    let noProtocolCount = 0;

    for (const device of devices) {
      const protocol = (device.driver || '').toLowerCase();
      if (!protocol) {
        noProtocolCount++;
        this.logger.warn(
          `Device ${device.id} (${device.deviceName}): has no driver/protocol configured`,
        );
        continue;
      }

      const plugin = this.pluginRegistry?.getPlugin(protocol);
      if (!this.pluginRegistry) {
        this.logger.warn(
          `Device ${device.id} (${device.deviceName}): Skipped — PluginRegistry not available (null/undefined)`,
        );
        skippedCount++;
        continue;
      }
      if (!plugin) {
        this.logger.warn(
          `Device ${device.id} (${device.deviceName}): Skipped — plugin "${protocol}" not found in registry. ` +
            `Registered plugins: [${
              this.pluginRegistry
                .listPlugins()
                .map((p) => `${p.meta.protocol}(${p.status})`)
                .join(', ') || 'none'
            }]`,
        );
        skippedCount++;
        continue;
      }
      if (plugin.status !== 'active') {
        this.logger.warn(
          `Device ${device.id} (${device.deviceName}): Skipped — plugin "${protocol}" status is "${plugin.status}" (expected "active")`,
        );
        skippedCount++;
        continue;
      }

      // Register the device with the state manager
      this.ensureDeviceTracked(device, protocol, projectName);

      if (!loadedByProtocol[protocol]) {
        loadedByProtocol[protocol] = [];
      }
      loadedByProtocol[protocol].push(device);
    }

    if (skippedCount > 0 || noProtocolCount > 0) {
      this.logger.warn(
        `Project "${projectName}" summary: ${Object.keys(loadedByProtocol).length} protocol(s) loaded, ` +
          `${skippedCount} device(s) skipped (plugin not active), ` +
          `${noProtocolCount} device(s) skipped (no driver configured)` +
          ` — total devices: ${devices.length}`,
      );
    }

    return {
      totalDevices: devices.length,
      loadedByProtocol,
      skippedDevices: skippedCount,
    };
  }

  /**
   * Ensure the device is added to in-memory state tracking (delegated to DeviceStateManager)
   */
  private ensureDeviceTracked(device: Device, protocol: string, projectName: string): void {
    this.deviceStateManager!.registerDevice({
      deviceId: device.id,
      projectId: projectName,
      protocol,
      scanRate: device.scanRate || undefined,
      offlinePeriod: device.offlinePeriod || undefined,
      initialStatus: (device.status as DeviceStatus) || DeviceStatus.OFFLINE,
    });

    this.deviceNameMap.set(device.id, device.deviceName);
  }

  private scanProjectDirectories(projectsDir: string): string[] {
    if (!fs.existsSync(projectsDir)) {
      this.logger.warn(`Projects directory not found: ${projectsDir}`);
      return [];
    }

    return fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((projectName) => {
        // Skip disabled projects: read the enabled field of projectinfo.json
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

  private mergeResults(target: DeviceLoadingResult, source: DeviceLoadingResult): void {
    target.totalDevices += source.totalDevices;
    target.skippedDevices += source.skippedDevices;

    for (const [protocol, devices] of Object.entries(source.loadedByProtocol)) {
      if (!target.loadedByProtocol[protocol]) {
        target.loadedByProtocol[protocol] = [];
      }
      target.loadedByProtocol[protocol].push(...devices);
    }
  }
}
