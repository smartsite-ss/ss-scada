// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, OnModuleInit } from '@nestjs/common';
import { EventBusModule } from '@ss-node/ss-core';
import {
  StorageModule,
  StorageEngineRouterService,
  STORAGE_ENGINE_TYPES,
} from '@ss-node/ss-storage';
import { Influxdb3AdapterService } from './influxdb3-adapter.service';
import { Influxdb3DatabaseService } from './influxdb3-database.service';

/**
 * InfluxDB 3 Core storage module.
 *
 * Assembly contents:
 * - Influxdb3AdapterService: implements StorageAdapter (engine type influxdb3);
 * - Influxdb3DatabaseService: project → database mapping and automatic database creation (project.created);
 * - Registers the influxdb3 engine with StorageEngineRouterService, for STORAGE_DEFAULT_ENGINE /
 *   project-level override routing by project.
 */
@Module({
  imports: [StorageModule, EventBusModule],
  providers: [Influxdb3AdapterService, Influxdb3DatabaseService],
  exports: [Influxdb3AdapterService, Influxdb3DatabaseService],
})
export class Influxdb3StorageModule implements OnModuleInit {
  constructor(
    private readonly storageEngineRouter: StorageEngineRouterService,
    private readonly influxdb3Adapter: Influxdb3AdapterService,
  ) {}

  onModuleInit(): void {
    this.storageEngineRouter.registerAdapter(STORAGE_ENGINE_TYPES.INFLUXDB3, this.influxdb3Adapter);
  }
}
