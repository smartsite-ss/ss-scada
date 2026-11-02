// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable } from '@nestjs/common';
import {
  BaseCollectorService,
  CollectorPlugin,
  IsolationMode,
  PluginCategory,
  PluginMonitorService,
  type CollectorReadResult,
  type ITagContext,
  type ChannelValidationResult,
} from '@ss-node/ss-collector-sdk';
import { SimulatorFactory } from './simulator-factory';
import { VariableSimulator } from './simulators/variable-simulator.interface';

interface VirtualClient {
  deviceId: string;
  simulators: Map<string, VariableSimulator>;
}

/**
 * Virtual protocol adapter - requires no real physical connection,
 * generates simulated data through the SimulatorFactory.
 */
@Injectable()
@CollectorPlugin({
  protocol: 'virtual',
  displayName: 'Virtual Device',
  version: '0.1.0',
  description: '虚拟数据采集插件，用于开发调试和无设备环境下的仿真测试',
  category: PluginCategory.CUSTOM,
  transport: 'other',
  connectionSchema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', title: '设备ID', default: 'virtual-device' },
    },
  },
  defaultConnection: { deviceId: 'virtual-device' },
  supportedDataTypes: ['float', 'int', 'bool', 'string', 'enum'],
  isolationMode: IsolationMode.CHILD_PROCESS,
  enabledByDefault: true,
  tags: ['virtual', 'simulation', 'debug', 'testing'],
})
export class VirtualProtocolAdapter extends BaseCollectorService {
  private readCounter = 0;
  private lastSummaryTime = 0;

  private readonly simulatorFactory: SimulatorFactory;

  constructor(
    simulatorFactory?: SimulatorFactory,
    private readonly monitor?: PluginMonitorService,
  ) {
    super();
    // Supports running without a NestJS DI environment (e.g. worker/child-process isolation mode)
    this.simulatorFactory = simulatorFactory ?? new SimulatorFactory();
    this.logger.log('========== VirtualProtocolAdapter CONSTRUCTED ==========');
    this.logger.log(`  - simulatorFactory available: ${!!this.simulatorFactory}`);
    this.logger.log(`  - monitor available: ${!!this.monitor}`);
    this.logger.log('==========================================================');
  }

  /**
   * Initialization hook called when the plugin is activated
   * Independent of device loading - called even when there are no devices.
   * Used to warm up the simulator factory, emit initialization logs, etc.
   */
  async onActivate(): Promise<void> {
    const startTime = Date.now();
    this.logger.log('VirtualProtocolAdapter.onActivate() — starting initialization...');

    // Warm up the SimulatorFactory
    try {
      if (typeof (this.simulatorFactory as any).warmup === 'function') {
        (this.simulatorFactory as any).warmup();
        this.logger.log('SimulatorFactory warmed up');
      }
    } catch (err) {
      this.logger.warn(`SimulatorFactory.warmup() failed: ${(err as Error).message}`);
    }

    // Record the initialization log to the collection log file
    this.monitor?.writeLog(
      'virtual',
      'INFO',
      `[INIT] VirtualProtocolAdapter 激活成功 (${Date.now() - startTime}ms)`,
    );

    this.logger.log(
      `VirtualProtocolAdapter.onActivate() — initialized (${Date.now() - startTime}ms)`,
    );
  }

  /**
   * Cleanup hook called when the plugin is deactivated
   */
  async onDeactivate(): Promise<void> {
    this.logger.log('VirtualProtocolAdapter.onDeactivate() — cleaning up connections...');

    // The base class onModuleDestroy handles connection cleanup
    await this.onModuleDestroy();

    this.monitor?.writeLog(
      'virtual',
      'INFO',
      '[INIT] VirtualProtocolAdapter 已停用，所有连接已清理',
    );
    this.logger.log('VirtualProtocolAdapter.onDeactivate() — cleanup complete');
  }

  async connect(device: any): Promise<VirtualClient> {
    const deviceId = device.id;
    if (this.getConnectionStatus(deviceId)) {
      // Already connected, find and return from getClientEntries
      for (const [, entry] of this.getClientEntries()) {
        if ((entry.client as VirtualClient).deviceId === deviceId) {
          return entry.client as VirtualClient;
        }
      }
    }
    const client: VirtualClient = {
      deviceId,
      simulators: new Map(),
    };
    this.trackClient(deviceId, client);
    this.logger.log(`虚拟设备 ${deviceId} 连接成功`);
    return client;
  }

  protected async doReadTag(client: VirtualClient, tag: ITagContext): Promise<CollectorReadResult> {
    const tagId = tag.id;
    // Get or create a simulator
    const simulator = this.simulatorFactory.getOrCreate(tagId, tag);

    // Cache on the client for fast access
    if (!client.simulators.has(tagId)) {
      client.simulators.set(tagId, simulator);
    }

    const value = simulator.generate();

    // CODE-12: collection stats and log frequency reduction - the original doReadTag wrote an INFO entry via monitor.writeLog on every call,
    // which, at the virtual collector's read rate of 40-58 calls/second, produced heavy IO (and could not be suppressed by LOG_LEVEL=info).
    // Changed to: emit a debug-level summary every 60 seconds plus one monitor summary log, to avoid log IO amplifying the server load.
    this.readCounter++;
    const now = Date.now();
    if (now - this.lastSummaryTime >= 60000) {
      const summary = `采集统计: 过去60秒读取 ${this.readCounter} 次 | 最新值: ${tag.name || tagId}=${JSON.stringify(value)}`;
      this.logger.debug(summary);
      // Periodically write a summary to the monitoring log (DEBUG level; not written to file when production LOG_LEVEL=warn)
      this.monitor?.writeLog('virtual', 'DEBUG', `[STATS] ${summary}`);
      this.readCounter = 0;
      this.lastSummaryTime = now;
    }

    return {
      tagId,
      value,
      timestamp: new Date(),
      quality: 'good',
    };
  }

  async readTag(client: VirtualClient, tag: ITagContext): Promise<CollectorReadResult> {
    return this.doReadTag(client, tag);
  }

  protected async doWriteTag(client: VirtualClient, tag: ITagContext, value: any): Promise<void> {
    const simulator = client.simulators.get(tag.id);
    if (simulator) {
      simulator.setValue(value);
    }
  }

  protected async doDisconnect(client: VirtualClient): Promise<void> {
    // Virtual devices need no real disconnect; only clean up simulator state
    client.simulators.clear();
  }

  async validateChannelConfig(_config: Record<string, any>): Promise<ChannelValidationResult> {
    return { valid: true, errors: [] };
  }

  /**
   * Channel connectivity pre-check
   *
   * Validates whether the channel config is reachable when creating/editing a device, without relying on EnhancedScheduler scheduling.
   * Virtual devices always return success (no real physical connection).
   */
  async precheckConnection(config: Record<string, any>): Promise<ChannelValidationResult> {
    const startTime = Date.now();
    this.logger.log(`Prechecking virtual connection for device: ${config.deviceId || 'unknown'}`);

    // Virtual devices need no real connection; return success directly
    const elapsed = Date.now() - startTime;
    this.logger.log(`Virtual precheck completed in ${elapsed}ms`);

    return {
      valid: true,
      errors: [],
    };
  }
}
