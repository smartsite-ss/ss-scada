// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PluginRegistry } from './plugin-registry';
import { PluginDiscoveryService } from './plugin-discovery.service';
import { PluginUpdaterService } from './plugin-updater.service';
import { PluginConfigService, PluginRuntimeConfig } from './plugin-config.service';
import {
  RegisteredPlugin,
  PluginMetrics,
  ACTIVE_DEVICE_TRACKER,
  IActiveDeviceTracker,
  ActiveDeviceInfo,
  DeviceStats,
} from './plugin.types';
import { ChannelValidationResult } from '../types';
import { PluginMonitorService, MonitorData, ClearLogsResult } from './plugin-monitor.service';
import { IsolationFactory } from './isolation/isolation-factory';
import type { PipelineMetricsService } from '../pipeline/pipeline-metrics.service';

export interface PluginInfo {
  protocol: string;
  displayName: string;
  version: string;
  description: string;
  category: string;
  transport: string;
  status: string;
  isolationMode: string;
  supportedDataTypes: string[];
  defaultConnection: Record<string, any>;
  icon?: string;
  metrics: PluginMetrics;
  registeredAt: string;
  activatedAt?: string;
  /** Runtime process name (child_process / in_process mode) */
  processName?: string;
  /** Runtime process PID (child_process / in_process mode) */
  processId?: number;
  /** Runtime thread ID (worker_thread mode only) */
  threadId?: number;
}

export interface PluginStatus {
  protocol: string;
  status: string;
  uptime: number;
  metrics: PluginMetrics;
  registeredAt: string;
  activatedAt?: string;
}

export interface PluginHealthReport {
  totalPlugins: number;
  activePlugins: number;
  results: PluginHealthResult[];
}

export interface PluginHealthResult {
  protocol: string;
  status: 'healthy' | 'unhealthy';
  message: string;
}

/**
 * Plugin management service - business orchestration for the Controller layer
 */
@Injectable()
export class PluginManagerService {
  private readonly logger = new Logger(PluginManagerService.name);

  /** PipelineMetricsService instance (injected by PipelineInitializer via setter) */
  private pipelineMetricsService?: PipelineMetricsService;

  constructor(
    private readonly registry: PluginRegistry,
    private readonly discovery: PluginDiscoveryService,
    private readonly updater: PluginUpdaterService,
    private readonly monitor: PluginMonitorService,
    private readonly configService: PluginConfigService,
    @Optional() private readonly isolationFactory?: IsolationFactory,
    @Optional()
    @Inject(forwardRef(() => ACTIVE_DEVICE_TRACKER))
    private readonly activeDeviceTracker?: IActiveDeviceTracker,
  ) {}

  /**
   * Inject PipelineMetricsService (called by PipelineInitializer.onModuleInit)
   *
   * Uses the setter-injection pattern to avoid a static PluginModule dependency on PipelineModule,
   * consistent with EnhancedScheduler.setPipelineMetricsService().
   */
  setPipelineMetricsService(service: PipelineMetricsService): void {
    this.pipelineMetricsService = service;
  }

  listPlugins(filter?: { status?: string; category?: string }): PluginInfo[] {
    return this.registry.listPlugins(filter as any).map((p) => this.toPluginInfo(p));
  }

  /**
   * Get the plugin list (including runtime process/thread info and real Pipeline metrics)
   *
   * In isolation mode, the child-process PID or thread ID is taken from the executor;
   * in in_process mode, the main-process info is returned.
   * Real collection metrics grouped by protocol are also merged in from PipelineMetricsService.
   */
  async listPluginsWithRuntime(filter?: {
    status?: string;
    category?: string;
  }): Promise<PluginInfo[]> {
    const plugins = this.listPlugins(filter);
    if (!this.isolationFactory) return plugins;

    // Merge real Pipeline collection metrics (injected by PipelineInitializer via setter)
    const metricsService = this.pipelineMetricsService;

    const results = await Promise.all(
      plugins.map(async (plugin) => {
        // Merge real Pipeline metrics
        if (metricsService) {
          const realMetrics = metricsService.getProtocolMetrics(plugin.protocol);
          if (realMetrics) {
            plugin.metrics = {
              ...plugin.metrics,
              totalConnections: realMetrics.totalConnections,
              activeConnections: realMetrics.activeConnections,
              totalReads: realMetrics.totalReads,
              totalErrors: realMetrics.totalErrors,
              avgResponseTime: realMetrics.avgResponseTime,
              lastActivity: realMetrics.lastActivity,
            };
          }
        }

        if (plugin.isolationMode === 'in_process') {
          plugin.processName = `node (main: ${plugin.protocol})`;
          plugin.processId = process.pid;
          return plugin;
        }
        try {
          const executor = this.isolationFactory!.getExecutor(plugin.protocol);
          const health = await executor.getHealth();
          if (health.pid) {
            plugin.processId = health.pid;
            // Consistent with ensureNodeExe: on Windows it is ss-collector-{protocol}.exe
            const isWin = process.platform === 'win32';
            plugin.processName = isWin
              ? `ss-collector-${plugin.protocol}.exe`
              : `ss-collector-${plugin.protocol}`;
          }
          if (health.threadId) {
            plugin.threadId = health.threadId;
            plugin.processName = `worker (${plugin.protocol})`;
          }
        } catch {
          // Executor not yet started, keep undefined
        }
        return plugin;
      }),
    );
    return results;
  }

  getPlugin(protocol: string): PluginInfo | null {
    const plugin = this.registry.getPlugin(protocol);
    return plugin ? this.toPluginInfo(plugin) : null;
  }

  async activate(protocol: string): Promise<PluginInfo> {
    await this.registry.activate(protocol);
    return this.getPlugin(protocol)!;
  }

  async deactivate(protocol: string): Promise<PluginInfo> {
    await this.registry.deactivate(protocol);
    return this.getPlugin(protocol)!;
  }

  async rediscover(): Promise<PluginInfo[]> {
    await this.discovery.discoverPlugins();
    return this.listPlugins();
  }

  async hotReload(protocol: string) {
    return this.updater.hotReload(protocol);
  }

  /**
   * Restart a plugin (used for config changes such as isolation mode that require reinitializing the executor)
   *
   * Flow: deactivate -> destroy old executor -> activate
   * the next getExecutor() creates a fresh executor using the latest isolationMode
   */
  async restartPlugin(
    protocol: string,
  ): Promise<{ protocol: string; isolationMode: string; elapsed: number }> {
    const start = Date.now();
    const plugin = this.registry.getPlugin(protocol);
    if (!plugin) throw new Error(`Plugin not found: ${protocol}`);

    const wasActive = plugin.status === 'active';
    const newMode = plugin.meta.isolationMode ?? 'in_process';

    this.logger.log(`Restarting plugin "${protocol}" (wasActive=${wasActive}, mode=${newMode})`);

    // 1. Deactivate
    if (wasActive) {
      await this.deactivate(protocol);
    }

    // 2. Destroy the old isolation executor, ensuring a rebuild with the new mode next time
    if (this.isolationFactory) {
      await this.isolationFactory.destroyExecutor(protocol);
    }

    // 3. Reactivate
    if (wasActive) {
      await this.activate(protocol);
    }

    const elapsed = Date.now() - start;
    this.logger.log(`Plugin "${protocol}" restarted in ${elapsed}ms (mode=${newMode})`);
    return { protocol, isolationMode: newMode, elapsed };
  }

  async checkUpdate(protocol: string) {
    return this.updater.checkUpdate(protocol);
  }

  async rollback(protocol: string) {
    return this.updater.rollback(protocol);
  }

  getPluginStatus(protocol: string): PluginStatus {
    const plugin = this.registry.getPlugin(protocol);
    if (!plugin) throw new Error(`Plugin not found: ${protocol}`);

    return {
      protocol,
      status: plugin.status,
      uptime: plugin.metrics.uptime,
      metrics: plugin.metrics,
      registeredAt:
        plugin.registeredAt instanceof Date
          ? plugin.registeredAt.toISOString()
          : String(plugin.registeredAt),
      activatedAt:
        plugin.activatedAt instanceof Date
          ? plugin.activatedAt.toISOString()
          : plugin.activatedAt
            ? String(plugin.activatedAt)
            : undefined,
    };
  }

  async healthCheck(): Promise<PluginHealthReport> {
    const activePlugins = this.registry.listPlugins({ status: 'active' });
    const results: PluginHealthResult[] = [];

    for (const plugin of activePlugins) {
      try {
        results.push({
          protocol: plugin.meta.protocol,
          status: 'healthy',
          message: 'OK',
        });
      } catch (error) {
        results.push({
          protocol: plugin.meta.protocol,
          status: 'unhealthy',
          message: String(error),
        });
      }
    }

    return {
      totalPlugins: this.registry.listPlugins().length,
      activePlugins: activePlugins.length,
      results,
    };
  }

  getConnectionSchema(protocol: string): Record<string, any> | null {
    const plugin = this.registry.getPlugin(protocol);
    return plugin?.meta.connectionSchema ?? null;
  }

  /** Call the collection plugin's validateChannelConfig() to validate the channel config */
  async validateChannelConfig(
    protocol: string,
    config: Record<string, any>,
  ): Promise<ChannelValidationResult> {
    const adapter = this.registry.getAdapter(protocol);
    return adapter.validateChannelConfig(config);
  }

  /** Get the active device list currently being collected by the plugin */
  getPluginActiveDevices(protocol: string): ActiveDeviceInfo[] {
    if (!this.activeDeviceTracker) {
      return [];
    }
    const deviceIds = this.activeDeviceTracker.getActiveDeviceIds(protocol);
    return deviceIds
      .map((id) => this.activeDeviceTracker!.getActiveDeviceInfo(id))
      .filter(Boolean) as ActiveDeviceInfo[];
  }

  /** Get device statistics for all plugins (online/offline counts) */
  getAllDeviceStats(): Record<string, DeviceStats> {
    const result: Record<string, DeviceStats> = {};
    if (!this.activeDeviceTracker) {
      this.logger.warn('getAllDeviceStats: activeDeviceTracker is not injected (DI issue)');
      return result;
    }
    const plugins = this.registry.listPlugins();
    for (const plugin of plugins) {
      const stats = this.activeDeviceTracker.getDeviceStats(plugin.meta.protocol);
      result[plugin.meta.protocol] = stats;
      this.logger.debug(
        `Device stats for "${plugin.meta.protocol}": total=${stats.total} online=${stats.online} offline=${stats.offline} error=${stats.error}`,
      );
    }
    return result;
  }

  /**
   * Get plugin runtime monitoring data (memory/CPU + collection logs)
   *
   * In isolation mode, the real PID and runtime metrics are taken from the child-process executor;
   * in in_process mode, the main-process metrics are returned.
   */
  async getMonitorData(protocol: string): Promise<MonitorData> {
    const plugin = this.registry.getPlugin(protocol);
    const isolationMode = plugin?.meta?.isolationMode ?? 'in_process';
    const data = this.monitor.getMonitorData(protocol, isolationMode);

    // Isolation mode: get the real child-process PID/thread ID and runtime metrics from the executor
    if (this.isolationFactory && isolationMode !== 'in_process') {
      try {
        const executor = this.isolationFactory.getExecutor(protocol);
        const health = await executor.getHealth();
        if (health.pid) {
          data.processId = health.pid;
          // Consistent with the actual execPath: on Windows it is ss-collector-{protocol}.exe, on Linux/macOS it is node
          const isWin = process.platform === 'win32';
          data.processName = isWin ? `ss-collector-${protocol}.exe` : `ss-collector-${protocol}`;
        }
        if (health.threadId) {
          data.threadId = health.threadId;
          data.processName = `worker (${protocol})`;
        }
        // Override with the executor's runtime stats (requestCount/errorCount/uptime are more accurate)
        if (health.uptime) {
          data.metrics.uptime = Math.round(health.uptime / 1000);
        }
      } catch {
        // Executor not started or already destroyed, keep the main-process data
      }
    }

    return data;
  }

  /** Clear plugin collection logs */
  clearPluginLogs(protocol: string): ClearLogsResult {
    return this.monitor.clearLogs(protocol);
  }

  /** Write collection logs */
  writePluginLog(
    protocol: string,
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
    message: string,
  ): void {
    this.monitor.writeLog(protocol, level, message);
  }

  // -----------------------------------------------------------------------
  //  Runtime config persistence (isolation mode, etc.)
  // -----------------------------------------------------------------------

  /** Get plugin runtime config */
  getPluginConfig(protocol: string): PluginRuntimeConfig {
    return this.configService.getConfig(protocol);
  }

  /**
   * Update plugin runtime config
   *
   * - persist to a JSON file on disk
   * - if isolationMode changed, sync the in-memory meta so the next readTag takes effect
   * - if the plugin is already active and the mode changed to worker_thread/child_process, isolation must be restarted
   */
  async updatePluginConfig(
    protocol: string,
    partial: Partial<PluginRuntimeConfig>,
  ): Promise<PluginRuntimeConfig> {
    const merged = this.configService.saveConfig(protocol, partial);
    const plugin = this.registry.getPlugin(protocol);

    // Sync the in-memory meta so ProtocolReadStep reads the latest isolationMode
    if (plugin && merged.isolationMode) {
      (plugin.meta as any).isolationMode = merged.isolationMode;
      this.logger.log(
        `Plugin "${protocol}" isolationMode updated in-memory → ${merged.isolationMode}`,
      );
    }

    return merged;
  }

  /** Convenience method: set the plugin isolation mode */
  async setPluginIsolationMode(protocol: string, mode: string): Promise<PluginRuntimeConfig> {
    return this.updatePluginConfig(protocol, { isolationMode: mode });
  }

  private toPluginInfo(plugin: RegisteredPlugin): PluginInfo {
    return {
      protocol: plugin.meta.protocol,
      displayName: plugin.meta.displayName,
      version: plugin.meta.version,
      description: plugin.meta.description,
      category: plugin.meta.category,
      transport: plugin.meta.transport,
      status: plugin.status,
      isolationMode: plugin.meta.isolationMode ?? 'in_process',
      supportedDataTypes: plugin.meta.supportedDataTypes,
      defaultConnection: plugin.meta.defaultConnection,
      icon: plugin.meta.icon,
      metrics: plugin.metrics,
      registeredAt:
        plugin.registeredAt instanceof Date
          ? plugin.registeredAt.toISOString()
          : String(plugin.registeredAt),
      activatedAt:
        plugin.activatedAt instanceof Date
          ? plugin.activatedAt.toISOString()
          : plugin.activatedAt
            ? String(plugin.activatedAt)
            : undefined,
    };
  }
}
