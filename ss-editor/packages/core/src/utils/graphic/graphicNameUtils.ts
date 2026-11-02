// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { IGraphic } from '@scada-editor/plugin-sdk';

/**
 * Generate an incrementing name for graphics of the same type
 *
 * Rules:
 *   - Derive the base name from type (capitalize first letter), e.g. 'pump' → 'Pump'
 *   - Scan all graphics of the same name series on the page and extract the
 *     largest numeric suffix
 *   - Return `${baseName}_${maxSuffix + 1}`
 *
 * @example
 *   // Page contains Pump_1, Pump_3, Valve_1
 *   getNextGraphicName('pump', graphics) // → 'Pump_4'
 *   getNextGraphicName('valve', graphics) // → 'Valve_2'
 *   getNextGraphicName('text', graphics)  // → 'Text_1'  (no same-type series on page)
 */
export function getNextGraphicName(
  type: string,
  existingGraphics: IGraphic[],
): string {
  // Derive base name: capitalize first letter
  const baseName = type.charAt(0).toUpperCase() + type.slice(1);

  // Collect numeric suffixes of same-series names on the page
  // Match pattern: baseName_number or baseName (treated as baseName_0)
  const pattern = new RegExp(`^${escapeRegExp(baseName)}(?:_(\\d+))?$`);
  let maxNum = 0;

  for (const g of existingGraphics) {
    const name = g.config?.name;
    if (!name) continue;
    const match = name.match(pattern);
    if (match) {
      // match[1] is the _number part; undefined means a bare baseName (treated as index 0)
      const num = match[1] !== undefined ? parseInt(match[1], 10) : 0;
      if (num >= maxNum) {
        maxNum = num + 1;
      }
    }
  }

  return `${baseName}_${maxNum}`;
}

/**
 * Extract the list of graphics of a given type from the page graphic list
 */
export function getGraphicsByType(
  graphics: IGraphic[],
  type: string,
): IGraphic[] {
  return graphics.filter((g) => g.type === type);
}

/** Escape regex special characters */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
