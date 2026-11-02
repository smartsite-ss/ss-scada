// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type {
  ChartDataSource,
  ChartDataResult,
  DatabaseSourceConfig,
} from './types';

/** Infrastructure (fetch + subscribe) that the database data source depends on (injected by the plugin layer to avoid shared reverse-depending on system) */
export interface DatabaseDataSourceDeps {
  dataQueryApi: {
    queryTrend: (params: {
      tagIds: string[];
      startTime: string;
      endTime: string;
      maxPoints?: number;
      projectId?: string;
      interpolation?: string;
      interval?: number;
    }) => Promise<{
      data: Array<{ tagId: string; data: Array<{ timestamp: string; value: number | null }> }>;
      pagination: { total: number };
    }>;
    getLatest: (
      tagIds: string[],
    ) => Promise<Array<{ tagId: string; value: number | string | boolean | null; timestamp: string }>>;
    getAggregated: (params: {
      tagIds: string[];
      startTime: Date;
      endTime: Date;
      function: 'avg' | 'max' | 'min' | 'sum' | 'count';
      interval?: string;
    }) => Promise<Array<{ tagId: string; value: number; timestamp: string; count?: number }>>;
  };
  wsStore: {
    subscribeTags: (tagIds: string[]) => void;
    unsubscribeTags: (tagIds: string[]) => void;
    getTagValue: (tagId: string) => unknown;
    /** Connection status: in edit mode the connection may be established only after binding, so don't subscribe while disconnected and resubscribe once connected */
    isConnected?: boolean;
  };
}

/** Database data source (extends ChartDataSource with realtime latest-value reading) */
export interface DatabaseDataSource extends ChartDataSource {
  /** Read the realtime latest values of bound variables from wsStore and notify listeners (for gauge/liquid/progress/bar/pie/radar realtime refresh) */
  readLatest(): ChartDataResult;
}

function parsePoint(raw: { timestamp: string; value: number | null }): [number, number] | null {
  const time = new Date(raw.timestamp).getTime();
  const value = Number(raw.value);
  if (Number.isNaN(time) || raw.value === null || raw.value === undefined || Number.isNaN(value)) {
    return null;
  }
  return [time, value];
}

function tagName(config: DatabaseSourceConfig, tagId: string): string {
  const tag = config.tags.find((t) => t.tagId === tagId);
  return tag?.tagName || tag?.deviceName || tagId;
}

/**
 * Database (variable-related) data source: bind tag variables; time-series via queryTrend,
 * latest via getLatest, aggregation via getAggregated; realtime subscription via wsStore.
 */
export function createDatabaseDataSource(
  config: DatabaseSourceConfig,
  deps: DatabaseDataSourceDeps,
): DatabaseDataSource {
  const listeners = new Set<(result: ChartDataResult) => void>();

  function notify(result: ChartDataResult) {
    listeners.forEach((listener) => listener(result));
  }

  async function loadSeries(): Promise<ChartDataResult> {
    const tagIds = config.tags.map((t) => t.tagId).filter(Boolean);
    if (tagIds.length === 0) return { dimensions: [], source: [], state: 'empty' };

    const end = config.seriesConfig?.endTime
      ? new Date(config.seriesConfig.endTime).getTime()
      : Date.now();
    const start = config.seriesConfig?.startTime
      ? new Date(config.seriesConfig.startTime).getTime()
      : end - 60 * 60 * 1000;

    try {
      const res = await deps.dataQueryApi.queryTrend({
        tagIds,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        maxPoints: config.seriesConfig?.maxPoints ?? 2000,
        interpolation: config.seriesConfig?.interpolation ?? 'raw',
        interval: config.seriesConfig?.interval,
        projectId: config.tags[0]?.projectId,
      });

      const series = (res.data ?? []).map((item) => ({
        tagId: item.tagId,
        name: tagName(config, item.tagId),
        data: (item.data ?? [])
          .map(parsePoint)
          .filter((p): p is [number, number] => p !== null),
      }));

      return {
        dimensions: ['time', 'value'],
        source: [],
        series,
        state: series.every((s) => s.data.length === 0) ? 'empty' : 'ready',
      };
    } catch (error) {
      return {
        dimensions: [],
        source: [],
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function loadLatest(): Promise<ChartDataResult> {
    // latest-mode realtime values are uniformly provided by WebSocket (readLatest refresh driven by tagFlushVersion);
    // no longer fetched via HTTP /data/latest to avoid hitting a non-existent endpoint and erroring.
    return readLatest();
  }

  async function loadAggregate(): Promise<ChartDataResult> {
    const tagIds = config.tags.map((t) => t.tagId).filter(Boolean);
    if (tagIds.length === 0) return { dimensions: [], source: [], state: 'empty' };

    try {
      const fn = config.aggregateConfig?.function ?? 'avg';
      const end = new Date();
      const start = new Date(end.getTime() - 60 * 60 * 1000);
      const points = await deps.dataQueryApi.getAggregated({
        tagIds,
        startTime: start,
        endTime: end,
        function: fn,
        interval: config.aggregateConfig?.interval,
      });

      const byTagId = new Map(points.map((p) => [p.tagId, p.value]));
      const source = config.tags
        .filter((t) => byTagId.has(t.tagId))
        .map((t) => ({
          name: t.tagName || t.deviceName || t.tagId,
          value: byTagId.get(t.tagId) ?? 0,
        }));

      return {
        dimensions: ['name', 'value'],
        source,
        state: source.length === 0 ? 'empty' : 'ready',
      };
    } catch (error) {
      return {
        dimensions: [],
        source: [],
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function load(): Promise<ChartDataResult> {
    switch (config.mode) {
      case 'series':
        return loadSeries();
      case 'latest':
        return loadLatest();
      case 'aggregate':
        return loadAggregate();
      default:
        return Promise.resolve({ dimensions: [], source: [], state: 'empty' });
    }
  }

  function tagIds(): string[] {
    return config.tags.map((t) => t.tagId).filter(Boolean);
  }

  let subscribed = false;

  function subscribe(): void {
    if (subscribed) return;
    const ids = tagIds();
    if (ids.length === 0) return;
    // In edit mode the wsStore connection may be established only after the graphic is bound;
    // don't subscribe while disconnected, resubscribe once useChartSource detects isConnected.
    if (deps.wsStore.isConnected === false) return;
    deps.wsStore.subscribeTags(ids);
    subscribed = true;
  }

  function unsubscribe(): void {
    const ids = tagIds();
    if (ids.length > 0) deps.wsStore.unsubscribeTags(ids);
    subscribed = false;
  }

  function readLatest(): ChartDataResult {
    const series = config.tags
      .filter((t) => t.tagId)
      .map((t) => {
        const raw = deps.wsStore.getTagValue(t.tagId);
        const value = Number(raw);
        return {
          tagId: t.tagId,
          name: t.tagName || t.deviceName || t.tagId,
          data: [Number.isFinite(value) ? value : 0] as Array<number>,
        };
      });

    const result: ChartDataResult = {
      dimensions: ['value'],
      source: [],
      series,
      state: series.length === 0 ? 'empty' : 'ready',
    };
    notify(result);
    return result;
  }

  return {
    type: 'database',
    load,
    subscribe,
    unsubscribe,
    readLatest,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
