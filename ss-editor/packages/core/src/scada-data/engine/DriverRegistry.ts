// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { DataSourceConfig, DataSourceInfo } from '../types/data-source.types';
import type { DataSourceManagerStatus } from '../types/graphic-data.types';
import type { IDataSourceDriver } from '../drivers/IDataSourceDriver';
import { HttpPollingDriver } from '../drivers/HttpPollingDriver';
import { StaticDataSourceDriver } from './StaticDataSource';
import { ExpressionDataSourceDriver } from './ExpressionDataSource';
import { v4 as uuidv4 } from 'uuid';

export interface SourceStatusEntry {
  id: string;
  name: string;
  type: string;
  status: 'idle' | 'loading' | 'active' | 'error' | 'paused';
  lastFetchTime: number;
  errorMessage?: string;
}

/**
 * DriverRegistry — driver registration / lookup / lifecycle management
 *
 * Responsibilities:
 * - Manage the driver factory registry (registerDriverFactory)
 * - Manage driver instances (connect/disconnect/lookup)
 * - Manage data source info (DataSourceInfo) and status entries (SourceStatusEntry)
 * - Auto-register built-in drivers
 */
export class DriverRegistry {
  private _driverFactory: Map<string, () => IDataSourceDriver> = new Map();
  private _drivers: Map<string, IDataSourceDriver> = new Map();
  private _sources: Map<string, DataSourceInfo> = new Map();
  private _statusEntries: Map<string, SourceStatusEntry> = new Map();

  constructor() {
    this._registerBuiltinDrivers();
  }

  private _registerBuiltinDrivers(): void {
    this.registerDriverFactory('polling', () => new HttpPollingDriver());
    this.registerDriverFactory('api', () => new HttpPollingDriver());
    this.registerDriverFactory('static', () => new StaticDataSourceDriver());
    this.registerDriverFactory('expression', () => new ExpressionDataSourceDriver());
    // SQL driver must be explicitly registered by the app layer (Node.js require is unavailable in the browser)
  }

  registerDriverFactory(type: string, factory: () => IDataSourceDriver): void {
    this._driverFactory.set(type, factory);
  }

  hasFactory(type: string): boolean {
    return this._driverFactory.has(type);
  }

  getFactory(type: string): (() => IDataSourceDriver) | undefined {
    return this._driverFactory.get(type);
  }

  getDriver(sourceId: string): IDataSourceDriver | undefined {
    return this._drivers.get(sourceId);
  }

  getSource(sourceId: string): DataSourceInfo | undefined {
    return this._sources.get(sourceId);
  }

  getAllSources(): DataSourceInfo[] {
    return Array.from(this._sources.values());
  }

  /**
   * Create a driver instance and register it into the internal maps.
   * Returns the driver, data source info and status entry — connection and
   * configuration are the caller's responsibility.
   */
  createDriver(
    dsType: string,
    dsConfig: Record<string, unknown>,
    dsName: string,
    dsId?: string,
  ): { sourceId: string; driver: IDataSourceDriver; info: DataSourceInfo; statusEntry: SourceStatusEntry } {
    const factory = this._driverFactory.get(dsType);
    if (!factory) {
      throw new Error(`No driver registered for data source type: ${dsType}`);
    }

    const driver = factory();
    const sourceId = dsId || uuidv4();

    const info: DataSourceInfo = {
      id: sourceId,
      type: dsType as DataSourceInfo['type'],
      config: { ...dsConfig } as unknown as DataSourceConfig,
      status: 'connecting',
      tags: [],
      lastError: '',
    };

    this._sources.set(sourceId, info);
    this._drivers.set(sourceId, driver);

    const statusEntry: SourceStatusEntry = {
      id: sourceId,
      name: dsName,
      type: dsType,
      status: 'loading',
      lastFetchTime: 0,
    };
    this._statusEntries.set(sourceId, statusEntry);

    return { sourceId, driver, info, statusEntry };
  }

  removeSource(sourceId: string): IDataSourceDriver | undefined {
    const driver = this._drivers.get(sourceId);
    this._drivers.delete(sourceId);
    this._sources.delete(sourceId);
    this._statusEntries.delete(sourceId);
    return driver;
  }

  updateStatusEntry(sourceId: string, updates: Partial<SourceStatusEntry>): void {
    const entry = this._statusEntries.get(sourceId);
    if (entry) {
      Object.assign(entry, updates);
    }
  }

  getStatusEntry(sourceId: string): SourceStatusEntry | undefined {
    return this._statusEntries.get(sourceId);
  }

  buildStatus(pageId: string, bindingCount: number): DataSourceManagerStatus {
    return {
      pageId,
      dataSourceCount: this._statusEntries.size,
      bindingCount,
      sources: Array.from(this._statusEntries.values()).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type as DataSourceManagerStatus['sources'][0]['type'],
        status: s.status,
        lastFetchTime: s.lastFetchTime,
        errorMessage: s.errorMessage,
      })),
    };
  }

  clear(): void {
    this._drivers.clear();
    this._sources.clear();
    this._statusEntries.clear();
  }
}
