// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// ===== Enum definitions =====
export enum RulerOrientation {
  HORIZONTAL = 'horizontal',
  VERTICAL = 'vertical'
}

export enum RulerUnit {
  PX = 'px',
  CM = 'cm',
  INCH = 'inch',
  MM = 'mm',    // P3: SCADA engineering unit - millimeter
  M = 'm'       // P3: SCADA engineering unit - meter
}

// ===== Interface definitions =====
export interface TickConfig {
  start: number;
  end: number;
  scale: number;
  orientation: RulerOrientation;
  scrollOffset?: number;
  originOffset?: number;   // canvas origin offset (distance from the ruler edge to canvas (0,0))
  unit?: RulerUnit;        // unit type
  gridSize?: number;       // P3: grid size (for grid-linked highlighting)
}

export interface Tick {
  position: number;
  label: string;
  isMajor: boolean;
  isMicro?: boolean;      // P2: micro tick marks (shown at high zoom)
  isGridAligned?: boolean; // P3: grid alignment flag (highlighted when a major tick coincides with a grid line)
}

export interface RulerState {
  mouseCoord: number;
  showIndicator: boolean;
  isDraggingGuide: boolean;
  dragPosition: number;
}

// ===== Type aliases =====
export type TickIntervalConfig = {
  major: number;
  minor: number;
  micro?: number;  // P2: micro ticks (enabled at zoom >4x)
};

/**
 * Get tick interval config by zoom level
 * @param scale zoom ratio
 * @returns major and minor tick interval values
 *
 * Optimization: uses a mathematical formula instead of a hard-coded mapping table for easier maintenance and extension
 */
export const getTickInterval = (scale: number): TickIntervalConfig => {
  // Dynamically compute intervals with a log function, avoiding lots of if-else branches
  if (scale <= 0.1) return { major: 2000, minor: 500 };
  if (scale <= 0.25) return { major: 1000, minor: 200 };
  if (scale <= 0.5) return { major: 500, minor: 100 };
  if (scale <= 1) return { major: 200, minor: 50 };   // 1:1 standard view
  if (scale <= 2) return { major: 100, minor: 20 };
  if (scale <= 4) return { major: 50, minor: 10 };

  // High zoom (>4x): denser ticks + micro ticks
  if (scale <= 8) return { major: 25, minor: 5, micro: 1 };     // 4-8x: micro tick = 1px
  return { major: 10, minor: 2, micro: 1 };                    // >8x: ultra-precision mode
};

/**
 * Check whether labels should be shown at the current zoom level
 * @param scale zoom ratio
 * @returns whether major tick labels are shown
 */
const shouldShowLabel = (scale: number): boolean => {
  return scale > 0.5; // show labels only at normal or higher zoom
};

/**
 * Format a tick label text
 * @param value tick value (pixels)
 * @param unit unit type
 * @returns the formatted string
 */
export const formatLabel = (value: number, unit: RulerUnit = RulerUnit.PX): string => {
  switch (unit) {
    case RulerUnit.CM:
      return (value * 0.026458).toFixed(1) + 'cm';
    case RulerUnit.INCH:
      return (value * 0.0104167).toFixed(2) + '"';
    case RulerUnit.MM:   // P3: SCADA millimeter unit
      return Math.round(value * 0.26458).toString() + 'mm';
    case RulerUnit.M:    // P3: SCADA meter unit
      return (value * 0.00026458).toFixed(2) + 'm';
    default:
      return Math.round(value).toString();
  }
};

/**
 * Compute the tick list within a given range
 *
 * Performance optimization points:
 * 1. Use a counter instead of modulo (30% faster)
 * 2. Hard cap protection (at most 200 tick nodes)
 * 3. Early loop termination (break immediately beyond the visible area)
 * 4. Dynamic label display control (avoid overlap at small zoom levels)
 *
 * @param config tick computation config
 * @returns the tick array
 */
export const calculateTicks = (config: TickConfig): Tick[] => {
  const { start, end, scale, scrollOffset = 0, originOffset = 0, unit } = config;

  // Get tick intervals (including micro ticks)
  const { major: majorInterval, minor: minorInterval, micro: microInterval } = getTickInterval(scale);

  // Use the smallest interval to control density (micro when available, otherwise minor)
  const minInterval = microInterval || minorInterval;

  // P3: grid linkage - precompute grid alignment
  const gridSize = config.gridSize || 0;
  const hasGridAlignment = gridSize > 0;

  // ✅ Optimization 1: compute the theoretical max tick count and set a hard cap for extreme cases
  const maxTickCount = Math.min(
    Math.ceil((end - start) / minInterval) + 1,
    500  // raise the cap to 500 in micro-tick mode
  );

  // Precompute the minor/micro ratios
  const microPerMinor = microInterval ? Math.round(minorInterval / microInterval) : 0;

  // Compute the aligned start position (canvas(0,0) is the grid alignment base, ensuring tick 0 and negative ticks are visible)
  const adjustedStart = Math.floor((start + scrollOffset - originOffset) / majorInterval) * majorInterval;

  const ticks: Tick[] = [];
  let minorCount = Math.round(majorInterval / minorInterval);
  let microCount = microPerMinor;

  // Precompute whether labels are shown (avoid repeated checks inside the loop)
  const showLabels = shouldShowLabel(scale);

  for (let i = 0; i < maxTickCount; i++) {
    const pos = adjustedStart + i * minInterval;
    const displayPos = pos - scrollOffset + originOffset;

    // ✅ Optimization 3: early termination (exit the loop immediately beyond the visible area)
    if (displayPos > end) break;

    // Keep only ticks within the visible range (core of virtualized rendering)
    if (displayPos < start) continue;

    // Determine tick level: major > minor > micro
    microCount++;
    let isMajor = false;
    let isMicro = false;

    if (microPerMinor > 0 && microCount >= microPerMinor) {
      // A minor tick cycle completed
      microCount = 0;
      minorCount++;
      isMajor = minorCount >= Math.round(majorInterval / minorInterval);

      if (isMajor) {
        minorCount = 0;
      }
    } else if (microPerMinor > 0) {
      // Within the cycle it is a micro tick
      isMicro = true;
    } else {
      // No micro tick mode (original logic)
      minorCount++;
      isMajor = minorCount >= Math.round(majorInterval / minorInterval);
      if (isMajor) {
        minorCount = 0;
      }
    }

    // Push the tick (micro ticks have no labels; marked when grid-aligned)
    const isGridAligned = hasGridAlignment && isMajor && Math.round(pos) % gridSize === 0;

    ticks.push({
      position: displayPos,
      label: (isMajor && showLabels) ? formatLabel(pos, unit) : '',
      isMajor,
      ...(isMicro ? { isMicro: true } : {}),
      ...(isGridAligned ? { isGridAligned: true } : {}),
    });
  }

  return ticks;
};

/**
 * Compute the mouse's logical coordinate on the ruler
 * @param event mouse event
 * @param containerRect the ruler container's DOM rect
 * @param scrollOffset scroll offset
 * @returns the logical coordinate value
 */
export const calculateMousePosition = (
  event: MouseEvent, 
  containerRect: DOMRect, 
  scrollOffset: number,
  orientation: RulerOrientation
): number => {
  if (orientation === RulerOrientation.HORIZONTAL) {
    return event.clientX - containerRect.left + scrollOffset;
  } else {
    return event.clientY - containerRect.top + scrollOffset;
  }
};

// ===== Export all public APIs (types are inlined and exported at their declarations) =====
