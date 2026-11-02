// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '@scada-editor/plugin-sdk';

// ==================== Type Definitions ====================

export interface GuideLine {
  id: string;
  position: number;
  direction: 'horizontal' | 'vertical';
  color?: string;
}

export interface AlignTarget {
  type: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';
  value: number;
  referenceGraphicId?: string;
  referenceLineId?: string;
}

export type AlignType = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';

/**
 * Smart align manager
 * Handles real-time alignment detection, guide line management, and even distribution
 */
export class SmartAlignManager {
  private guideLines: GuideLine[] = [];
  private alignDistance: number = 8; // Default alignment distance

  /**
   * Set the alignment distance
   */
  setAlignDistance(distance: number): void {
    this.alignDistance = distance;
  }

  /**
   * Detect alignment targets (called in real time during dragging)
   * @param draggingGraphic - Graphic being dragged
   * @param otherGraphics - Other referenceable graphics
   */
  detectAlignTargets(
    draggingGraphic: IGraphic,
    otherGraphics: IGraphic[]
  ): AlignTarget[] {
    const targets: AlignTarget[] = [];
    const draggingGeo = this.getSafeGeometry(draggingGraphic);
    if (!draggingGeo) return targets;

    const { x, y, width, height } = draggingGeo;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // 1. Detect alignment with other graphics
    for (const graphic of otherGraphics) {
      if (graphic.id === draggingGraphic.id) continue;

      const otherGeo = this.getSafeGeometry(graphic);
      if (!otherGeo) continue;

      const { x: ox, y: oy, width: ow, height: oh } = otherGeo;
      const otherCenterX = ox + ow / 2;
      const otherCenterY = oy + oh / 2;

      // Align left
      if (Math.abs(x - ox) <= this.alignDistance) {
        targets.push({ type: 'left', value: ox, referenceGraphicId: graphic.id });
      }
      // Align right
      if (Math.abs(x + width - (ox + ow)) <= this.alignDistance) {
        targets.push({ type: 'right', value: ox + ow, referenceGraphicId: graphic.id });
      }
      // Align top
      if (Math.abs(y - oy) <= this.alignDistance) {
        targets.push({ type: 'top', value: oy, referenceGraphicId: graphic.id });
      }
      // Align bottom
      if (Math.abs(y + height - (oy + oh)) <= this.alignDistance) {
        targets.push({ type: 'bottom', value: oy + oh, referenceGraphicId: graphic.id });
      }
      // Horizontal center alignment
      if (Math.abs(centerX - otherCenterX) <= this.alignDistance) {
        targets.push({ type: 'centerX', value: otherCenterX, referenceGraphicId: graphic.id });
      }
      // Vertical center alignment
      if (Math.abs(centerY - otherCenterY) <= this.alignDistance) {
        targets.push({ type: 'centerY', value: otherCenterY, referenceGraphicId: graphic.id });
      }
    }

    // 2. Detect alignment with guide lines
    for (const line of this.guideLines) {
      if (line.direction === 'vertical') {
        if (Math.abs(x - line.position) <= this.alignDistance) {
          targets.push({ type: 'left', value: line.position, referenceLineId: line.id });
        }
        if (Math.abs(x + width - line.position) <= this.alignDistance) {
          targets.push({ type: 'right', value: line.position, referenceLineId: line.id });
        }
        if (Math.abs(centerX - line.position) <= this.alignDistance) {
          targets.push({ type: 'centerX', value: line.position, referenceLineId: line.id });
        }
      } else {
        if (Math.abs(y - line.position) <= this.alignDistance) {
          targets.push({ type: 'top', value: line.position, referenceLineId: line.id });
        }
        if (Math.abs(y + height - line.position) <= this.alignDistance) {
          targets.push({ type: 'bottom', value: line.position, referenceLineId: line.id });
        }
        if (Math.abs(centerY - line.position) <= this.alignDistance) {
          targets.push({ type: 'centerY', value: line.position, referenceLineId: line.id });
        }
      }
    }

    return targets;
  }

  /**
   * Apply alignment
   * @param graphic - Graphic to align
   * @param target - Alignment target
   */
  applyAlignment(graphic: IGraphic, target: AlignTarget): void {
    const geometry = this.getSafeGeometry(graphic);
    if (!geometry) return;

    const { type, value } = target;
    const { width, height } = geometry;
    const currentPos = graphic.getPosition();

    switch (type) {
      case 'left':
        graphic.setPosition(value, currentPos.y);
        break;
      case 'right':
        graphic.setPosition(value - width, currentPos.y);
        break;
      case 'top':
        graphic.setPosition(currentPos.x, value);
        break;
      case 'bottom':
        graphic.setPosition(currentPos.x, value - height);
        break;
      case 'centerX':
        graphic.setPosition(value - width / 2, currentPos.y);
        break;
      case 'centerY':
        graphic.setPosition(currentPos.x, value - height / 2);
        break;
    }
  }

  // ==================== Guide Line Management ====================

  /**
   * Add a guide line
   */
  addGuideLine(position: number, direction: 'horizontal' | 'vertical'): string {
    const id = `guide-${Date.now()}-${Math.random()}`;
    this.guideLines.push({ id, position, direction });
    return id;
  }

  /**
   * Remove a guide line
   */
  removeGuideLine(id: string): void {
    this.guideLines = this.guideLines.filter(line => line.id !== id);
  }

  /**
   * Remove all guide lines
   */
  clearAllGuideLines(): void {
    this.guideLines = [];
  }

  /**
   * Get all guide lines
   */
  getAllGuideLines(): GuideLine[] {
    return [...this.guideLines];
  }

  /**
   * Update guide line position
   */
  updateGuideLinePosition(id: string, position: number): void {
    const line = this.guideLines.find(l => l.id === id);
    if (line) {
      line.position = position;
    }
  }

  /**
   * Get a guide line
   */
  getGuideLine(id: string): GuideLine | null {
    return this.guideLines.find(l => l.id === id) || null;
  }

  /**
   * Serialize to JSON
   */
  toJSON(): GuideLine[] {
    return [...this.guideLines];
  }

  /**
   * Deserialize from JSON
   */
  fromJSON(data: GuideLine[]): void {
    this.guideLines = data ? [...data] : [];
  }

  // ==================== Enhanced Alignment Features ====================

  /**
   * Equal width and height alignment
   */
  makeSameSize(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    // Compute the maximum width and height
    let maxWidth = 0;
    let maxHeight = 0;
    for (const graphic of graphics) {
      const geo = this.getSafeGeometry(graphic);
      if (!geo) continue;
      maxWidth = Math.max(maxWidth, geo.width);
      maxHeight = Math.max(maxHeight, geo.height);
    }

    // Apply uniformly
    for (const graphic of graphics) {
      graphic.setSize(maxWidth, maxHeight);
    }
  }

  /**
   * Equal width alignment
   */
  makeSameWidth(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    let maxWidth = 0;
    for (const graphic of graphics) {
      const geo = this.getSafeGeometry(graphic);
      if (!geo) continue;
      maxWidth = Math.max(maxWidth, geo.width);
    }

    for (const graphic of graphics) {
      const currentSize = graphic.getSize();
      graphic.setSize(maxWidth, currentSize.height);
    }
  }

  /**
   * Equal height alignment
   */
  makeSameHeight(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    let maxHeight = 0;
    for (const graphic of graphics) {
      const geo = this.getSafeGeometry(graphic);
      if (!geo) continue;
      maxHeight = Math.max(maxHeight, geo.height);
    }

    for (const graphic of graphics) {
      const currentSize = graphic.getSize();
      graphic.setSize(currentSize.width, maxHeight);
    }
  }

  /**
   * Align to page edge
   */
  alignToPageEdge(
    graphics: IGraphic[],
    type: 'left' | 'right' | 'top' | 'bottom',
    pageWidth: number,
    pageHeight: number,
    margin: number = 0
  ): void {
    for (const graphic of graphics) {
      const currentPos = graphic.getPosition();
      const currentSize = graphic.getSize();

      switch (type) {
        case 'left':
          graphic.setPosition(margin, currentPos.y);
          break;
        case 'right':
          graphic.setPosition(pageWidth - currentSize.width - margin, currentPos.y);
          break;
        case 'top':
          graphic.setPosition(currentPos.x, margin);
          break;
        case 'bottom':
          graphic.setPosition(currentPos.x, pageHeight - currentSize.height - margin);
          break;
      }
    }
  }

  /**
   * Center graphic (relative to page)
   */
  centerOnPage(
    graphics: IGraphic[],
    pageWidth: number,
    pageHeight: number,
    direction: 'horizontal' | 'vertical' | 'both' = 'both'
  ): void {
    if (graphics.length === 0) return;

    for (const graphic of graphics) {
      const currentPos = graphic.getPosition();
      const currentSize = graphic.getSize();

      let newX = currentPos.x;
      let newY = currentPos.y;

      if (direction === 'horizontal' || direction === 'both') {
        newX = (pageWidth - currentSize.width) / 2;
      }
      if (direction === 'vertical' || direction === 'both') {
        newY = (pageHeight - currentSize.height) / 2;
      }

      graphic.setPosition(newX, newY);
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
}
