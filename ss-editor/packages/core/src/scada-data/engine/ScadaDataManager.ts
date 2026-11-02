// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { EventBus } from './EventBus';
import { DataSourceManager } from './DataSourceManager';
import type { PageDataSourceInput } from './DataSourceManager';
import type { IDataSourceDriver } from '../drivers/IDataSourceDriver';
import { DataPipeline } from './DataPipeline';
import { DataDriverEngine } from './DataDriverEngine';
import { DataPipelineBridge } from './DataPipelineBridge';

/**
 * ScadaDataManager — unified scheduling entry for global data sources
 *
 * Responsibilities:
 * - Holds the global EventBus singleton
 * - Holds the global DataSourceManager singleton
 * - Holds DataPipeline / DataDriverEngine / DataPipelineBridge singletons
 * - Provides init() to register driver factories (injected by the app layer, e.g. WebSocketDriver)
 * - Provides initPage() to initialize data sources at page load and start filter/driver script execution
 * - Provides destroyPage() to clean up at page unload
 */
class ScadaDataManagerClass {
  private _eventBus: EventBus;
  private _dataSourceManager: DataSourceManager;
  private _dataPipeline: DataPipeline;
  private _dataDriverEngine: DataDriverEngine;
  private _pipelineBridge: DataPipelineBridge | null = null;

  constructor() {
    this._eventBus = new EventBus();
    this._dataSourceManager = new DataSourceManager(this._eventBus);
    this._dataPipeline = new DataPipeline();
    this._dataDriverEngine = new DataDriverEngine();
  }

  get eventBus(): EventBus {
    return this._eventBus;
  }

  get dataSourceManager(): DataSourceManager {
    return this._dataSourceManager;
  }

  get dataPipeline(): DataPipeline {
    return this._dataPipeline;
  }

  get dataDriverEngine(): DataDriverEngine {
    return this._dataDriverEngine;
  }

  /**
   * Initialization: register driver factories.
   * Should be called once at app startup (main.ts), passing the WebSocketDriver factory.
   */
  init(driverFactories: Record<string, () => IDataSourceDriver>): void {
    for (const [type, factory] of Object.entries(driverFactories)) {
      this._dataSourceManager.registerDriverFactory(type, factory);
    }
  }

  /**
   * Initialize data sources at page load.
   * Auto-subscribes tags; when data arrives, tagValueChanged events are emitted via EventBus.
   * Also starts DataPipelineBridge so filterScript/driverScript run automatically on data arrival.
   */
  async initPage(pageGroup: PageDataSourceInput): Promise<void> {
    await this._dataSourceManager.init(pageGroup);

    // Start DataPipelineBridge: listen to DataSourceManager's tagValueChanged,
    // and run data pipelines per binding's filterScript / driverScript
    this._pipelineBridge = new DataPipelineBridge({
      dataSourceManager: this._dataSourceManager,
      dataPipeline: this._dataPipeline,
      dataDriverEngine: this._dataDriverEngine,
      getBindingsByTagId: (tagId) => this._dataSourceManager.getBindingsByTagId(tagId)
        .map((b) => ({
          graphicId: b.graphicId,
          tagId: b.tagId,
          graphicName: b.graphicName,
          graphicType: b.graphicType,
          filterScript: b.filterScript,
          driverScript: b.driverScript,
        })),
      getVariableMeta: (tagId) => {
        const meta = this._dataSourceManager.getVariableMeta(tagId);
        return meta ? (meta as Record<string, unknown>) : {};
      },
    });
    this._pipelineBridge.start();
  }

  /**
   * Clean up data sources at page unload.
   */
  async destroyPage(): Promise<void> {
    if (this._pipelineBridge) {
      this._pipelineBridge.stop();
      this._pipelineBridge = null;
    }
    await this._dataSourceManager.destroy();
  }

  /**
   * Get the data source manager's status (for the debug panel).
   */
  getStatus() {
    return this._dataSourceManager.getStatus();
  }

  /**
   * Manually fetch all data sources (for the manual refresh button).
   */
  async fetchAll(): Promise<void> {
    await this._dataSourceManager.fetchAll();
  }

  /**
   * Get a single tag's cached live value (for the runtime data panel).
   */
  getTagValue(tagId: string): any {
    return this._dataSourceManager.getCachedValue(tagId);
  }
}

/** Global singleton */
export const ScadaDataManager = new ScadaDataManagerClass();
