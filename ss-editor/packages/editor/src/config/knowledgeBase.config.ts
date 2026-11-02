// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Knowledge base configuration
 *
 * Defines the load URL for the knowledge base JSON file, with multi-priority configuration support.
 */

/** Knowledge base configuration interface */
export interface KnowledgeBaseConfig {
  /** Knowledge base base URL (without the version path) */
  baseUrl: string;
  /** Default version number */
  defaultVersion: string;
  /** Full URL */
  url: string;
  /** Request timeout (milliseconds) */
  timeout: number;
  /** Local cache key name */
  localStorageKey: string;
  /** Whether local caching is enabled */
  enableCache: boolean;
  /** Cache validity period (milliseconds) */
  cacheTtl: number;
}

/** Get the knowledge base URL (by priority) */
function resolveKbUrl(): string {
  // Priority 1: runtime global variable
  if (typeof window !== 'undefined' && (window as any).SCRIPT_KB_URL) {
    return (window as any).SCRIPT_KB_URL;
  }

  // Priority 2: environment variable (injected at Vite compile time)
  const envUrl = import.meta.env.VITE_SCRIPT_KB_URL;
  if (envUrl) {
    return envUrl;
  }

  // Priority 3: default path (current web server's static directory)
  return '/static/knowledge-base';
}

/** Get the full knowledge base URL (with version) */
export function getKnowledgeBaseUrl(version?: string): string {
  const baseUrl = resolveKbUrl();
  const ver = version || 'v2';

  // If baseUrl already contains .json, use it directly
  if (baseUrl.endsWith('.json')) {
    return baseUrl;
  }

  // Otherwise concatenate the version path
  return `${baseUrl}/${ver}/kb-data.json`;
}

/** Get the versions.json URL */
export function getVersionsUrl(): string {
  const baseUrl = resolveKbUrl();

  if (baseUrl.endsWith('.json')) {
    return baseUrl.replace(/\/v\d+\/kb-data\.json$/, '/versions.json');
  }

  return `${baseUrl}/versions.json`;
}

/** Current application version (used for compatibility checks) */
export function getAppVersion(): string {
  // Get from a global variable or package.json
  if (typeof window !== 'undefined' && (window as any).APP_VERSION) {
    return (window as any).APP_VERSION;
  }

  // Default version
  return '1.0.0';
}

/** Default configuration */
export const knowledgeBaseConfig: KnowledgeBaseConfig = {
  baseUrl: resolveKbUrl(),
  defaultVersion: 'v2',
  url: getKnowledgeBaseUrl(),
  timeout: 10000,
  localStorageKey: 'scada_knowledge_base_cache',
  enableCache: true,
  cacheTtl: 3600000, // 1 hour
};

export default knowledgeBaseConfig;
