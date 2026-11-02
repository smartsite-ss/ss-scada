// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * sourceMeta — Data source UI common mappings
 *
 * Extracted from the duplicated qualityColor / sourceTypeLabel / statusLabel mapping logic
 * in VariableSelector / FetchPanel / TagSourceSelector.
 *
 * Includes all quality states uniformly (including stale/disconnected), eliminating implementation differences across 3 files.
 */

/**
 * Data quality → CSS color variable mapping.
 * Used for quality indicator lights, table quality column coloring, etc.
 */
export const qualityMeta: Record<string, { color: string; label: string }> = {
  good: { color: 'var(--status-success, #18a058)', label: 'Good' },
  bad: { color: 'var(--status-error, #d03050)', label: 'Bad' },
  uncertain: { color: 'var(--status-warning, #f0a020)', label: 'Uncertain' },
  stale: { color: 'var(--status-warning, #f0a020)', label: 'Stale' },
  disconnected: { color: 'var(--text-secondary, #909399)', label: 'Disconnected' },
};

/**
 * Get the color for a data quality.
 * Unknown quality codes fall back to the secondary text color.
 */
export function getQualityColor(quality: string | undefined | null): string {
  if (!quality) return 'var(--text-secondary, #909399)';
  return qualityMeta[quality]?.color ?? 'var(--text-secondary, #909399)';
}

/**
 * Get the label text for a data quality.
 */
export function getQualityLabel(quality: string | undefined | null): string {
  if (!quality) return '--';
  return qualityMeta[quality]?.label ?? quality;
}

/**
 * Data source type → display label mapping.
 */
export const sourceTypeMeta: Record<string, { label: string; icon: string }> = {
  static: { label: 'Static', icon: '📊' },
  api: { label: 'API', icon: '🌐' },
  tag: { label: 'Tag', icon: '🏷️' },
  database: { label: 'Database', icon: '🗄️' },
  sql: { label: 'SQL', icon: '🗄️' },
};

/**
 * Get the display label for a data source type.
 */
export function getSourceTypeLabel(sourceType: string | undefined | null): string {
  if (!sourceType) return '--';
  return sourceTypeMeta[sourceType]?.label ?? sourceType;
}

/**
 * Data source status → display label + color mapping.
 */
export const statusMeta: Record<string, { label: string; color: string }> = {
  idle: { label: 'Idle', color: 'var(--text-secondary, #909399)' },
  loading: { label: 'Loading', color: 'var(--status-info, #2080f0)' },
  active: { label: 'Active', color: 'var(--status-success, #18a058)' },
  error: { label: 'Error', color: 'var(--status-error, #d03050)' },
  paused: { label: 'Paused', color: 'var(--status-warning, #f0a020)' },
};

/**
 * Get the display label for a data source status.
 */
export function getStatusLabel(status: string | undefined | null): string {
  if (!status) return '--';
  return statusMeta[status]?.label ?? status;
}

/**
 * Get the color for a data source status.
 */
export function getStatusColor(status: string | undefined | null): string {
  if (!status) return 'var(--text-secondary, #909399)';
  return statusMeta[status]?.color ?? 'var(--text-secondary, #909399)';
}
