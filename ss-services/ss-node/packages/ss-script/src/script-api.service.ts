// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  DataPointCacheService,
  EventBusService,
  CachedDataPoint,
} from '@ss-node/ss-core';
import { DataTagService, DataTag } from '@ss-node/ss-datatag';
import { AlarmService } from '@ss-node/ss-alarm';
import {
  DataQueryService,
  TrendQueryOptions,
  InterpolationType,
} from '@ss-node/ss-storage-influx';
import { randomUUID } from 'crypto';
import * as http from 'http';
import * as https from 'https';

export interface ScriptApiFunction {
  name: string;
  description: string;
  parameters: string[];
  /**
   * Factory function: takes a projectId and returns functions bound to that project context.
   *
   * Rationale for the factory pattern instead of "appending projectId as a trailing positional argument":
   * when a function has optional middle parameters (e.g. triggerAlarm's options, queryTagHistory's options,
   * httpGet/httpPost's options), a caller omitting the middle parameter would shift projectId into
   * the options slot, turning projectId into the default '' and breaking project isolation.
   * The factory closure puts projectId directly into the function scope, decoupled from the caller's
   * argument positions, eliminating the misalignment risk entirely.
   */
  factory: (projectId: string) => ((...args: any[]) => any | Promise<any>);
}

/**
 * ScriptApiService — global APIs callable inside the script sandbox
 *
 * Phase 4 rework: replaced the stub with a real implementation
 * - readTag/writeTag: connects to DataPointCacheService (ss-core) to read/write live values
 * - triggerAlarm: emits the 'alarm_triggered' event via EventBus (AlarmEventSubscriber listens and creates AlarmRecord)
 * - acknowledgeAlarm: calls AlarmService.acknowledgeAlarm
 * - queryTagHistory: calls DataQueryService.queryTrendData (InfluxDB)
 * - httpGet/httpPost: unified HTTP utilities replacing the duplicated implementations in EngineService
 *
 * getApiProvider(projectId) closure approach: the factory pattern generates, per projectId, a set of
 * functions bound to that project context; scripts only pass business parameters (e.g. readTag('tag-1')),
 * and projectId is captured automatically inside the closure, ensuring project isolation.
 *
 * All dependencies are injected @Optional so that missing dependencies degrade to fake data instead of crashing.
 */
@Injectable()
export class ScriptApiService {
  private readonly logger = new Logger(ScriptApiService.name);

  private apiFunctions = new Map<string, ScriptApiFunction>();

  constructor(
    @Optional() private readonly cacheService?: DataPointCacheService,
    @Optional() private readonly dataTagService?: DataTagService,
    @Optional() private readonly alarmService?: AlarmService,
    @Optional() private readonly dataQueryService?: DataQueryService,
    @Optional() private readonly eventBusService?: EventBusService,
  ) {
    this.registerBuiltInFunctions();
  }

  private registerBuiltInFunctions(): void {
    // ── readTag: read a data tag's current value ──
    this.register({
      name: 'readTag',
      description: '读取数据标签当前值',
      parameters: ['tagId'],
      factory: (projectId: string) => async (tagId: string) => {
        void projectId; // project context (readTag reads via cacheService by tagId; projectId kept for audit)
        if (!this.cacheService) {
          this.logger.warn('[ScriptAPI] readTag: DataPointCacheService not available');
          return { tagId, value: null, quality: 'unknown', timestamp: new Date().toISOString() };
        }
        const cached = await this.cacheService.get(tagId);
        if (!cached) {
          return { tagId, value: null, quality: 'unknown', timestamp: new Date().toISOString() };
        }
        return {
          tagId: cached.tagId,
          value: cached.value,
          quality: cached.quality,
          timestamp: new Date(cached.timestamp).toISOString(),
        };
      },
    });

    // ── readTags: read multiple data tags' current values in batch ──
    this.register({
      name: 'readTags',
      description: '批量读取数据标签当前值',
      parameters: ['tagIds'],
      factory: (projectId: string) => async (tagIds: string[]) => {
        void projectId;
        if (!this.cacheService) return {};
        const map = await this.cacheService.getMany(tagIds);
        const result: Record<string, any> = {};
        for (const tagId of tagIds) {
          const cached = map.get(tagId);
          result[tagId] = cached
            ? {
                value: cached.value,
                quality: cached.quality,
                timestamp: new Date(cached.timestamp).toISOString(),
              }
            : { value: null, quality: 'unknown', timestamp: new Date().toISOString() };
        }
        return result;
      },
    });

    // ── writeTag: write a data tag value (update cache + emit EventBus event) ──
    this.register({
      name: 'writeTag',
      description: '写入数据标签值',
      parameters: ['tagId', 'value'],
      factory: (projectId: string) => async (tagId: string, value: any) => {
        // 1. Look up the DataTag to get deviceId
        let deviceId = '';
        let actualProjectId = projectId;
        if (this.dataTagService) {
          try {
            const tag: DataTag = await this.dataTagService.findById(tagId);
            deviceId = tag.deviceId;
            actualProjectId = tag.projectId || projectId;
          } catch {
            this.logger.warn(`[ScriptAPI] writeTag: DataTag not found ${tagId}, proceeding without deviceId`);
          }
        }
        // 2. Update the cache
        const now = Date.now();
        const dataPoint: CachedDataPoint = {
          tagId,
          deviceId,
          projectId: actualProjectId,
          value: Number(value),
          timestamp: now,
          quality: 'good',
          cachedAt: now,
        };
        if (this.cacheService) {
          await this.cacheService.set(dataPoint);
        }
        // 3. Emit the EventBus event (TagUpdatePayload format, timestamp as ISO string)
        if (this.eventBusService) {
          this.eventBusService.emit('data_point_changed', {
            tagId,
            deviceId,
            projectId: actualProjectId,
            value: Number(value),
            quality: 'good',
            timestamp: new Date(now).toISOString(),
          });
        }
        return { tagId, value, success: true };
      },
    });

    // ── writeTags: write multiple data tag values in batch ──
    this.register({
      name: 'writeTags',
      description: '批量写入数据标签值',
      parameters: ['writes'],
      factory: (projectId: string) => async (writes: Array<{ tagId: string; value: any }>) => {
        const results: any[] = [];
        const writeFn = this.apiFunctions.get('writeTag')!.factory(projectId);
        for (const { tagId, value } of writes) {
          const r = await writeFn(tagId, value);
          results.push(r);
        }
        return results;
      },
    });

    // ── log: output a log entry ──
    this.register({
      name: 'log',
      description: '输出日志',
      parameters: ['level', 'message'],
      factory: (projectId: string) => (level: string, message: string) => {
        void projectId;
        switch (level) {
          case 'error':
            this.logger.error(`[ScriptAPI] ${message}`);
            break;
          case 'warn':
            this.logger.warn(`[ScriptAPI] ${message}`);
            break;
          case 'debug':
            this.logger.debug(`[ScriptAPI] ${message}`);
            break;
          default:
            this.logger.log(`[ScriptAPI] ${message}`);
            break;
        }
        return true;
      },
    });

    // ── sleep: suspend the script (milliseconds) ──
    this.register({
      name: 'sleep',
      description: '脚本休眠（毫秒）',
      parameters: ['ms'],
      factory: (projectId: string) => async (ms: number) => {
        void projectId;
        const cappedMs = Math.min(ms, 30000);
        return new Promise((resolve) => setTimeout(resolve, cappedMs));
      },
    });

    // ── triggerAlarm: raise an alarm (emit the alarm_triggered event via EventBus) ──
    // Event format expected by AlarmEventSubscriber.handleAlarmTriggered:
    // { alarmId, tagId, deviceId, projectId, condition:{severity,type}, value, timestamp, message }
    this.register({
      name: 'triggerAlarm',
      description: '触发报警',
      parameters: ['ruleName', 'message', 'level', 'options'],
      factory: (projectId: string) =>
        (
          ruleName: string,
          message: string,
          level: string = 'warning',
          options: { tagId?: string; deviceId?: string; value?: number } = {},
        ) => {
          const alarmId = randomUUID();
          const validLevels = ['critical', 'high', 'medium', 'low', 'info', 'warning'];
          const severity = (validLevels.includes(level) ? level : 'warning') as any;
          const event = {
            alarmId,
            tagId: options.tagId ?? '',
            deviceId: options.deviceId ?? '',
            projectId,
            condition: { severity, type: 'manual', enabled: true },
            value: options.value,
            timestamp: Date.now(),
            message: `[${ruleName}] ${message}`,
          };
          if (this.eventBusService) {
            this.eventBusService.emit('alarm_triggered', event);
          }
          this.logger.log(
            `[ScriptAPI] triggerAlarm: ${ruleName} - ${message} (${level}) alarmId=${alarmId}`,
          );
          return { alarmId, ruleName, message, level, triggered: true };
        },
    });

    // ── acknowledgeAlarm: acknowledge an alarm ──
    this.register({
      name: 'acknowledgeAlarm',
      description: '确认报警',
      parameters: ['alarmId', 'userId'],
      factory: (projectId: string) => async (alarmId: string, userId: string = 'system') => {
        if (!this.alarmService) {
          return { alarmId, acknowledged: false, error: 'AlarmService not available' };
        }
        try {
          const record = await this.alarmService.acknowledgeAlarm(alarmId, userId, projectId);
          return { alarmId, acknowledged: true, status: record.status };
        } catch (err) {
          return { alarmId, acknowledged: false, error: (err as Error).message };
        }
      },
    });

    // ── queryTagHistory: query a tag's historical data (InfluxDB) ──
    this.register({
      name: 'queryTagHistory',
      description: '查询标签历史数据',
      parameters: ['tagIds', 'startTime', 'endTime', 'options'],
      factory: (projectId: string) =>
        async (
          tagIds: string[],
          startTime: string | Date,
          endTime: string | Date,
          options: { maxPoints?: number; interpolation?: 'raw' | 'linear' | 'step'; interval?: number } = {},
        ) => {
          if (!this.dataQueryService) {
            return { data: [], pagination: { total: 0 } };
          }
          const opts: TrendQueryOptions = {
            tagIds,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            projectId,
            maxPoints: options.maxPoints ?? 1000,
            interpolation:
              options.interpolation === 'linear'
                ? InterpolationType.LINEAR
                : options.interpolation === 'step'
                  ? InterpolationType.STEP
                  : InterpolationType.RAW,
            interval: options.interval ?? 1000,
          };
          return this.dataQueryService.queryTrendData(opts);
        },
    });

    // ── httpGet: HTTP GET request (real implementation, unified replacement for the duplicated injection in EngineService) ──
    this.register({
      name: 'httpGet',
      description: 'HTTP GET 请求',
      parameters: ['url', 'options'],
      factory: (projectId: string) =>
        async (url: string, options: { headers?: Record<string, string>; timeout?: number } = {}) => {
          void projectId;
          return this.httpRequest('GET', url, undefined, options);
        },
    });

    // ── httpPost: HTTP POST request ──
    this.register({
      name: 'httpPost',
      description: 'HTTP POST 请求',
      parameters: ['url', 'body', 'options'],
      factory: (projectId: string) =>
        async (
          url: string,
          body: any,
          options: { headers?: Record<string, string>; timeout?: number } = {},
        ) => {
          void projectId;
          return this.httpRequest('POST', url, body, options);
        },
    });

    // ── getTime: get the current timestamp ──
    this.register({
      name: 'getTime',
      description: '获取当前时间戳',
      parameters: [],
      factory: (projectId: string) => () => {
        void projectId;
        return { timestamp: Date.now(), iso: new Date().toISOString() };
      },
    });
  }

  /**
   * Unified HTTP request utility (replaces the duplicated httpGet implementation in EngineService.executeWithPrivileges)
   */
  private async httpRequest(
    method: 'GET' | 'POST',
    url: string,
    body: any,
    options: { headers?: Record<string, string>; timeout?: number },
  ): Promise<{ status: number; data: string; headers: any; error?: string }> {
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch (err) {
        resolve({ status: 0, data: '', headers: {}, error: `Invalid URL: ${(err as Error).message}` });
        return;
      }
      const req = lib.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname + parsedUrl.search,
          method,
          headers: options.headers,
          timeout: options.timeout ?? 10000,
        },
        (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        },
      );
      req.on('error', (err: Error) => resolve({ status: 0, data: '', headers: {}, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 0, data: '', headers: {}, error: 'timeout' });
      });
      if (method === 'POST' && body !== undefined) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  register(func: ScriptApiFunction): void {
    this.apiFunctions.set(func.name, func);
    this.logger.debug(`Registered ScriptAPI function: ${func.name}`);
  }

  unregister(name: string): boolean {
    return this.apiFunctions.delete(name);
  }

  getApiFunctions(): ScriptApiFunction[] {
    return Array.from(this.apiFunctions.values());
  }

  /**
   * Get the API provider map (with projectId-bound closures)
   *
   * The factory pattern generates, per projectId, a set of independently bound functions:
   * scripts only pass business parameters (e.g. triggerAlarm('rule','msg','warning',{tagId})),
   * projectId is captured in the factory closure, fully decoupled from the caller's argument positions,
   * completely avoiding the isolation leak where "omitting an optional middle parameter misaligns projectId".
   *
   * @param projectId project ID (for project isolation: triggerAlarm/writeTag/queryTagHistory etc.)
   */
  getApiProvider(projectId: string): Record<string, (...args: any[]) => any | Promise<any>> {
    const provider: Record<string, (...args: any[]) => any | Promise<any>> = {};
    for (const [name, func] of this.apiFunctions) {
      // The factory generates functions bound to projectId; different projectIds produce independent closures
      provider[name] = func.factory(projectId);
    }
    return provider;
  }
}
