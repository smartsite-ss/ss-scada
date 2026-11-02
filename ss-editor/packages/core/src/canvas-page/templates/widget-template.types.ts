// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Widget Template type definitions
 *
 * Parallel to PageTemplate, but a widget template aggregates a "set of graphics"
 * (usually a group), and exposes parameterized placeholders ({{key}}) via `variables`
 * for injection at instantiation time.
 */

/** Variable type */
export type WidgetTemplateVariableType = 'text' | 'number' | 'color' | 'bind-tag';

/** Widget template variable definition */
export interface WidgetTemplateVariable {
  key: string; // Placeholder key, e.g. "title"
  label: string; // Display name
  type: WidgetTemplateVariableType;
  defaultValue?: string | number;
  targetPath?: string; // Injection target, e.g. "graphics[0].props.text"
}

/** Complete widget template data */
export interface WidgetTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  author: string;
  source: 'builtin' | 'user' | 'market';
  thumbnail?: string;
  createdAt?: string;
  updatedAt?: string;
  schemaVersion: number;
  graphics: any[]; // IGraphicJSON[] serialized result
  variables: WidgetTemplateVariable[];
  tags?: string[];
}

/** Widget template metadata (list item, without graphics) */
export interface WidgetTemplateMeta {
  id: string;
  name: string;
  description?: string;
  category: string;
  author: string;
  source: 'builtin' | 'user' | 'market';
  thumbnail?: string;
  createdAt?: string;
  updatedAt?: string;
  schemaVersion: number;
  hasVariables: boolean;
  variableCount: number;
  tags?: string[];
}

/** Widget template category (shared with page templates) */
export type WidgetTemplateCategory =
  | 'common'
  | 'industry'
  | 'energy'
  | 'monitor'
  | 'custom';
