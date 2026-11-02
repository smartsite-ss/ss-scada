// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Script engine rules file — unified export entry
 *
 * === File structure ===
 * rules/
 * ├── index.ts                       ← this file (unified exports)
 * ├── types.ts                       ← type definitions
 * ├── script-api-registry.ts         ← API registry (26 methods)
 * └── examples/
 *     ├── data-driven.examples.ts     ← data-driven examples
 *     ├── scheduled-task.examples.ts  ← scheduled task examples
 *     ├── event-driven.examples.ts    ← event-driven examples
 *     ├── multi-tag-linking.examples.ts ← multi-tag linking examples
 *     ├── graphic-operation.examples.ts ← graphic operation examples
 *     └── alarm-management.examples.ts  ← alarm management examples
 *
 * === Usage ===
 * Import in a Vue component:
 *   import { API_REGISTRY, getApiGroupedByCategory, ALL_EXAMPLES, getExamplesByCategory } from '../rules';
 *
 * === Update process ===
 * 1. Add an API: modify the API_REGISTRY array in script-api-registry.ts
 * 2. Add an example: append in the corresponding category's examples/*.ts file
 * 3. Add a category: create a new examples/*.ts and import it into ALL_EXAMPLES below
 * 4. No Vue component code needs to be modified
 */

// ═══════════════════════════════════════════════════════════════
// Export types
// ═══════════════════════════════════════════════════════════════
export type {
  ApiCategory,
  ApiMethodDef,
  ApiParamDef,
} from './script-api-registry';

export type {
  ExampleCategory,
  ScriptExample,
  ExampleGroup,
  TriggerType,
} from './types';

export {
  API_CATEGORY_LABELS,
  API_CATEGORY_ICONS,
} from './script-api-registry';

export {
  EXAMPLE_CATEGORY_LABELS,
  EXAMPLE_CATEGORY_ICONS,
} from './types';

// ═══════════════════════════════════════════════════════════════
// Export API registry
// ═══════════════════════════════════════════════════════════════
export {
  API_REGISTRY,
  getApiByCategory,
  getApiGroupedByCategory,
  getApiByEnvironment,
  getApiByName,
  getApiNames,
  getApiCount,
} from './script-api-registry';

// ═══════════════════════════════════════════════════════════════
// Export all examples
// ═══════════════════════════════════════════════════════════════
import { dataDrivenExamples } from './examples/data-driven.examples';
import { scheduledTaskExamples } from './examples/scheduled-task.examples';
import { eventDrivenExamples } from './examples/event-driven.examples';
import { multiTagLinkingExamples } from './examples/multi-tag-linking.examples';
import { graphicOperationExamples } from './examples/graphic-operation.examples';
import { alarmManagementExamples } from './examples/alarm-management.examples';
import type { ScriptExample, ExampleGroup, ExampleCategory } from './types';
import { EXAMPLE_CATEGORY_LABELS, EXAMPLE_CATEGORY_ICONS } from './types';

/** Flat list of all examples */
export const ALL_EXAMPLES: ScriptExample[] = [
  ...dataDrivenExamples,
  ...scheduledTaskExamples,
  ...eventDrivenExamples,
  ...multiTagLinkingExamples,
  ...graphicOperationExamples,
  ...alarmManagementExamples,
];

/** Examples grouped by category */
export const ALL_EXAMPLE_GROUPS: ExampleGroup[] = [
  { category: 'data-driven', label: EXAMPLE_CATEGORY_LABELS['data-driven'], icon: EXAMPLE_CATEGORY_ICONS['data-driven'], examples: dataDrivenExamples },
  { category: 'scheduled-task', label: EXAMPLE_CATEGORY_LABELS['scheduled-task'], icon: EXAMPLE_CATEGORY_ICONS['scheduled-task'], examples: scheduledTaskExamples },
  { category: 'event-driven', label: EXAMPLE_CATEGORY_LABELS['event-driven'], icon: EXAMPLE_CATEGORY_ICONS['event-driven'], examples: eventDrivenExamples },
  { category: 'multi-tag-linking', label: EXAMPLE_CATEGORY_LABELS['multi-tag-linking'], icon: EXAMPLE_CATEGORY_ICONS['multi-tag-linking'], examples: multiTagLinkingExamples },
  { category: 'graphic-operation', label: EXAMPLE_CATEGORY_LABELS['graphic-operation'], icon: EXAMPLE_CATEGORY_ICONS['graphic-operation'], examples: graphicOperationExamples },
  { category: 'alarm-management', label: EXAMPLE_CATEGORY_LABELS['alarm-management'], icon: EXAMPLE_CATEGORY_ICONS['alarm-management'], examples: alarmManagementExamples },
];

/** Get examples by category */
export function getExamplesByCategory(category: ExampleCategory): ScriptExample[] {
  return ALL_EXAMPLES.filter((e) => e.category === category);
}

/** Get examples by difficulty */
export function getExamplesByDifficulty(difficulty: 'easy' | 'medium' | 'hard'): ScriptExample[] {
  return ALL_EXAMPLES.filter((e) => e.difficulty === difficulty);
}

/** Filter examples by tag */
export function getExamplesByTag(tag: string): ScriptExample[] {
  return ALL_EXAMPLES.filter((e) => e.tags.includes(tag));
}

/** Get the total number of examples */
export function getExampleCount(): number {
  return ALL_EXAMPLES.length;
}

/** Get the list of all tags */
export function getAllExampleTags(): string[] {
  const tagSet = new Set<string>();
  for (const example of ALL_EXAMPLES) {
    for (const tag of example.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}