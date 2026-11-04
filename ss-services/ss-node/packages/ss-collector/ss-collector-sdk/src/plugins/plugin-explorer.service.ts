// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, OnModuleInit, Logger, Optional, Inject } from '@nestjs/common';
import { COLLECTOR_PLUGIN_META } from './plugin.decorator';
import { PluginRegistry } from './plugin-registry';
import { EventBusService } from '@ss-node/ss-core';
import { PluginLifecycleEvent } from '../events/plugin-events.types';
import { IProtocolAdapter } from '../types';
import { CollectorPluginMeta, IProviderScanner, PROVIDER_SCANNER } from './plugin.types';
import { IsolationFactory } from './isolation/isolation-factory';
import { PluginConfigService } from './plugin-config.service';

/**
 * Plugin explorer - scans all NestJS Providers decorated with @CollectorPlugin and auto-registers them
 */
@Injectable()
export class PluginExplorerService implements OnModuleInit {
  private readonly logger = new Logger(PluginExplorerService.name);

  constructor(
    private readonly registry: PluginRegistry,
    @Inject(PROVIDER_SCANNER) private readonly providerScanner: IProviderScanner,
    private readonly configService: PluginConfigService,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly isolationFactory?: IsolationFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.exploreAndRegister();
  }

  private async exploreAndRegister(): Promise<void> {
    this.logger.log(
      '========== PluginExplorerService: scanning for @CollectorPlugin providers ==========',
    );
    const providers = this.providerScanner.getProviders();
    this.logger.log(`  Found ${providers.length} provider(s) total`);

    for (const wrapper of providers) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const meta: CollectorPluginMeta | undefined = Reflect.getMetadata(
        COLLECTOR_PLUGIN_META,
        metatype,
      );

      if (meta) {
        await this.registerPlugin(meta, instance as IProtocolAdapter);
      }
    }
  }

  /**
   * Register the plugin and apply the persisted configuration
   *
   * - read the existing config from PluginConfigService, overriding decorator defaults
   * - then call registry.register() and isolationFactory.prepare()
   */
  private async registerPlugin(
    meta: CollectorPluginMeta,
    adapter: IProtocolAdapter,
  ): Promise<void> {
    try {
      // Load persisted config and override isolationMode
      const persistedMode = this.configService.getIsolationMode(meta.protocol);
      if (persistedMode) {
        this.logger.log(
          `Plugin "${meta.protocol}": using persisted isolationMode "${persistedMode}" (decorator default: "${meta.isolationMode ?? 'in_process'}")`,
        );
        meta.isolationMode = persistedMode as CollectorPluginMeta['isolationMode'];
      }

      this.registry.register(meta, adapter);
      this.logger.log(`Auto-registered plugin: ${meta.displayName} (${meta.protocol})`);

      this.emitDiscovered(meta);

      // Decide whether to auto-activate, priority:
      // 1. persisted config activated=true  -> restore previous activation state
      // 2. persisted config activated=false -> user deactivated it explicitly; the
      //    enabledByDefault flag must NOT override the persisted choice (bugfix:
      //    deactivated plugins used to auto-activate again after a restart)
      // 3. enabledByDefault=true            -> default-enabled as declared by the decorator
      //    (only when the plugin has never been toggled, i.e. no persisted state)
      const persistedActivated = this.configService.getActivated(meta.protocol);
      if (persistedActivated === true) {
        this.logger.log(
          `Plugin "${meta.protocol}": persisted activated=true, restoring activation...`,
        );
        await this.registry.activate(meta.protocol);
        this.logger.log(`Plugin "${meta.protocol}": activation restored`);
      } else if (persistedActivated === false) {
        this.logger.log(
          `Plugin "${meta.protocol}": persisted activated=false, staying deactivated (overrides enabledByDefault=${meta.enabledByDefault})`,
        );
      } else if (meta.enabledByDefault) {
        this.logger.log(`Plugin "${meta.protocol}": enabledByDefault=true, auto-activating...`);
        await this.registry.activate(meta.protocol);
        this.logger.log(`Plugin "${meta.protocol}": auto-activated successfully`);
      }

      // Pre-warm the Worker/child process according to isolation mode.
      // Only active plugins get a warm process; deactivated plugins must not spawn
      // a collector process (the executor is created lazily on activation instead).
      if (this.isolationFactory && this.registry.getPlugin(meta.protocol)?.status === 'active') {
        await this.isolationFactory.prepare(meta.protocol);
      }
    } catch (error) {
      this.logger.error(
        `Failed to auto-register plugin ${meta.protocol}: ${(error as Error).message}`,
      );
    }
  }

  private emitDiscovered(meta: CollectorPluginMeta): void {
    try {
      const event: PluginLifecycleEvent = {
        protocol: meta.protocol,
        displayName: meta.displayName,
        version: meta.version,
        category: meta.category,
        status: 'discovered',
        timestamp: Date.now(),
      };
      this.eventBus?.emit('plugin.discovered', event);
    } catch {
      // Event dispatch failure must not affect the core plugin registration logic
    }
  }
}
