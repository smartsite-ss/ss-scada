// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { PipelineContext, PipelineStep, PipelineOrchestrator } from '../pipeline-orchestrator';
import { PipelineMetricsService } from '../pipeline-metrics.service';
import { EventBusService, MetricsCollectorService, DeviceStateManager } from '@ss-node/ss-core';
import { PluginRegistry } from '../../plugins';
import { IsolationMode } from '../../plugins';

export enum TaskPriority {
  CRITICAL = 100,
  HIGH = 75,
  NORMAL = 50,
  LOW = 25,
}

export interface AcquisitionTask {
  id: string;
  deviceId: string;
  tagId: string;
  tagConfig: any;
  deviceClient: any;
  priority: TaskPriority;
  interval: number;
  lastExecution?: Date;
  retryCount: number;
  maxRetries: number;
  enabled: boolean;
  /** Internal: delayed-retry timer handle, used to cancel on unregister */
  _retryTimer?: ReturnType<typeof setTimeout>;
}

export interface SchedulerConfig {
  maxConcurrentTasks: number;
  maxQueueSize: number;
  schedulingIntervalMs: number;
  enableBackpressure: boolean;
  defaultMaxRetries: number;
  circuitFailureThreshold: number;
  circuitResetTimeoutMs: number;
  throttleFailureThreshold: number;
  throttleFactor: number;
}

const DEFAULT_CONFIG: Required<SchedulerConfig> = {
  maxConcurrentTasks: 10,
  maxQueueSize: 1000,
  schedulingIntervalMs: 50,
  enableBackpressure: true,
  defaultMaxRetries: 3,
  circuitFailureThreshold: 5,
  circuitResetTimeoutMs: 30000,
  throttleFailureThreshold: 3,
  throttleFactor: 2,
};

/**
 * online-event emission throttle cap (ms).
 * The online-event emission interval for low-frequency tasks (e.g. 60s) does not exceed this value,
 * to avoid device status going stale for too long; high-frequency tasks are still throttled by scanRate.
 */
const MAX_ONLINE_EMIT_INTERVAL_MS = 30000;

/**
 * Collection-summary log output interval (ms).
 * The scheduler outputs per-device collection statistics at this period, replacing the previous
 * per-tag-per-cycle fine-grained logs, so ops can quickly identify "which plugin/process/device/variable count/success-failure".
 */
const COLLECTION_SUMMARY_INTERVAL_MS = 30000;

/**
 * Per-device collection-cycle statistics.
 * Accumulated within the summary window: read count, success/failure count, cumulative duration; reset after output.
 */
interface DeviceCycleStats {
  /** Protocol (plugin protocol, e.g. modbus_tcp / opc_ua) */
  protocol: string;
  /** Device name (for log readability) */
  deviceName: string;
  /** Number of tag tasks currently registered to this device */
  tagCount: number;
  /** Number of reads completed within the summary window */
  reads: number;
  /** Count of quality within {good, out_of_range} within the summary window */
  successCount: number;
  /** Count of quality within {bad, comm_error} or exceptions within the summary window */
  errorCount: number;
  /** Cumulative duration (ms) within the summary window */
  totalDurationMs: number;
}

export interface SchedulerMetrics {
  totalTasks: number;
  runningTasks: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageExecutionTime: number;
  throughputPerSecond: number;
}

interface DeviceCircuitState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime?: Date;
  openedAt?: Date;
  throttledInterval?: number;
}

@Injectable()
export class EnhancedScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EnhancedScheduler.name);

  private tasks = new Map<string, AcquisitionTask>();
  private runningTasksCount = 0;

  private schedulerInterval: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private circuitCheckTimer: NodeJS.Timeout | null = null;

  private config: Required<SchedulerConfig>;
  private pipelineSteps: PipelineStep[] = [];

  /**
   * Pipeline executor and metric service, injected via setter by PipelineInitializer during startup.
   * Constructor injection is avoided to prevent the SchedulerModule <-> PipelineModule circular dependency.
   * - orchestrator: delegates pipeline execution, auto-recording step duration, error rate, flame-graph breakdown
   * - pipelineMetricsService: used to update gauge metrics such as queueDepth / activeTasks
   */
  private orchestrator?: PipelineOrchestrator;
  private pipelineMetricsService?: PipelineMetricsService;

  private deviceCircuits = new Map<string, DeviceCircuitState>();

  /** Device's last online-event emission time (for throttle, to avoid high-frequency readTag flooding EventBus) */
  private lastOnlineEmitAt = new Map<string, number>();

  /**
   * Per-device collection-cycle statistics.
   * key = deviceId, value = accumulated metrics within the current summary window.
   * tagCount maintained by registerTask/unregisterTask,
   * reads/success/error/duration accumulated by handlePipelineResult/handleTaskError,
   * emitted and reset (reads/success/error/duration) by emitCollectionSummary.
   */
  private deviceStats = new Map<string, DeviceCycleStats>();

  /** Collection-summary log timer */
  private summaryTimer: NodeJS.Timeout | null = null;

  /** P1 optimization: error-log throttle - only one warn per device/tag within 5 seconds */
  private lastErrorLogAt = new Map<string, number>();

  private metrics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalExecutionTime: 0,
    startTime: Date.now(),
  };

  constructor(
    @Optional() config?: Partial<SchedulerConfig>,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly metricsCollector?: MetricsCollectorService,
    @Optional() private readonly deviceStateManager?: DeviceStateManager,
    /**
     * Plugin registry (provided by @Global PluginModule), used in the summary log to resolve
     * the "current protocol -> isolationMode -> process name" mapping.
     * May be un-injected in the unit-test environment; null-safety required.
     */
    @Optional() private readonly pluginRegistry?: PluginRegistry,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onModuleInit() {
    this.logger.log(`Scheduler initialized with config: ${JSON.stringify(this.config)}`);
    this.startSchedulingLoop();
    this.startMetricsCollection();
    this.startCircuitRecoveryCheck();
    this.startCollectionSummary();
  }

  onModuleDestroy() {
    this.logger.log('Shutting down scheduler...');

    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    if (this.circuitCheckTimer) {
      clearInterval(this.circuitCheckTimer);
      this.circuitCheckTimer = null;
    }

    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
  }

  setPipelineSteps(steps: PipelineStep[]): void {
    this.pipelineSteps = steps.sort((a, b) => a.order - b.order);
    this.logger.debug(
      `Pipeline steps configured: ${this.pipelineSteps.map((s) => s.name).join(' → ')}`,
    );
  }

  /**
   * Inject PipelineOrchestrator so the scheduler delegates pipeline execution to orchestrator.execute(),
   * automatically recording step duration, error rate, flame-graph breakdown, etc.
   * Called by PipelineInitializer during onModuleInit.
   */
  setOrchestrator(orchestrator: PipelineOrchestrator): void {
    this.orchestrator = orchestrator;
    this.logger.log('PipelineOrchestrator injected, metrics collection enabled');
  }

  /**
   * Inject PipelineMetricsService, used to update gauge metrics such as queue depth and active task count.
   * Called by PipelineInitializer during onModuleInit.
   */
  setPipelineMetricsService(metricsService: PipelineMetricsService): void {
    this.pipelineMetricsService = metricsService;
  }

  registerTask(task: AcquisitionTask): void {
    if (this.tasks.size >= this.config.maxQueueSize && this.config.enableBackpressure) {
      this.applyBackpressure();
      throw new Error(`Task queue full (${this.tasks.size}/${this.config.maxQueueSize})`);
    }

    task.retryCount = 0;
    task.maxRetries = task.maxRetries || this.config.defaultMaxRetries;
    task.enabled = true;
    task.lastExecution = new Date();

    this.tasks.set(task.id, task);
    this.readyTasksCache = null; // P3: invalidate the cache on task changes

    // Maintain per-device tag counts for the summary log ("how many variables were collected")
    this.ensureDeviceStats(task).tagCount++;

    this.logger.debug(
      `Task registered: ${task.id} (priority: ${task.priority}, interval: ${task.interval}ms)`,
    );
  }

  unregisterTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    const deleted = this.tasks.delete(taskId);
    this.readyTasksCache = null; // P3: invalidate the cache on task changes
    // Clean up the online-event throttle records to avoid memory leaks
    if (deleted && task) {
      // Clean up online-event throttle records to avoid memory leaks
      if (task._retryTimer) {
        clearTimeout(task._retryTimer);
        task._retryTimer = undefined;
      }
      const hasOtherTasks = Array.from(this.tasks.values()).some(
        (t) => t.deviceId === task.deviceId,
      );
      if (!hasOtherTasks) {
        this.lastOnlineEmitAt.delete(task.deviceId);
        // Cancel the pending retry timer (prevents an old task from running after deregistering on driver switch)
        this.deviceStats.delete(task.deviceId);
        this.deviceCircuits.delete(task.deviceId);
      } else {
        // This device has no collection tasks left; remove its statistics record and circuit-breaker state
        const stats = this.deviceStats.get(task.deviceId);
        if (stats && stats.tagCount > 0) {
          stats.tagCount--;
        }
      }
    }
    return deleted;
  }

  /**
   * Update the execution interval of all collection tasks for a device (for scanRate changes)
   * @param deviceId device ID
   * @param interval new collection interval (ms)
   * @returns the number of tasks updated
   */
  updateTaskInterval(deviceId: string, interval: number): number {
    if (interval < 1) {
      this.logger.warn(`Invalid interval ${interval}ms for device ${deviceId}, ignored`);
      return 0;
    }
    let updated = 0;
    for (const task of this.tasks.values()) {
      if (task.deviceId === deviceId) {
        task.interval = interval;
        updated++;
      }
    }
    if (updated > 0) {
      this.logger.log(
        `Updated ${updated} task(s) interval to ${interval}ms for device ${deviceId}`,
      );
    } else {
      this.logger.warn(`No tasks found for device ${deviceId}, scanRate update skipped`);
    }
    return updated;
  }

  enableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = true;
      this.readyTasksCache = null; // P3: invalidate the cache when a task is enabled
      this.logger.debug(`Task ${taskId} enabled`);
    }
  }

  disableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = false;
      this.readyTasksCache = null; // P3: invalidate the cache when a task is disabled
      this.logger.debug(`Task ${taskId} disabled`);
    }
  }

  getTaskStatus(): Map<string, AcquisitionTask> {
    return new Map(this.tasks);
  }

  getDeviceCircuitStatus(deviceId: string): DeviceCircuitState | undefined {
    return this.deviceCircuits.get(deviceId);
  }

  getAllCircuitStatus(): Map<string, DeviceCircuitState> {
    return new Map(this.deviceCircuits);
  }

  getMetrics(): SchedulerMetrics {
    const elapsed = (Date.now() - this.metrics.startTime) / 1000;

    return {
      totalTasks: this.tasks.size,
      runningTasks: this.runningTasksCount,
      queuedTasks: this.getReadyTasks().length,
      completedTasks: this.metrics.successfulExecutions,
      failedTasks: this.metrics.failedExecutions,
      averageExecutionTime:
        elapsed > 0
          ? Math.round(this.metrics.totalExecutionTime / this.metrics.totalExecutions)
          : 0,
      throughputPerSecond:
        elapsed > 0 ? Math.round((this.metrics.successfulExecutions / elapsed) * 100) / 100 : 0,
    };
  }

  private startSchedulingLoop(): void {
    this.schedulerInterval = setInterval(async () => {
      await this.executeNextBatch();
    }, this.config.schedulingIntervalMs);

    this.logger.log(`Scheduling loop started (interval: ${this.config.schedulingIntervalMs}ms)`);
  }

  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      const metrics = this.getMetrics();

      // Sync gauge metrics to PipelineMetricsService (exposed via the /pipeline/metrics/json endpoint)
      if (this.pipelineMetricsService) {
        this.pipelineMetricsService.setQueueDepth(metrics.queuedTasks);
        this.pipelineMetricsService.setActiveTasks(metrics.runningTasks);
      }

      if (metrics.runningTasks > 0 || metrics.failedTasks > 0) {
        this.logger.debug(
          `Scheduler Metrics: Running=${metrics.runningTasks}, ` +
            `Queued=${metrics.queuedTasks}, ` +
            `Completed=${metrics.completedTasks}, ` +
            `Failed=${metrics.failedTasks}, ` +
            `Throughput=${metrics.throughputPerSecond}/s`,
        );
      }
    }, 5000);
  }

  private startCircuitRecoveryCheck(): void {
    this.circuitCheckTimer = setInterval(() => {
      this.checkCircuitRecovery();
    }, 5000);
  }

  /**
   * Start the collection-summary log timer.
   * Output per-device collection statistics every COLLECTION_SUMMARY_INTERVAL_MS,
   * replacing the previous per-tag-per-cycle fine-grained logs, so ops can quickly gauge collection health.
   */
  private startCollectionSummary(): void {
    this.summaryTimer = setInterval(() => {
      this.emitCollectionSummary();
    }, COLLECTION_SUMMARY_INTERVAL_MS);
  }

  /**
   * Output the collection-summary log and reset the window counters.
   *
   * Example output format:
   *   [EnhancedScheduler] Collection summary (30s) - 2 device(s):
   *     [modbus_tcp/node(main)] device=test-device2 (deviceId=5deba4b0): tags=10, reads=300, success=298, errors=2, avgMs=12
   *     [opc_ua/worker] device=test-device1 (deviceId=abc123): tags=5, reads=150, success=150, errors=0, avgMs=8
   *
   * Skip output when there was no collection activity in the window, to avoid noise.
   */
  private emitCollectionSummary(): void {
    if (this.deviceStats.size === 0) {
      return;
    }

    const entries = Array.from(this.deviceStats.values()).filter((s) => s.reads > 0);
    if (entries.length === 0) {
      return;
    }

    const intervalSec = Math.round(COLLECTION_SUMMARY_INTERVAL_MS / 1000);
    const lines = entries.map((s) => {
      const processName = this.resolveProcessName(s.protocol);
      const avgMs = s.reads > 0 ? Math.round(s.totalDurationMs / s.reads) : 0;
      return `  [${s.protocol}/${processName}] device=${s.deviceName}: tags=${s.tagCount}, reads=${s.reads}, success=${s.successCount}, errors=${s.errorCount}, avgMs=${avgMs}`;
    });

    this.logger.log(
      `Collection summary (${intervalSec}s) — ${entries.length} device(s):\n${lines.join('\n')}`,
    );

    // Reset window counters (keep protocol/deviceName/tagCount, as these are current state, not window deltas)
    for (const s of this.deviceStats.values()) {
      s.reads = 0;
      s.successCount = 0;
      s.errorCount = 0;
      s.totalDurationMs = 0;
    }
  }

  /**
   * Derive the process name from the protocol (consistent with PluginManagerService).
   * - in_process   -> node (main: ${protocol})
   * - worker_thread-> worker (${protocol})
   * - child_process-> ss-collector-${protocol}[.exe]
   * Returns 'unknown' if pluginRegistry is un-injected or the protocol is unregistered.
   */
  private resolveProcessName(protocol: string): string {
    if (!this.pluginRegistry || !protocol) {
      return 'unknown';
    }
    const plugin = this.pluginRegistry.getPlugin(protocol);
    const mode = plugin?.meta?.isolationMode ?? IsolationMode.IN_PROCESS;
    switch (mode) {
      case IsolationMode.WORKER_THREAD:
        return `worker (${protocol})`;
      case IsolationMode.CHILD_PROCESS:
        return process.platform === 'win32'
          ? `ss-collector-${protocol}.exe`
          : `ss-collector-${protocol}`;
      case IsolationMode.IN_PROCESS:
      default:
        return `node (main: ${protocol})`;
    }
  }

  /**
   * Get or create the collection-statistics record for a device.
   * - protocol/deviceName derived from the task context and fixed at registration (immutable)
   * - tagCount maintained by registerTask/unregisterTask
   * - reads/success/error/duration accumulated by handlePipelineResult/handleTaskError
   */
  private ensureDeviceStats(task: AcquisitionTask): DeviceCycleStats {
    let stats = this.deviceStats.get(task.deviceId);
    if (!stats) {
      stats = {
        protocol: task.deviceClient?.protocol || 'unknown',
        deviceName: task.tagConfig?.deviceName || task.deviceClient?.name || task.deviceId,
        tagCount: 0,
        reads: 0,
        successCount: 0,
        errorCount: 0,
        totalDurationMs: 0,
      };
      this.deviceStats.set(task.deviceId, stats);
    }
    return stats;
  }

  private async executeNextBatch(): Promise<void> {
    if (this.runningTasksCount >= this.config.maxConcurrentTasks) {
      return;
    }

    const readyTasks = this.getReadyTasks()
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.config.maxConcurrentTasks - this.runningTasksCount);

    for (const task of readyTasks) {
      if (!task.enabled) continue;

      if (this.isCircuitOpen(task.deviceId)) {
        continue;
      }

      this.runningTasksCount++;
      task.lastExecution = new Date();

      this.executeTask(task).finally(() => {
        this.runningTasksCount--;
      });
    }
  }

  /** P3 optimization: ready-task cache - avoids O(n) scans 100 times/sec (20 times/sec after 10ms -> 50ms) */
  private readyTasksCache: AcquisitionTask[] | null = null;
  private readyTasksCacheAt: number = 0;

  private getReadyTasks(): AcquisitionTask[] {
    const now = Date.now();

    // P3 optimization: return cache within the same millisecond (avoid repeated O(n) scans on rapid consecutive calls)
    if (this.readyTasksCache && this.readyTasksCacheAt === now) {
      return this.readyTasksCache;
    }

    const tasks = Array.from(this.tasks.values());
    const ready: AcquisitionTask[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!task.enabled || !task.lastExecution) continue;
      if (now - task.lastExecution.getTime() >= task.interval) {
        ready.push(task);
      }
    }

    this.readyTasksCache = ready;
    this.readyTasksCacheAt = now;
    return ready;
  }

  private async executeTask(task: AcquisitionTask): Promise<void> {
    const startTime = Date.now();

    try {
      const initialCtx: PipelineContext = {
        tagId: task.tagId,
        deviceId: task.deviceId,
        projectId: task.tagConfig.projectId || 'default',
        deviceCode: task.tagConfig?.deviceCode || task.deviceClient?.deviceCode,
        tagName: task.tagConfig?.name,
        deviceName: task.tagConfig?.deviceName || task.deviceClient?.name,
        tagConfig: task.tagConfig,
        deviceClient: task.deviceClient,
        deviceType: task.deviceClient?.protocol || undefined,
        deviceConnection: task.deviceClient?.connection || undefined,
        rawValue: undefined,
        transformedValue: undefined,
        quality: 'unknown',
        shouldPersist: true,
        shouldPublish: true,
        startTime: Date.now(),
        errors: [],
      };

      // Prefer delegating execution to PipelineOrchestrator (auto-records step duration, error rate, flame-graph breakdown, etc.)
      // If orchestrator is un-injected (e.g. unit-test scenario), fall back to iterating steps directly
      const ctx = this.orchestrator
        ? await this.orchestrator.execute(initialCtx)
        : await this.executeStepsFallback(initialCtx);

      const durationMs = Date.now() - startTime;
      this.handlePipelineResult(task, ctx, durationMs);

      task.retryCount = 0;
      this.recordSuccess(durationMs);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.handleTaskError(task, error as Error, durationMs);
    }
  }

  /**
   * Fallback execution path: iterate pipelineSteps directly (without going through orchestrator).
   * Used only when orchestrator is un-injected; preserves the original behavior.
   */
  private async executeStepsFallback(initialCtx: PipelineContext): Promise<PipelineContext> {
    let ctx = initialCtx;
    for (const step of this.pipelineSteps) {
      ctx = await step.process(ctx);
    }
    return ctx;
  }

  private handlePipelineResult(
    task: AcquisitionTask,
    ctx: PipelineContext,
    durationMs: number,
  ): void {
    const deviceId = task.deviceId;

    // Accumulate collection metrics per device (for the periodic summary log)
    // - comm_error / bad: count as errorCount
    // - good / out_of_range: count as successCount (out_of_range still means the comm link is healthy)
    const stats = this.ensureDeviceStats(task);
    stats.reads++;
    stats.totalDurationMs += durationMs;
    const isCommOk = ctx.quality !== 'comm_error' && ctx.quality !== 'bad';
    if (isCommOk) {
      stats.successCount++;
    } else {
      stats.errorCount++;
    }

    if (ctx.quality === 'comm_error') {
      this.handleCommError(deviceId, task, ctx);
    } else if (ctx.quality === 'bad') {
      this.handleDataError(deviceId, task, ctx);
    } else if (ctx.quality === 'out_of_range') {
      this.handleOutOfRange(deviceId, task, ctx);
    } else {
      // Collection success: reset circuit breaker + emit online event (throttled)
      this.handleCommSuccess(deviceId, task);
    }
  }

  /**
   * Collection-success handling: reset the circuit breaker and emit the device_status_changed { status: 'online' } event.
   *
   * The event uses adaptive throttling - throttle interval = min(scanRate, 30s):
   * - High-frequency tasks (e.g. 100ms): throttled by scanRate, to avoid flooding EventBus
   * - Low-frequency tasks (e.g. 60s): throttled by the 30s cap, to avoid device status going stale too long
   * DeviceCollectorBootstrap receives the event and updates deviceStatusMap's status and lastHeartbeat.
   */
  private handleCommSuccess(deviceId: string, task: AcquisitionTask): void {
    this.resetDeviceFailure(deviceId);

    // Prefer DeviceStateManager (unified state management)
    if (this.deviceStateManager) {
      this.deviceStateManager.setOnline(deviceId);
      return;
    }

    // Fallback: notify via EventBus (old path, to be removed later)
    if (this.eventBus) {
      const now = Date.now();
      const lastEmit = this.lastOnlineEmitAt.get(deviceId) || 0;
      // Adaptive throttle: min(scanRate, 30s), ensuring low-frequency device status does not expire
      const throttleMs = Math.min(
        task.interval > 0 ? task.interval : 1000,
        MAX_ONLINE_EMIT_INTERVAL_MS,
      );

      if (now - lastEmit >= throttleMs) {
        this.lastOnlineEmitAt.set(deviceId, now);
        if (!lastEmit) {
          this.logger.log(`Device ${deviceId}: first successful read → emitting online event`);
        }
        this.eventBus.emitDeviceStatusChanged({
          deviceId,
          projectId: task.tagConfig?.projectId || '',
          status: 'online',
          timestamp: now,
        });
      }
    } else {
      this.logger.warn(
        `Device ${deviceId} read success but eventBus is not available — device_status_changed NOT emitted`,
      );
    }
  }

  private handleCommError(deviceId: string, task: AcquisitionTask, ctx: PipelineContext): void {
    const circuit = this.getOrCreateCircuit(deviceId);
    circuit.failureCount++;
    circuit.lastFailureTime = new Date();

    // P1 optimization: only one comm-error warn per device within 5s
    if (this.shouldLogError(deviceId)) {
      this.logger.warn(
        `Comm error for device ${deviceId} (${circuit.failureCount}/${this.config.circuitFailureThreshold}): ` +
          `${ctx.errors[0]?.message}`,
      );
    }

    if (this.metricsCollector) {
      this.metricsCollector.increment('collector.comm.error', 1, [
        { key: 'deviceId', value: deviceId },
      ]);
    }

    // Prefer DeviceStateManager
    if (this.deviceStateManager) {
      this.deviceStateManager.setError(deviceId, ctx.errors[0]?.message);
      // Push collection diagnostic data
      this.deviceStateManager.setDiagnostics(deviceId, {
        circuitState: circuit.state,
        consecutiveFailures: circuit.failureCount,
        lastErrorAt: circuit.lastFailureTime.getTime(),
      });
    } else if (this.eventBus) {
      this.eventBus.emitDeviceStatusChanged({
        deviceId,
        projectId: task.tagConfig?.projectId || '',
        status: 'error',
        errorMessage: ctx.errors[0]?.message,
        timestamp: Date.now(),
      });
    }

    if (circuit.failureCount >= this.config.circuitFailureThreshold) {
      this.openCircuit(deviceId);
    } else if (circuit.failureCount >= this.config.throttleFailureThreshold) {
      this.throttleDevice(deviceId);
    }
  }

  private handleDataError(deviceId: string, task: AcquisitionTask, ctx: PipelineContext): void {
    // P1 optimization: only one data-error warn per tag within 5s
    if (this.shouldLogError(`data:${task.tagId}`)) {
      this.logger.warn(
        `Data error for tag ${task.tagId}: ${ctx.errors.map((e) => e.message).join(', ')}`,
      );
    }

    if (this.metricsCollector) {
      this.metricsCollector.increment('collector.data.error', 1, [
        { key: 'deviceId', value: deviceId },
        { key: 'tagId', value: task.tagId },
      ]);
    }
  }

  private handleOutOfRange(deviceId: string, task: AcquisitionTask, ctx: PipelineContext): void {
    // P1 optimization: only one out-of-range warn per tag within 5s
    if (this.shouldLogError(`oor:${task.tagId}`)) {
      this.logger.warn(`Out of range for tag ${task.tagId}: value=${ctx.transformedValue}`);
    }

    if (this.metricsCollector) {
      this.metricsCollector.increment('collector.data.out_of_range', 1, [
        { key: 'deviceId', value: deviceId },
        { key: 'tagId', value: task.tagId },
      ]);
    }
  }

  private handleTaskError(task: AcquisitionTask, error: Error, durationMs: number): void {
    task.retryCount++;

    // Accumulate anomaly metrics per device (pipeline exception scenario, before quality evaluation)
    const stats = this.ensureDeviceStats(task);
    stats.reads++;
    stats.errorCount++;
    stats.totalDurationMs += durationMs;

    this.logger.warn(
      `Task ${task.id} failed (attempt ${task.retryCount}/${task.maxRetries}): ${error.message}`,
    );

    // Set the device error state on first failure, so the frontend notices immediately
    if (task.retryCount === 1 && this.deviceStateManager) {
      this.deviceStateManager.setError(task.deviceId, error.message);
    }

    if (this.metricsCollector) {
      this.metricsCollector.increment('collector.task.error', 1, [
        { key: 'deviceId', value: task.deviceId },
      ]);
    }

    if (task.retryCount < task.maxRetries) {
      const delay = Math.min(500 * Math.pow(2, task.retryCount), 5000);

      task._retryTimer = setTimeout(() => {
        task._retryTimer = undefined;
        this.executeTask(task).catch((err) => {
          this.logger.error(`Retry failed for task ${task.id}: ${err.message}`);
          this.recordFailure();
        });
      }, delay);
    } else {
      this.logger.error(`Task ${task.id} permanently failed after ${task.maxRetries} retries`);

      // Set the device error state (with error details)
      if (this.deviceStateManager) {
        this.deviceStateManager.setError(task.deviceId, error.message);
        const circuit = this.deviceCircuits.get(task.deviceId);
        this.deviceStateManager.setDiagnostics(task.deviceId, {
          retryCount: task.retryCount,
          circuitState: circuit?.state ?? 'closed',
          consecutiveFailures: circuit?.failureCount ?? task.retryCount,
        });
      }

      if (task.priority === TaskPriority.CRITICAL) {
        this.handleCriticalTaskFailure(task, error);
      }

      this.recordFailure();
    }
  }

  private handleCriticalTaskFailure(task: AcquisitionTask, error: Error): void {
    this.logger.error(
      `CRITICAL TASK FAILURE: ${task.id} (${task.deviceId}/${task.tagId}) - ${error.message}`,
    );

    if (this.eventBus) {
      this.eventBus.emit('processing_error', {
        taskId: task.id,
        deviceId: task.deviceId,
        tagId: task.tagId,
        error: error.message,
      });
    }
  }

  /** P1 optimization: error-log throttle - returns false for the same key within 5s (skip the log) */
  private shouldLogError(key: string): boolean {
    const now = Date.now();
    const last = this.lastErrorLogAt.get(key);
    if (last && now - last < 5000) {
      return false;
    }
    this.lastErrorLogAt.set(key, now);
    return true;
  }

  private getOrCreateCircuit(deviceId: string): DeviceCircuitState {
    if (!this.deviceCircuits.has(deviceId)) {
      this.deviceCircuits.set(deviceId, { state: 'closed', failureCount: 0 });
    }
    return this.deviceCircuits.get(deviceId)!;
  }

  private isCircuitOpen(deviceId: string): boolean {
    const circuit = this.deviceCircuits.get(deviceId);
    if (!circuit) return false;

    if (circuit.state === 'open') {
      if (circuit.openedAt) {
        const elapsed = Date.now() - circuit.openedAt.getTime();
        if (elapsed > this.config.circuitResetTimeoutMs) {
          this.logger.warn(`Circuit for device ${deviceId} auto-reset after timeout`);
          this.deviceCircuits.delete(deviceId);
          return false;
        }
      }
      return true;
    }

    return false;
  }

  private openCircuit(deviceId: string): void {
    const circuit = this.getOrCreateCircuit(deviceId);
    circuit.state = 'open';
    circuit.openedAt = new Date();

    this.logger.error(`Circuit breaker OPENED for device ${deviceId}`);

    if (this.eventBus) {
      this.eventBus.emitDeviceStatusChanged({
        deviceId,
        projectId: '',
        status: 'error',
        errorMessage: 'Too many communication errors',
        timestamp: Date.now(),
      });
    }

    if (this.metricsCollector) {
      this.metricsCollector.increment('collector.circuit.open', 1, [
        { key: 'deviceId', value: deviceId },
      ]);
    }
  }

  private throttleDevice(deviceId: string): void {
    const circuit = this.getOrCreateCircuit(deviceId);
    circuit.throttledInterval = (circuit.throttledInterval || 1) * this.config.throttleFactor;

    this.logger.warn(
      `Device ${deviceId} throttled: interval multiplier=${circuit.throttledInterval}x`,
    );

    for (const task of this.tasks.values()) {
      if (task.deviceId === deviceId) {
        task.interval = task.interval * this.config.throttleFactor;
      }
    }
  }

  private resetDeviceFailure(deviceId: string): void {
    const circuit = this.deviceCircuits.get(deviceId);
    if (circuit) {
      if (circuit.failureCount > 0) {
        this.logger.log(`Device ${deviceId} recovered, resetting failure count`);
      }
      this.deviceCircuits.delete(deviceId);
    }
  }

  private checkCircuitRecovery(): void {
    for (const [deviceId, circuit] of this.deviceCircuits) {
      if (circuit.state === 'open' && circuit.openedAt) {
        const elapsed = Date.now() - circuit.openedAt.getTime();
        if (elapsed > this.config.circuitResetTimeoutMs) {
          this.logger.warn(`Circuit for device ${deviceId} entering half-open state`);
          circuit.state = 'half-open';
          circuit.failureCount = 0;

          if (this.eventBus) {
            this.eventBus.emitDeviceStatusChanged({
              deviceId,
              projectId: '',
              status: 'connecting',
              errorMessage: 'Circuit half-open, testing connectivity',
              timestamp: Date.now(),
            });
          }
        }
      }
    }
  }

  private applyBackpressure(): void {
    this.logger.warn(
      `Applying backpressure: queue size ${this.tasks.size}/${this.config.maxQueueSize}`,
    );

    for (const [, task] of this.tasks) {
      if (task.priority < TaskPriority.NORMAL) {
        task.interval = Math.min(task.interval * 2, 60000);
        this.logger.debug(`Reduced frequency for low-priority task ${task.id}: ${task.interval}ms`);
      }
    }
  }

  private recordSuccess(executionTime: number): void {
    this.metrics.totalExecutions++;
    this.metrics.successfulExecutions++;
    this.metrics.totalExecutionTime += executionTime;
  }

  private recordFailure(): void {
    this.metrics.totalExecutions++;
    this.metrics.failedExecutions++;
  }

  resetMetrics(): void {
    this.metrics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalExecutionTime: 0,
      startTime: Date.now(),
    };
    this.logger.log('Scheduler metrics reset');
  }
}
