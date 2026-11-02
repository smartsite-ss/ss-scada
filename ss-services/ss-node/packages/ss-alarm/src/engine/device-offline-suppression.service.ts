// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventBusService } from '@ss-node/ss-core';
import { DeviceStatus } from '@ss-node/ss-sdk';
import { AlarmSuppressionService } from './alarm-suppression.service';

/**
 * Device-offline -> alarm cascade suppression service
 *
 * Listens for the device:statusChanged event:
 * - Device goes OFFLINE -> automatically create a device_offline suppression rule suppressing all alarms of that device
 * - Device goes ONLINE  -> automatically remove the suppression rule
 *
 * This is a P0-priority optimization: prevent a flood of "communication failure" alarms after a device goes offline
 * from drowning out the real business alarms.
 */
@Injectable()
export class DeviceOfflineSuppressionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceOfflineSuppressionService.name);

  /** deviceId -> suppressionRuleId map, for fast lookup and removal */
  private readonly deviceSuppressionMap = new Map<string, string>();

  constructor(
    private readonly eventBus: EventBusService,
    private readonly suppressionService: AlarmSuppressionService,
  ) {}

  onModuleInit(): void {
    this.eventBus.on('device:statusChanged', this.handleDeviceStatusChanged.bind(this));
    this.logger.log(
      'DeviceOfflineSuppressionService initialized — listening for device:statusChanged',
    );
  }

  onModuleDestroy(): void {
    this.eventBus.removeAllListeners?.('device:statusChanged');
    this.deviceSuppressionMap.clear();
  }

  /**
   * Handle the device status-changed event
   */
  private handleDeviceStatusChanged(event: {
    deviceId: string;
    projectId: string;
    status: DeviceStatus;
    previousStatus: DeviceStatus;
    timestamp: number;
  }): void {
    const { deviceId, status, previousStatus } = event;

    // Device goes offline -> create a suppression rule
    if (status === DeviceStatus.OFFLINE && previousStatus !== DeviceStatus.OFFLINE) {
      this.suppressDeviceAlarms(deviceId);
    }

    // Device goes online -> remove the suppression rule
    if (status === DeviceStatus.ONLINE && previousStatus === DeviceStatus.OFFLINE) {
      this.releaseDeviceAlarms(deviceId);
    }
  }

  /**
   * Create a device-offline suppression rule
   */
  private suppressDeviceAlarms(deviceId: string): void {
    // Avoid duplicate creation
    if (this.deviceSuppressionMap.has(deviceId)) {
      return;
    }

    const ruleId = this.suppressionService.addSuppressionRule({
      id: `offline-${deviceId}`,
      type: 'device_offline',
      devices: [deviceId],
      createdAt: Date.now(),
      // No expiration: removed manually when the device returns ONLINE
    });

    this.deviceSuppressionMap.set(deviceId, ruleId);
    this.logger.log(`Device ${deviceId} offline → alarms suppressed (rule: ${ruleId})`);
  }

  /**
   * Remove the device-offline suppression rule
   */
  private releaseDeviceAlarms(deviceId: string): void {
    const ruleId = this.deviceSuppressionMap.get(deviceId);
    if (!ruleId) {
      return;
    }

    const removed = this.suppressionService.removeSuppressionRule(ruleId);
    this.deviceSuppressionMap.delete(deviceId);

    if (removed) {
      this.logger.log(`Device ${deviceId} online → alarm suppression released (rule: ${ruleId})`);
    }
  }

  /**
   * Get the list of currently suppressed devices
   */
  getSuppressedDevices(): string[] {
    return Array.from(this.deviceSuppressionMap.keys());
  }

  /**
   * Check whether a given device is suppressed
   */
  isDeviceSuppressed(deviceId: string): boolean {
    return this.deviceSuppressionMap.has(deviceId);
  }

  /**
   * Manually remove the suppression for a given device
   */
  releaseDevice(deviceId: string): boolean {
    const ruleId = this.deviceSuppressionMap.get(deviceId);
    if (!ruleId) return false;

    this.suppressionService.removeSuppressionRule(ruleId);
    this.deviceSuppressionMap.delete(deviceId);
    this.logger.log(`Device ${deviceId} suppression manually released`);
    return true;
  }
}
