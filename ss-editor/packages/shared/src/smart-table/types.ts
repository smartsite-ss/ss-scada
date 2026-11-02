// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { VNode } from 'vue';

// ============================================================
// Column configuration
// ============================================================

/** Built-in formatters */
export type FormatterType =
  | 'time'      // → "07-09 14:30"
  | 'period'    // → "1.0s" / "30.0s" / "2.0min"
  | 'status'    // → renders status-badge
  | 'bool'      // → e.g. "Yes" / "No"
  | 'number'    // → thousands separator
  | 'percent';  // → "85.0%"

/** Column editor type */
export type ColumnEditor = 'text' | 'number' | 'select' | 'date';

/** Editor dropdown options */
export interface EditorOption {
  label: string;
  value: string | number | boolean;
}

/** Cell span info */
export interface CellSpan {
  colspan: number;
  rowspan: number;
}

/** Cell span method */
export type SpanMethod<T = any> = (
  row: T,
  column: SmartTableColumn<T>,
  rowIndex: number,
  columnIndex: number,
) => CellSpan;

/** Column definition */
export interface SmartTableColumn<T = any> {
  key: string;
  title: string | ((col: SmartTableColumn<T>) => string);
  dataKey?: string;
  width?: number | string;
  minWidth?: number;
  align?: 'left' | 'center' | 'right';
  fixed?: 'left' | 'right';
  sortable?: boolean;
  render?: (value: any, row: T, index: number) => VNode | string;
  formatter?: FormatterType;
  defaultVisible?: boolean;
  required?: boolean;
  className?: string;
  headerClassName?: string;
  exportTitle?: string;
  excludeFromExport?: boolean;
  /** Whether this column is editable (requires the editable prop enabled) */
  editable?: boolean;
  /** Editor type, defaults to 'text' */
  editor?: ColumnEditor;
  /** Options for the select editor */
  editorOptions?: EditorOption[];
  /** Column-level colspan calculation (returns a number, default 1) */
  colspan?: (row: T, rowIndex: number) => number;
  /** Column-level rowspan calculation (returns a number, default 1) */
  rowspan?: (row: T, rowIndex: number) => number;
}

// ============================================================
// Pagination
// ============================================================

export interface PaginationConfig {
  page: number;
  pageSize: number;
  total: number;
  mode: 'client' | 'server';
}

export interface PageChangeEvent {
  page: number;
  pageSize: number;
}

// ============================================================
// Column config persistence
// ============================================================

export interface ColumnPersist {
  hiddenKeys: string[];
  updatedAt: number;
}

// ============================================================
// Export
// ============================================================

export type ExportFormat = 'xlsx' | 'csv' | 'png';

export interface ExportEvent {
  format: ExportFormat;
  columns: SmartTableColumn[];
  data: any[];
}

// ============================================================
// Sorting
// ============================================================

export interface SortConfig {
  key: string;
  order: 'asc' | 'desc' | '';
}

export interface SortChangeEvent {
  key: string;
  order: 'asc' | 'desc' | '';
}

// ============================================================
// Row editing
// ============================================================

/** Row edit event payload */
export interface RowEditEvent<T = any> {
  row: T;
  rowId: any;
  changes: Partial<T>;
}

// ============================================================
// Tree table
// ============================================================

/** Flattened tree node row */
export interface FlatTreeRow<T = any> {
  row: T;
  level: number;
  hasChildren: boolean;
  rawIndex: number;
  /** Parent path in the original data, used for event callback */
  parentKey?: any;
}

/** Tree expand/collapse event payload */
export interface TreeExpandEvent<T = any> {
  row: T;
  rowKey: any;
  expanded: boolean;
  level: number;
}
