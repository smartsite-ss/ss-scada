// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Script example type definitions
 *
 * Unified type interface for all example files, used to render example lists in Vue components.
 */

/** Script example category */
export type ExampleCategory =
  | 'data-driven'        // data-driven
  | 'scheduled-task'     // scheduled task
  | 'event-driven'       // event-driven
  | 'multi-tag-linking'  // multi-tag linking
  | 'graphic-operation'  // graphic operations
  | 'alarm-management';  // alarm management

/** Example category Chinese labels */
export const EXAMPLE_CATEGORY_LABELS: Record<ExampleCategory, string> = {
  'data-driven': '数据驱动',
  'scheduled-task': '定时任务',
  'event-driven': '事件驱动',
  'multi-tag-linking': '多标签联动',
  'graphic-operation': '图元操作',
  'alarm-management': '告警管理',
};

/** Example category icons */
export const EXAMPLE_CATEGORY_ICONS: Record<ExampleCategory, string> = {
  'data-driven': '📊',
  'scheduled-task': '⏱',
  'event-driven': '⚡',
  'multi-tag-linking': '🔗',
  'graphic-operation': '🎨',
  'alarm-management': '🔔',
};

/** Trigger mode */
export type TriggerType = 'dataChange' | 'schedule' | 'event' | 'manual' | 'expression';

/** A single script example */
export interface ScriptExample {
  /** Unique identifier */
  id: string;
  /** Example title */
  title: string;
  /** Example description */
  description: string;
  /** Category it belongs to */
  category: ExampleCategory;
  /** Trigger mode */
  triggerType: TriggerType;
  /** Cron expression (used for scheduled tasks) */
  cronExpression?: string;
  /** Event name (used for event-driven) */
  eventName?: string;
  /** List of dependent tags */
  requiredTags?: string[];
  /** Tag (used for filtering) */
  tags: string[];
  /** Difficulty level */
  difficulty: 'easy' | 'medium' | 'hard';
  /** Script code */
  code: string;
}

/** Collection of examples grouped by category */
export interface ExampleGroup {
  category: ExampleCategory;
  label: string;
  icon: string;
  examples: ScriptExample[];
}