// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module, DynamicModule, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventBusModule } from '@ss-node/ss-core';
import { PluginRegistry } from './plugin-registry';
import { PluginDiscoveryService } from './plugin-discovery.service';
import { PluginUpdaterService } from './plugin-updater.service';
import { PluginManagerService } from './plugin-manager.service';
import { PluginMonitorService } from './plugin-monitor.service';
import { PluginConfigService } from './plugin-config.service';
import { PluginController } from './plugin.controller';
import { PluginModuleOptions } from './plugin.types';
import { IsolationFactory } from './isolation/isolation-factory';

@Global()
@Module({})
export class PluginModule {
  /**
   * Register the plugin management module
   *
   * PluginExplorerService injects the provider-scanning capability via the PROVIDER_SCANNER string token,
   * whose concrete implementation is provided by app.module.ts in the root context, avoiding a DI token
   * mismatch caused by pnpm duplicating @nestjs/core.
   *
   * @param options.autoDiscover whether to enable auto-discovery at startup (default true)
   */
  static forRoot(options?: PluginModuleOptions): DynamicModule {
    return {
      module: PluginModule,
      imports: [ConfigModule, EventBusModule],
      providers: [
        PluginConfigService,
        PluginRegistry,
        PluginDiscoveryService,
        PluginUpdaterService,
        PluginManagerService,
        PluginMonitorService,
        IsolationFactory,
        {
          provide: 'PLUGIN_MODULE_OPTIONS',
          useValue: { autoDiscover: true, scanExternal: false, ...options },
        },
      ],
      controllers: [PluginController],
      exports: [
        PluginConfigService,
        PluginRegistry,
        PluginManagerService,
        PluginUpdaterService,
        PluginMonitorService,
        IsolationFactory,
      ],
    };
  }
}
