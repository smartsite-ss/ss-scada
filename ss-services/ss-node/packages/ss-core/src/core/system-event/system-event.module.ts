// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemEvent } from '../entities/system-event.entity';
import { SystemEventService } from './system-event.service';

/**
 * Global system-event module
 *
 * Registers the SystemEvent entity and SystemEventService for global use.
 * Entities are stored in the global ss-node.db and do not depend on projectId.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SystemEvent])],
  providers: [SystemEventService],
  exports: [SystemEventService],
})
export class SystemEventModule {}
