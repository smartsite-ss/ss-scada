// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Optional, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventBusService, SystemEventService } from '@ss-node/ss-core';
import { AlarmLevel } from '@ss-node/ss-sdk';

/**
 * System-health alarm subscriber
 *
 * Listens for health_degraded / health_recovered events:
 * - Core services (SQLite/InfluxDB/Redis, etc.) fail their health check -> written to the global sys_events table
 * - Core services recover -> mark the corresponding event as RECOVERED
 *
 * System-health events are global events that belong to no project; they are stored centrally in the sys_events table
 * of the global ss-node.db. Event ID format: `sys-health-{checkName}` (deterministic ID, easy to dedupe and find on recovery).
 */
@Injectable()
export class SystemHealthAlarmSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemHealthAlarmSubscriber.name);
  private readonly degradedHandler: (event: any) => void;
  private readonly recoveredHandler: (event: any) => void;

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly systemEventService?: SystemEventService,
  ) {
    this.degradedHandler = this.handleHealthDegraded.bind(this);
    this.recoveredHandler = this.handleHealthRecovered.bind(this);
  }

  onModuleInit(): void {
    if (this.eventBus) {
      this.eventBus.on('health_degraded', this.degradedHandler);
      this.eventBus.on('health_recovered', this.recoveredHandler);
      this.logger.log(
        'SystemHealthAlarmSubscriber initialized — listening for health_degraded/health_recovered',
      );
    }
  }

  onModuleDestroy(): void {
    if (this.eventBus) {
      this.eventBus.off('health_degraded', this.degradedHandler);
      this.eventBus.off('health_recovered', this.recoveredHandler);
    }
  }

  /**
   * System-health degradation -> write to the global sys_events table
   */
  private async handleHealthDegraded(event: {
    checks: Array<{ name: string; status: string; error?: string; latency?: number }>;
    timestamp: number;
  }): Promise<void> {
    if (!this.systemEventService) {
      this.logger.warn('Skipped health alarm: systemEventService not available');
      return;
    }

    const unhealthyChecks = event.checks.filter((c) => c.status === 'unhealthy');
    if (unhealthyChecks.length === 0) {
      return;
    }

    for (const check of unhealthyChecks) {
      const eventId = `sys-health-${check.name}`;
      const message = check.error
        ? `系统服务异常: ${check.name} - ${check.error}`
        : `系统服务异常: ${check.name}`;

      try {
        await this.systemEventService.create({
          deterministicId: eventId,
          eventType: 'health',
          subType: check.name,
          level: AlarmLevel.CRITICAL,
          message,
          source: 'health-checker',
          metadata: {
            latency: check.latency,
            timestamp: event.timestamp,
          },
        });

        this.logger.warn(`System health event created: ${eventId} service=${check.name}`);
      } catch (error: any) {
        this.logger.error(`Failed to create health event ${eventId}: ${error.message}`);
      }
    }
  }

  /**
   * System-health recovery -> mark the corresponding event as RECOVERED
   */
  private async handleHealthRecovered(event: {
    checks: Array<{ name: string; status: string }>;
    timestamp: number;
  }): Promise<void> {
    if (!this.systemEventService) {
      return;
    }

    const recoveredChecks = event.checks.filter((c) => c.status === 'healthy');
    let totalRecovered = 0;

    for (const check of recoveredChecks) {
      const eventId = `sys-health-${check.name}`;
      try {
        const result = await this.systemEventService.recover(eventId);
        if (result) {
          totalRecovered++;
          this.logger.log(`System health event recovered: ${eventId}`);
        }
      } catch (error: any) {
        this.logger.error(`Failed to recover health event ${eventId}: ${error.message}`);
      }
    }

    if (totalRecovered > 0) {
      this.logger.log(`System health recovered — cleared ${totalRecovered} events`);
    }
  }
}
