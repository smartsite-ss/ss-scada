// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Global, Module } from '@nestjs/common';
import { EventBusModule } from '../event-bus/event-bus.module';
import { ProjectDatabaseService } from './project-database.service';

/**
 * Project-database management global module
 *
 * Provides ProjectDatabaseService as a global singleton;
 * all modules that need to access project-level system.db inject this service via DI.
 *
 * Note: this module depends on EventBusModule to listen for the project.beforeDelete event.
 */
@Global()
@Module({
  imports: [EventBusModule],
  providers: [ProjectDatabaseService],
  exports: [ProjectDatabaseService],
})
export class DatabaseModule {}
