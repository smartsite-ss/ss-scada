// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Script engine API definitions (compatibility layer)
 *
 * This file is a backward-compatible wrapper; all data comes from rules/script-api-registry.ts.
 * The original exports such as API_DEFINITIONS and ApiCategory remain unchanged, so existing code requires no modification.
 *
 * === Data source ===
 * To modify interface definitions, update the API_REGISTRY array in rules/script-api-registry.ts directly;
 * this file syncs automatically and needs no manual changes.
 *
 * === Update guide ===
 * 1. Add an API → the API_REGISTRY array in rules/script-api-registry.ts
 * 2. Modify a signature/comment → update the corresponding entry in rules/script-api-registry.ts
 * 3. Remove an API → delete it from the API_REGISTRY array
 * 4. Add an example → the corresponding category file under rules/examples/
 * 5. No Vue component code needs to be modified
 */

import {
  API_REGISTRY,
  type ApiCategory,
  type ApiMethodDef,
} from '../rules/script-api-registry';

import { API_CATEGORY_LABELS } from '../rules/script-api-registry';

// Re-export types and constants (kept for backward compatibility)
export type { ApiCategory } from '../rules/script-api-registry';
export { API_CATEGORY_LABELS } from '../rules/script-api-registry';

/** API method definition (legacy format) */
export interface ApiMethodDefinition {
  label: string;
  kind: 'function';
  detail: string;
  documentation: string;
  insertText: string;
  sortText: string;
  category: ApiCategory;
  signature: string;
}

/** Generate API definition list in the legacy format from the rule registry */
function buildApiDefinitions(): ApiMethodDefinition[] {
  return API_REGISTRY.map((api: ApiMethodDef) => ({
    label: `api.${api.name}`,
    kind: 'function' as const,
    detail: api.detail,
    documentation: api.summary,
    insertText: api.insertText,
    sortText: api.sortText,
    category: api.category,
    signature: api.signature,
  }));
}

/** All API method definitions (legacy format, 26 entries) */
export const API_DEFINITIONS: ApiMethodDefinition[] = buildApiDefinitions();

/** Get API definitions grouped by category */
export function getApiDefinitionsByCategory(): Record<string, ApiMethodDefinition[]> {
  const groups: Record<string, ApiMethodDefinition[]> = {};
  for (const def of API_DEFINITIONS) {
    const catLabel = API_CATEGORY_LABELS[def.category];
    if (!groups[catLabel]) groups[catLabel] = [];
    groups[catLabel].push(def);
  }
  return groups;
}