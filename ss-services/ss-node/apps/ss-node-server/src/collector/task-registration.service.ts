// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import { EnhancedScheduler, AcquisitionTask, TaskPriority } from '@ss-node/ss-collector-sdk';
import { Device, DataTag } from '@ss-node/ss-device';
import { TemplateLoaderService } from '@ss-node/ss-system';
import type { TemplateVariable } from '@ss-node/ss-system';

/**
 * Task registration service
 *
 * Registers collection tasks for devices with EnhancedScheduler, manages the
 * device-to-task mapping, and handles task enable/disable operations.
 */
@Injectable()
export class TaskRegistrationService {
  private readonly logger = new Logger(TaskRegistrationService.name);

  /** Device -> list of registered scheduler task IDs */
  private readonly deviceTaskMap = new Map<string, string[]>();

  constructor(
    private readonly scheduler: EnhancedScheduler,
    @Optional() private readonly templateLoader?: TemplateLoaderService,
  ) {}

  /**
   * Register EnhancedScheduler tasks for all enabled tags of a single device
   *
   * Lookup order:
   * 1. Prefer the device's enabled tags from the dev_data_tags table
   * 2. If the DB has no tags but the device is bound to a template, load variables from the template JSON file as tags
   */
  async registerTasksForDevice(
    device: Device,
    protocol: string,
    tagRepo: any,
    projectName: string,
  ): Promise<void> {
    try {
      // 1. Query tags from the database
      const tags = await tagRepo.find({
        where: { deviceId: device.id, enabled: true },
      });

      // 2. If the DB has no tags but a template is bound, load variables from the template
      if (tags.length === 0 && device.templateId && this.templateLoader) {
        const template = this.templateLoader.getTemplate(device.templateId);
        if (template && template.variables.length > 0) {
          const enabledVars = template.variables.filter((v) => v.enabled !== false);
          if (enabledVars.length === 0) {
            this.logger.debug(
              `Device ${device.id}: template "${device.templateId}" has no enabled variables`,
            );
            return;
          }

          this.logger.log(
            `Device "${device.deviceName}" (${device.id}) → loading ${enabledVars.length} variables from template "${device.templateId}"`,
          );

          const tasks = this.createTemplateTasks(device, protocol, enabledVars, projectName);
          this.registerTasks(device.id, device.deviceName, tasks);
          return;
        }
      }

      // 3. No tags and no template -> device is already tracked by DeviceLoadingService, do not skip
      if (tags.length === 0) {
        this.logger.debug(
          `Device ${device.id} (${device.deviceName}): tracked but no tags to schedule ` +
            `${device.templateId ? `(template "${device.templateId}" not found/loaded)` : '(no template configured)'}`,
        );
        return;
      }

      // 4. DB-tag path - register the scheduler task
      const tasks = tags.map((tag: DataTag) =>
        this.createTagTask(device, protocol, tag, projectName),
      );
      this.registerTasks(device.id, device.deviceName, tasks);
    } catch (error) {
      this.logger.error(
        `Failed to register tasks for device ${device.id}: ${(error as Error).message}`,
      );
    }
  }

  /** Check whether a device already has registered tasks */
  hasDeviceTasks(deviceId: string): boolean {
    return this.deviceTaskMap.has(deviceId);
  }

  /** Get the set of device IDs with registered tasks */
  getRegisteredDeviceIds(): Set<string> {
    return new Set(this.deviceTaskMap.keys());
  }

  /** Enable device collection */
  enableDeviceTasks(deviceId: string): void {
    const taskIds = this.deviceTaskMap.get(deviceId);
    if (!taskIds || taskIds.length === 0) {
      this.logger.warn(`No tasks found for device ${deviceId}`);
      return;
    }

    for (const taskId of taskIds) {
      this.scheduler.enableTask(taskId);
    }
    this.logger.log(`Device ${deviceId}: ${taskIds.length} tasks enabled`);
  }

  /** Disable device collection */
  disableDeviceTasks(deviceId: string): void {
    const taskIds = this.deviceTaskMap.get(deviceId);
    if (!taskIds || taskIds.length === 0) {
      this.logger.warn(`No tasks found for device ${deviceId}`);
      return;
    }

    for (const taskId of taskIds) {
      this.scheduler.disableTask(taskId);
    }
    this.logger.log(`Device ${deviceId}: ${taskIds.length} tasks disabled`);
  }

  /**
   * Reload a device's tag collection tasks (template-sync / tag-change scenarios)
   *
   * Steps:
   * 1. Unregister old tasks (scheduler.unregisterTask)
   * 2. Re-read enabled tags from the database
   * 3. Register new tasks (scheduler.registerTask)
   *
   * @param deviceId the device ID
   * @param projectId the project ID
   * @param protocol the collection protocol
   * @param device the device entity
   * @param tagRepo the project-level DataTag repository
   */
  async reloadDeviceTasks(
    deviceId: string,
    projectId: string,
    protocol: string,
    device: Device,
    tagRepo: any,
  ): Promise<void> {
    // 1. Unregister old tasks
    const oldTaskIds = this.deviceTaskMap.get(deviceId);
    if (oldTaskIds && oldTaskIds.length > 0) {
      for (const taskId of oldTaskIds) {
        this.scheduler.unregisterTask(taskId);
      }
      this.deviceTaskMap.delete(deviceId);
      this.logger.log(`Device ${deviceId}: ${oldTaskIds.length} old tasks unregistered`);
    }

    // 2. Re-register (reuse the existing registerTasksForDevice logic)
    await this.registerTasksForDevice(device, protocol, tagRepo, projectId);

    this.logger.log(`Device ${deviceId}: tasks reloaded after tag change`);
  }

  /**
   * Stop the collection tasks of a group of devices (called when a project is disabled)
   *
   * Unregisters all scheduler tasks and cleans deviceTaskMap.
   * The caller is responsible for querying the project's device-ID list (task-registration
   * does not access the project DB directly).
   *
   * @param deviceIds the list of device IDs whose collection should stop
   */
  stopProjectTasks(deviceIds: string[]): void {
    let stoppedCount = 0;
    for (const deviceId of deviceIds) {
      const taskIds = this.deviceTaskMap.get(deviceId);
      if (taskIds && taskIds.length > 0) {
        for (const taskId of taskIds) {
          this.scheduler.unregisterTask(taskId);
        }
        this.deviceTaskMap.delete(deviceId);
        stoppedCount += taskIds.length;
      }
    }
    this.logger.log(
      `Stopped ${stoppedCount} tasks for ${deviceIds.length} devices (project disabled)`,
    );
  }

  /** Batch-enable devices */
  async enableDevices(deviceIds: string[]): Promise<{ success: string[]; failed: string[] }> {
    const result = { success: [] as string[], failed: [] as string[] };
    for (const deviceId of deviceIds) {
      try {
        this.enableDeviceTasks(deviceId);
        result.success.push(deviceId);
      } catch (error) {
        this.logger.error(`Failed to enable device ${deviceId}: ${(error as Error).message}`);
        result.failed.push(deviceId);
      }
    }
    return result;
  }

  /** Batch-disable devices */
  async disableDevices(deviceIds: string[]): Promise<{ success: string[]; failed: string[] }> {
    const result = { success: [] as string[], failed: [] as string[] };
    for (const deviceId of deviceIds) {
      try {
        this.disableDeviceTasks(deviceId);
        result.success.push(deviceId);
      } catch (error) {
        this.logger.error(`Failed to disable device ${deviceId}: ${(error as Error).message}`);
        result.failed.push(deviceId);
      }
    }
    return result;
  }

  /** Get device collection enable state */
  isDeviceTasksEnabled(deviceId: string): boolean {
    const taskIds = this.deviceTaskMap.get(deviceId);
    if (!taskIds || taskIds.length === 0) return false;
    const taskStatuses = this.scheduler.getTaskStatus();
    const task = taskStatuses.get(taskIds[0]);
    return task?.enabled ?? false;
  }

  /** Get the total number of registered tasks */
  getTaskCount(): number {
    return Array.from(this.deviceTaskMap.values()).reduce((s, t) => s + t.length, 0);
  }

  // -----------------------------------------------------------------------
  //  Private methods
  // -----------------------------------------------------------------------

  /** Create a collection task from a template variable */
  private createTemplateTasks(
    device: Device,
    protocol: string,
    enabledVars: TemplateVariable[],
    projectName: string,
  ): AcquisitionTask[] {
    const scanRate = device.scanRate || 1000;

    return enabledVars.map((variable) => {
      const syntheticTagId = `tpl_${device.id}_${variable.name}`;
      return {
        id: `collect_${device.id}_${syntheticTagId}`,
        deviceId: device.id,
        tagId: syntheticTagId,
        tagConfig: {
          id: syntheticTagId,
          name: variable.name,
          address: variable.address,
          dataType: variable.dataType || 'float32',
          projectId: projectName,
          deviceId: device.id,
          deviceCode: device.deviceCode,
          deviceName: device.deviceName,
          scanRate: variable.scanRate || scanRate,
          description: variable.description,
        },
        deviceClient: {
          id: device.id,
          name: device.deviceName,
          protocol,
          connection: device.connection,
        },
        priority: TaskPriority.NORMAL,
        interval: variable.scanRate || scanRate,
        retryCount: 0,
        maxRetries: variable.retryCount || 3,
        enabled: true,
      };
    });
  }

  /** Create a collection task for a single tag */
  private createTagTask(
    device: Device,
    protocol: string,
    tag: DataTag,
    projectName: string,
  ): AcquisitionTask {
    const scanRate = device.scanRate || 1000;
    return {
      id: `collect_${device.id}_${tag.id}`,
      deviceId: device.id,
      tagId: tag.id,
      tagConfig: {
        id: tag.id,
        name: tag.name,
        address: tag.address,
        dataType: tag.dataType,
        projectId: projectName,
        deviceId: device.id,
        deviceCode: device.deviceCode,
        deviceName: device.deviceName,
        scanRate: tag.scanRate || scanRate,
      },
      deviceClient: {
        id: device.id,
        name: device.deviceName,
        protocol,
        connection: device.connection,
      },
      priority: TaskPriority.NORMAL,
      interval: tag.scanRate || scanRate,
      retryCount: 0,
      maxRetries: 3,
      enabled: true,
    };
  }

  /** Register a task with the scheduler and record the mapping */
  private registerTasks(deviceId: string, deviceName: string, tasks: AcquisitionTask[]): void {
    const taskIds: string[] = [];
    const scanRate = tasks[0]?.interval || 1000;

    for (const task of tasks) {
      this.scheduler.registerTask(task);
      taskIds.push(task.id);
    }

    this.deviceTaskMap.set(deviceId, taskIds);
    this.logger.log(
      `Device "${deviceName}" (${deviceId}) → ${taskIds.length} tasks registered (interval: ${scanRate}ms)`,
    );
  }
}
