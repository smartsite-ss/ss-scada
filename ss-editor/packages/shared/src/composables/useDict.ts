// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref } from 'vue';

/**
 * Dictionary item
 */
export interface DictItem {
  value: string;
  label: string;
  sortOrder: number;
  description: string;
}

/**
 * Dictionary table
 */
export interface DictTable {
  dictId: string;
  dictName: string;
  category: string;
  description: string;
  version: string;
  sortOrder: number;
  items: DictItem[];
}

/**
 * Dropdown option
 */
export interface DictOption {
  label: string;
  value: string;
}

// ===== Module-level cache (shared across components to avoid duplicate requests) =====

/** dictId → dictionary item list */
const dictCache = new Map<string, DictItem[]>();

/** dictId → in-flight loading Promise (prevents concurrent duplicate requests) */
const loadingPromises = new Map<string, Promise<DictItem[]>>();

const API_BASE = '/api/v1';
const TOKEN_KEY = 'scada_access_token';

/**
 * Load dictionary table data from the backend.
 * Returns cached data directly when available; reuses the same Promise while loading.
 */
function fetchDict(dictId: string): Promise<DictItem[]> {
  if (dictCache.has(dictId)) {
    return Promise.resolve(dictCache.get(dictId)!);
  }
  if (loadingPromises.has(dictId)) {
    return loadingPromises.get(dictId)!;
  }

  const promise = (async (): Promise<DictItem[]> => {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}/dicts/${encodeURIComponent(dictId)}`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(`加载字典 "${dictId}" 失败: ${response.status}`);
    }

    const json = await response.json();
    const table: DictTable | null = json?.data ?? null;
    if (!table) {
      throw new Error(`字典 "${dictId}" 不存在`);
    }

    const items = table.items ?? [];
    dictCache.set(dictId, items);
    return items;
  })();

  loadingPromises.set(dictId, promise);
  promise.finally(() => {
    loadingPromises.delete(dictId);
  });
  return promise;
}

/**
 * useDict — reactive dictionary query composable
 *
 * Wraps lazy loading, caching, label resolution, and option generation for dictionary data.
 * Uses a module-level Map cache so multiple components share the same dictionary data
 * and avoid duplicate requests.
 *
 * @example
 * ```ts
 * const { loadDict, getDictLabel, getDictOptions } = useDict();
 * await loadDict('priority');
 * const label = await getDictLabel('priority', 'high'); // "High priority"
 * const opts = await getDictOptions('priority');        // [{ label, value }, ...]
 * ```
 */
export function useDict() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Load dictionary table data (with cache)
   * @param dictId Dictionary identifier
   * @returns Dictionary item list
   */
  async function loadDict(dictId: string): Promise<DictItem[]> {
    loading.value = true;
    error.value = null;
    try {
      return await fetchDict(dictId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载字典失败';
      error.value = msg;
      throw e;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Get the label text for a single value
   * @param dictId Dictionary identifier
   * @param value Dictionary item value
   * @returns The matching label; returns the value itself when no match
   */
  async function getDictLabel(dictId: string, value: string): Promise<string> {
    const items = await fetchDict(dictId);
    const item = items.find((it) => it.value === value);
    return item?.label ?? value;
  }

  /**
   * Get the dropdown option list (sorted by sortOrder ascending)
   * @param dictId Dictionary identifier
   * @returns Option array [{ label, value }]
   */
  async function getDictOptions(dictId: string): Promise<DictOption[]> {
    const items = await fetchDict(dictId);
    return [...items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({ label: item.label, value: item.value }));
  }

  /**
   * Clear the cache for a specific dictionary (or all when omitted)
   */
  function clearCache(dictId?: string): void {
    if (dictId) {
      dictCache.delete(dictId);
    } else {
      dictCache.clear();
    }
  }

  return {
    /** Whether loading is in progress */
    loading,
    /** Error message */
    error,
    /** Load dictionary table data (with cache) */
    loadDict,
    /** Get a single label text */
    getDictLabel,
    /** Get the dropdown option list */
    getDictOptions,
    /** Clear the cache */
    clearCache,
  };
}
