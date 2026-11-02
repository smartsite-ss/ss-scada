// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Controller, Get, Post, Put, Delete, Param, Query, Body } from '@nestjs/common';
import { PluginManagerService } from './plugin-manager.service';

@Controller('plugins')
export class PluginController {
  constructor(private readonly pluginManager: PluginManagerService) {}

  // =======================================================================
  //  Routes without dynamic params (exact match, highest priority)
  // =======================================================================

  /** Get all plugins list */
  @Get()
  async listPlugins(@Query('status') status?: string, @Query('category') category?: string) {
    const data = await this.pluginManager.listPluginsWithRuntime({ status, category });
    return { code: 0, data, message: 'ok' };
  }

  /** Trigger plugin rediscovery */
  @Post('discover')
  async rediscover() {
    const plugins = await this.pluginManager.rediscover();
    return {
      code: 0,
      data: plugins,
      message: `Discovered ${plugins.length} plugins`,
    };
  }

  /** Health check */
  @Get('health')
  async healthCheck() {
    const report = await this.pluginManager.healthCheck();
    return { code: 0, data: report, message: 'ok' };
  }

  // =======================================================================
  //  :protocol/xxx nested sub-paths -> must be registered before @Get(':protocol')
  // =======================================================================

  /** Activate a plugin */
  @Post(':protocol/activate')
  async activatePlugin(@Param('protocol') protocol: string) {
    try {
      const plugin = await this.pluginManager.activate(protocol);
      return { code: 0, data: plugin, message: `Plugin ${protocol} activated` };
    } catch (error) {
      return { code: 404, message: (error as Error).message };
    }
  }

  /** Deactivate a plugin */
  @Post(':protocol/deactivate')
  async deactivatePlugin(@Param('protocol') protocol: string) {
    try {
      const plugin = await this.pluginManager.deactivate(protocol);
      return { code: 0, data: plugin, message: `Plugin ${protocol} deactivated` };
    } catch (error) {
      return { code: 404, message: (error as Error).message };
    }
  }

  /** Get plugin running status */
  @Get(':protocol/status')
  getPluginStatus(@Param('protocol') protocol: string) {
    try {
      const status = this.pluginManager.getPluginStatus(protocol);
      return { code: 0, data: status, message: 'ok' };
    } catch (error) {
      return { code: 404, message: (error as Error).message };
    }
  }

  /** Get plugin connection config Schema */
  @Get(':protocol/schema')
  getConnectionSchema(@Param('protocol') protocol: string) {
    const schema = this.pluginManager.getConnectionSchema(protocol);
    if (!schema) {
      return { code: 404, message: `Schema not found for: ${protocol}` };
    }
    return { code: 0, data: schema, message: 'ok' };
  }

  /** Check for updates */
  @Get(':protocol/check-update')
  async checkUpdate(@Param('protocol') protocol: string) {
    const result = await this.pluginManager.checkUpdate(protocol);
    return { code: 0, data: result, message: 'ok' };
  }

  /** Hot-update a plugin */
  @Post(':protocol/update')
  async updatePlugin(@Param('protocol') protocol: string) {
    const result = await this.pluginManager.hotReload(protocol);
    return {
      code: result.success ? 0 : 500,
      data: result,
      message: result.success
        ? `Plugin ${protocol} updated to ${result.newVersion}`
        : `Update failed: ${result.error}`,
    };
  }

  /** Roll back version */
  @Post(':protocol/rollback')
  async rollbackPlugin(@Param('protocol') protocol: string) {
    const result = await this.pluginManager.rollback(protocol);
    return {
      code: result.success ? 0 : 500,
      data: result,
      message: result.success
        ? `Plugin ${protocol} rolled back to ${result.newVersion}`
        : `Rollback failed: ${result.error}`,
    };
  }

  /** Get the active device list currently collected by the plugin */
  @Get(':protocol/active-devices')
  getActiveDevices(@Param('protocol') protocol: string) {
    const devices = this.pluginManager.getPluginActiveDevices(protocol);
    return {
      code: 0,
      data: {
        protocol,
        count: devices.length,
        devices,
      },
      message: 'ok',
    };
  }

  /** Validate channel config */
  @Post(':protocol/validate')
  async validateChannelConfig(
    @Param('protocol') protocol: string,
    @Body() config: Record<string, any>,
  ) {
    try {
      const result = await this.pluginManager.validateChannelConfig(protocol, config);
      return {
        code: result.valid ? 0 : 400,
        data: result,
        message: result.valid ? 'ok' : '通道配置校验失败',
      };
    } catch (error) {
      return {
        code: 404,
        message: `Plugin not found or validation error: ${(error as Error).message}`,
      };
    }
  }

  /** Get plugin runtime monitoring data (memory/CPU + collection logs) */
  @Get(':protocol/monitor')
  async getMonitor(@Param('protocol') protocol: string) {
    const data = await this.pluginManager.getMonitorData(protocol);
    return { code: 0, data, message: 'ok' };
  }

  /** Clear plugin collection logs */
  @Delete(':protocol/monitor/logs')
  clearMonitorLogs(@Param('protocol') protocol: string) {
    const result = this.pluginManager.clearPluginLogs(protocol);
    return {
      code: result.cleared ? 0 : 500,
      data: result,
      message: result.message,
    };
  }

  // -----------------------------------------------------------------------
  //  Runtime config persistence
  // -----------------------------------------------------------------------

  /** Get plugin runtime config */
  @Get(':protocol/config')
  getPluginConfig(@Param('protocol') protocol: string) {
    const config = this.pluginManager.getPluginConfig(protocol);
    return { code: 0, data: config, message: 'ok' };
  }

  /** Update plugin runtime config (persisted to JSON file, retained after restart) */
  @Put(':protocol/config')
  async updatePluginConfig(
    @Param('protocol') protocol: string,
    @Body() body: { isolationMode?: string },
  ) {
    const config = await this.pluginManager.updatePluginConfig(protocol, body);
    return { code: 0, data: config, message: 'ok' };
  }

  /** Restart plugin (reload executor after config changes such as isolation mode) */
  @Post(':protocol/restart')
  async restartPlugin(@Param('protocol') protocol: string) {
    const result = await this.pluginManager.restartPlugin(protocol);
    return {
      code: 0,
      data: result,
      message: `Plugin ${protocol} restarted in ${result.elapsed}ms`,
    };
  }

  // =======================================================================
  //  Exact-path routes (must be registered before the @Get(':protocol') wildcard)
  // =======================================================================

  /** Get device statistics for all plugins (online/offline counts) */
  @Get('device-stats')
  getAllDeviceStats() {
    const data = this.pluginManager.getAllDeviceStats();
    return { code: 0, data, message: 'ok' };
  }

  // =======================================================================
  //  @Get(':protocol') wildcard -> must be placed last
  // =======================================================================

  /** Get a single plugin's details */
  @Get(':protocol')
  getPlugin(@Param('protocol') protocol: string) {
    const plugin = this.pluginManager.getPlugin(protocol);
    if (!plugin) {
      return { code: 404, message: `Plugin not found: ${protocol}` };
    }
    return { code: 0, data: plugin, message: 'ok' };
  }
}
