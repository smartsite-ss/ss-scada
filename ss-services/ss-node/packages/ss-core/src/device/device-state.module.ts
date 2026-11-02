// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Global, Module } from '@nestjs/common';
import { EventBusModule } from '../event-bus/event-bus.module';
import { DeviceStateManager } from './device-state-manager.service';

/**
 * Device-state module (global)
 *
 * Provides DeviceStateManager as the single authoritative source of device state.
 * Built-in setInterval heartbeat detection (every 5 seconds).
 */
@Global()
@Module({
  imports: [EventBusModule],
  providers: [DeviceStateManager],
  exports: [DeviceStateManager],
})
export class DeviceStateModule {}
