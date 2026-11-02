// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PluginRegistry } from './plugin-registry';
import { PluginDiscoveryService } from './plugin-discovery.service';
import { CollectorPluginMeta } from './plugin.types';
import { EventBusService } from '@ss-node/ss-core';
import { PluginLifecycleEvent } from '../events/plugin-events.types';

export interface HotReloadResult {
  protocol: string;
  oldVersion: string;
  newVersion: string;
  elapsed: number;
  success: boolean;
  error?: string;
}

export interface UpdateCheckResult {
  protocol: string;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
  updateAvailable: boolean;
}

/**
 * Plugin update service - supports hot reload, version check and rollback
 */
@Injectable()
export class PluginUpdaterService {
  private readonly logger = new Logger(PluginUpdaterService.name);
  private versionHistory = new Map<string, Array<{ version: string; adapter: any }>>();

  constructor(
    private readonly registry: PluginRegistry,
    private readonly discovery: PluginDiscoveryService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Hot-reload a plugin (zero-downtime update)
   *
   * Flow:
   *  1. Deactivate the target plugin
   *  2. Wait for active connections to close naturally (up to 30s)
   *  3. Clear the module cache
   *  4. Rediscover and load the new version
   *  5. Activate the plugin
   */
  async hotReload(protocol: string): Promise<HotReloadResult> {
    const startTime = Date.now();
    const oldPlugin = this.registry.getPlugin(protocol);
    if (!oldPlugin) {
      return {
        protocol,
        oldVersion: 'unknown',
        newVersion: 'unknown',
        elapsed: 0,
        success: false,
        error: 'Plugin not found',
      };
    }

    const oldVersion = oldPlugin.meta.version;

    // Save to version history
    this.saveVersion(protocol, oldVersion, oldPlugin.adapter);

    try {
      // 1. Deactivate
      await this.registry.deactivate(protocol);
      this.logger.log(`Plugin ${protocol} deactivated for hot reload`);

      // 2. Wait for connections to drain
      await this.drainConnections(protocol, 30000);

      // 3. Clear the Node.js module cache
      this.clearModuleCache(protocol);

      // 4. Rediscover
      const newPlugins = await this.discovery.discoverPlugins();
      const newPlugin = newPlugins.find((p) => p.meta.protocol === protocol);
      if (!newPlugin) throw new Error(`Plugin ${protocol} not found after reload`);

      // 5. Re-register
      this.registry.register(newPlugin.meta, newPlugin.adapter || oldPlugin.adapter);
      await this.registry.activate(protocol);

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `Plugin ${protocol} hot reloaded: ${oldVersion} → ${newPlugin.meta.version} (${elapsed}ms)`,
      );

      this.emitUpdated(newPlugin.meta, oldVersion);

      return {
        protocol,
        oldVersion,
        newVersion: newPlugin.meta.version,
        elapsed,
        success: true,
      };
    } catch (error) {
      // Rollback
      this.registry.register(oldPlugin.meta, oldPlugin.adapter);
      await this.registry.activate(protocol);
      this.logger.error(
        `Plugin ${protocol} hot reload failed, rolled back: ${(error as Error).message}`,
      );

      return {
        protocol,
        oldVersion,
        newVersion: oldVersion,
        elapsed: Date.now() - startTime,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Roll back to the previous version
   */
  async rollback(protocol: string): Promise<HotReloadResult> {
    const history = this.versionHistory.get(protocol);
    if (!history || history.length === 0) {
      return {
        protocol,
        oldVersion: 'unknown',
        newVersion: 'unknown',
        elapsed: 0,
        success: false,
        error: 'No version history available',
      };
    }

    const prev = history.pop()!;
    const current = this.registry.getPlugin(protocol);
    const oldVersion = current?.meta.version || 'unknown';

    if (current) {
      this.registry.register({ ...current.meta, version: prev.version }, prev.adapter);
      await this.registry.activate(protocol);
      this.logger.log(`Plugin ${protocol} rolled back to v${prev.version}`);
    }

    return {
      protocol,
      oldVersion,
      newVersion: prev.version,
      elapsed: 0,
      success: true,
    };
  }

  /**
   * Check whether a plugin has an available update
   */
  async checkUpdate(protocol: string): Promise<UpdateCheckResult | null> {
    const installed = this.registry.getPlugin(protocol);
    if (!installed) return null;

    try {
      const pkgName = `@ss-node/ss-collector-${protocol}`;
      const response = await fetch(`https://npm.ss-data.local/${pkgName}/latest`);

      if (!response.ok) return null;

      const latest = await response.json();

      if (latest.version !== installed.meta.version) {
        return {
          protocol,
          currentVersion: installed.meta.version,
          latestVersion: latest.version,
          changelog: latest.changelog,
          updateAvailable: true,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async drainConnections(protocol: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const plugin = this.registry.getPlugin(protocol);
    if (!plugin) return;

    while (Date.now() < deadline) {
      if (plugin.metrics.activeConnections === 0) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    this.logger.warn(`Plugin ${protocol} drain timeout, forcing reload`);
  }

  private clearModuleCache(protocol: string): void {
    try {
      const pkgName = `@ss-node/ss-collector-${protocol}`;
      const cacheKey = require.resolve(pkgName);
      if (cacheKey) {
        delete require.cache[cacheKey];
        this.logger.debug(`Cleared module cache for ${pkgName}`);
      }
    } catch {
      this.logger.debug(`No module cache to clear for ${protocol}`);
    }
  }

  private saveVersion(protocol: string, version: string, adapter: any): void {
    const history = this.versionHistory.get(protocol) || [];
    history.push({ version, adapter });
    if (history.length > 5) history.shift(); // keep only the 5 most recent versions
    this.versionHistory.set(protocol, history);
  }

  private emitUpdated(meta: CollectorPluginMeta, oldVersion: string): void {
    try {
      const event: PluginLifecycleEvent = {
        protocol: meta.protocol,
        displayName: meta.displayName,
        version: meta.version,
        category: meta.category,
        status: 'active',
        oldVersion,
        newVersion: meta.version,
        timestamp: Date.now(),
      };
      this.eventBus?.emit('plugin.updated', event);
    } catch {
      // Event dispatch failure must not affect the core plugin hot-update logic
    }
  }
}
