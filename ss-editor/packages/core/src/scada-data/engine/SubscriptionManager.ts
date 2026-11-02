// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { IDataSourceDriver } from '../drivers/IDataSourceDriver';

/** Tag value change callback */
export type TagValueChangeHandler = (payload: {
  tagId: string;
  value: unknown;
  previousValue: unknown;
  quality: string;
  sourceId: string;
  timestamp: number;
}) => void;

export interface BindingInfo {
  graphicId: string;
  graphicName: string;
  graphicType: string;
  tagId: string;
  filterScript?: string;
  driverScript?: string;
  /** Graphic property path; runtime BindingManager.applyProperty writes here; defaults to 'config.customProps.text' */
  propertyPath?: string;
}

export interface VariableInfo {
  tagId: string;
  tagName: string;
  dataSourceId: string;
  dataType: string;
  unit?: string;
  minValue?: number;
  maxValue?: number;
  alarmHigh?: number;
  alarmHighHigh?: number;
  alarmLow?: number;
  alarmLowLow?: number;
  decimalPlaces?: number;
}

/**
 * SubscriptionManager — data subscription/unsubscription/push management
 *
 * Responsibilities:
 * - Manage graphic binding relations (graphicBindings)
 * - Manage variable metadata (variables)
 * - Manage tag value change listeners (onTagValueChanged)
 * - Subscribe/unsubscribe tag data
 * - Dispatch tag value change notifications
 */
export class SubscriptionManager {
  private _bindings: BindingInfo[] = [];
  private _variables: Map<string, VariableInfo> = new Map();
  private _tagChangeHandlers: TagValueChangeHandler[] = [];

  init(bindings: BindingInfo[], variables: VariableInfo[]): void {
    this._bindings = bindings.map((b) => ({ ...b }));
    this._variables.clear();
    for (const v of variables) {
      this._variables.set(v.tagId, v);
    }
  }

  getBindings(): BindingInfo[] {
    return [...this._bindings];
  }

  /** Retrieve all bindings related to a tagId (for DataPipelineBridge to run filter/driver scripts) */
  getBindingsByTagId(tagId: string): BindingInfo[] {
    return this._bindings.filter((b) => b.tagId === tagId);
  }

  getVariableMeta(tagId: string): VariableInfo | undefined {
    return this._variables.get(tagId);
  }

  /**
   * Register a tag value change listener; returns an unregister function.
   */
  onTagValueChanged(handler: TagValueChangeHandler): () => void {
    this._tagChangeHandlers.push(handler);
    return () => {
      const idx = this._tagChangeHandlers.indexOf(handler);
      if (idx >= 0) {
        this._tagChangeHandlers.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe the specified tags with the driver
   */
  subscribeToSource(driver: IDataSourceDriver | undefined, tagIds: string[]): void {
    if (driver) {
      driver.subscribe(tagIds);
    }
  }

  /**
   * Broadcast tag value changes to all listeners.
   */
  notifyTagValueChanged(payload: {
    tagId: string;
    value: unknown;
    previousValue: unknown;
    quality: string;
    sourceId: string;
    timestamp: number;
  }): void {
    for (const handler of this._tagChangeHandlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error('[DataSourceManager] tagChangeHandler error:', err);
      }
    }
  }

  clear(): void {
    this._bindings = [];
    this._variables.clear();
    this._tagChangeHandlers = [];
  }
}