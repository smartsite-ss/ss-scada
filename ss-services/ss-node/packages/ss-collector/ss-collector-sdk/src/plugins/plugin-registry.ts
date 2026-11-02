// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { EventBusService } from '@ss-node/ss-core';
import { PluginLifecycleEvent } from '../events/plugin-events.types';
import { IProtocolAdapter } from '../types';
import { CollectorPluginMeta, RegisteredPlugin, PluginMetrics, PluginFilter } from './plugin.types';
import { PluginConfigService } from './plugin-config.service';

@Injectable()
export class PluginRegistry {
  private readonly logger = new Logger(PluginRegistry.name);
  private plugins = new Map<string, RegisteredPlugin>();

  constructor(
    @Optional() private readonly eventBus?: EventBusService,
    @Optional()
    @Inject(forwardRef(() => PluginConfigService))
    private readonly configService?: PluginConfigService,
  ) {}

  /**
   * Register a collection plugin
   */
  register(meta: CollectorPluginMeta, adapter: IProtocolAdapter): void {
    const protocol = meta.protocol.toLowerCase();

    if (this.plugins.has(protocol)) {
      this.logger.warn(
        `Plugin ${protocol} already registered (v${this.plugins.get(protocol)!.meta.version}), ` +
          `replacing with v${meta.version}`,
      );
    }

    const plugin: RegisteredPlugin = {
      meta,
      adapter,
      status: 'registered',
      registeredAt: new Date(),
      metrics: this.createEmptyMetrics(),
    };

    this.plugins.set(protocol, plugin);
    this.logger.log(`Plugin registered: ${meta.displayName} (${meta.protocol} v${meta.version})`);

    this.emitEvent('plugin.registered', {
      protocol: meta.protocol,
      displayName: meta.displayName,
      version: meta.version,
      category: meta.category,
      status: 'registered',
      timestamp: Date.now(),
    });
  }

  /**
   * Activate a plugin (make it available for collection)
   */
  async activate(protocol: string): Promise<void> {
    const plugin = this.getRequired(protocol);
    const previousStatus = plugin.status;
    plugin.status = 'active';
    plugin.activatedAt = new Date();
    this.logger.log(`Plugin activated: ${protocol}`);

    // Persist the activation state so it auto-restores after restart
    try {
      this.configService?.setActivated(protocol, true);
    } catch (err) {
      this.logger.warn(
        `Failed to persist activation state for "${protocol}": ${(err as Error).message}`,
      );
    }

    // Call the adapter's onActivate lifecycle hook (independent of device loading)
    try {
      if (typeof plugin.adapter?.onActivate === 'function') {
        this.logger.log(`Calling adapter.onActivate() for plugin "${protocol}"...`);
        await plugin.adapter.onActivate();
        this.logger.log(`Adapter.onActivate() completed for plugin "${protocol}"`);
      } else {
        this.logger.warn(`Adapter for plugin "${protocol}" does not implement onActivate()`);
      }
    } catch (err) {
      this.logger.error(
        `Adapter.onActivate() failed for plugin "${protocol}": ${(err as Error).message}`,
      );
      // Activation failure must not block the plugin status change - the status is already set to active,
      // but log the error for troubleshooting
    }

    this.emitEvent('plugin.activated', {
      protocol: plugin.meta.protocol,
      displayName: plugin.meta.displayName,
      version: plugin.meta.version,
      category: plugin.meta.category,
      status: 'active',
      previousStatus,
      timestamp: Date.now(),
    });
  }

  /**
   * Deactivate a plugin
   */
  async deactivate(protocol: string): Promise<void> {
    const plugin = this.getRequired(protocol);
    const previousStatus = plugin.status;
    plugin.status = 'inactive';
    this.logger.log(`Plugin deactivated: ${protocol}`);

    // Persist the deactivation state so it will not auto-activate after restart
    try {
      this.configService?.setActivated(protocol, false);
    } catch (err) {
      this.logger.warn(
        `Failed to persist deactivation state for "${protocol}": ${(err as Error).message}`,
      );
    }

    // Call the adapter's onDeactivate lifecycle hook
    try {
      if (typeof plugin.adapter?.onDeactivate === 'function') {
        await plugin.adapter.onDeactivate();
      }
    } catch (err) {
      this.logger.error(
        `Adapter.onDeactivate() failed for plugin "${protocol}": ${(err as Error).message}`,
      );
    }

    this.emitEvent('plugin.deactivated', {
      protocol: plugin.meta.protocol,
      displayName: plugin.meta.displayName,
      version: plugin.meta.version,
      category: plugin.meta.category,
      status: 'inactive',
      previousStatus,
      timestamp: Date.now(),
    });
  }

  /**
   * Unregister a plugin
   */
  unregister(protocol: string): void {
    const plugin = this.plugins.get(protocol.toLowerCase());
    this.plugins.delete(protocol.toLowerCase());
    this.logger.log(`Plugin unregistered: ${protocol}`);

    if (plugin) {
      this.emitEvent('plugin.unregistered', {
        protocol: plugin.meta.protocol,
        displayName: plugin.meta.displayName,
        version: plugin.meta.version,
        category: plugin.meta.category,
        status: 'unregistered',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Mark a plugin as error state
   */
  markError(protocol: string, errorMessage: string): void {
    const plugin = this.plugins.get(protocol.toLowerCase());
    if (!plugin) return;
    const previousStatus = plugin.status;
    plugin.status = 'error';
    plugin.errorMessage = errorMessage;
    this.logger.error(`Plugin error: ${protocol} - ${errorMessage}`);

    this.emitEvent('plugin.error', {
      protocol: plugin.meta.protocol,
      displayName: plugin.meta.displayName,
      version: plugin.meta.version,
      category: plugin.meta.category,
      status: 'error',
      previousStatus,
      errorMessage,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit a plugin lifecycle event
   */
  private emitEvent(
    eventType:
      | 'plugin.registered'
      | 'plugin.activated'
      | 'plugin.deactivated'
      | 'plugin.unregistered'
      | 'plugin.error',
    event: PluginLifecycleEvent,
  ): void {
    try {
      this.eventBus?.emit(eventType, event);
    } catch {
      // Event dispatch failure must not affect the core plugin management logic
    }
  }

  /**
   * Get the adapter for the specified protocol
   */
  getAdapter(protocol: string): IProtocolAdapter {
    const plugin = this.getRequired(protocol);
    if (plugin.status !== 'active' && plugin.status !== 'registered') {
      throw new Error(`Plugin is not active: ${protocol}`);
    }
    return plugin.adapter;
  }

  /**
   * Get plugin details
   */
  getPlugin(protocol: string): RegisteredPlugin | undefined {
    return this.plugins.get(protocol.toLowerCase());
  }

  /**
   * Get all registered plugins
   */
  listPlugins(filter?: PluginFilter): RegisteredPlugin[] {
    let plugins = Array.from(this.plugins.values());
    if (filter?.status) {
      plugins = plugins.filter((p) => p.status === filter.status);
    }
    if (filter?.category) {
      plugins = plugins.filter((p) => p.meta.category === filter.category);
    }
    return plugins;
  }

  /**
   * Get all supported protocol types
   */
  getSupportedProtocols(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Check whether a protocol is supported
   */
  isSupported(protocol: string): boolean {
    return this.plugins.has(protocol.toLowerCase());
  }

  /**
   * Get the plugin count
   */
  get count(): number {
    return this.plugins.size;
  }

  private getRequired(protocol: string): RegisteredPlugin {
    const plugin = this.plugins.get(protocol.toLowerCase());
    if (!plugin) {
      throw new Error(`Plugin not found for protocol: ${protocol}`);
    }
    return plugin;
  }

  private createEmptyMetrics(): PluginMetrics {
    return {
      totalConnections: 0,
      activeConnections: 0,
      totalReads: 0,
      totalErrors: 0,
      avgResponseTime: 0,
      uptime: 0,
      lastActivity: null,
    };
  }
}
