// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '@scada-editor/plugin-sdk';
import { v4 as uuidv4 } from 'uuid';

// ==================== Type Definitions ====================

export interface BatchOperation {
  type: 'move' | 'scale' | 'rotate' | 'style' | 'property';
  payload: any;
  apply(graphic: IGraphic): void;
}

export interface BatchMoveOptions {
  deltaX: number;
  deltaY: number;
}

export interface BatchScaleOptions {
  scaleX: number;
  scaleY: number;
  origin?: { x: number; y: number };
}

export interface BatchRotateOptions {
  degrees: number;
  origin?: { x: number; y: number };
}

export interface BatchStyleOptions {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  // Other style properties
  [key: string]: any;
}

export interface SmartPasteOptions {
  direction: 'horizontal' | 'vertical';
  spacing: number;
  count?: number;
}

/**
 * Batch operation manager
 * Handles batch move, scale, rotate, and style application of graphics
 */
export class BatchOperationManager {
  private operations: BatchOperation[] = [];

  constructor() {
    //
  }

  addOperation(graphicId: string, payload: any): void {
    this.operations.push({
      type: 'property',
      payload: { graphicId, ...payload },
      apply: () => {},
    });
  }

  execute(): void {
    this.operations = [];
  }

  /**
   * Batch move
   */
  batchMove(graphics: IGraphic[], deltaX: number, deltaY: number): void {
    for (const graphic of graphics) {
      const geometry = this.getSafeGeometry(graphic);
      if (geometry) {
        geometry.x += deltaX;
        geometry.y += deltaY;
        // Use IGraphic interface methods instead of direct manipulation
        graphic.setPosition(geometry.x, geometry.y);
      }
    }
  }

  /**
   * Batch scale
   */
  batchScale(
    graphics: IGraphic[],
    scaleX: number,
    scaleY: number,
    origin?: { x: number; y: number }
  ): void {
    if (graphics.length === 0) return;

    // If no origin is given, use the center point of all graphics as the origin
    if (!origin) {
      origin = this.calculateGroupCenter(graphics);
    }

    for (const graphic of graphics) {
      const geometry = this.getSafeGeometry(graphic);
      if (!geometry) continue;

      const { x, y, width, height } = geometry;

      // Scale around the origin
      const relativeX = x - origin.x;
      const relativeY = y - origin.y;

      geometry.x = origin.x + relativeX * scaleX;
      geometry.y = origin.y + relativeY * scaleY;
      geometry.width = width * scaleX;
      geometry.height = height * scaleY;

      // Use IGraphic interface methods instead of direct manipulation
      graphic.setPosition(geometry.x, geometry.y);
      graphic.setSize(geometry.width, geometry.height);
    }
  }

  /**
   * Batch rotate
   */
  batchRotate(
    graphics: IGraphic[],
    degrees: number,
    origin?: { x: number; y: number }
  ): void {
    if (graphics.length === 0) return;

    if (!origin) {
      origin = this.calculateGroupCenter(graphics);
    }

    const radians = (degrees * Math.PI) / 180;

    for (const graphic of graphics) {
      const geometry = this.getSafeGeometry(graphic);
      if (!geometry) continue;

      const { x, y, width, height } = geometry;
      const centerX = x + width / 2;
      const centerY = y + height / 2;

      const relativeX = centerX - origin.x;
      const relativeY = centerY - origin.y;

      const rotatedX = relativeX * Math.cos(radians) - relativeY * Math.sin(radians);
      const rotatedY = relativeX * Math.sin(radians) + relativeY * Math.cos(radians);

      const newCenterX = origin.x + rotatedX;
      const newCenterY = origin.y + rotatedY;

      geometry.x = newCenterX - width / 2;
      geometry.y = newCenterY - height / 2;
      geometry.rotation = (geometry.rotation || 0) + degrees;

      // Use IGraphic interface methods instead of direct manipulation
      graphic.setPosition(geometry.x, geometry.y);
      graphic.setRotation(geometry.rotation);
    }
  }

  /**
   * Apply style in batch
   */
  batchApplyStyle(graphics: IGraphic[], styleProperties: BatchStyleOptions): void {
    for (const graphic of graphics) {
      graphic.setStyle({ ...graphic.getStyle(), ...styleProperties });
    }
  }

  /**
   * Set property in batch
   */
  batchSetProperty(graphics: IGraphic[], propertyPath: string, value: any): void {
    for (const graphic of graphics) {
      graphic.setProperty(propertyPath, value);
    }
  }

  /**
   * Smart paste (batch paste with spacing)
   */
  smartPaste(
    graphics: IGraphic[],
    options: SmartPasteOptions
  ): IGraphic[] {
    const { direction, spacing, count = graphics.length } = options;
    const result: IGraphic[] = [];

    let currentOffset = 0;

    for (let i = 0; i < count; i++) {
      for (const graphic of graphics) {
        const duplicated = this.duplicateGraphic(graphic);
        const geometry = this.getSafeGeometry(duplicated);

        if (geometry) {
          if (direction === 'horizontal') {
            geometry.x += currentOffset;
          } else {
            geometry.y += currentOffset;
          }
        }

        result.push(duplicated);
      }

      const groupBounds = this.calculateGroupBounds(graphics);
      if (direction === 'horizontal') {
        currentOffset += groupBounds.width + spacing;
      } else {
        currentOffset += groupBounds.height + spacing;
      }
    }

    return result;
  }

  /**
   * Even spacing in batch (horizontal)
   */
  spaceEvenlyHorizontal(graphics: IGraphic[], spacing: number = 20): void {
    if (graphics.length < 2) return;

    // Sort by X coordinate
    const sorted = [...graphics].sort((a, b) => {
      const geoA = this.getSafeGeometry(a);
      const geoB = this.getSafeGeometry(b);
      return (geoA?.x || 0) - (geoB?.x || 0);
    });

    let currentX = this.getSafeGeometry(sorted[0])?.x || 0;

    for (const graphic of sorted) {
      const geometry = this.getSafeGeometry(graphic);
      if (!geometry) continue;

      geometry.x = currentX;
      currentX += geometry.width + spacing;
      // Use IGraphic interface methods instead of direct manipulation
      graphic.setPosition(geometry.x, geometry.y);
    }
  }

  /**
   * Even spacing in batch (vertical)
   */
  spaceEvenlyVertical(graphics: IGraphic[], spacing: number = 20): void {
    if (graphics.length < 2) return;

    // Sort by Y coordinate
    const sorted = [...graphics].sort((a, b) => {
      const geoA = this.getSafeGeometry(a);
      const geoB = this.getSafeGeometry(b);
      return (geoA?.y || 0) - (geoB?.y || 0);
    });

    let currentY = this.getSafeGeometry(sorted[0])?.y || 0;

    for (const graphic of sorted) {
      const geometry = this.getSafeGeometry(graphic);
      if (!geometry) continue;

      geometry.y = currentY;
      currentY += geometry.height + spacing;
      // Use IGraphic interface methods instead of direct manipulation
      graphic.setPosition(geometry.x, geometry.y);
    }
  }

  // ==================== Internal Helper Methods ====================

  private getSafeGeometry(graphic: IGraphic): any {
    if (!graphic || !graphic.config) {
      return null;
    }
    if (!graphic.config.geometry) {
      graphic.config.geometry = {
        x: 0, y: 0, width: 0, height: 0, rotation: 0, scale: 1
      };
    }
    return graphic.config.geometry;
  }

  private calculateGroupCenter(graphics: IGraphic[]): { x: number; y: number } {
    if (graphics.length === 0) {
      return { x: 0, y: 0 };
    }

    const bounds = this.calculateGroupBounds(graphics);
    return {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    };
  }

  private calculateGroupBounds(graphics: IGraphic[]): {
    x: number; y: number; width: number; height: number
  } {
    if (graphics.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const graphic of graphics) {
      const geo = this.getSafeGeometry(graphic);
      if (!geo) continue;
      minX = Math.min(minX, geo.x);
      minY = Math.min(minY, geo.y);
      maxX = Math.max(maxX, geo.x + geo.width);
      maxY = Math.max(maxY, geo.y + geo.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  private duplicateGraphic(graphic: IGraphic): IGraphic {
    const duplicated = Object.create(Object.getPrototypeOf(graphic));
    duplicated.config = {
      ...graphic.config,
      id: uuidv4(),
      config: JSON.parse(JSON.stringify(graphic.config))
    };
    return duplicated;
  }
}
