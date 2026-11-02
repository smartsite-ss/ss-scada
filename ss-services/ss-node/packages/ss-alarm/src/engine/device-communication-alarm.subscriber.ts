// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Optional, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventBusService, ProjectDatabaseService } from '@ss-node/ss-core';
import { DeviceStatus } from '@ss-node/ss-sdk';
import { AlarmRecord, AlarmStatus, AlarmLevel } from '../entities/alarm.entity';
import { Device } from '@ss-node/ss-device';

/**
 * Device-communication alarm subscriber
 *
 * Listens for the device:statusChanged event:
 * - Device goes OFFLINE -> automatically generate a communication alarm (alarmType='communication')
 * - Device goes ONLINE  -> automatically clear the corresponding communication alarm
 *
 * Complementary to DeviceOfflineSuppressionService:
 * - The suppression service handles "silencing existing alarms" (suppresses the device's business alarms while offline)
 * - This subscriber handles "generating the communication alarm" (the offline state itself is an alarm)
 *
 * Alarm ID format: `comm-offline-${deviceId}` (deterministic ID, easy to find and clear on recovery)
 */
@Injectable()
export class DeviceCommunicationAlarmSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceCommunicationAlarmSubscriber.name);
  private readonly handler: (event: any) => void;

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly projectDbService?: ProjectDatabaseService,
  ) {
    this.handler = this.handleDeviceStatusChanged.bind(this);
  }

  onModuleInit(): void {
    if (this.eventBus) {
      this.eventBus.on('device:statusChanged', this.handler);
      this.logger.log(
        'DeviceCommunicationAlarmSubscriber initialized — listening for device:statusChanged',
      );
    }
  }

  onModuleDestroy(): void {
    if (this.eventBus) {
      this.eventBus.off('device:statusChanged', this.handler);
    }
  }

  /**
   * Handle the device status-changed event
   */
  private async handleDeviceStatusChanged(event: {
    deviceId: string;
    projectId: string;
    status: string;
    previousStatus?: string;
    errorMessage?: string;
    timestamp: number;
  }): Promise<void> {
    const { status, previousStatus } = event;

    // Device goes offline -> generate a communication alarm
    if (status === DeviceStatus.OFFLINE && previousStatus !== DeviceStatus.OFFLINE) {
      await this.triggerCommunicationAlarm(event);
    }

    // Device is back online -> clear the communication alarm
    if (status === DeviceStatus.ONLINE && previousStatus === DeviceStatus.OFFLINE) {
      await this.clearCommunicationAlarm(event);
    }
  }

  /**
   * Device offline -> create a communication alarm
   */
  private async triggerCommunicationAlarm(event: {
    deviceId: string;
    projectId: string;
    errorMessage?: string;
    timestamp: number;
  }): Promise<void> {
    if (!this.projectDbService || !event.projectId || !event.deviceId) {
      this.logger.warn(
        `Skipped communication alarm: projectDbService=${!!this.projectDbService} ` +
          `projectId=${event.projectId} deviceId=${event.deviceId}`,
      );
      return;
    }

    const alarmId = `comm-offline-${event.deviceId}`;

    try {
      const ds = await this.projectDbService.getSystemDb(event.projectId);
      const repo = ds.getRepository(AlarmRecord);

      // Dedup: skip if an active alarm with the same ID already exists
      const existing = await repo.findOne({
        where: { id: alarmId, projectId: event.projectId, status: AlarmStatus.ACTIVE },
      });
      if (existing) {
        this.logger.debug(`Communication alarm ${alarmId} already active, skipping`);
        return;
      }

      // Look up the device name
      let deviceName = event.deviceId;
      try {
        const deviceRepo = ds.getRepository(Device);
        const device = await deviceRepo.findOne({ where: { id: event.deviceId } });
        if (device?.deviceName) deviceName = device.deviceName;
      } catch {
        // Failure to look up the device name does not block alarm creation
      }

      const message = event.errorMessage
        ? `设备通讯中断: ${deviceName} (${event.errorMessage})`
        : `设备通讯中断: ${deviceName}`;

      // Create the alarm record
      const record = repo.create({
        id: alarmId,
        projectId: event.projectId,
        ruleId: null,
        deviceId: event.deviceId,
        deviceName,
        tagId: null,
        tagName: null,
        message,
        triggerValue: 'offline',
        level: AlarmLevel.ERROR,
        status: AlarmStatus.ACTIVE,
        alarmType: 'communication',
        dispositionType: 'alarm.triggered',
      });
      await repo.save(record);

      // Trigger the alarm_triggered event -> DataPushBridge WebSocket real-time push
      this.eventBus?.emit('alarm_triggered', {
        alarmId,
        tagId: '',
        deviceId: event.deviceId,
        projectId: event.projectId,
        level: AlarmLevel.ERROR,
        message,
        timestamp: event.timestamp,
      });

      this.logger.warn(
        `Communication alarm triggered: deviceId=${event.deviceId} alarmId=${alarmId}`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to trigger communication alarm: ${error.message}`);
    }
  }

  /**
   * Device back online -> clear the communication alarm
   */
  private async clearCommunicationAlarm(event: {
    deviceId: string;
    projectId: string;
    timestamp: number;
  }): Promise<void> {
    if (!this.projectDbService || !event.projectId || !event.deviceId) {
      return;
    }

    const alarmId = `comm-offline-${event.deviceId}`;

    try {
      const ds = await this.projectDbService.getSystemDb(event.projectId);
      const repo = ds.getRepository(AlarmRecord);

      const record = await repo.findOne({
        where: { id: alarmId, projectId: event.projectId },
      });
      if (!record || record.status === AlarmStatus.CLEARED) {
        return;
      }

      record.status = AlarmStatus.CLEARED;
      record.clearedAt = new Date();
      record.clearedBy = 'system';
      record.dispositionType = 'alarm.cleared';
      await repo.save(record);

      // Trigger the alarm.cleared event
      this.eventBus?.emit('alarm.cleared', {
        alarmId,
        projectId: event.projectId,
        deviceId: event.deviceId,
        timestamp: event.timestamp,
      });

      this.logger.log(`Communication alarm cleared: deviceId=${event.deviceId} alarmId=${alarmId}`);
    } catch (error: any) {
      this.logger.error(`Failed to clear communication alarm: ${error.message}`);
    }
  }
}
