// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export { BaseCollectorService } from './base-collector.service';
export { PluginTestHarness } from './plugin-test-harness';
export { PluginDevServer } from './plugin-dev-server';
export { scaffoldPlugin } from './scaffold';
export type { ScaffoldOptions, ScaffoldResult } from './scaffold';

// ─── Common types + protocol interface types (migrated here from ss-core on 2026-07-17) ───
export type {
  Quality,
  TransformConfig,
  CollectorReadResult,
  FieldError,
  BaseConnectionConfig,
  BaseDeviceConfig,
  IProtocolAdapter,
  IDeviceContext,
  ITagContext,
  ChannelValidationResult,
} from './types';

// ─── Plugin event types (migrated here from ss-core on 2026-07-18) ───
export type {
  PluginLifecycleEvent,
  ExecutorHealth,
  IsolationCrashEvent,
} from './events/plugin-events.types';

// ─── Common utilities ───
export { ValueTransformUtil } from './value-transform.util';
export { ConfigValidator } from './config-validator.util';
export { JsonPathUtil } from './jsonpath.util';
export { BatchReadOptimizer } from './batch-read-optimizer.util';
export type { BatchGroup } from './batch-read-optimizer.util';
export { isBooleanDataType, isStringDataType } from './data-type.util';

// ─── Plugin management (migrated from ss-core to ss-collector-sdk on 2026-07-17) ───
export {
  PluginModule,
  PluginRegistry,
  PluginDiscoveryService,
  PluginExplorerService,
  PluginUpdaterService,
  PluginManagerService,
  PluginController,
  PluginMonitorService,
  PluginConfigService,
  CollectorPlugin,
  COLLECTOR_PLUGIN_META,
  IsolationFactory,
  InProcessExecutor,
  WorkerThreadExecutor,
  ChildProcessExecutor,
  IsolationAlarmService,
  PluginCategory,
  IsolationMode,
  PROVIDER_SCANNER,
} from './plugins';
export type {
  PluginRuntimeConfig,
  CollectorPluginMeta,
  RegisteredPlugin,
  PluginMetrics,
  PluginModuleOptions,
  IsolationConfig,
  PluginStatus,
  PluginFilter,
  DiscoveredPlugin,
  ActiveDeviceInfo,
  DeviceStats,
  IActiveDeviceTracker,
  IIsolationExecutor,
  ShardRef,
  IsolationAlarmEvent,
  IProviderScanner,
  IProviderWrapper,
} from './plugins';
export { ACTIVE_DEVICE_TRACKER } from './plugins';

// ─── Collection diagnostics (migrated from ss-core to ss-collector-sdk on 2026-07-17) ───
export { DiagnosticsModule } from './diagnostics/diagnostics.module';
export { CollectorDiagnosticsService } from './diagnostics/collector-diagnostics.service';
export type { DiagnosisResult, DiagnosisReport } from './diagnostics/collector-diagnostics.service';
export { CollectorDiagnosticsController } from './diagnostics/collector-diagnostics.controller';

// ─── Pipeline engine (migrated from ss-core to ss-collector-sdk on 2026-07-17) ───
export {
  PipelineOrchestrator,
  PipelineContext,
  PipelineStep,
} from './pipeline/pipeline-orchestrator';
export { PipelineModule } from './pipeline/pipeline.module';
export { DeviceConfigWatcher } from './pipeline/device-config-watcher.service';
export { OfflineCacheService } from './pipeline/offline-cache.service';
export type {
  OfflineDataPoint,
  OfflineCacheStats,
  OfflineCacheConfig,
} from './pipeline/offline-cache.service';
export { PipelineMetricsService } from './pipeline/pipeline-metrics.service';
export type { PipelineMetricsSnapshot } from './pipeline/pipeline-metrics.service';
export { PipelineMetricsController } from './pipeline/pipeline-metrics.controller';
export { ConcurrentPipelineOrchestrator } from './pipeline/concurrent-pipeline-orchestrator';
export { BoundedBackpressureQueue, QueueStats } from './pipeline/bounded-backpressure-queue';
export { CircuitBreakerService as PipelineCircuitBreaker } from './pipeline/circuit-breaker.service';
export type {
  CircuitState as PipelineCircuitState,
  CircuitBreakerConfig as PipelineCircuitBreakerConfig,
  CircuitStats as PipelineCircuitStats,
} from './pipeline/circuit-breaker.service';
export {
  IPersistWriter,
  PERSIST_WRITER,
  DataPoint,
  TagUpdatePayload,
  PersistWriterPriority,
} from './pipeline/interfaces';
export { PersistWriterRegistry } from './pipeline/persist-writer-registry';
export { SchedulerModule } from './pipeline/scheduler/scheduler.module';
export {
  EnhancedScheduler,
  AcquisitionTask,
  TaskPriority,
} from './pipeline/scheduler/enhanced-scheduler';
