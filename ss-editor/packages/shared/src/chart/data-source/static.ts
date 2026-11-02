// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type {
  ChartDataSource,
  ChartDataResult,
  StaticSourceConfig,
} from './types';

/** Convenience constructor for an empty result */
export function createEmptyResult(): ChartDataResult {
  return { dimensions: [], source: [], state: 'empty' };
}

/**
 * Static data source: data is fixed inside the component config, with no backend dependency.
 * load() returns the dimensions + source from config directly; no subscription.
 */
export function createStaticDataSource(config: StaticSourceConfig): ChartDataSource {
  const listeners = new Set<(result: ChartDataResult) => void>();

  function buildResult(): ChartDataResult {
    const dimensions = Array.isArray(config.dimensions) ? config.dimensions : [];
    const source = Array.isArray(config.source) ? config.source : [];
    return {
      dimensions,
      source,
      state: source.length === 0 ? 'empty' : 'ready',
    };
  }

  return {
    type: 'static',
    load: () => Promise.resolve(buildResult()),
    subscribe: () => {
      /* static data source has no subscription */
    },
    unsubscribe: () => {
      /* static data source holds no resources */
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
