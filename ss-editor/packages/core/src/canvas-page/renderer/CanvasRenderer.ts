// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IRenderer, RenderContext, RenderOptions, ViewportRect } from './types';
import { IGraphic } from '@scada-editor/plugin-sdk';

/**
 * Simple grid spatial index, used to speed up viewport visibility queries
 * Divides the canvas into fixed-size grid cells; each graphic is assigned to the
 * cells its bounding box overlaps. Only the cells intersecting the viewport are
 * checked during queries.
 */
class GridSpatialIndex {
  private cellSize: number;
  private grid: Map<string, Set<IGraphic>> = new Map();
  private graphicCells: Map<string, string[]> = new Map(); // Graphic ID → list of grid keys it belongs to

  constructor(cellSize: number = 256) {
    this.cellSize = cellSize;
  }

  build(graphics: IGraphic[]): void {
    this.clear();
    for (const graphic of graphics) {
      this.insert(graphic);
    }
  }

  query(viewport: ViewportRect): IGraphic[] {
    const result: IGraphic[] = [];
    const visited = new Set<string>();

    // Compute the grid range covered by the viewport
    const minCx = Math.floor(viewport.x / this.cellSize);
    const minCy = Math.floor(viewport.y / this.cellSize);
    const maxCx = Math.floor((viewport.x + viewport.width) / this.cellSize);
    const maxCy = Math.floor((viewport.y + viewport.height) / this.cellSize);

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = `${cx},${cy}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const graphic of cell) {
            if (!visited.has(graphic.id)) {
              visited.add(graphic.id);
              // Secondary precise check (AABB intersection)
              if (this.intersectsViewport(graphic, viewport)) {
                result.push(graphic);
              }
            }
          }
        }
      }
    }

    return result;
  }

  clear(): void {
    this.grid.clear();
    this.graphicCells.clear();
  }

  private insert(graphic: IGraphic): void {
    try {
      const pos = graphic.getPosition();
      const size = graphic.getSize();
      // Get the graphic's actual render bounds (considering rotation)
      let bounds: { x: number; y: number; width: number; height: number };
      const rotation = graphic.getRotation?.() || 0;
      if (rotation !== 0 && typeof (graphic as any).getBounds === 'function') {
        const b = (graphic as any).getBounds();
        bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      } else {
        bounds = { x: pos.x, y: pos.y, width: size.width, height: size.height };
      }

      const minCx = Math.floor(bounds.x / this.cellSize);
      const minCy = Math.floor(bounds.y / this.cellSize);
      const maxCx = Math.floor((bounds.x + bounds.width) / this.cellSize);
      const maxCy = Math.floor((bounds.y + bounds.height) / this.cellSize);

      const cells: string[] = [];
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const key = `${cx},${cy}`;
          let cell = this.grid.get(key);
          if (!cell) {
            cell = new Set();
            this.grid.set(key, cell);
          }
          cell.add(graphic);
          cells.push(key);
        }
      }
      this.graphicCells.set(graphic.id, cells);
    } catch {
      // Graphic may not be fully initialized yet; skip
    }
  }

  private intersectsViewport(graphic: IGraphic, viewport: ViewportRect): boolean {
    try {
      const pos = graphic.getPosition();
      const size = graphic.getSize();
      return (
        pos.x + size.width > viewport.x &&
        pos.x < viewport.x + viewport.width &&
        pos.y + size.height > viewport.y &&
        pos.y < viewport.y + viewport.height
      );
    } catch {
      return true; // Default to visible when it cannot be determined
    }
  }
}

export class CanvasRenderer implements IRenderer {
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private graphics: Map<string, IGraphic> = new Map();
  private scale: number = 1;
  private panX: number = 0;
  private panY: number = 0;
  private animationFrameId: number | null = null;
  private dirtyGraphics = new Set<string>();

  // ====== Viewport culling ======
  private viewport: ViewportRect | null = null;
  private cullingEnabled = false;
  private cullingBufferRatio = 0.05; // Default 5% buffer
  private spatialIndex: GridSpatialIndex = new GridSpatialIndex(256);
  private spatialIndexDirty = false;

  constructor(container: HTMLElement, options?: RenderOptions) {
    this.canvas = options?.canvas || document.createElement('canvas');
    this.canvas.width = options?.width || container.clientWidth;
    this.canvas.height = options?.height || container.clientHeight;
    this.context = this.canvas.getContext('2d')!;

    if (!options?.canvas) {
      container.appendChild(this.canvas);
    }

    this.startRenderLoop();
  }

  private startRenderLoop(): void {
    this.renderLoop();
  }

  private renderLoop(): void {
    if (this.dirtyGraphics.size > 0) {
      this.renderDirtyGraphics();
    }
    this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
  }

  private renderDirtyGraphics(): void {
    const dirtyIds = Array.from(this.dirtyGraphics);

    dirtyIds.forEach(id => {
      const graphic = this.graphics.get(id);
      if (graphic) {
        this.clearGraphicArea(graphic);
        this.drawGraphic(graphic);
      }
    });

    this.dirtyGraphics.clear();
  }

  private clearGraphicArea(graphic: IGraphic): void {
    const { x, y } = graphic.getPosition();
    const { width, height } = graphic.getSize();

    this.context.save();
    this.context.setTransform(this.scale, 0, 0, this.scale, this.panX, this.panY);
    this.context.clearRect(x, y, width, height);
    this.context.restore();
  }

  private drawGraphic(graphic: IGraphic): void {
    if (!graphic.getVisible()) return;

    this.context.save();
    this.context.setTransform(this.scale, 0, 0, this.scale, this.panX, this.panY);

    const rotation = graphic.getRotation?.() || 0;
    if (rotation !== 0) {
      const { x, y } = graphic.getPosition();
      const { width, height } = graphic.getSize();
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      this.context.translate(centerX, centerY);
      this.context.rotate((rotation * Math.PI) / 180);
      this.context.translate(-centerX, -centerY);
    }

    graphic.draw(this.context);
    this.context.restore();
  }

  render(graphic: IGraphic): void {
    this.graphics.set(graphic.id, graphic);
    this.markDirty(graphic.id);
    this.spatialIndexDirty = true;
  }

  update(graphic: IGraphic): void {
    this.graphics.set(graphic.id, graphic);
    this.markDirty(graphic.id);
    this.spatialIndexDirty = true;
  }

  remove(graphicId: string): void {
    const graphic = this.graphics.get(graphicId);
    if (graphic) {
      this.clearGraphicArea(graphic);
      this.graphics.delete(graphicId);
      this.spatialIndexDirty = true;
    }
  }

  clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.graphics.clear();
    this.dirtyGraphics.clear();
    this.spatialIndex.clear();
    this.spatialIndexDirty = false;
  }

  destroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.clear();
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.markAllDirty();
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.markAllDirty();
  }

  setPan(x: number, y: number): void {
    this.panX = x;
    this.panY = y;
    this.markAllDirty();
  }

  getContext(): RenderContext {
    return {
      canvas: this.canvas,
      context: this.context,
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  // ====== Viewport culling implementation ======

  setViewport(viewport: ViewportRect): void {
    this.viewport = viewport;
    this.spatialIndexDirty = true;
  }

  getViewport(): ViewportRect | null {
    return this.viewport ? { ...this.viewport } : null;
  }

  setViewportCulling(enabled: boolean): void {
    this.cullingEnabled = enabled;
    if (enabled) {
      this.spatialIndexDirty = true;
    }
  }

  isViewportCullingEnabled(): boolean {
    return this.cullingEnabled;
  }

  setCullingBuffer(ratio: number): void {
    this.cullingBufferRatio = Math.max(0, Math.min(1, ratio));
  }

  /**
   * Get the buffered viewport rectangle (expands the detection range to prevent edge flickering)
   */
  private getBufferedViewport(): ViewportRect | null {
    if (!this.viewport) return null;

    const bufX = this.viewport.width * this.cullingBufferRatio;
    const bufY = this.viewport.height * this.cullingBufferRatio;

    return {
      x: this.viewport.x - bufX,
      y: this.viewport.y - bufY,
      width: this.viewport.width + bufX * 2,
      height: this.viewport.height + bufY * 2,
    };
  }

  /**
   * Get the list of visible graphics within the current viewport
   * Returns the culled result when viewport culling is enabled, otherwise all graphics
   */
  getVisibleGraphics(): IGraphic[] {
    if (!this.cullingEnabled || !this.viewport) {
      return Array.from(this.graphics.values());
    }

    // Rebuild the spatial index when it is dirty
    if (this.spatialIndexDirty) {
      this.spatialIndex.build(Array.from(this.graphics.values()));
      this.spatialIndexDirty = false;
    }

    const bufferedVp = this.getBufferedViewport()!;
    return this.spatialIndex.query(bufferedVp);
  }

  /**
   * Full render with viewport culling
   * Only draws the visible graphics within the viewport, greatly reducing draw calls
   */
  renderAllWithCulling(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const visibleGraphics = this.getVisibleGraphics();

    // Sort by zIndex
    visibleGraphics.sort(
      (a, b) => (a.getZIndex?.() || 0) - (b.getZIndex?.() || 0)
    );

    for (const graphic of visibleGraphics) {
      this.drawGraphic(graphic);
    }
  }

  private markDirty(graphicId: string): void {
    this.dirtyGraphics.add(graphicId);
  }

  private markAllDirty(): void {
    this.graphics.forEach((_, id) => this.dirtyGraphics.add(id));
  }

  renderAll(): void {
    if (this.cullingEnabled && this.viewport) {
      this.renderAllWithCulling();
      return;
    }

    // Original full-render logic (for backward compatibility)
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const sortedGraphics = Array.from(this.graphics.values()).sort(
      (a, b) => (a.getZIndex?.() || 0) - (b.getZIndex?.() || 0)
    );

    sortedGraphics.forEach(graphic => this.drawGraphic(graphic));
  }

  /**
   * Get performance statistics (for debugging and benchmarking)
   */
  getCullingStats(): { totalGraphics: number; visibleGraphics: number; cullingRatio: number } | null {
    if (!this.cullingEnabled || !this.viewport) return null;
    const total = this.graphics.size;
    const visible = this.getVisibleGraphics().length;
    return {
      totalGraphics: total,
      visibleGraphics: visible,
      cullingRatio: total > 0 ? ((total - visible) / total) : 0,
    };
  }
}
