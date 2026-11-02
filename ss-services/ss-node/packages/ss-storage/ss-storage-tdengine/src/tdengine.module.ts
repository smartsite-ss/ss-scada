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
import { TdengineAdapterService } from './tdengine-adapter.service';
import { TdengineDatabaseService } from './tdengine-database.service';

/**
 * TDengine storage module.
 *
 * Assembly contents:
 * - TdengineAdapterService: implements StorageAdapter (engine type tdengine);
 * - TdengineDatabaseService: project → database + super-table/child-table management and automatic database/table creation;
 * - Registers the tdengine engine with StorageEngineRouterService, for STORAGE_DEFAULT_ENGINE /
 *   project-level override routing by project.
 */
@Module({
  imports: [StorageModule, EventBusModule],
  providers: [TdengineAdapterService, TdengineDatabaseService],
  exports: [TdengineAdapterService, TdengineDatabaseService],
})
export class TdengineStorageModule implements OnModuleInit {
  constructor(
    private readonly storageEngineRouter: StorageEngineRouterService,
    private readonly tdengineAdapter: TdengineAdapterService,
  ) {}

  onModuleInit(): void {
    this.storageEngineRouter.registerAdapter(STORAGE_ENGINE_TYPES.TDENGINE, this.tdengineAdapter);
  }
}
