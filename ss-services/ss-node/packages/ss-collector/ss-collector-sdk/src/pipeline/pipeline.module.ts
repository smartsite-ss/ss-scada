// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, OnModuleInit, Injectable, Logger, Optional } from '@nestjs/common';
import { PipelineOrchestrator } from './pipeline-orchestrator';
import { ConcurrentPipelineOrchestrator } from './concurrent-pipeline-orchestrator';
import { BoundedBackpressureQueue } from './bounded-backpressure-queue';
import { CircuitBreakerService } from './circuit-breaker.service';
import { OfflineCacheService } from './offline-cache.service';
import { OfflineCacheController } from './offline-cache.controller';
import { PipelineMetricsService } from './pipeline-metrics.service';
import { PipelineMetricsController } from './pipeline-metrics.controller';
import { ProtocolReadStep } from './steps/protocol-read.step';
import { TransformStep } from './steps/transform.step';
import { DeadbandStep } from './steps/deadband.step';
import { QualityCheckStep } from './steps/quality-check.step';
import { AlarmCheckStep } from './steps/alarm-check.step';
import { CacheUpdateStep } from './steps/cache-update.step';
import { PersistStep } from './steps/persist.step';
import { FormatStep } from './steps/format.step';
import { PublishStep } from './steps/publish.step';
import { RetryableProtocolRead, CircuitBreakerDecorator } from './steps/retry-wrapper.step';
import { EnhancedScheduler } from './scheduler/enhanced-scheduler';
import { SchedulerModule } from './scheduler/scheduler.module';
import { DeviceConfigWatcher } from './device-config-watcher.service';
import { PersistWriterRegistry } from './persist-writer-registry';
import { PluginManagerService } from '../plugins/plugin-manager.service';

import { EventBusModule } from '@ss-node/ss-core';

// ---------------------------------------------------------------------------
// Pipeline initializer - injects Pipeline steps into the scheduler at startup
// ---------------------------------------------------------------------------

@Injectable()
class PipelineInitializer implements OnModuleInit {
  private readonly logger = new Logger(PipelineInitializer.name);

  constructor(
    private readonly scheduler: EnhancedScheduler,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly pipelineMetricsService: PipelineMetricsService,
    private readonly protocolRead: ProtocolReadStep,
    private readonly transform: TransformStep,
    private readonly deadband: DeadbandStep,
    private readonly qualityCheck: QualityCheckStep,
    private readonly alarmCheck: AlarmCheckStep,
    private readonly cacheUpdate: CacheUpdateStep,
    private readonly persist: PersistStep,
    private readonly format: FormatStep,
    private readonly publish: PublishStep,
    /** PluginModule is @Global(), so PluginManagerService can be injected across modules; @Optional supports the unit-test environment */
    @Optional() private readonly pluginManagerService?: PluginManagerService,
  ) {}

  onModuleInit(): void {
    const steps = [
      this.protocolRead,
      this.transform,
      this.deadband,
      this.qualityCheck,
      this.alarmCheck,
      this.cacheUpdate,
      this.persist,
      this.format,
      this.publish,
    ];

    // Register with PipelineOrchestrator
    for (const step of steps) {
      this.orchestrator.registerStep(step);
    }

    // Register with EnhancedScheduler
    this.scheduler.setPipelineSteps(steps);

    // Inject orchestrator and metricsService into the scheduler so it delegates pipeline execution to orchestrator.execute(),
    // which automatically records step duration, error rate, flame-graph breakdown, etc. (fixes the Pipeline metrics page showing no data)
    this.scheduler.setOrchestrator(this.orchestrator);
    this.scheduler.setPipelineMetricsService(this.pipelineMetricsService);

    // Inject PipelineMetricsService back into PluginManagerService,
    // so the plugin-list API can return real per-protocol collection metrics (active connections / total reads / average response time)
    if (this.pluginManagerService) {
      this.pluginManagerService.setPipelineMetricsService(this.pipelineMetricsService);
    }

    this.logger.log(
      `Pipeline initialized: ${steps.length} steps registered → ${steps.map((s) => s.name).join(' → ')}`,
    );
  }
}

@Module({
  imports: [SchedulerModule, EventBusModule],
  providers: [
    PipelineInitializer,
    CircuitBreakerService,
    BoundedBackpressureQueue,
    OfflineCacheService,
    ConcurrentPipelineOrchestrator,
    PipelineOrchestrator,
    PipelineMetricsService,
    ProtocolReadStep,
    TransformStep,
    DeadbandStep,
    QualityCheckStep,
    AlarmCheckStep,
    CacheUpdateStep,
    PersistStep,
    FormatStep,
    PublishStep,
    RetryableProtocolRead,
    CircuitBreakerDecorator,
    DeviceConfigWatcher,
    PersistWriterRegistry,
  ],
  controllers: [OfflineCacheController, PipelineMetricsController],
  exports: [
    PipelineModule,
    SchedulerModule,
    CircuitBreakerService,
    BoundedBackpressureQueue,
    OfflineCacheService,
    ConcurrentPipelineOrchestrator,
    PipelineOrchestrator,
    PipelineMetricsService,
    ProtocolReadStep,
    TransformStep,
    DeadbandStep,
    QualityCheckStep,
    AlarmCheckStep,
    CacheUpdateStep,
    PersistStep,
    FormatStep,
    PublishStep,
    RetryableProtocolRead,
    CircuitBreakerDecorator,
    DeviceConfigWatcher,
    PersistWriterRegistry,
  ],
})
export class PipelineModule {}
