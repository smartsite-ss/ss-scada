// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Knowledge base composable (system package)
 *
 * Loads knowledge base JSON data remotely, providing queries for the API registry, examples and graphic schemas.
 * Supports the three-level fallback strategy: remote load → cache → built-in fallback.
 */

import { ref, computed, readonly, type DeepReadonly } from 'vue';
import { useI18n } from '@scada-editor/core';
import type { ApiMethodDefinition } from '../utils/api-definitions';
import { API_DEFINITIONS } from '../utils/api-definitions';

// ═══════════════════════════════════════════════════════════════
// Type definitions
// ═══════════════════════════════════════════════════════════════

export interface KbMeta {
  version: string;
  appVersion: string;
  updatedAt: string;
  apiCount: number;
  apiNames: string[];
}

export interface KbExampleCategory {
  category: string;
  label: string;
  icon: string;
  items: ScriptExample[];
}

export interface ScriptExample {
  id: string;
  title: string;
  description: string;
  category: string;
  triggerType: string;
  requiredTags: string[];
  tags: string[];
  difficulty: string;
  code: string;
}

export interface GraphicFieldDef {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'color' | 'select' | 'textarea';
  label: string;
  description?: string;
  defaultValue?: any;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  group?: string;
}

export interface GraphicSchema {
  pluginType: string;
  displayName: string;
  category: string;
  fields: GraphicFieldDef[];
  schemaVersion?: string;
}

export interface KnowledgeBaseJson {
  meta: KbMeta;
  apiRegistry: ApiMethodDefinition[];
  examples?: KbExampleCategory[];
  graphicSchemas?: GraphicSchema[];
}

export interface VersionCheckResult {
  compatible: boolean;
  kbVersion: string;
  appVersion: string;
  requiredAppVersion: string;
  message: string;
}

export interface VersionInfo {
  version: string;
  path: string;
  updatedAt: string;
  appVersionRange: string;
  changes: string[];
}

export interface VersionsJson {
  latest: string;
  versions: VersionInfo[];
}

// ═══════════════════════════════════════════════════════════════
// Global state (singleton)
// ═══════════════════════════════════════════════════════════════

const kbData = ref<KnowledgeBaseJson | null>(null);
const isLoading = ref(false);
const loadError = ref<string | null>(null);
const versionCheck = ref<VersionCheckResult | null>(null);
const fromCache = ref(false);
const fromFallback = ref(false);
const versionsInfo = ref<VersionsJson | null>(null);

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'scada_knowledge_base_cache';
const CACHE_TTL = 3600000; // 1 hour
const FETCH_TIMEOUT = 10000;

function resolveKbUrl(): string {
  if (typeof window !== 'undefined' && (window as any).SCRIPT_KB_URL) {
    return (window as any).SCRIPT_KB_URL;
  }
  const envUrl = (import.meta as any).env?.VITE_SCRIPT_KB_URL;
  if (envUrl) return envUrl;
  return '/static/knowledge-base/v2/kb-data.json';
}

function getAppVersion(): string {
  if (typeof window !== 'undefined' && (window as any).APP_VERSION) {
    return (window as any).APP_VERSION;
  }
  return '1.0.0';
}

// ═══════════════════════════════════════════════════════════════
// Computed properties
// ═══════════════════════════════════════════════════════════════

const isLoaded = computed(() => kbData.value !== null);

const meta = computed<KbMeta | null>(() => kbData.value?.meta ?? null);

const apiRegistry = computed<ApiMethodDefinition[]>(() => {
  return kbData.value?.apiRegistry ?? API_DEFINITIONS;
});

const examples = computed<KbExampleCategory[]>(() => kbData.value?.examples ?? []);

const allExamples = computed<ScriptExample[]>(() => {
  const result: ScriptExample[] = [];
  for (const category of examples.value) {
    result.push(...category.items);
  }
  return result;
});

const graphicSchemas = computed<GraphicSchema[]>(() => {
  return kbData.value?.graphicSchemas ?? [];
});

const apiByCategory = computed(() => {
  const groups: Record<string, ApiMethodDefinition[]> = {};
  for (const api of apiRegistry.value) {
    const label = getCategoryLabel(api.category);
    if (!groups[label]) groups[label] = [];
    groups[label].push(api);
  }
  return groups;
});

const kbVersion = computed(() => meta.value?.version ?? 'builtin');

// ═══════════════════════════════════════════════════════════════
// Core methods
// ═══════════════════════════════════════════════════════════════

async function loadKb(forceRefresh = false, url?: string): Promise<boolean> {
  if (isLoaded.value && !forceRefresh) return true;

  isLoading.value = true;
  loadError.value = null;
  fromCache.value = false;
  fromFallback.value = false;

  try {
    // Step 1: try loading from cache
    if (!forceRefresh) {
      const cached = loadFromCache();
      if (cached) {
        kbData.value = cached;
        fromCache.value = true;
        versionCheck.value = checkVersionCompat(cached.meta);
        isLoading.value = false;
        return true;
      }
    }

    // Step 2: load from remote
    const result = await fetchKnowledgeBase(url);
    if (result) {
      kbData.value = result;
      saveToCache(result);
      versionCheck.value = checkVersionCompat(result.meta);
      isLoading.value = false;
      return true;
    }

    // Step 3: fallback
    kbData.value = buildFallbackKb();
    fromFallback.value = true;
    versionCheck.value = checkVersionCompat(kbData.value.meta);
    isLoading.value = false;
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    loadError.value = message;
    isLoading.value = false;
    return false;
  }
}

async function fetchKnowledgeBase(customUrl?: string): Promise<KnowledgeBaseJson | null> {
  const targetUrl = customUrl || resolveKbUrl();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json();
    if (!data.meta || !data.apiRegistry) return null;
    return data as KnowledgeBaseJson;
  } catch {
    return null;
  }
}

async function refreshKb(): Promise<boolean> {
  clearCache();
  kbData.value = null;
  versionCheck.value = null;
  return loadKb(true);
}

function getApiByName(name: string): ApiMethodDefinition | undefined {
  return apiRegistry.value.find((api) => api.label === name || api.label === `api.${name}`);
}

function getApiByCategory(category: string): ApiMethodDefinition[] {
  return apiRegistry.value.filter((api) => api.category === category);
}

function searchApi(keyword: string): ApiMethodDefinition[] {
  const lower = keyword.toLowerCase();
  return apiRegistry.value.filter(
    (api) =>
      api.label.toLowerCase().includes(lower) ||
      api.documentation.toLowerCase().includes(lower) ||
      api.signature.toLowerCase().includes(lower)
  );
}

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

function getExamplesByCategory(category: string): ScriptExample[] {
  const cat = examples.value.find((c) => c.category === category);
  return cat?.items ?? [];
}

/** Get the property schema of a graphic plugin type */
function getGraphicSchema(pluginType: string): GraphicSchema | undefined {
  return graphicSchemas.value.find((s) => s.pluginType === pluginType);
}

/** Search graphic types */
function searchGraphicSchema(keyword: string): GraphicSchema[] {
  const lower = keyword.toLowerCase();
  return graphicSchemas.value.filter(
    (s) =>
      s.pluginType.toLowerCase().includes(lower) ||
      s.displayName.toLowerCase().includes(lower) ||
      s.category.toLowerCase().includes(lower)
  );
}

/** Get the list of all graphic types */
function getAllGraphicTypes(): { pluginType: string; displayName: string; category: string }[] {
  return graphicSchemas.value.map((s) => ({
    pluginType: s.pluginType,
    displayName: s.displayName,
    category: s.category,
  }));
}

async function loadVersions(): Promise<void> {
  try {
    const baseUrl = resolveKbUrl();
    const versionsUrl = baseUrl.replace(/\/v\d+\/kb-data\.json$/, '/versions.json').replace(/kb-data\.json$/, 'versions.json');
    const response = await fetch(versionsUrl, { headers: { 'Accept': 'application/json' } });
    if (response.ok) {
      versionsInfo.value = await response.json();
    }
  } catch {
    // Ignore
  }
}

// ═══════════════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════════════

function getCategoryLabel(category: string): string {
  const { t } = useI18n();
  const key = `system.scripts.kb.${category}`;
  try {
    const translated = t(key);
    return translated !== key ? translated : category;
  } catch {
    return category;
  }
}

function buildFallbackKb(): KnowledgeBaseJson {
  return {
    meta: {
      version: 'builtin',
      appVersion: '*',
      updatedAt: new Date().toISOString(),
      apiCount: API_DEFINITIONS.length,
      apiNames: API_DEFINITIONS.map((a) => a.label),
    },
    apiRegistry: API_DEFINITIONS,
    examples: [],
    graphicSchemas: [],
  };
}

function checkVersionCompat(kbMeta: KbMeta): VersionCheckResult {
  const { t } = useI18n();
  const appVersion = getAppVersion();
  const requiredVersion = kbMeta.appVersion || '*';
  if (requiredVersion === '*') {
    return { compatible: true, kbVersion: kbMeta.version, appVersion, requiredAppVersion: requiredVersion, message: '' };
  }
  const isCompatible = compareVersion(appVersion, requiredVersion.replace(/^>=/, '')) >= 0;
  return {
    compatible: isCompatible,
    kbVersion: kbMeta.version,
    appVersion,
    requiredAppVersion: requiredVersion,
    message: isCompatible ? '' : t('system.scripts.kb.versionRequired', { required: requiredVersion, current: appVersion }),
  };
}

function compareVersion(v1: string, v2: string): number {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);
  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// Local cache
// ═══════════════════════════════════════════════════════════════

function loadFromCache(): KnowledgeBaseJson | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function saveToCache(data: KnowledgeBaseJson): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // Ignore
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
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
    getGraphicSchema,
    searchGraphicSchema,
    getAllGraphicTypes,
    loadVersions,
    clearCache,
  };
}

export type UseKnowledgeBaseReturn = ReturnType<typeof useKnowledgeBase>;