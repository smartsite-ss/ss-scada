// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Knowledge base Composable
 *
 * Provides knowledge base loading, caching, querying and refreshing capabilities.
 * As a Vue composition function it can be reused in components.
 */

import { ref, computed, readonly, type DeepReadonly } from 'vue';
import {
  fetchKnowledgeBase,
  fetchVersions,
  validateVersion,
  loadFromCache,
  saveToCache,
  clearCache,
} from '../utils/knowledgeBaseLoader';
import type {
  KnowledgeBaseJson,
  KbMeta,
  KbExampleCategory,
  GraphicSchema,
  VersionCheckResult,
  VersionsJson,
} from '../utils/knowledgeBaseLoader';
import type { ApiMethodDef } from '../rules/script-api-registry';
import type { ScriptExample } from '../rules/types';
import { API_REGISTRY } from '../rules/script-api-registry';

// ═══════════════════════════════════════════════════════════════
// Global state (singleton)
// ═══════════════════════════════════════════════════════════════

/** Knowledge base data */
const kbData = ref<KnowledgeBaseJson | null>(null);
/** Loading state */
const isLoading = ref(false);
/** Load error */
const loadError = ref<string | null>(null);
/** Version check result */
const versionCheck = ref<VersionCheckResult | null>(null);
/** Whether loaded from cache */
const fromCache = ref(false);
/** Whether loaded from fallback */
const fromFallback = ref(false);
/** Version manifest */
const versionsInfo = ref<VersionsJson | null>(null);

// ═══════════════════════════════════════════════════════════════
// Computed properties
// ═══════════════════════════════════════════════════════════════

/** Whether loaded */
const isLoaded = computed(() => kbData.value !== null);

/** Meta info */
const meta = computed<KbMeta | null>(() => kbData.value?.meta ?? null);

/** API registry */
const apiRegistry = computed<ApiMethodDef[]>(() => {
  if (kbData.value?.apiRegistry) {
    return kbData.value.apiRegistry;
  }
  // fallback: use the built-in registry
  return API_REGISTRY;
});

/** Example categories */
const examples = computed<KbExampleCategory[]>(() => kbData.value?.examples ?? []);

/** All examples (flattened) */
const allExamples = computed<ScriptExample[]>(() => {
  const result: ScriptExample[] = [];
  for (const category of examples.value) {
    result.push(...category.items);
  }
  return result;
});

/** APIs grouped by category */
const apiByCategory = computed(() => {
  const groups: Record<string, ApiMethodDef[]> = {};
  for (const api of apiRegistry.value) {
    const label = getCategoryLabel(api.category);
    if (!groups[label]) groups[label] = [];
    groups[label].push(api);
  }
  return groups;
});

/** Graphic schema */
const graphicSchemas = computed(() => kbData.value?.graphicSchemas ?? []);

/** Knowledge base version */
const kbVersion = computed(() => meta.value?.version ?? 'unknown');

// ═══════════════════════════════════════════════════════════════
// Core methods
// ═══════════════════════════════════════════════════════════════

/**
 * Load the knowledge base
 * @param forceRefresh whether to force refresh (ignore cache)
 * @param url custom URL (optional)
 */
async function loadKb(forceRefresh = false, url?: string): Promise<boolean> {
  // If already loaded and not forcing refresh, return directly
  if (isLoaded.value && !forceRefresh) {
    return true;
  }

  isLoading.value = true;
  loadError.value = null;
  fromCache.value = false;
  fromFallback.value = false;

  try {
    // Step 1: try loading from cache (when not forcing refresh)
    if (!forceRefresh) {
      const cached = loadFromCache();
      if (cached) {
        kbData.value = cached;
        fromCache.value = true;
        versionCheck.value = validateVersion(cached.meta);
        isLoading.value = false;
        return true;
      }
    }

    // Step 2: load from remote
    const result = await fetchKnowledgeBase(url);

    if (result.success && result.data) {
      kbData.value = result.data;
      fromCache.value = false;

      // Save to cache
      saveToCache(result.data);

      // Version check
      versionCheck.value = validateVersion(result.data.meta);

      isLoading.value = false;
      return true;
    }

    // Step 3: remote load failed; try the fallback (built-in data)
    console.warn('[KnowledgeBase] Remote load failed:', result.error);

    // Build a minimal knowledge base from the built-in registry
    const fallbackData = buildFallbackKb();
    kbData.value = fallbackData;
    fromFallback.value = true;
    versionCheck.value = validateVersion(fallbackData.meta);

    isLoading.value = false;
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loadError.value = message;
    console.error('[KnowledgeBase] Load error:', message);
    isLoading.value = false;
    return false;
  }
}

/**
 * Refresh the knowledge base (clear cache and reload)
 */
async function refreshKb(): Promise<boolean> {
  clearCache();
  kbData.value = null;
  versionCheck.value = null;
  return loadKb(true);
}

/**
 * Get an API by name
 */
function getApiByName(name: string): ApiMethodDef | undefined {
  return apiRegistry.value.find((api) => api.name === name);
}

/**
 * Get the API list by category
 */
function getApiByCategory(category: string): ApiMethodDef[] {
  return apiRegistry.value.filter((api) => api.category === category);
}

/**
 * Search APIs
 */
function searchApi(keyword: string): ApiMethodDef[] {
  const lower = keyword.toLowerCase();
  return apiRegistry.value.filter(
    (api) =>
      api.name.toLowerCase().includes(lower) ||
      api.summary.toLowerCase().includes(lower) ||
      api.description.toLowerCase().includes(lower)
  );
}

/**
 * Search examples
 */
function searchExamples(keyword: string): ScriptExample[] {
  const lower = keyword.toLowerCase();
  return allExamples.value.filter(
    (ex) =>
      ex.title.toLowerCase().includes(lower) ||
      ex.description.toLowerCase().includes(lower) ||
      ex.code.toLowerCase().includes(lower) ||
      ex.tags.some((tag) => tag.toLowerCase().includes(lower))
  );
}

/**
 * Get examples by category
 */
function getExamplesByCategory(category: string): ScriptExample[] {
  const cat = examples.value.find((c) => c.category === category);
  return cat?.items ?? [];
}

/**
 * Get the version manifest
 */
async function loadVersions(): Promise<void> {
  versionsInfo.value = await fetchVersions();
}

/**
 * Get a graphic plugin type's property schema
 */
function getGraphicSchema(pluginType: string): GraphicSchema | undefined {
  return graphicSchemas.value.find((s) => s.pluginType === pluginType);
}

/**
 * Search graphic types
 */
function searchGraphicSchema(keyword: string): GraphicSchema[] {
  const lower = keyword.toLowerCase();
  return graphicSchemas.value.filter(
    (s) =>
      s.pluginType.toLowerCase().includes(lower) ||
      s.displayName.toLowerCase().includes(lower) ||
      s.category.toLowerCase().includes(lower)
  );
}

/**
 * Get all graphic types
 */
function getAllGraphicTypes(): { pluginType: string; displayName: string; category: string }[] {
  return graphicSchemas.value.map((s) => ({
    pluginType: s.pluginType,
    displayName: s.displayName,
    category: s.category,
  }));
}

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════

/** Get the category's Chinese label */
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    data: '数据读写',
    graphic: '图元操作',
    alarm: '告警操作',
    page: '页面操作',
    network: '网络请求',
    timer: '定时器',
    utility: '工具函数',
  };
  return labels[category] || category;
}

/** Build the fallback knowledge base (using built-in data) */
function buildFallbackKb(): KnowledgeBaseJson {
  return {
    meta: {
      version: 'builtin',
      appVersion: '*',
      updatedAt: new Date().toISOString(),
      apiCount: API_REGISTRY.length,
      apiNames: API_REGISTRY.map((a) => a.name),
    },
    apiRegistry: API_REGISTRY,
    examples: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// Composable export
// ═══════════════════════════════════════════════════════════════

export function useKnowledgeBase() {
  return {
    // State
    kbData: readonly(kbData) as DeepReadonly<typeof kbData>,
    isLoading: readonly(isLoading),
    loadError: readonly(loadError),
    versionCheck: readonly(versionCheck),
    fromCache: readonly(fromCache),
    fromFallback: readonly(fromFallback),
    versionsInfo: readonly(versionsInfo),

    // Computed properties
    isLoaded,
    meta,
    apiRegistry,
    examples,
    allExamples,
    graphicSchemas,
    apiByCategory,
    kbVersion,

    // Methods
    loadKb,
    refreshKb,
    getApiByName,
    getApiByCategory,
    searchApi,
    searchExamples,
    getExamplesByCategory,
    loadVersions,
    getGraphicSchema,
    searchGraphicSchema,
    getAllGraphicTypes,
    clearCache,
  };
}

export type UseKnowledgeBaseReturn = ReturnType<typeof useKnowledgeBase>;
