// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '@ss-node/ss-core';
import { SystemConfigService } from '../config/system-config.service';

/**
 * Timer configuration entry
 */
export interface TimerEntry {
  /** Unique identifier, corresponding to the .env variable name */
  id: string;
  /** Display name */
  name: string;
  /** Owning module */
  module: string;
  /** Current interval (milliseconds) */
  currentInterval: number;
  /** Default interval (milliseconds) */
  defaultInterval: number;
  /** Feature description */
  description: string;
  /** Whether runtime hot-reload is supported */
  runtimeUpdate: boolean;
  /** Runtime update callback (must be provided at service registration) */
  restartFn?: (newInterval: number) => void;
}

/** System timer default configuration (hard-coded fallback) */
const DEFAULT_TIMERS: Omit<TimerEntry, 'currentInterval' | 'restartFn'>[] = [
  {
    id: 'DEVICE_HEARTBEAT_CHECK_INTERVAL_MS',
    name: '设备心跳检测',
    module: '设备管理',
    defaultInterval: 5_000,
    description: '定期检查设备心跳，超时自动标记为 OFFLINE',
    runtimeUpdate: true,
  },
  {
    id: 'DEVICE_CONNECTION_HEARTBEAT_INTERVAL_MS',
    name: '连接心跳检测',
    module: '设备管理',
    defaultInterval: 30_000,
    description: '检查活动连接空闲时间，超时触发降级（ONLINE → DEGRADED）',
    runtimeUpdate: true,
  },
  {
    id: 'DEVICE_PERSIST_INTERVAL_MS',
    name: '设备状态持久化',
    module: '设备管理',
    defaultInterval: 30_000,
    description: '脏标记批量写入 system.db 的周期',
    runtimeUpdate: true,
  },
  {
    id: 'DEVICE_AUTO_RECONNECT_INTERVAL_MS',
    name: '设备自动重连',
    module: '设备管理',
    defaultInterval: 30_000,
    description: '设备断线后重试连接的周期',
    runtimeUpdate: false,
  },
  {
    id: 'DEVICE_SIMULATION_DEFAULT_INTERVAL_MS',
    name: '仿真数据生成',
    module: '设备管理',
    defaultInterval: 1_000,
    description: '虚拟设备仿真数据的生成间隔（设备级可覆盖）',
    runtimeUpdate: false,
  },
  {
    id: 'DEVICE_ARCHIVE_DEFAULT_INTERVAL_MS',
    name: '数据归档兜底间隔',
    module: '设备管理',
    defaultInterval: 300_000,
    description: '设备数据归档 cron 表达式解析失败时的 fallback 间隔',
    runtimeUpdate: false,
  },
];

/** Prefix of keys stored in the DB */
const CONFIG_KEY_PREFIX = 'timer.';

@Injectable()
export class TimerConfigService implements OnModuleInit {
  private readonly logger = new Logger(TimerConfigService.name);
  private readonly configs = new Map<string, TimerEntry>();

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBusService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadDefaults();
  }

  /**
   * Load default configuration: DB first → .env → hard-coded
   */
  private async loadDefaults(): Promise<void> {
    for (const tpl of DEFAULT_TIMERS) {
      const dbVal = await this.systemConfigService.get(CONFIG_KEY_PREFIX + tpl.id);
      const envVal = this.configService.get<number>(tpl.id);

      const currentInterval = dbVal ? parseInt(String(dbVal), 10) : envVal || tpl.defaultInterval;

      this.configs.set(tpl.id, {
        ...tpl,
        currentInterval,
        runtimeUpdate: false,
      });
    }
    this.logger.log(`Loaded ${this.configs.size} timer configs (${this.allIds.join(', ')})`);
  }

  /**
   * Register an external service's timer (supports runtime hot-reload callbacks)
   */
  register(id: string, restartFn?: (newInterval: number) => void): void {
    const existing = this.configs.get(id);
    if (!existing) {
      this.logger.warn(`Timer "${id}" not found in defaults, skipping register`);
      return;
    }
    if (restartFn) {
      existing.restartFn = restartFn;
      existing.runtimeUpdate = true;
    }
  }

  /**
   * Get all timer configurations
   */
  getAll(): TimerEntry[] {
    return Array.from(this.configs.values()).map((e) => ({
      ...e,
      restartFn: undefined, // do not expose the callback externally
    }));
  }

  /**
   * Get a single timer configuration
   */
  getById(id: string): TimerEntry | undefined {
    const entry = this.configs.get(id);
    if (!entry) return undefined;
    return { ...entry, restartFn: undefined };
  }

  /**
   * Update a timer's interval
   *
   * - Persists to the system_configs table
   * - Hot-reloads at runtime if the service registered a restartFn
   * - Emits an EventBus event to notify subscribers
   */
  async updateInterval(id: string, interval: number): Promise<TimerEntry> {
    const entry = this.configs.get(id);
    if (!entry) {
      throw new Error(`Timer "${id}" not found`);
    }

    // Validate the interval range (at least 100ms)
    if (interval < 100) {
      throw new Error(`Interval must be >= 100ms, got ${interval}`);
    }

    // Persist to the DB
    await this.systemConfigService.set(CONFIG_KEY_PREFIX + id, String(interval));

    // Update the in-memory value
    entry.currentInterval = interval;

    // Notify subscribers
    this.eventBus.emit('timer:configChanged', { id, interval });

    // If a runtime hot-reload callback exists, restart the timer immediately
    if (entry.restartFn) {
      entry.restartFn(interval);
      this.logger.log(`Timer "${id}" hot-reloaded to ${interval}ms (restarted)`);
    } else {
      this.logger.log(
        `Timer "${id}" interval updated to ${interval}ms (persisted, requires restart to take effect)`,
      );
    }

    return { ...entry, restartFn: undefined };
  }

  /**
   * Reset a timer to its default value
   */
  async resetInterval(id: string): Promise<TimerEntry> {
    const entry = this.configs.get(id);
    if (!entry) {
      throw new Error(`Timer "${id}" not found`);
    }

    // Delete the custom value in the DB, restoring the .env or hard-coded default
    await this.systemConfigService.delete(CONFIG_KEY_PREFIX + id);

    const envVal = this.configService.get<number>(entry.id);
    entry.currentInterval = envVal || entry.defaultInterval;

    this.eventBus.emit('timer:configChanged', {
      id,
      interval: entry.currentInterval,
    });

    if (entry.restartFn) {
      entry.restartFn(entry.currentInterval);
    }

    return { ...entry, restartFn: undefined };
  }

  /**
   * Get all current timer IDs (for debugging/logging)
   */
  get allIds(): string[] {
    return Array.from(this.configs.keys());
  }
}
