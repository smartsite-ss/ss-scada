// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { PluginRegistry } from '../plugin-registry';
import { IsolationMode, IsolationConfig } from '../plugin.types';
import { IIsolationExecutor } from './isolation.types';
import { InProcessExecutor } from './in-process-executor';
import { WorkerThreadExecutor } from './worker-thread-executor';
import { ChildProcessExecutor } from './child-process-executor';
import { EventBusService } from '@ss-node/ss-core';
import { PluginMonitorService } from '../plugin-monitor.service';

/**
 * Isolation executor factory - creates/retrieves the executor for a plugin config
 *
 * Design:
 * - each protocol keeps one executor instance (lazily loaded)
 * - in_process mode: InProcessExecutor invokes the adapter directly
 * - worker_thread / child_process mode: call prepare() to start ahead of time
 * - on onModuleDestroy, all executors are destroyed
 */
@Injectable()
export class IsolationFactory implements OnModuleDestroy {
  private readonly logger = new Logger(IsolationFactory.name);
  private executors = new Map<string, IIsolationExecutor>();

  constructor(
    private readonly pluginRegistry: PluginRegistry,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly pluginMonitor?: PluginMonitorService,
  ) {}

  /**
   * Get or create the isolation executor for the specified protocol
   */
  getExecutor(protocol: string): IIsolationExecutor {
    const existing = this.executors.get(protocol);
    if (existing) return existing;

    const plugin = this.pluginRegistry.getPlugin(protocol);
    const mode = plugin?.meta?.isolationMode ?? IsolationMode.IN_PROCESS;

    let executor: IIsolationExecutor;
    switch (mode) {
      case IsolationMode.WORKER_THREAD:
        executor = new WorkerThreadExecutor(this.eventBus);
        break;
      case IsolationMode.CHILD_PROCESS:
        executor = new ChildProcessExecutor(this.eventBus, this.pluginMonitor);
        break;
      case IsolationMode.IN_PROCESS:
      default: {
        const adapter = this.pluginRegistry.getAdapter(protocol);
        executor = new InProcessExecutor();
        executor.init(protocol, adapter, {});
        break;
      }
    }

    this.executors.set(protocol, executor);
    this.logger.log(`Executor created for [${protocol}]: mode=${mode}`);
    return executor;
  }

  /**
   * Pre-start the Worker/child process after plugin discovery
   * Called by PluginExplorerService after a plugin is discovered
   */
  async prepare(protocol: string): Promise<void> {
    const plugin = this.pluginRegistry.getPlugin(protocol);
    if (!plugin) return;

    const mode = plugin.meta?.isolationMode ?? IsolationMode.IN_PROCESS;
    if (mode === IsolationMode.IN_PROCESS) return; // no warm-up needed

    try {
      const executor = this.getExecutor(protocol);
      const config: Partial<IsolationConfig> = plugin.meta?.isolation || {};
      await executor.init(protocol, null, config);
    } catch (err) {
      // Initialization failure must not crash the app; later reads degrade to in-process mode
      this.logger.error(
        `Failed to prepare executor for [${protocol}]: ${(err as Error).message} — will fallback to in-process`,
      );
      // Tear down the half-started executor (kills a spawned child/worker) so it
      // does not leak outside of the executors map
      try {
        await this.executors.get(protocol)?.destroy();
      } catch {}
      this.executors.delete(protocol);
    }
  }

  /**
   * Destroy the isolation executor for the specified protocol; the next getExecutor() rebuilds it using the latest isolationMode
   */
  async destroyExecutor(protocol: string): Promise<void> {
    const executor = this.executors.get(protocol);
    if (executor) {
      try {
        await executor.destroy();
      } catch {
        // Silently handle destroy failure
      }
      this.executors.delete(protocol);
      this.logger.log(`Executor destroyed for [${protocol}], will recreate on next use`);
    }
  }

  /**
   * Get health status of all executors
   */
  async getAllHealth(): Promise<Map<string, any>> {
    const health = new Map<string, any>();
    for (const [protocol, executor] of this.executors) {
      try {
        health.set(protocol, await executor.getHealth());
      } catch {
        health.set(protocol, { status: 'error' });
      }
    }
    return health;
  }

  /**
   * Check whether the protocol uses isolation mode
   */
  isIsolated(protocol: string): boolean {
    const plugin = this.pluginRegistry.getPlugin(protocol);
    const mode = plugin?.meta?.isolationMode ?? IsolationMode.IN_PROCESS;
    return mode !== IsolationMode.IN_PROCESS;
  }

  async onModuleDestroy(): Promise<void> {
    for (const [protocol, executor] of this.executors) {
      try {
        await executor.destroy();
        this.logger.log(`Executor [${protocol}] destroyed`);
      } catch {}
    }
    this.executors.clear();
  }
}
