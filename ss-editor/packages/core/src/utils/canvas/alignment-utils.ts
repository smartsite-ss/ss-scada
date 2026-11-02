// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { IGraphic } from '@scada-editor/plugin-sdk';

/**
 * Alignment utility functions
 */
export class AlignmentUtils {
  /**
   * Get the bounding box of multiple graphics
   */
  static getBounds(graphics: IGraphic[]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  } {
    if (graphics.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const graphic of graphics) {
      const pos = graphic.getPosition();
      const size = graphic.getSize();

      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Align to the left
   */
  static alignLeft(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    const bounds = this.getBounds(graphics);
    const targetX = bounds.minX;

    for (const graphic of graphics) {
      if (graphic.getLocked()) continue;
      const pos = graphic.getPosition();
      graphic.setPosition(targetX, pos.y);
    }
  }

  /**
   * Align to the right
   */
  static alignRight(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    const bounds = this.getBounds(graphics);

    for (const graphic of graphics) {
      if (graphic.getLocked()) continue;
      const pos = graphic.getPosition();
      const size = graphic.getSize();
      const targetX = bounds.maxX - size.width;
      graphic.setPosition(targetX, pos.y);
    }
  }

  /**
   * Align to the top
   */
  static alignTop(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    const bounds = this.getBounds(graphics);
    const targetY = bounds.minY;

    for (const graphic of graphics) {
      if (graphic.getLocked()) continue;
      const pos = graphic.getPosition();
      graphic.setPosition(pos.x, targetY);
    }
  }

  /**
   * Align to the bottom
   */
  static alignBottom(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    const bounds = this.getBounds(graphics);

    for (const graphic of graphics) {
      if (graphic.getLocked()) continue;
      const pos = graphic.getPosition();
      const size = graphic.getSize();
      const targetY = bounds.maxY - size.height;
      graphic.setPosition(pos.x, targetY);
    }
  }

  /**
   * Align to horizontal center
   */
  static alignCenter(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    const bounds = this.getBounds(graphics);
    const centerX = bounds.minX + bounds.width / 2;

    for (const graphic of graphics) {
      if (graphic.getLocked()) continue;
      const pos = graphic.getPosition();
      const size = graphic.getSize();
      const targetX = centerX - size.width / 2;
      graphic.setPosition(targetX, pos.y);
    }
  }

  /**
   * Align to vertical middle
   */
  static alignMiddle(graphics: IGraphic[]): void {
    if (graphics.length < 2) return;

    const bounds = this.getBounds(graphics);
    const centerY = bounds.minY + bounds.height / 2;

    for (const graphic of graphics) {
      if (graphic.getLocked()) continue;
      const pos = graphic.getPosition();
      const size = graphic.getSize();
      const targetY = centerY - size.height / 2;
      graphic.setPosition(pos.x, targetY);
    }
  }

  /**
   * Distribute with equal horizontal spacing
   */
  static distributeHorizontal(graphics: IGraphic[]): void {
    if (graphics.length < 3) return;

    // Sort by x coordinate
    const sortedGraphics = [...graphics].sort(
      (a, b) => a.getPosition().x - b.getPosition().x
    );

    const bounds = this.getBounds(sortedGraphics);
    const totalWidth = bounds.width;

    // Compute the total width of all graphics
    let allGraphicsWidth = 0;
    for (const graphic of sortedGraphics) {
      allGraphicsWidth += graphic.getSize().width;
    }

    // Compute the spacing
    const gapCount = sortedGraphics.length - 1;
    const gap = (totalWidth - allGraphicsWidth) / gapCount;

    // Reposition the graphics
    let currentX = bounds.minX;
    for (const graphic of sortedGraphics) {
      if (!graphic.getLocked()) {
        const pos = graphic.getPosition();
        graphic.setPosition(currentX, pos.y);
      }
      currentX += graphic.getSize().width + gap;
    }
  }

  /**
   * Distribute with equal vertical spacing
   */
  static distributeVertical(graphics: IGraphic[]): void {
    if (graphics.length < 3) return;

    // Sort by y coordinate
    const sortedGraphics = [...graphics].sort(
      (a, b) => a.getPosition().y - b.getPosition().y
    );

    const bounds = this.getBounds(sortedGraphics);
    const totalHeight = bounds.height;

    // Compute the total height of all graphics
    let allGraphicsHeight = 0;
    for (const graphic of sortedGraphics) {
      allGraphicsHeight += graphic.getSize().height;
    }

    // Compute the spacing
    const gapCount = sortedGraphics.length - 1;
    const gap = (totalHeight - allGraphicsHeight) / gapCount;

    // Reposition the graphics
    let currentY = bounds.minY;
    for (const graphic of sortedGraphics) {
      if (!graphic.getLocked()) {
        const pos = graphic.getPosition();
        graphic.setPosition(pos.x, currentY);
      }
      currentY += graphic.getSize().height + gap;
    }
  }

  /**
   * Execute an alignment operation
   */
  static executeAlign(
    graphics: IGraphic[],
    alignment: 'left' | 'right' | 'top' | 'bottom' | 'center' | 'middle'
  ): void {
    switch (alignment) {
      case 'left':
        this.alignLeft(graphics);
        break;
      case 'right':
        this.alignRight(graphics);
        break;
      case 'top':
        this.alignTop(graphics);
        break;
      case 'bottom':
        this.alignBottom(graphics);
        break;
      case 'center':
        this.alignCenter(graphics);
        break;
      case 'middle':
        this.alignMiddle(graphics);
        break;
    }
  }

  /**
   * Execute a distribution operation
   */
  static executeDistribute(
    graphics: IGraphic[],
    direction: 'horizontal' | 'vertical'
  ): void {
    switch (direction) {
      case 'horizontal':
        this.distributeHorizontal(graphics);
        break;
      case 'vertical':
        this.distributeVertical(graphics);
        break;
    }
  }
}

// Export standalone functions
export function alignLeft(graphics: IGraphic[]): void {
  AlignmentUtils.alignLeft(graphics);
}

export function alignRight(graphics: IGraphic[]): void {
  AlignmentUtils.alignRight(graphics);
}

export function alignTop(graphics: IGraphic[]): void {
  AlignmentUtils.alignTop(graphics);
}

export function alignBottom(graphics: IGraphic[]): void {
  AlignmentUtils.alignBottom(graphics);
}

export function alignCenter(graphics: IGraphic[]): void {
  AlignmentUtils.alignCenter(graphics);
}

export function alignMiddle(graphics: IGraphic[]): void {
  AlignmentUtils.alignMiddle(graphics);
}

export function distributeHorizontal(graphics: IGraphic[]): void {
  AlignmentUtils.distributeHorizontal(graphics);
}

export function distributeVertical(graphics: IGraphic[]): void {
  AlignmentUtils.distributeVertical(graphics);
}
