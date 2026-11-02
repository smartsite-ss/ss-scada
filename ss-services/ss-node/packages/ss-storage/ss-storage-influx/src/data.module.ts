// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, Global, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistoricalData } from './entities/historical-data.entity';
import { DataService } from './data.service';
import { DataQueryService } from './data-query.service';
import { DataController } from './data.controller';
import { InfluxWriteService } from './influx-write.service';
import { InfluxBucketService } from './influx-bucket.service';
import { SqlitePersistWriter } from './sqlite-persist-writer';
import { InfluxPersistWriter } from './influx-persist-writer';
import { InfluxQueryService } from './influx-query.service';
import { InfluxdbAdapterService } from './influxdb-adapter.service';
import { PERSIST_WRITER, PipelineModule } from '@ss-node/ss-collector-sdk';
import { ProjectDatabaseService, EventBusModule } from '@ss-node/ss-core';
import {
  StorageModule,
  StorageEngineRouterService,
  STORAGE_ENGINE_TYPES,
} from '@ss-node/ss-storage';

// multi: true registration is kept for potential @Inject(PERSIST_WRITER) injection scenarios
// (note: multi providers are only instantiated when injected, so onModuleInit is not triggered)
const persistWriterProviders = [
  { provide: PERSIST_WRITER, useClass: SqlitePersistWriter, multi: true },
  { provide: PERSIST_WRITER, useClass: InfluxPersistWriter, multi: true },
] as any[];

/**
 * String token aliases — for injection by ss-device's DeviceArchiveService / ArchiveService
 *
 * Avoids directly importing ss-storage-influx classes (which would create workspace package-level circular dependencies:
 * ss-storage-influx → ss-device [DataTag entity], ss-device → ss-storage-influx [service classes]).
 *
 * ss-device injects via @Inject('INFLUX_WRITE_SERVICE') / @Inject('DATA_QUERY_SERVICE');
 * useExisting here maps the tokens to the actual service instances.
 */
const serviceTokenAliases = [
  { provide: 'INFLUX_WRITE_SERVICE', useExisting: InfluxWriteService },
  { provide: 'DATA_QUERY_SERVICE', useExisting: DataQueryService },
];

/**
 * @Global() — the data storage module is declared as a global module
 *
 * Makes InfluxWriteService / DataQueryService / DataService injectable from any module,
 * avoiding workspace package-level circular dependencies when business modules (e.g. ss-device) need DataModule
 * (ss-storage-influx depends on ss-device's DataTag entity type; ss-device should not depend back on ss-storage-influx).
 *
 * Imports PipelineModule: makes PersistWriterRegistry injectable into SqlitePersistWriter / InfluxPersistWriter,
 * so they can actively register with the Registry at onModuleInit and be invoked by PersistStep.
 *
 * PersistWriters are listed directly in providers (not only registered via multi: true),
 * ensuring NestJS instantiates them to trigger onModuleInit → PersistWriterRegistry.register().
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([HistoricalData]),
    PipelineModule,
    EventBusModule,
    StorageModule,
  ],
  controllers: [DataController],
  providers: [
    DataService,
    DataQueryService,
    InfluxWriteService,
    InfluxBucketService,
    InfluxQueryService,
    InfluxdbAdapterService,
    SqlitePersistWriter,
    InfluxPersistWriter,
    ...persistWriterProviders,
    ...serviceTokenAliases,
  ],
  exports: [
    DataService,
    DataQueryService,
    InfluxWriteService,
    InfluxBucketService,
    InfluxQueryService,
    InfluxdbAdapterService,
  ],
})
export class DataModule implements OnModuleInit {
  constructor(
    private readonly projectDbService: ProjectDatabaseService,
    private readonly storageEngineRouter: StorageEngineRouterService,
    private readonly influxdbAdapter: InfluxdbAdapterService,
  ) {}

  /**
   * Register the HistoricalData entity with the global ProjectDatabaseService.
   *
   * This way, when a project database is initialized (synchronize: true), TypeORM automatically creates
   * the data_historical_data table with HistoricalData.tagId as a foreign key referencing
   * dev_data_tags.id (the DataTag entity is registered by DeviceModule).
   *
   * Without registration the table is not created in the project database, and SqlitePersistWriter writes
   * fail the foreign key check with "FOREIGN KEY constraint failed".
   */
  onModuleInit(): void {
    this.projectDbService.registerSystemEntities([HistoricalData]);
    // Register the InfluxDB 2 adapter with the storage engine router (engine type influxdb2)
    this.storageEngineRouter.registerAdapter(STORAGE_ENGINE_TYPES.INFLUXDB2, this.influxdbAdapter);
  }
}
