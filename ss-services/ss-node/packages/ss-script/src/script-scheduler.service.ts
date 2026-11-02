// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as cron from 'node-cron';
import { Script, ScriptStatus, ScriptTriggerType } from './entities/script.entity';
import { ScriptEngineService } from './script-engine.service';
import { ScriptApiService } from './script-api.service';

interface ScheduledTask {
  scriptId: string;
  cronExpression: string;
  task: cron.ScheduledTask | null;
}

/**
 * ScriptSchedulerService — standard cron scheduler based on node-cron
 *
 * Phase 6.1 upgrade: setInterval → cron.schedule
 * - Supports full standard cron expressions (minute hour day month weekday, incl. ranges, lists, steps)
 * - Expression validity is validated via cron.validate()
 * - Timezone is fixed to Asia/Shanghai (avoids scheduling drift from server timezone differences)
 * - Implements OnModuleDestroy to stop all tasks on module destruction
 * - getApiProvider(script.projectId) passes in the project context
 */
@Injectable()
export class ScriptSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(ScriptSchedulerService.name);

  private scheduledTasks = new Map<string, ScheduledTask>();

  constructor(
    @Inject(getRepositoryToken(Script))
    private readonly scriptRepo: Repository<Script>,
    private readonly engineService: ScriptEngineService,
    private readonly apiService: ScriptApiService,
  ) {}

  async loadScheduledScripts(projectId?: string): Promise<void> {
    const where: any = {
      triggerType: ScriptTriggerType.SCHEDULED,
      status: ScriptStatus.ACTIVE,
    };
    if (projectId) where.projectId = projectId;

    const scripts = await this.scriptRepo.find({ where });

    for (const script of scripts) {
      await this.scheduleScript(script);
    }

    this.logger.log(`Loaded ${scripts.length} scheduled scripts`);
  }

  async scheduleScript(script: Script): Promise<void> {
    if (script.triggerType !== ScriptTriggerType.SCHEDULED) return;
    if (script.status !== ScriptStatus.ACTIVE) {
      this.unscheduleScript(script.id);
      return;
    }

    try {
      const config = script.triggerConfig ? JSON.parse(script.triggerConfig) : {};
      const cronExpression = config.cron || '*/5 * * * *';

      // Validate the expression with node-cron (standard 5-field format: minute hour day month weekday)
      if (!cron.validate(cronExpression)) {
        this.logger.error(
          `Invalid cron expression for script ${script.name}: ${cronExpression}`,
        );
        return;
      }

      // Stop the old task first, then register the new one
      this.unscheduleScript(script.id);

      const task = cron.schedule(
        cronExpression,
        async () => {
          try {
            this.logger.debug(`Running scheduled script: ${script.name}`);
            await this.engineService.execute(script, {
              apiProvider: this.apiService.getApiProvider(script.projectId),
              trigger: 'scheduled',
              scheduledAt: new Date().toISOString(),
            });
          } catch (error) {
            this.logger.error(`Scheduled script error: ${script.name} - ${error.message}`);
          }
        },
        { timezone: 'Asia/Shanghai' },
      );

      this.scheduledTasks.set(script.id, {
        scriptId: script.id,
        cronExpression,
        task,
      });

      this.logger.log(
        `Scheduled script: ${script.name} (${cronExpression}, timezone=Asia/Shanghai)`,
      );
    } catch (error) {
      this.logger.error(`Failed to schedule script ${script.name}: ${error.message}`);
    }
  }

  unscheduleScript(scriptId: string): void {
    const task = this.scheduledTasks.get(scriptId);
    if (task?.task) {
      task.task.stop();
      this.scheduledTasks.delete(scriptId);
      this.logger.debug(`Unscheduled script: ${scriptId}`);
    }
  }

  unscheduleAll(): void {
    for (const [id] of this.scheduledTasks) {
      this.unscheduleScript(id);
    }
  }

  onModuleDestroy(): void {
    this.logger.log('ScriptSchedulerService destroyed, stopping all scheduled tasks');
    this.unscheduleAll();
  }

  getScheduledTasks(): { scriptId: string; cronExpression: string }[] {
    return Array.from(this.scheduledTasks.values()).map((t) => ({
      scriptId: t.scriptId,
      cronExpression: t.cronExpression,
    }));
  }
}
