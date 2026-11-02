// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { IPersistWriter } from './interfaces';

/**
 * Persist-writer registry (cross-module communication bridge)
 *
 * Background: NestJS module encapsulation prevents PersistStep (PipelineModule/ss-core)
 * from obtaining the RedisLatestValuePersistWriter registered in DeviceModule (ss-device)
 * via @Inject(PERSIST_WRITER).
 *
 * The registry pattern lets the writer register itself in onModuleInit,
 * and PersistStep fetches all registered writers from the registry, decoupling module dependencies.
 */
@Injectable()
export class PersistWriterRegistry {
  private readonly logger = new Logger(PersistWriterRegistry.name);
  private writers: IPersistWriter[] = [];

  register(writer: IPersistWriter): void {
    if (!this.writers.includes(writer)) {
      this.writers.push(writer);
      this.logger.log(`Writer registered: ${writer.name} (total: ${this.writers.length})`);
    }
  }

  unregister(writer: IPersistWriter): void {
    const idx = this.writers.indexOf(writer);
    if (idx >= 0) {
      this.writers.splice(idx, 1);
      this.logger.log(`Writer unregistered: ${writer.name}`);
    }
  }

  getWriters(): IPersistWriter[] {
    return [...this.writers];
  }
}
