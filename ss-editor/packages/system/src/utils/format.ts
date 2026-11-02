// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Tag value display formatting utilities.
 *
 * Semantics kept consistent with the backend FormatStep.applyFormat(), supporting:
 * - Integer formats: %d / %i / %.0f
 * - Float formats: %.Nf (N decimal places)
 * - Hexadecimal formats: %X / %x / %04X / %08x etc.
 *
 * When displayFormat is not provided or the value cannot be parsed as a number, falls back to direct string conversion.
 */

/**
 * Format the display value according to a tag's displayFormat.
 *
 * @param value          Raw value (may be number / string / null / undefined)
 * @param displayFormat  Display format string (e.g. "%.2f", "%d", "%04X")
 * @returns The formatted string; returns an em dash when the value is empty
 */
export function formatTagValue(value: unknown, displayFormat?: string): string {
  if (value === null || value === undefined || value === '') return '—';

  // Without a format config, return the raw value directly
  if (!displayFormat) return String(value);

  const num = Number(value);
  if (Number.isNaN(num)) return String(value);

  // Integer formats
  if (displayFormat === '%d' || displayFormat === '%i' || displayFormat === '%.0f') {
    return Math.round(num).toString();
  }

  // Float format: %.Nf
  const floatMatch = displayFormat.match(/^%\.(\d+)f$/);
  if (floatMatch) {
    const decimals = parseInt(floatMatch[1], 10);
    return num.toFixed(decimals);
  }

  // Hexadecimal formats: %X / %x / %04X / %08x etc.
  const hexMatch = displayFormat.match(/^%(\d*)([Xx])$/);
  if (hexMatch) {
    const width = parseInt(hexMatch[1], 10) || 0;
    const upper = hexMatch[2] === 'X';
    const intVal = Math.round(num);
    if (intVal < 0) return String(value);
    const hex = intVal.toString(16);
    const padded = hex.padStart(width, '0');
    return upper ? padded.toUpperCase() : padded;
  }

  // Unsupported format, convert to string directly
  return String(value);
}

/**
 * Infer the decimal places from displayFormat (for axis ticks and similar scenarios).
 * Returns null when there are no explicit decimal places (callers should choose a default precision themselves).
 */
export function getDecimalsFromFormat(displayFormat?: string): number | null {
  if (!displayFormat) return null;
  const floatMatch = displayFormat.match(/^%\.(\d+)f$/);
  if (floatMatch) return parseInt(floatMatch[1], 10);
  if (displayFormat === '%d' || displayFormat === '%i' || displayFormat === '%.0f') return 0;
  return null;
}
