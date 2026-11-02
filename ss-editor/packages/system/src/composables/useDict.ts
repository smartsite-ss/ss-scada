// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, reactive, onUnmounted } from 'vue';
import { dictApi, type DictTable } from '../api/modules/dict.api';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * useDict — reactive dictionary query composable
 *
 * Encapsulates common logic such as lazy loading, caching, label resolution and option generation for dictionary data.
 * Unfinished requests are automatically aborted when the component unmounts.
 *
 * @example
 * ```ts
 * const { loadDict, getLabel, getOptions } = useDict();
 * await loadDict('priority');
 * const label = getLabel('priority', 'high'); // "High priority"
 * const opts = getOptions('tagDataType');     // [{ value, label }, ...]
 * ```
 */
export function useDict() {
  const dicts = reactive<Record<string, DictTable>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);
  const loadingDicts = new Set<string>();
  let aborted = false;

  /** Cleanup flag; aborts subsequent operations when the component unmounts */
  onUnmounted(() => {
    aborted = true;
  });

  /**
   * Load a single dictionary (skips the request when a cache exists)
   * @param dictId Dictionary identifier
   * @param locale Locale; defaults to the current i18n locale or 'zh-CN'
   */
  async function loadDict(dictId: string, locale?: string): Promise<DictTable> {
    if (dicts[dictId]) return dicts[dictId];
    if (loadingDicts.has(dictId)) {
      // Already loading; wait for the polling to finish
      return new Promise((resolve, reject) => {
        const check = setInterval(() => {
          if (aborted) {
            clearInterval(check);
            reject(new Error('组件已卸载'));
          }
          if (dicts[dictId]) {
            clearInterval(check);
            resolve(dicts[dictId]);
          }
        }, 50);
      });
    }

    loadingDicts.add(dictId);
    loading.value = true;
    error.value = null;

    try {
      const res = await dictApi.getDict(dictId, locale);
      if (aborted) throw new Error('组件已卸载');
      if (res.data) {
        dicts[dictId] = res.data;
        return res.data;
      }
      throw new Error(`字典 "${dictId}" 不存在`);
    } catch (e: any) {
      error.value = e?.message || '加载字典失败';
      throw e;
    } finally {
      loadingDicts.delete(dictId);
      if (loadingDicts.size === 0) {
        loading.value = false;
      }
    }
  }

  /**
   * Load multiple dictionaries in batch
   */
  async function loadDicts(dictIds: string[], locale?: string): Promise<void> {
    await Promise.all(dictIds.map((id) => loadDict(id, locale)));
  }

  /**
   * Get a dictionary from cache
   */
  function getDict(dictId: string): DictTable | undefined {
    return dicts[dictId];
  }

  /**
   * Get the label corresponding to a value
   * @param dictId Dictionary identifier
   * @param value Dictionary entry value
   * @param fallback Fallback text when unmatched; defaults to the value itself
   */
  function getLabel(dictId: string, value: string, fallback?: string): string {
    const dict = dicts[dictId];
    if (!dict) return fallback ?? value;
    const item = dict.items.find((it) => it.value === value);
    return item?.label ?? fallback ?? value;
  }

  /**
   * Get the dropdown option list (sorted by sortOrder)
   */
  function getOptions(dictId: string): SelectOption[] {
    const dict = dicts[dictId];
    if (!dict) return [];
    return [...dict.items]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => ({ value: item.value, label: item.label }));
  }

  /**
   * Reload all loaded dictionaries
   * @param locale Locale; when omitted, the locale used at last load is reused
   */
  async function reloadAll(locale?: string): Promise<void> {
    const ids = Object.keys(dicts);
    clearCache();
    await loadDicts(ids, locale);
  }

  /**
   * Clear the cache
   */
  function clearCache(): void {
    Object.keys(dicts).forEach((key) => delete dicts[key]);
  }

  return {
    /** Cache of loaded dictionaries, keyed by dictId */
    dicts,
    /** Whether loading is in progress */
    loading,
    /** Error message */
    error,
    /** Load a single dictionary */
    loadDict,
    /** Load multiple dictionaries in batch */
    loadDicts,
    /** Get a dictionary from cache */
    getDict,
    /** Get the label for a value */
    getLabel,
    /** Get the dropdown option list */
    getOptions,
    /** Reload all loaded dictionaries */
    reloadAll,
    /** Clear the cache */
    clearCache,
  };
}