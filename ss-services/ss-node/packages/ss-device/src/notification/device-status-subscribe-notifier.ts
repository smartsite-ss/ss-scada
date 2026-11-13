// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Device-status subscribe-message notifier (Phase2 10 #6)
 *
 * Subscribes to the `device:statusChange` event (emitted by DeviceStateMachine);
 * when a device enters the offline/fault state, sends a WeChat mini-program subscribe message via
 * WechatSubscribeMessageChannel (@Global module, injected via @Optional). Send failures only log, not blocking the state machine's main flow.
 *
 * Device-name completion: the event payload lacks deviceName; the device entity is queried per the project-DB mode to complete it
 * (falling back to the device ID when not found).
 */
import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceStatus } from '@ss-node/ss-sdk';
import {
  EventBusService,
  ProjectDatabaseService,
  WechatSubscribeMessageChannel,
} from '@ss-node/ss-core';
import { Device } from '../entities/device.entity';
import { StatusChangeEvent } from '../state/device-state-machine';

/** Push only the offline/fault two states (per the Phase2 requirement) */
const NOTIFIED_STATUSES: DeviceStatus[] = [DeviceStatus.OFFLINE, DeviceStatus.ERROR];

@Injectable()
export class DeviceStatusSubscribeNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceStatusSubscribeNotifier.name);
  private readonly handler: (event: StatusChangeEvent) => void;
  /** Database mode: isolated=per-project DB, unified=global DB */
  private readonly dbMode: string;

  constructor(
    @Optional()
    private readonly eventBus: EventBusService | undefined,
    @Optional()
    private readonly subscribeChannel: WechatSubscribeMessageChannel | undefined,
    @Inject(getRepositoryToken(Device))
    private readonly deviceRepository: Repository<Device>,
    @Inject(ProjectDatabaseService)
    private readonly projectDbService: ProjectDatabaseService,
    configService: ConfigService,
  ) {
    this.dbMode = configService.get<string>('PROJECT_DB_MODE', 'isolated');
    this.handler = (event) => {
      void this.handleStatusChange(event);
    };
  }

  onModuleInit(): void {
    if (!this.eventBus) {
      return;
    }
    if (!this.subscribeChannel) {
      this.logger.warn(
        'WechatSubscribeMessageChannel unavailable, skipping device status subscription messages',
      );
      return;
    }
    this.eventBus.on('device:statusChange', this.handler);
    this.logger.log(
      'DeviceStatusSubscribeNotifier initialized — listening for device:statusChange',
    );
  }

  onModuleDestroy(): void {
    this.eventBus?.off('device:statusChange', this.handler);
  }

  /** Handle a device-status change: filter target states -> complete the device name -> send the subscribe message */
  private async handleStatusChange(event: StatusChangeEvent): Promise<void> {
    if (!NOTIFIED_STATUSES.includes(event.toStatus)) {
      return;
    }
    const channel = this.subscribeChannel;
    if (!channel) {
      return;
    }
    try {
      const deviceRepo = await this.getDeviceRepo(event.projectId);
      const device = await deviceRepo.findOne({ where: { id: event.deviceId } });
      await channel.notifyDeviceStatus({
        deviceName: device?.deviceName || event.deviceId,
        status: event.toStatus as string,
        projectId: event.projectId,
        timestamp: new Date(event.timestamp),
      });
    } catch (error) {
      // Notification failure degrades to a log, not blocking the device state machine's main flow
      this.logger.warn(
        `Device status subscription message failed: deviceId=${event.deviceId} ${(error as Error).message}`,
      );
    }
  }

  /** Get the device Repository per the project-DB mode (same pattern as DeviceService.getRepos) */
  private async getDeviceRepo(projectId: string): Promise<Repository<Device>> {
    if (this.dbMode === 'isolated' && this.projectDbService) {
      const ds = await this.projectDbService.getSystemDb(projectId);
      return ds.getRepository(Device);
    }
    return this.deviceRepository;
  }
}
