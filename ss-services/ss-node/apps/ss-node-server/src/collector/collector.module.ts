// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, Global } from '@nestjs/common';
import { SchedulerModule } from '@ss-node/ss-collector-sdk';
import { EventBusModule } from '@ss-node/ss-core';
import { DeviceModule } from '@ss-node/ss-device';
import { SystemModule } from '@ss-node/ss-system';
import { DeviceCollectorBootstrap } from './collector-bootstrap.service';
import { DeviceLoadingService } from './device-loading.service';
import { TaskRegistrationService } from './task-registration.service';
import { DevicePersistenceService } from './device-persistence.service';
import { PluginEventAdapter } from './plugin-event-adapter';
import { ACTIVE_DEVICE_TRACKER } from '@ss-node/ss-collector-sdk';

/**
 * Collector bootstrap module
 *
 * Marked @Global() so the ACTIVE_DEVICE_TRACKER token is visible to PluginManagerService
 * inside PluginModule (ss-core). Otherwise the @Optional() injection silently returns undefined,
 * making getAllDeviceStats() return an empty object and the frontend device stats stay at 0.
 *
 * PluginRegistry is injected globally via @Global PluginModule (forRoot in AppModule).
 *
 * Explicitly imported modules:
 * - SystemModule    -> TemplateLoaderService (device-template tag loading)
 * - SchedulerModule -> EnhancedScheduler
 * - EventBusModule  -> EventBusService
 * - DeviceModule    -> Device/DataTag/DeviceGroup entities (registered with the global ProjectDatabaseService)
 *
 * Internal service split:
 * - DeviceLoadingService       -> device loading and state registration
 * - TaskRegistrationService    -> collection-task registration and management
 * - DevicePersistenceService   -> device-state persistence
 * - PluginEventAdapter         -> plugin event handling
 * - DeviceCollectorBootstrap   -> coordination layer (IActiveDeviceTracker implementation)
 */
@Global()
@Module({
  imports: [SystemModule, SchedulerModule, EventBusModule, DeviceModule],
  providers: [
    DeviceLoadingService,
    TaskRegistrationService,
    DevicePersistenceService,
    PluginEventAdapter,
    DeviceCollectorBootstrap,
    {
      provide: ACTIVE_DEVICE_TRACKER,
      useExisting: DeviceCollectorBootstrap,
    },
  ],
  exports: [DeviceCollectorBootstrap, ACTIVE_DEVICE_TRACKER],
})
export class CollectorModule {}
