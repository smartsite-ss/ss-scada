// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { DataSourceConfig, DataSourceInfo, TagValue } from '../types/data-source.types';
import type { DataSourceManagerStatus } from '../types/graphic-data.types';
import type { IDataSourceDriver } from '../drivers/IDataSourceDriver';
import { DriverRegistry } from './DriverRegistry';
import { TagCache } from './TagCache';
import { SubscriptionManager } from './SubscriptionManager';
import type { TagValueChangeHandler, BindingInfo, VariableInfo } from './SubscriptionManager';
import { extractTagIds } from './DataSourceReader';

export type { TagValueChangeHandler };

export interface PageDataSourceInput {
  /** v3.0: pageId identifies the current page; dataSources comes from the page JSON's dataSource field */
  pageId: string;
  /** v4.5: runtime project identifier, used by WebSocketDriver to establish connections and subscribe tags */
  projectId?: string;
  /** v3.0: page dataSource collection, deserialized directly from the page JSON, no longer queried from a separate database */
  dataSources: Array<{
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    enabled?: boolean;
  }>;
  variables: Array<{
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
  }>;
  /** @deprecated v3.0 — graphicBindings are gradually migrating to each graphic's graphicData field. At runtime prefer reading binding info from the graphic's own graphicData. */
  graphicBindings: Array<{
    graphicId: string;
    graphicName: string;
    graphicType: string;
    tagId: string;
    filterScript?: string;
    driverScript?: string;
    /** Graphic property path; defaults to 'config.customProps.text' */
    propertyPath?: string;
  }>;
}

interface EventBusLike {
  emit(eventType: string, payload: unknown, sourceId?: string): void;
}

/**
 * DataSourceManager — centralized management window for page data sources (composes DriverRegistry / TagCache / SubscriptionManager)
 *
 * **v3.0 positioning**: this manager is the centralized management window for all data sources in a page,
 * providing unified viewing, modification and debugging capabilities.
 * It is not a persistence layer — the data source collection is serialized with the page JSON and
 * deserialized directly from the page config at load time.
 */
export class DataSourceManager {
  private _driverRegistry = new DriverRegistry();
  private _tagCache = new TagCache();
  private _subscriptionManager = new SubscriptionManager();
  private _eventBus: EventBusLike;
  private _pageId = '';
  private _projectId = '';
  private _activeTimers: Set<ReturnType<typeof setInterval>> = new Set();
  private _initialized = false;
  /** Consecutive failure count of polling data sources (used for circuit-breaker decisions) */
  private _refreshErrorCounts = new Map<string, number>();
  private static readonly MAX_CONSECUTIVE_ERRORS = 3;

  constructor(eventBus: EventBusLike) {
    this._eventBus = eventBus;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /** Runtime project identifier, read by WebSocketDriver and other drivers */
  getProjectId(): string {
    return this._projectId;
  }

  // ── Driver registration ──────────────────────────────────────

  registerDriverFactory(type: string, factory: () => IDataSourceDriver): void {
    this._driverRegistry.registerDriverFactory(type, factory);
  }

  // ── Page lifecycle ─────────────────────────────────

  async init(pageGroup: PageDataSourceInput): Promise<void> {
    if (this._initialized) await this.destroy();

    this._pageId = pageGroup.pageId;
    this._projectId = pageGroup.projectId ?? '';
    this._subscriptionManager.init(
      pageGroup.graphicBindings.map((b) => ({ ...b })) as BindingInfo[],
      pageGroup.variables as VariableInfo[],
    );

    for (const ds of pageGroup.dataSources) {
      if (ds.enabled === false) continue;
      if (!this._driverRegistry.hasFactory(ds.type)) {
        console.warn(`[DataSourceManager] No driver for type "${ds.type}", source "${ds.name}" skipped`);
        continue;
      }
      const { sourceId, driver, info, statusEntry } = this._driverRegistry.createDriver(
        ds.type, ds.config as Record<string, unknown>, ds.name, ds.id,
      );
      this._connectDriverCallback(sourceId, driver);
      let tagIds = pageGroup.variables
        .filter((v) => v.dataSourceId === ds.id || v.dataSourceId === sourceId)
        .map((v) => v.tagId);
      // Fallback: when variables is empty, extract tagIds from ds.config / ds.properties
      if (tagIds.length === 0) {
        tagIds = extractTagIds((ds as any).config || ds);
      }
      if (tagIds.length > 0) this._subscriptionManager.subscribeToSource(driver, tagIds);
      try {
        // Inject the projectId context for WebSocketDriver and other drivers (does not modify the original config)
        const connectConfig = this._projectId
          ? { ...info.config, projectId: this._projectId } as any
          : info.config;
        await driver.connect(connectConfig);
        // connect() may not throw in some expected scenarios (e.g. not logged in) without actually connecting,
        // so the status must be calibrated via getStatus(); never assume no-exception = connected
        const driverStatus = driver.getStatus();
        info.status = driverStatus;
        if (driverStatus === 'connected') {
          statusEntry.status = 'active';
          this._eventBus.emit('sourceConnected', { sourceId, type: ds.type });
        } else if (driverStatus === 'error') {
          statusEntry.status = 'error';
          statusEntry.errorMessage = info.lastError || 'Connection failed';
          this._eventBus.emit('sourceError', { sourceId, error: info.lastError || 'Connection failed' });
        } else {
          // Non-error states such as disconnected/connecting — the panel shows "disconnected" rather than "error"
          statusEntry.status = 'idle';
          console.log(`[DataSourceManager.init] driver "${ds.name}" status=${driverStatus} at ${Date.now()}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        info.status = 'error';
        info.lastError = msg;
        statusEntry.status = 'error';
        statusEntry.errorMessage = msg;
        this._eventBus.emit('sourceError', { sourceId, error: msg });
      }
      this._applyRefreshStrategy(sourceId, ds.type, ds.config);
    }

    this._initialized = true;
    this._eventBus.emit('dataSourceManagerReady', { pageId: this._pageId });
  }

  async destroy(pageId?: string): Promise<void> {
    if (pageId && pageId !== this._pageId) return;
    for (const timer of this._activeTimers) clearInterval(timer);
    this._activeTimers.clear();

    for (const { id: sourceId } of this._driverRegistry.getAllSources()) {
      const driver = this._driverRegistry.getDriver(sourceId);
      const info = this._driverRegistry.getSource(sourceId);
      if (info) info.status = 'disconnected';
      if (driver) {
        try {
          driver.offData(this._createOnDataCallback(sourceId));
          await driver.disconnect();
        } catch { /* ignore */ }
      }
    }
    this._driverRegistry.clear();
    this._tagCache.clear();
    this._subscriptionManager.clear();
    this._refreshErrorCounts.clear();
    this._pageId = '';
    this._projectId = '';
    this._initialized = false;
    this._eventBus.emit('dataSourceManagerDestroyed', { pageId });
  }

  // ── Data fetch ─────────────────────────────────────

  async fetchAll(): Promise<void> {
    for (const { id } of this._driverRegistry.getAllSources()) await this._fetchSource(id);
  }

  async fetchById(dataSourceId: string): Promise<void> {
    if (this._driverRegistry.getSource(dataSourceId)) await this._fetchSource(dataSourceId);
  }

  // ── Status queries ─────────────────────────────────────

  getStatus(): DataSourceManagerStatus {
    return this._driverRegistry.buildStatus(this._pageId, this._subscriptionManager.getBindings().length);
  }

  getBindings(): BindingInfo[] {
    return this._subscriptionManager.getBindings();
  }

  /** Retrieve bindings by tagId (for DataPipelineBridge to run filter/driver scripts) */
  getBindingsByTagId(tagId: string): BindingInfo[] {
    return this._subscriptionManager.getBindingsByTagId(tagId);
  }

  getVariableMeta(tagId: string): PageDataSourceInput['variables'][0] | undefined {
    return this._subscriptionManager.getVariableMeta(tagId) as PageDataSourceInput['variables'][0] | undefined;
  }

  // ── Tag change listeners ─────────────────────────────────

  onTagValueChanged(handler: TagValueChangeHandler): () => void {
    return this._subscriptionManager.onTagValueChanged(handler);
  }

  // ── Data source register/unregister ──────────────────────────────

  async registerSource(config: DataSourceConfig): Promise<string> {
    const { sourceId, driver, info } = this._driverRegistry.createDriver(
      config.type, (config as unknown as { config: Record<string, unknown> }).config || {}, config.type,
    );
    this._connectDriverCallback(sourceId, driver);
    try {
      await driver.connect(config);
      info.status = 'connected';
      this._eventBus.emit('sourceConnected', { sourceId, type: config.type });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      info.status = 'error';
      info.lastError = msg;
      this._eventBus.emit('sourceError', { sourceId, error: msg });
    }
    return sourceId;
  }

  async unregisterSource(sourceId: string): Promise<void> {
    const driver = this._driverRegistry.removeSource(sourceId);
    if (driver) {
      driver.offData(this._createOnDataCallback(sourceId));
      await driver.disconnect();
    }
    this._eventBus.emit('sourceDisconnected', { sourceId });
    this._tagCache.clearCachedTags(sourceId);
  }

  // ── Start/stop control ─────────────────────────────────────

  async start(): Promise<void> {
    for (const { id } of this._driverRegistry.getAllSources()) {
      const driver = this._driverRegistry.getDriver(id);
      if (driver && driver.getStatus() !== 'connected') {
        const info = this._driverRegistry.getSource(id)!;
        try { await driver.connect(info.config); info.status = 'connected'; } catch { info.status = 'error'; }
      }
    }
  }

  async stop(): Promise<void> {
    for (const { id } of this._driverRegistry.getAllSources()) {
      const driver = this._driverRegistry.getDriver(id);
      const info = this._driverRegistry.getSource(id);
      if (info) info.status = 'disconnected';
      if (driver) await driver.disconnect();
    }
  }

  async pause(sourceId: string): Promise<void> {
    const driver = this._driverRegistry.getDriver(sourceId);
    const info = this._driverRegistry.getSource(sourceId);
    if (driver && info) { info.status = 'disconnected'; await driver.disconnect(); }
    this._driverRegistry.updateStatusEntry(sourceId, { status: 'paused' });
  }

  async resume(sourceId: string): Promise<void> {
    const driver = this._driverRegistry.getDriver(sourceId);
    const info = this._driverRegistry.getSource(sourceId);
    if (driver && info) {
      try { await driver.connect(info.config); info.status = 'connected'; } catch { info.status = 'error'; }
    }
    this._driverRegistry.updateStatusEntry(sourceId, { status: 'active' });
  }

  // ── Data reading ─────────────────────────────────────

  subscribeToSource(sourceId: string, tagIds: string[]): void {
    this._subscriptionManager.subscribeToSource(this._driverRegistry.getDriver(sourceId), tagIds);
  }

  getCachedValue(tagId: string): TagValue | undefined {
    return this._tagCache.getCachedValue(tagId);
  }

  getAllCachedValues(): Map<string, TagValue> {
    return this._tagCache.getAllCachedValues();
  }

  getSource(sourceId: string): DataSourceInfo | undefined {
    return this._driverRegistry.getSource(sourceId);
  }

  getSourceRawData(sourceId: string): Record<string, unknown> | undefined {
    return this._tagCache.getSourceRawData(sourceId);
  }

  getAllSources(): DataSourceInfo[] {
    return this._driverRegistry.getAllSources();
  }

  getDriver(sourceId: string): IDataSourceDriver | undefined {
    return this._driverRegistry.getDriver(sourceId);
  }

  async writeTag(sourceId: string, tagId: string, value: unknown): Promise<void> {
    const driver = this._driverRegistry.getDriver(sourceId);
    if (driver) await driver.write(tagId, value);
  }

  // ── Internal methods ─────────────────────────────────────

  private _connectDriverCallback(sourceId: string, driver: IDataSourceDriver): void {
    driver.onData(this._createOnDataCallback(sourceId));
  }

  private _createOnDataCallback(sourceId: string): (values: TagValue[]) => void {
    return (values) => this._onDataReceived(sourceId, values);
  }

  private _onDataReceived(sourceId: string, values: TagValue[]): void {
    const now = Date.now();
    this._driverRegistry.updateStatusEntry(sourceId, { lastFetchTime: now });
    // Circuit breaker: update the error count based on the pushed data quality (replacing the _fetchSource error capture in the old double-layer polling)
    this._updateCircuitBreaker(sourceId, values);
    const changes = this._tagCache.processReceivedData(sourceId, values);
    if (changes.length > 0) {
      console.log(`[DataSourceManager._onData] source=${sourceId}, changes=${changes.length}: ${changes.map(c => `${c.tagId.slice(0,8)}=${String(c.value).slice(0,20)}`).join(', ')}`);
    }
    for (const change of changes) {
      const payload = { ...change, timestamp: now };
      this._eventBus.emit('tagValueChanged', payload);
      this._subscriptionManager.notifyTagValueChanged(payload);
    }
  }

  /**
   * Circuit breaker: count when a driver pushes stale/bad quality data; on reaching the threshold consecutively, emit sourceError.
   * Resets the count on good data. Replaces the _fetchSource error capture logic in the old _applyRefreshStrategy.
   */
  private _updateCircuitBreaker(sourceId: string, values: TagValue[]): void {
    const hasBadQuality = values.some((v) => v.quality === 'stale' || v.quality === 'bad');
    if (hasBadQuality) {
      const prev = this._refreshErrorCounts.get(sourceId) || 0;
      const count = prev + 1;
      this._refreshErrorCounts.set(sourceId, count);
      this._driverRegistry.updateStatusEntry(sourceId, { status: 'error', errorMessage: `数据质量降级 (连续 ${count} 次)` });
      if (count >= DataSourceManager.MAX_CONSECUTIVE_ERRORS) {
        this._eventBus.emit('sourceError', { sourceId, error: `连续 ${count} 次推送降级数据` });
      }
    } else if (this._refreshErrorCounts.get(sourceId)) {
      this._refreshErrorCounts.delete(sourceId);
      this._driverRegistry.updateStatusEntry(sourceId, { status: 'active', errorMessage: undefined });
    }
  }

  private async _fetchSource(sourceId: string): Promise<void> {
    const driver = this._driverRegistry.getDriver(sourceId);
    const info = this._driverRegistry.getSource(sourceId);
    if (!driver || !info) return;
    this._driverRegistry.updateStatusEntry(sourceId, { status: 'loading' });
    try {
      await driver.connect(info.config);
      info.status = 'connected';
      this._driverRegistry.updateStatusEntry(sourceId, { status: 'active', lastFetchTime: Date.now() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Fetch failed';
      info.status = 'error';
      info.lastError = msg;
      this._driverRegistry.updateStatusEntry(sourceId, { status: 'error', errorMessage: msg });
    }
  }

  /**
   * Refresh strategy: drivers poll autonomously; DSM no longer starts timers (eliminating double-layer polling).
   * - static/tag/websocket: no polling
   * - api/polling/sql: the driver's internal _startPolling manages its own timer
   * - The circuit-breaker logic has moved to _onDataReceived → _updateCircuitBreaker
   *
   * Kept as an extension point (future on-demand refresh, health checks and other strategies can hook here).
   */
  private _applyRefreshStrategy(_sourceId: string, _dsType: string, _dsConfig: Record<string, unknown>): void {
    // no-op: drivers self-manage polling; DSM monitors data quality via the _onDataReceived circuit breaker
  }
}