// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { createChartDataSource } from './data-source/factory';
import { createEmptyResult } from './data-source/static';
import type {
  ChartDataResult,
  ChartDataSource,
  ChartDataSourceConfig,
  DatabaseDataSource,
  DatabaseDataSourceDeps,
} from './data-source';

/** Full dependencies available to the composable (extends DatabaseDataSourceDeps with realtime-refresh fields) */
export interface ChartSourceDeps extends DatabaseDataSourceDeps {
  wsStore: DatabaseDataSourceDeps['wsStore'] & {
    /** WS batch-refresh version (triggers latest-mode realtime refresh when changed) */
    tagFlushVersion?: number;
    /** Connection status (for reconnect compensation; optional) */
    isConnected?: boolean;
  };
}

/**
 * Chart data source composable: centrally manages the lifecycle of
 * "create → subscribe → load → realtime refresh → unmount cleanup".
 * - static / api: load on mount; api polling pushes via onChange;
 * - database(latest): additionally watches wsStore.tagFlushVersion and refreshes via readLatest on change;
 * - automatically rebuilds the data source and reloads when the config
 *   (data source type / mode / bound variables) changes.
 */
export function useChartSource(
  getConfig: () => ChartDataSourceConfig,
  deps?: ChartSourceDeps,
) {
  const result = ref<ChartDataResult>(createEmptyResult());
  const source = shallowRef<ChartDataSource | null>(null);

  async function reload() {
    const current = source.value;
    if (!current) return;
    result.value = await current.load();
  }

  /** Create / rebuild the data source: unsubscribe from the old source, create the new one, subscribe and load the baseline */
  async function resetSource() {
    source.value?.unsubscribe();
    let next: ChartDataSource;
    try {
      next = createChartDataSource(getConfig(), deps);
    } catch (error) {
      source.value = null;
      result.value = {
        dimensions: [],
        source: [],
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      return;
    }

    source.value = next;
    next.onChange((value) => {
      result.value = value;
    });
    next.subscribe();
    await reload();
  }

  onMounted(() => {
    void resetSource();
  });

  // Rebuild when the data source config / bindings change (e.g. editing adds/removes variables, switches type / mode)
  watch(getConfig, () => {
    void resetSource();
  });

  // Database latest mode: read realtime latest values after a WS batch refresh
  watch(
    () => deps?.wsStore?.tagFlushVersion,
    () => {
      const current = source.value as DatabaseDataSource | null;
      if (current && 'readLatest' in current) {
        result.value = current.readLatest();
      }
    },
  );

  // In edit mode the wsStore connection may be established only after the graphic is bound;
  // subscribe again once the connection is established.
  // DatabaseDataSource.subscribe is idempotent internally and won't register early when not connected.
  watch(
    () => deps?.wsStore?.isConnected,
    (connected) => {
      if (connected) {
        source.value?.subscribe();
      }
    },
  );

  onUnmounted(() => {
    source.value?.unsubscribe();
    source.value = null;
  });

  return { result, reload };
}
