// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type {
  ApiSourceConfig,
  ChartDataSource,
  ChartDataResult,
} from './types';

/** Get a nested value by dot-path (e.g. 'data.list' → obj.data.list) */
function pickByPath(target: unknown, dataPath?: string): unknown {
  if (!dataPath) return target;
  const segments = dataPath.split('.').filter(Boolean);
  let current: any = target;
  for (const segment of segments) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * API data source: fetch external / aggregated data via HTTP and normalize it
 * into dimensions + source per the mapping. Supports polling (when pollingInterval > 0,
 * reloads on a timer and notifies listeners).
 */
export function createApiDataSource(config: ApiSourceConfig): ChartDataSource {
  const listeners = new Set<(result: ChartDataResult) => void>();
  let pollingTimer: ReturnType<typeof setInterval> | null = null;

  function notify(result: ChartDataResult) {
    listeners.forEach((listener) => listener(result));
  }

  async function load(): Promise<ChartDataResult> {
    const timeout = Number(config.timeout) || 15000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(config.url, {
        method: config.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(config.headers ?? {}) },
        body: config.method === 'POST' ? JSON.stringify(config.body ?? {}) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          dimensions: [],
          source: [],
          state: 'error',
          error: `HTTP ${response.status}`,
        };
      }

      const payload = await response.json();
      const list = pickByPath(payload, config.dataPath);
      const rows = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];

      const dimensions = config.mapping?.dimensions ?? [];
      const source = rows.map((row) => ({
        [config.mapping?.categoryField ?? 'name']: row[config.mapping?.categoryField ?? 'name'],
        [config.mapping?.valueField ?? 'value']: row[config.mapping?.valueField ?? 'value'],
      }));

      return {
        dimensions,
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
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  function startPolling() {
    const interval = Number(config.pollingInterval);
    if (!Number.isFinite(interval) || interval <= 0) return;
    stopPolling();
    pollingTimer = setInterval(() => {
      void load().then(notify);
    }, interval);
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  return {
    type: 'api',
    load,
    subscribe: () => startPolling(),
    unsubscribe: () => stopPolling(),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
