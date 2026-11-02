// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/** Tag value component shape */
export type TagValueShape = 'rectangle' | 'circle';

/** Decoration image position */
export type DecorationImagePosition = 'left' | 'right' | 'background' | 'center';

/**
 * Resolve the display name: alias (non-empty) > tag name > tag ID.
 * alias is a component-level field (DataTag has no alias), hence the three-level fallback here.
 */
export function resolveDisplayName(alias: string, tagName: string, tagId: string): string {
  return (alias ?? '').trim() || tagName || tagId || '';
}

/**
 * Format the real-time value by decimal places; booleans and non-numeric values (strings) are returned as-is, empty values return a placeholder.
 */
export function formatTagValue(raw: unknown, decimalPlaces: number): string {
  if (raw === null || raw === undefined || raw === '') return '--';
  if (typeof raw === 'boolean') return String(raw);
  const num = Number(raw);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    return num.toFixed(decimalPlaces ?? 2);
  }
  return String(raw);
}

/**
 * Background image fill style → CSS background-size.
 * fill maps to 100% 100% (stretched to fill); scale-down has no native background-size value, approximated with contain.
 */
export function resolveBackgroundSize(fit: string): string {
  switch (fit) {
    case 'contain':
      return 'contain';
    case 'cover':
      return 'cover';
    case 'fill':
      return '100% 100%';
    case 'none':
      return 'auto';
    case 'scale-down':
      return 'contain';
    default:
      return '100% 100%';
  }
}
