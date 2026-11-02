// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventLog } from './entities/event-log.entity';
import { EventLogService } from './event-log.service';
import { EventLogController } from './event-log.controller';
import { EventBusModule } from '../event-bus/event-bus.module';

/**
 * Event-log module - config-change event persistence + subscriber tracing
 *
 * Follows the SystemEventModule pattern:
 * - Registered into the global ss-node.db via TypeOrmModule.forFeature([EventLog])
 * - Entities stored in the global ss-node.db, no projectId dependency
 * - Depends on EventBusModule (registers emit hooks in onModuleInit)
 * - Provides the EventLogController REST API (Phase 4)
 *
 * Must load after EventBusModule (order controlled in app.module.ts)
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EventLog]), EventBusModule],
  controllers: [EventLogController],
  providers: [EventLogService],
  exports: [EventLogService, TypeOrmModule.forFeature([EventLog])],
})
export class EventLogModule {}
