// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export interface SchemaMigration {
  from: number;
  to: number;
  migrate: (props: Record<string, any>) => Record<string, any>;
}

export interface PluginTestDefinition {
  defaultProps: Record<string, any>;
  propCombinations?: Record<string, any>[];
  checkpoints?: { name: string; x: string; y: string; expected: string }[];
  migrationTests?: {
    fromVersion: number;
    inputProps: Record<string, any>;
    assertProps: Record<string, any>;
  }[];
}

export interface PluginPropertySchemaField {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'color' | 'range' | 'checkbox' | 'textarea' | 'color-array' | 'string' | 'image';
  label: string;
  labelKey?: string;
  defaultValue?: any;
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: any; label: string; labelKey?: string }[];
  /** Dynamic options provider.
   * - String key: resolved by the property panel from a known key (e.g. 'pageStore.pages')
   * - Function: called at runtime to return the options list (must be called within a Vue setup context)
   */
  optionsProvider?: string | (() => { value: any; label: string }[]);
  group?: string;
  groupKey?: string;
  /** Marks this field as data-source bindable.
   * - true: the field appears in the candidate list of the DataPanel property selection UI
   * - Unset: by default not included in data binding candidates (conservative policy, avoiding mis-binding semantically mismatched fields)
   * Typical bindable fields: text / type / disabled / backgroundColor / fontColor / borderColor / targetPage
   */
  dataBindable?: boolean;
}

export type SchemaField = PluginPropertySchemaField

export interface PluginPropertySchema {
  name?: string;
  layout?: 'vertical' | 'grid';
  columns?: number;
  fields: PluginPropertySchemaField[];
  propsPath?: string;
  defaultValueFactory?: () => Record<string, any>;
}

export const SCHEMA_GROUP = {
  IDENTITY: 'basic',
  BEHAVIOR: 'behavior',
  VISUAL: 'visual',
  STATUS: 'status',
  ANIMATION: 'animation',
  DISPLAY: 'display',
  COLOR: 'color',
  VALUE: 'value',
  GAUGE: 'gauge',
  TICKS: 'ticks',
  ALARM: 'alarm',
  BINDING: 'binding',
} as const;