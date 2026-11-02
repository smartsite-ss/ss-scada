// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceStateManager, ProjectDatabaseService } from '@ss-node/ss-core';
import { Device } from '@ss-node/ss-device';
import { TimerConfigService } from '@ss-node/ss-system';

/**
 * Device persistence service
 *
 * Batch-writes changed in-memory device states to each project's system.db.
 * Collects changes via a dirty-flag mechanism and persists them periodically.
 */
@Injectable()
export class DevicePersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(DevicePersistenceService.name);

  /** Set of dirty device IDs */
  private readonly dirtyDeviceIds = new Set<string>();

  /** Timer */
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly PERSIST_INTERVAL_MS = 30_000; // 30 秒持久化一次

  constructor(
    private readonly projectDbService: ProjectDatabaseService,
    private readonly deviceStateManager: DeviceStateManager,
    private readonly configService: ConfigService,
    private readonly timerConfigService: TimerConfigService,
  ) {}

  /** Start periodic persistence */
  startPeriodicPersistence(): void {
    if (this.persistTimer) return;

    const interval =
      this.configService.get<number>('DEVICE_PERSIST_INTERVAL_MS') || this.PERSIST_INTERVAL_MS;

    this.persistTimer = setInterval(async () => {
      await this.persistDirtyStatuses();
    }, interval);

    // Register the hot-reload callback
    this.timerConfigService.register('DEVICE_PERSIST_INTERVAL_MS', (newInterval: number) =>
      this.restartTimer(newInterval),
    );

    this.logger.log(`Periodic persistence started (interval: ${interval}ms)`);
  }

  /** Stop periodic persistence */
  stopPeriodicPersistence(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
      this.logger.log('Periodic persistence stopped');
    }
  }

  /** Hot-update the persistence interval at runtime */
  private restartTimer(newInterval: number): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
    }
    this.persistTimer = setInterval(async () => {
      await this.persistDirtyStatuses();
    }, newInterval);
    this.logger.log(`Persistence interval hot-reloaded to ${newInterval}ms`);
  }

  /** Mark a device as dirty (state changed, pending persistence) */
  markDeviceDirty(deviceId: string): void {
    this.dirtyDeviceIds.add(deviceId);
  }

  onModuleDestroy(): void {
    this.stopPeriodicPersistence();
  }

  /**
   * Batch-write changed in-memory device states to each project's system.db
   */
  async persistDirtyStatuses(): Promise<void> {
    if (this.dirtyDeviceIds.size === 0) return;

    const dirtyIds = Array.from(this.dirtyDeviceIds);
    this.dirtyDeviceIds.clear();

    // Group by project
    const byProject = new Map<string, string[]>();
    for (const deviceId of dirtyIds) {
      const state = this.deviceStateManager.getState(deviceId);
      if (!state) continue;
      if (!byProject.has(state.projectId)) {
        byProject.set(state.projectId, []);
      }
      byProject.get(state.projectId)!.push(deviceId);
    }

    for (const [projectId, deviceIds] of byProject) {
      try {
        const ds = await this.projectDbService.getSystemDb(projectId);
        const deviceRepo = ds.getRepository(Device);

        // Batch-update the device table
        for (const deviceId of deviceIds) {
          const state = this.deviceStateManager.getState(deviceId);
          if (!state) continue;

          await deviceRepo.update(
            { id: deviceId },
            {
              status: state.status as any,
              lastOnlineAt: state.lastOnlineAt ? new Date(state.lastOnlineAt) : undefined,
              lastOfflineAt: state.lastOfflineAt ? new Date(state.lastOfflineAt) : undefined,
              lastDataAt: state.lastDataAt ? new Date(state.lastDataAt) : undefined,
            },
          );
        }

        this.logger.debug(
          `Persisted ${deviceIds.length} device statuses to project "${projectId}"`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to persist statuses for project "${projectId}": ${(error as Error).message}`,
        );
      }
    }
  }
}
