// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Chart numeric formatting utilities.
 * Shared by ECharts option builders for gauge / bar / pie / radar / trend,
 * formatting displayed values uniformly by the configured decimal places (decimalPlaces).
 */

/**
 * Format any value into a string with the given number of decimal places.
 * Non-finite values (NaN / Infinity) and nullish values are stringified as-is
 * to avoid toFixed throwing.
 */
export function formatNumber(value: unknown, decimalPlaces: number | undefined): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  const places = Number.isInteger(decimalPlaces) ? Math.max(0, decimalPlaces as number) : 2;
  return number.toFixed(places);
}
