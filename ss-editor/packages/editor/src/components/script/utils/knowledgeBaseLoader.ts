// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Knowledge base loader utility functions
 *
 * Provides low-level capabilities such as fetch, parsing, validation and version checking.
 */

import { getKnowledgeBaseUrl, getVersionsUrl, getAppVersion, knowledgeBaseConfig } from '../../../config/knowledgeBase.config';
import type { ApiMethodDef } from '../rules/script-api-registry';
import type { ScriptExample } from '../rules/types';

// ═══════════════════════════════════════════════════════════════
// Type definitions
// ═══════════════════════════════════════════════════════════════

/** Knowledge base metadata */
export interface KbMeta {
  version: string;
  appVersion: string;
  updatedAt: string;
  apiCount: number;
  apiNames: string[];
}

/** Knowledge base example category */
export interface KbExampleCategory {
  category: string;
  label: string;
  icon: string;
  items: ScriptExample[];
}

/** Graphic property field definition */
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

/** Graphic property schema */
export interface GraphicSchema {
  pluginType: string;
  displayName: string;
  category: string;
  fields: GraphicFieldDef[];
  schemaVersion?: string;
}

/** Complete knowledge base data structure */
export interface KnowledgeBaseJson {
  meta: KbMeta;
  apiRegistry: ApiMethodDef[];
  examples?: KbExampleCategory[];
  /** Graphic property schema (customProps definitions supported by each graphic type) */
  graphicSchemas?: GraphicSchema[];
  quickStart?: {
    steps: { step: number; action: string; description: string }[];
    minimalExample: { title: string; code: string; expected: string };
  };
  triggerModes?: { mode: string; description: string; scenario: string }[];
  errorScenarios?: { api: string; error: string; symptom: string; suggestion: string }[];
  bestPractices?: { title: string; content: string }[];
}

/** Version manifest entry */
export interface VersionInfo {
  version: string;
  path: string;
  updatedAt: string;
  appVersionRange: string;
  changes: string[];
}

/** Version manifest */
export interface VersionsJson {
  latest: string;
  versions: VersionInfo[];
}

/** Load result */
export interface LoadResult {
  success: boolean;
  data?: KnowledgeBaseJson;
  error?: string;
  fromCache?: boolean;
  fromFallback?: boolean;
}

/** Version check result */
export interface VersionCheckResult {
  compatible: boolean;
  kbVersion: string;
  appVersion: string;
  requiredAppVersion: string;
  message: string;
}

// ═══════════════════════════════════════════════════════════════
// Loading functions
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch knowledge base data from the specified URL
 */
export async function fetchKnowledgeBase(url?: string): Promise<LoadResult> {
  const targetUrl = url || getKnowledgeBaseUrl();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), knowledgeBaseConfig.timeout);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json() as KnowledgeBaseJson;

    // Basic structure validation
    if (!data.meta || !data.apiRegistry || !Array.isArray(data.apiRegistry)) {
      return {
        success: false,
        error: 'Invalid knowledge base format: missing meta or apiRegistry',
      };
    }

    return {
      success: true,
      data,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to fetch knowledge base: ${errorMessage}`,
    };
  }
}

/**
 * Get the version manifest
 */
export async function fetchVersions(): Promise<VersionsJson | null> {
  try {
    const response = await fetch(getVersionsUrl(), {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return null;

    return await response.json() as VersionsJson;
  } catch {
    return null;
  }
}

/**
 * Parse knowledge base data (basic validation)
 */
export function parseKnowledgeBase(data: unknown): KnowledgeBaseJson | null {
  if (!data || typeof data !== 'object') return null;

  const kb = data as Partial<KnowledgeBaseJson>;

  if (!kb.meta || !kb.apiRegistry || !Array.isArray(kb.apiRegistry)) {
    return null;
  }

  return kb as KnowledgeBaseJson;
}

// ═══════════════════════════════════════════════════════════════
// Version validation
// ═══════════════════════════════════════════════════════════════

/**
 * Check version compatibility
 * Supports semantic version ranges: >=1.5.0, ^1.5.0, ~1.5.0, 1.5.0
 */
export function validateVersion(kbMeta: KbMeta, appVersion: string = getAppVersion()): VersionCheckResult {
  const requiredVersion = kbMeta.appVersion || '*';

  // Wildcard, compatible with all versions
  if (requiredVersion === '*') {
    return {
      compatible: true,
      kbVersion: kbMeta.version,
      appVersion,
      requiredAppVersion: requiredVersion,
      message: 'Compatible (no version restriction)',
    };
  }

  const isCompatible = checkVersionRange(appVersion, requiredVersion);

  return {
    compatible: isCompatible,
    kbVersion: kbMeta.version,
    appVersion,
    requiredAppVersion: requiredVersion,
    message: isCompatible
      ? `Compatible: app ${appVersion} satisfies ${requiredVersion}`
      : `Incompatible: app ${appVersion} does not satisfy ${requiredVersion}`,
  };
}

/**
 * Check whether a version satisfies a range requirement
 */
function checkVersionRange(version: string, range: string): boolean {
  // Simple implementation, supports >=, >, <=, <, = prefixes
  const cleanVersion = version.replace(/^v/, '');
  const cleanRange = range.replace(/^v/, '');

  if (cleanRange.startsWith('>=')) {
    return compareVersion(cleanVersion, cleanRange.slice(2)) >= 0;
  }
  if (cleanRange.startsWith('>')) {
    return compareVersion(cleanVersion, cleanRange.slice(1)) > 0;
  }
  if (cleanRange.startsWith('<=')) {
    return compareVersion(cleanVersion, cleanRange.slice(2)) <= 0;
  }
  if (cleanRange.startsWith('<')) {
    return compareVersion(cleanVersion, cleanRange.slice(1)) < 0;
  }
  if (cleanRange.startsWith('=')) {
    return compareVersion(cleanVersion, cleanRange.slice(1)) === 0;
  }

  // Default to exact match
  return compareVersion(cleanVersion, cleanRange) === 0;
}

/**
 * Compare two version numbers
 * @returns -1: v1 < v2, 0: v1 === v2, 1: v1 > v2
 */
function compareVersion(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

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

/** Cached data structure */
interface CacheEntry {
  data: KnowledgeBaseJson;
  timestamp: number;
}

/**
 * Read cache from localStorage
 */
export function loadFromCache(): KnowledgeBaseJson | null {
  if (!knowledgeBaseConfig.enableCache) return null;

  try {
    const raw = localStorage.getItem(knowledgeBaseConfig.localStorageKey);
    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry;
    const now = Date.now();

    // Check whether the cache has expired
    if (now - entry.timestamp > knowledgeBaseConfig.cacheTtl) {
      localStorage.removeItem(knowledgeBaseConfig.localStorageKey);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Save to the localStorage cache
 */
export function saveToCache(data: KnowledgeBaseJson): void {
  if (!knowledgeBaseConfig.enableCache) return;

  try {
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(knowledgeBaseConfig.localStorageKey, JSON.stringify(entry));
  } catch {
    // Ignore localStorage write errors (e.g. insufficient storage space)
  }
}

/**
 * Clear the local cache
 */
export function clearCache(): void {
  try {
    localStorage.removeItem(knowledgeBaseConfig.localStorageKey);
  } catch {
    // Ignore errors
  }
}
