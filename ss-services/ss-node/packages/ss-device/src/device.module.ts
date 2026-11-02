// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './entities/device.entity';
import { DataTag } from './entities/data-tag.entity';
import { DeviceGroup } from './entities/device-group.entity';
import { DeviceStatusLog } from './entities/device-status-log.entity';
import { ControlOperationLog } from './control/control-operation.entity';
import { DeviceService } from './device.service';
import { DeviceController } from './device.controller';
import { DeviceStateMachine } from './state/device-state-machine';
import { ConnectionManagerService } from './connection/connection-manager.service';
import { DeviceDiagnosticService } from './device-diagnostic.service';
import { DeviceDataService } from './data/device-data.service';
import { DeviceSimulationService } from './simulation/device-simulation.service';
import { ArchiveService } from './data/archive.service';
import { DeviceGateway } from './device.gateway';
import { ChannelConfigService } from './channel/channel-config.service';
import { DeviceBackupService } from './backup/device-backup.service';
import { DeadbandFilterService } from './filter/deadband-filter.service';
import { DeviceArchiveService } from './archive/device-archive.service';
import { DeviceImportExportService } from './import-export/device-import-export.service';
import { RedisLatestValuePersistWriter } from './persist/redis-latest-value-persist-writer';
import { DeviceControlService } from './control/device-control.service';
import { DeviceStatusSubscribeNotifier } from './notification/device-status-subscribe-notifier';
import { EventBusModule, ConnectionModule, ProjectDatabaseService } from '@ss-node/ss-core';
import { PERSIST_WRITER, PipelineModule } from '@ss-node/ss-collector-sdk';
import { SystemModule } from '@ss-node/ss-system';

const persistWriterProviders = [
  { provide: PERSIST_WRITER, useClass: RedisLatestValuePersistWriter, multi: true },
] as any[];

/**
 * @deprecated Use @ss-node/ss-core's REDIS_CLIENT_DEFAULT instead.
 * Kept exported only for external-reference compatibility; no independent Redis client is created internally.
 * The actual client is provided globally by RedisModule.
 */
export const PERSIST_REDIS_CLIENT = 'REDIS_CLIENT_DEFAULT';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, DataTag, DeviceGroup, DeviceStatusLog]),
    EventBusModule,
    ConnectionModule,
    PipelineModule,
    forwardRef(() => SystemModule),
  ],
  controllers: [DeviceController],
  providers: [
    DeviceService,
    DeviceStateMachine,
    ConnectionManagerService,
    DeviceDiagnosticService,
    DeviceDataService,
    DeviceSimulationService,
    ArchiveService,
    DeviceGateway,
    ChannelConfigService,
    DeviceBackupService,
    DeadbandFilterService,
    DeviceArchiveService,
    DeviceImportExportService,
    DeviceControlService,
    DeviceStatusSubscribeNotifier,
    RedisLatestValuePersistWriter,
    ...persistWriterProviders,
    // The Redis client is provided by the global RedisModule (@ss-node/ss-core); the injection token is REDIS_CLIENT_DEFAULT
    // RedisLatestValuePersistWriter gets it directly via @Inject(REDIS_CLIENT_DEFAULT)
  ],
  exports: [
    DeviceService,
    DeviceStateMachine,
    ConnectionManagerService,
    DeviceDiagnosticService,
    DeviceDataService,
    DeviceSimulationService,
    ArchiveService,
    DeviceGateway,
    ChannelConfigService,
    DeviceBackupService,
    DeadbandFilterService,
    DeviceArchiveService,
    DeviceImportExportService,
  ],
})
export class DeviceModule implements OnModuleInit {
  constructor(private readonly projectDbService: ProjectDatabaseService) {}

  onModuleInit(): void {
    // Register the device module's entities with the global ProjectDatabaseService
    // When project databases are initialized, these entities are auto-created as tables
    this.projectDbService.registerSystemEntities([
      Device,
      DataTag,
      DeviceGroup,
      DeviceStatusLog,
      ControlOperationLog,
    ]);
  }
}
