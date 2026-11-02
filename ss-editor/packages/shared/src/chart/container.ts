// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ChartContainerStyleInput } from './types';

/** Transparent color placeholder (used for default background/border/shadow in edit mode; treated as transparent at runtime) */
const TRANSPARENT = '#00000000';

/**
 * Build the base styles for a chart container (background/border/radius/shadow),
 * shared by tag-trend / history-trend / new charts.
 * Components needing a vertical layout (e.g. history trend) can append styles like
 * display/flexDirection via extra.
 */
export function buildContainerStyle(
  props: ChartContainerStyleInput,
  extra: Record<string, string> = {},
): Record<string, string> {
  const background = props.backgroundColor === TRANSPARENT ? 'transparent' : props.backgroundColor;
  const borderColor = props.borderColor === TRANSPARENT ? 'transparent' : props.borderColor;
  const hasShadow = props.shadowColor && props.shadowColor !== TRANSPARENT;

  return {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    background,
    border: `${props.borderWidth}px ${props.borderStyle} ${borderColor}`,
    borderRadius: `${props.borderRadius}px`,
    boxShadow: hasShadow
      ? `${props.shadowOffsetX}px ${props.shadowOffsetY}px ${props.shadowBlur}px ${props.shadowColor}`
      : 'none',
    overflow: 'hidden',
    ...extra,
  };
}
