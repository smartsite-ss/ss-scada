// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Logical coordinate interface
export interface LogicalPoint {
  x: number;
  y: number;
}

// Display coordinate interface
export interface DisplayPoint {
  x: number;
  y: number;
}

// Rectangle interface
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// View state interface
export interface ViewState {
  scale: number;
  offset: {
    x: number;
    y: number;
  };
}

/**
 * Coordinate transformation utility class
 */
export class CoordinateUtils {
  /**
   * Convert logical coordinates to display coordinates
   * @param logical Logical coordinates
   * @param viewState View state (contains scale and offset)
   * @returns Display coordinates
   */
  public static logicalToDisplay(logical: LogicalPoint, viewState: ViewState): DisplayPoint {
    return {
      x: logical.x * viewState.scale + viewState.offset.x,
      y: logical.y * viewState.scale + viewState.offset.y
    };
  }

  /**
   * Convert display coordinates to logical coordinates
   * @param display Display coordinates
   * @param viewState View state (contains scale and offset)
   * @returns Logical coordinates
   */
  public static displayToLogical(display: DisplayPoint, viewState: ViewState): LogicalPoint {
    return {
      x: (display.x - viewState.offset.x) / viewState.scale,
      y: (display.y - viewState.offset.y) / viewState.scale
    };
  }

  /**
   * Compute the display rectangle from a logical rectangle
   * @param logicalRect Logical rectangle {x, y, width, height}
   * @param viewState View state (contains scale and offset)
   * @returns Display rectangle {x, y, width, height}
   */
  public static logicalRectToDisplay(logicalRect: Rect, viewState: ViewState): Rect {
    return {
      x: logicalRect.x * viewState.scale + viewState.offset.x,
      y: logicalRect.y * viewState.scale + viewState.offset.y,
      width: logicalRect.width * viewState.scale,
      height: logicalRect.height * viewState.scale
    };
  }

  /**
   * Compute the logical rectangle from a display rectangle
   * @param displayRect Display rectangle {x, y, width, height}
   * @param viewState View state (contains scale and offset)
   * @returns Logical rectangle {x, y, width, height}
   */
  public static displayRectToLogical(displayRect: Rect, viewState: ViewState): Rect {
    return {
      x: (displayRect.x - viewState.offset.x) / viewState.scale,
      y: (displayRect.y - viewState.offset.y) / viewState.scale,
      width: displayRect.width / viewState.scale,
      height: displayRect.height / viewState.scale
    };
  }

  /**
   * Compute the distance between two points
   * @param point1 First point
   * @param point2 Second point
   * @returns Distance between the two points
   */
  public static distance(point1: LogicalPoint | DisplayPoint, point2: LogicalPoint | DisplayPoint): number {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Check whether a point lies inside a rectangle
   * @param point Point
   * @param rect Rectangle
   * @returns Whether the point is inside the rectangle
   */
  public static pointInRect(point: LogicalPoint | DisplayPoint, rect: Rect): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width &&
           point.y >= rect.y && point.y <= rect.y + rect.height;
  }

  /**
   * Compute the intersection of two rectangles
   * @param rect1 First rectangle
   * @param rect2 Second rectangle
   * @returns The intersection rectangle, or null if there is no overlap
   */
  public static intersectRects(rect1: Rect, rect2: Rect): Rect | null {
    const x = Math.max(rect1.x, rect2.x);
    const y = Math.max(rect1.y, rect2.y);
    const width = Math.min(rect1.x + rect1.width, rect2.x + rect2.width) - x;
    const height = Math.min(rect1.y + rect1.height, rect2.y + rect2.height) - y;

    if (width <= 0 || height <= 0) {
      return null;
    }

    return { x, y, width, height };
  }
}

// Keep backward compatibility, export the legacy functional interface
export function logicalToDisplay(logical: LogicalPoint, viewState: ViewState): DisplayPoint {
  return CoordinateUtils.logicalToDisplay(logical, viewState);
}

export function displayToLogical(display: DisplayPoint, viewState: ViewState): LogicalPoint {
  return CoordinateUtils.displayToLogical(display, viewState);
}

export function logicalRectToDisplay(logicalRect: Rect, viewState: ViewState): Rect {
  return CoordinateUtils.logicalRectToDisplay(logicalRect, viewState);
}

export function displayRectToLogical(displayRect: Rect, viewState: ViewState): Rect {
  return CoordinateUtils.displayRectToLogical(displayRect, viewState);
}
