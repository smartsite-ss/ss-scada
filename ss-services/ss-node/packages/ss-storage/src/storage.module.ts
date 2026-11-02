// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module } from '@nestjs/common';
import { StorageEngineConfigService } from './storage-engine-config.service';
import { StorageEngineRouterService } from './storage-engine-router.service';
import { StorageArchiveService } from './storage-archive.service';
import { StorageHealthService } from './storage-health.service';
import { DownsamplingService } from './services/downsampling.service';

/**
 * Storage management NestJS module.
 *
 * Registers the storage engine router, archive, health check, and downsampling services.
 * The downsampling service depends on the InfluxDB adapter (optional injection) and degrades gracefully when it is not registered.
 */
@Module({
  providers: [
    StorageEngineConfigService,
    StorageEngineRouterService,
    StorageArchiveService,
    StorageHealthService,
    DownsamplingService,
  ],
  exports: [
    StorageEngineConfigService,
    StorageEngineRouterService,
    StorageArchiveService,
    StorageHealthService,
    DownsamplingService,
  ],
})
export class StorageModule {}
