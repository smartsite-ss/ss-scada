// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// SmartTable has been migrated to the @scada-editor/shared package
// This file remains as a backward-compatible re-export; import from @scada-editor/shared in new code
export {
  SmartTable,
  SmartTableCore,
  SmartTablePagination,
  SmartTableLoading,
  SmartTableEmpty,
  SmartTableColumnToggle,
  SmartTableExport,
} from '@scada-editor/shared';

export type {
  SmartTableColumn,
  PaginationConfig,
  PageChangeEvent,
  ColumnPersist,
  ExportFormat,
  ExportEvent,
  SortConfig,
  SortChangeEvent,
  FormatterType,
} from '@scada-editor/shared';

export {
  usePagination,
  useColumnConfig,
  useExport,
  exportToXlsx,
  exportToCsv,
  exportToImage,
  applyFormatter,
  getNestedValue,
} from '@scada-editor/shared';
