// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { AbstractBaseDriver } from '../drivers/AbstractBaseDriver';
import type { DataSourceConfig, TagValue } from '../types/data-source.types';

interface StaticVariableEntry {
  tagId: string;
  tagName?: string;
  value: unknown;
  dataType?: string;
}

/**
 * Runtime shape of the StaticDataSource config.
 * The design doc's StaticConfig interface is { value, dataType }, but the editor's StaticSourceEditor
 * actually persists a { jsonContent, variables: [{ tagId, tagName, value, dataType }] } array structure.
 * Both shapes are supported here.
 */
interface StaticRuntimeConfig {
  /** Single-value mode (StaticConfig.value) */
  value?: unknown;
  dataType?: string;
  /** Array mode (the editor's actual persisted structure) */
  jsonContent?: string;
  variables?: StaticVariableEntry[];
}

export class StaticDataSourceDriver extends AbstractBaseDriver {
  private _values: Map<string, unknown> = new Map();

  async connect(config: DataSourceConfig | StaticRuntimeConfig): Promise<void> {
    this._rawConfig = config as DataSourceConfig;
    // Compatible with both config shapes:
    // - Full DataSourceConfig: { type: 'static', config: { variables, ... } }
    // - Inner config (passed by the runtime DataSourceManager): { variables, ... }
    const innerConfig = this._extractInnerConfig(config);
    this._status = 'connected';
    // Phase 15.4.1: push initial values at connect, so static data source values flow into BindingManager via EventBus
    this._pushInitialValues(innerConfig);
  }

  async disconnect(): Promise<void> {
    this._rawConfig = null;
    this._status = 'disconnected';
  }

  /** StaticDataSource supports writes (overriding the base class's default throw) */
  async write(tagId: string, value: unknown): Promise<void> {
    this._values.set(tagId, value);
  }

  setTagValue(tagId: string, value: unknown, quality: TagValue['quality'] = 'good'): void {
    this._values.set(tagId, value);
    const tagValue: TagValue = { tagId, value, quality, timestamp: Date.now(), sourceId: 'static' };
    this._notify([tagValue]);
  }

  setTagValues(values: Record<string, unknown>): void {
    const now = Date.now();
    const tagValues: TagValue[] = [];
    for (const [tagId, value] of Object.entries(values)) {
      this._values.set(tagId, value);
      tagValues.push({ tagId, value, quality: 'good', timestamp: now, sourceId: 'static' });
    }
    this._notify(tagValues);
  }

  /**
   * Extract the inner config, compatible with both shapes:
   * - { type: 'static', config: { variables, ... } } → return the config field
   * - { variables, ... } → return directly
   */
  private _extractInnerConfig(config: DataSourceConfig | StaticRuntimeConfig): StaticRuntimeConfig {
    const maybeOuter = config as { type?: string; config?: StaticRuntimeConfig };
    if (maybeOuter.type === 'static' && maybeOuter.config) {
      return maybeOuter.config;
    }
    // Fallback: try (config as any).config (consistent with other drivers' extraction)
    const nestedConfig = (config as { config?: StaticRuntimeConfig }).config;
    if (nestedConfig && (nestedConfig.variables || nestedConfig.value !== undefined)) {
      return nestedConfig;
    }
    return config as StaticRuntimeConfig;
  }

  /**
   * Phase 15.4.1: push initial values at connect.
   * - Array mode: read [{ tagId, value, ... }] from config.variables and push
   * - Single-value mode: read config.value; tagId uses the first subscribed tag (or 'static_value')
   * - jsonContent mode: try JSON.parse(jsonContent) then handle as array mode
   */
  private _pushInitialValues(innerConfig: StaticRuntimeConfig): void {
    const entries = this._collectStaticEntries(innerConfig);
    if (entries.length === 0) return;
    const now = Date.now();
    const tagValues: TagValue[] = entries.map((entry) => {
      this._values.set(entry.tagId, entry.value);
      return {
        tagId: entry.tagId,
        value: entry.value,
        quality: 'good',
        timestamp: now,
        sourceId: 'static',
      };
    });
    this._notify(tagValues);
  }

  private _collectStaticEntries(innerConfig: StaticRuntimeConfig): StaticVariableEntry[] {
    // Prefer the variables array
    if (Array.isArray(innerConfig.variables) && innerConfig.variables.length > 0) {
      return innerConfig.variables.filter((v) => v && typeof v.tagId === 'string');
    }
    // Fallback: parse from jsonContent
    if (innerConfig.jsonContent) {
      try {
        const parsed = JSON.parse(innerConfig.jsonContent);
        const vars = parsed?.variables ?? parsed;
        if (Array.isArray(vars)) {
          return vars
            .filter((v: any) => v && typeof v.tagId === 'string')
            .map((v: any) => ({
              tagId: v.tagId,
              tagName: v.tagName,
              value: v.value,
              dataType: v.dataType,
            }));
        }
        if (vars && typeof vars === 'object' && !Array.isArray(vars)) {
          return Object.entries(vars as Record<string, any>).map(([key, value]) => ({
            tagId: key,
            tagName: key,
            value,
          }));
        }
      } catch {
        // JSON parse failure, ignore
      }
    }
    // Single-value mode: use the first subscribed tagId or 'static_value' as the tagId
    if (innerConfig.value !== undefined) {
      const fallbackTagId = this._tags[0] || 'static_value';
      return [{ tagId: fallbackTagId, value: innerConfig.value, dataType: innerConfig.dataType }];
    }
    return [];
  }
}
