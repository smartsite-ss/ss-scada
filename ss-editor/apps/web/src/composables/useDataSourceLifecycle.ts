// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { watch } from 'vue';
import { ScadaDataManager, BindingManager } from '@scada-editor/core';
import { usePageDataSourceStore, useWsStore } from '@scada-editor/system';

/**
 * Extract the binding list from the dataSource configuration of the page graphic element.
 *
 * graphicBindings may not be persisted to the page JSON (or may be outdated). This function serves as the sole build entry point,
 * for EditorView / PreviewView to rebuild the latest bindings before activating the data pipeline.*/
export function buildGraphicBindingsFromPage(page: any): any[] {
  const rawGraphics = page?.graphics?.value || page?.graphics || [];
  const entries: any[] = [];
  for (const graphic of rawGraphics) {
    const graphicDataSource = graphic?.dataSource;
    if (!graphicDataSource?.enabled || !graphicDataSource?.dataSource) continue;
    entries.push({
      graphicId: graphic.id,
      dataSourceId: graphicDataSource.dataSource,
      propertyPath: graphicDataSource.propertyPath || 'config.customProps.text',
      filterScript: graphicDataSource.filterScript || '',
      driverScript: graphicDataSource.driverScript || '',
    });
  }
  return entries;
}

/**
 * useDataSourceLifecycle — unified lifecycle management for page data sources
 *
 * Extracted from the duplicated logic in PreviewView.initDataSourceManager / EditorView.preview:
 * 1. Merge graphicBindings with the graphic's own dataSource config (filterScript/driverScript/propertyPath fallback)
 * 2. ScadaDataManager.initPage starts the data-source scheduling
 * 3. pageDataSourceStore.loadGroup loads the runtime data-panel state
 * 4. BindingManager.bind registers the property-path mappings in batch
 *
 * Complementary relationship:
 * - DataSourceManager handles drivers/pipeline/AQ subscriptions (filterScript/driverScript execution)
 * - BindingManager handles property-path mapping (expression/format -> applyProperty)
 * - The two are complementary, not redundant; each takes on a different role once data arrives
 */
export function useDataSourceLifecycle() {
  const wsStore = useWsStore();
  /** Compensation subscription listener: WS is not connected when bind is executed (subscription is discarded), and it is reissued once after successful connection.*/
  let subscriptionResyncStop: (() => void) | null = null;

  /**
   * Initialize the lifecycle of the page data source.
   *
   * @param pageData Current page JSON (must contain the dataSource field and the getGraphicById method)
   * @param projectId Project identifier (used by WebSocketDriver to establish a connection)
   * @param logTag Log prefix (e.g., 'PreviewView' / 'EditorView') for easy problem identification*/
  async function initDataSourceLifecycle(
    pageData: any,
    projectId: string,
    logTag = 'useDataSourceLifecycle',
  ): Promise<void> {
    try {
      //Decoupling of independent wsStore connections from the dataSource lifecycle: Even if the page is not configured with any data sources,
      //"Direct Binding" element (tag-variable / tag-trend, binding information is written in config.customProps)
      //wsStore also needs to be connected in order to receive real-time data in edit mode/runtime mode.
      const isRealProject =
        !!projectId && projectId !== 'template-mode' && projectId !== 'default-project';
      if (isRealProject) {
        try {
          await wsStore.connect(projectId);
        } catch {
          //wsStore connection failures (e.g., connect_error) should not block data source initialization
        }
      }

      const dataSourceGroup = pageData?.dataSource;
      if (!dataSourceGroup?.dataSources?.length) {
        return;
      }

      const currentPage = pageData;
      if (!currentPage) {
        console.warn(`[${logTag}] initDataSourceLifecycle: currentPage not ready`);
        return;
      }

      //── Merge graphicBindings with the dataSource configuration of the graphic element itself ──
      //filterScript / driverScript / propertyPath writes to graphic.dataSource in edit mode,
      //And pageGroup.graphicBindings may not be persisted/synchronized, and needs to be read from the graphic element as a fallback;
      //Rebuild from graphic element configuration when graphicBindings is empty (Fix: All bindings are skipped when the preview state is opened for the first time)
      const persistedBindings = dataSourceGroup.graphicBindings ?? [];
      const rawBindings = persistedBindings.length > 0
        ? persistedBindings
        : buildGraphicBindingsFromPage(currentPage);
      dataSourceGroup.graphicBindings = rawBindings;
      const variables = dataSourceGroup.variables ?? [];
      const graphicBindings = rawBindings.map((gb: any) => {
        const graphic = currentPage.getGraphicById?.(gb.graphicId);
        const gd = graphic?.dataSource;
        return {
          ...gb,
          filterScript: gb.filterScript ?? gd?.filterScript,
          driverScript: gb.driverScript ?? gd?.driverScript,
          propertyPath: gb.propertyPath ?? gd?.propertyPath,
        };
      });

      //── Launch DataSourceManager: Inject projectId context ──
      //WebSocketDriver.connect will read the projectId to establish a WS connection and subscribe to labels
      //DataPipelineBridge listens to tagValueChanged and executes according to filterScript/driverScript
      await ScadaDataManager.initPage({
        pageId: currentPage.id,
        projectId,
        dataSources: dataSourceGroup.dataSources,
        variables,
        graphicBindings,
      });

      //── Load pageDataSourceStore (for runtime data panel/debugging only) ──
      const pageDsStore = usePageDataSourceStore();
      pageDsStore.loadGroup({
        pageId: currentPage.id,
        dataSources: dataSourceGroup.dataSources,
        variables,
        graphicBindings,
      });

      //── Runtime registration of data binding to BindingManager ──
      //DataSourceManager is responsible for driver/pipeline/AQ subscriptions; BindingManager is responsible for property path mapping
      //(handleDataUpdate → graphicStore.applyProperty), the two are complementary and not redundant
      for (const gb of rawBindings) {
        const graphic = currentPage.getGraphicById?.(gb.graphicId);
        if (!graphic) continue;
        const dataSourceId = gb.dataSourceId || gb.tagId;
        const dsVars = variables.filter((v: any) => v.dataSourceId === dataSourceId);
        if (dsVars.length === 0) continue;
        const propertyPath = graphic.dataSource?.propertyPath
          || gb.propertyPath
          || 'config.customProps.text';
        for (const v of dsVars) {
          BindingManager.getInstance().bind(gb.graphicId, v.tagId, v.tagName || v.tagId, propertyPath);
        }
      }

      //── Compensatory Subscription ──
      //subscribeTags are silently discarded when WS is not connected, and the internal reference count of BindingManager has been incremented,
      //The subscription will not be re-triggered subsequently; if the connection is not ready when bind is executed, it will be re-sent once the connection is successful.
      subscriptionResyncStop?.();
      subscriptionResyncStop = null;
      if (!wsStore.isConnected) {
        subscriptionResyncStop = watch(
          () => wsStore.isConnected,
          (connected) => {
            if (!connected) return;
            BindingManager.getInstance().resyncTagSubscriptions();
            subscriptionResyncStop?.();
            subscriptionResyncStop = null;
          },
        );
      }
    } catch (err) {
      console.warn(`[${logTag}] initDataSourceLifecycle failed:`, err);
    }
  }

  /**
   * Destroys the lifecycle of the page data source (called when the page is unloaded/preview is closed).*/
  async function destroyDataSourceLifecycle(): Promise<void> {
    subscriptionResyncStop?.();
    subscriptionResyncStop = null;
    try {
      await ScadaDataManager.destroyPage();
    } catch {
      /* ignore */
    }
  }

  return {
    initDataSourceLifecycle,
    destroyDataSourceLifecycle,
  };
}
