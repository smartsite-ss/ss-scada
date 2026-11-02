// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import Konva from 'konva';
import { IRenderer, RenderContext, RenderOptions, ViewportRect } from './types';
import { IGraphic } from '@scada-editor/plugin-sdk';

/**
 * Layer type enum
 */
export enum KonvaLayerType {
  Background = 'background',
  Static = 'static',
  Dynamic = 'dynamic',
  Overlay = 'overlay',
}

/**
 * Multi-layer Konva renderer
 *
 * Architecture benefits:
 * - Background layer: grid, background (rarely redrawn)
 * - Static layer: static graphics (shapes, labels, images) (low-frequency redraw)
 * - Dynamic layer: dynamic graphics (charts, gauges, buttons) (high-frequency redraw)
 * - Overlay layer: selection box, guides, control points (real-time redraw)
 *
 * Performance optimizations:
 * - Use batchDraw() for batched rendering to reduce redraw count
 * - Use requestAnimationFrame to merge render requests
 * - Layered rendering avoids redrawing unrelated graphics
 */
export class KonvaRenderer implements IRenderer {
  private stage: Konva.Stage;

  /** Four independent layers */
  private layers: Record<KonvaLayerType, Konva.Layer>;

  /** Graphic-to-layer mapping */
  private graphicLayerMap: Map<string, KonvaLayerType> = new Map();

  /** Graphic node mapping */
  private nodes: Map<string, Konva.Node> = new Map();

  /** Render state */
  private scale: number = 1;
  private panX: number = 0;
  private panY: number = 0;

  /** Batch render control */
  private pendingRenders = new Set<string>();
  private animationFrameId: number | null = null;

  /** Performance statistics */
  private renderCount: number = 0;
  private batchCount: number = 0;

  constructor(container: HTMLElement, options?: RenderOptions) {
    this.stage = new Konva.Stage({
      container: container as HTMLDivElement,
      width: options?.width || container.clientWidth,
      height: options?.height || container.clientHeight,
    });

    this.layers = {
      background: new Konva.Layer({ name: KonvaLayerType.Background }),
      static: new Konva.Layer({ name: KonvaLayerType.Static }),
      dynamic: new Konva.Layer({ name: KonvaLayerType.Dynamic }),
      overlay: new Konva.Layer({ name: KonvaLayerType.Overlay }),
    };

    Object.values(this.layers).forEach(layer => {
      this.stage.add(layer);
    });
  }

  render(graphic: IGraphic): void {
    const layer = this.getLayerForGraphic(graphic);
    const node = this.createKonvaNode(graphic);

    if (node) {
      this.nodes.set(graphic.id, node);
      this.graphicLayerMap.set(graphic.id, this.getLayerTypeForGraphic(graphic));
      layer.add(node as any);
      this.scheduleBatchRender();
    }
  }

  update(graphic: IGraphic): void {
    const node = this.nodes.get(graphic.id);
    if (node) {
      this.updateKonvaNode(node, graphic);
      this.scheduleBatchRender();
    }
  }

  remove(graphicId: string): void {
    const node = this.nodes.get(graphicId);
    if (node) {
      node.destroy();
      this.nodes.delete(graphicId);
      this.graphicLayerMap.delete(graphicId);
      this.scheduleBatchRender();
    }
  }

  clear(): void {
    Object.values(this.layers).forEach(layer => {
      layer.destroyChildren();
    });
    this.nodes.clear();
    this.graphicLayerMap.clear();
    this.flushBatchRender();
  }

  destroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.stage.destroy();
    this.nodes.clear();
    this.graphicLayerMap.clear();
  }

  resize(width: number, height: number): void {
    this.stage.width(width);
    this.stage.height(height);
    this.scheduleBatchRender();
  }

  setScale(scale: number): void {
    this.scale = scale;
    Object.values(this.layers).forEach(layer => {
      layer.scale({ x: scale, y: scale });
    });
    this.scheduleBatchRender();
  }

  setPan(x: number, y: number): void {
    this.panX = x;
    this.panY = y;
    Object.values(this.layers).forEach(layer => {
      layer.position({ x, y });
    });
    this.scheduleBatchRender();
  }

  getScale(): number {
    return this.scale;
  }

  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
  }

  getContext(): RenderContext | null {
    const canvas = this.stage.toCanvas();
    if (!canvas) return null;

    return {
      canvas,
      context: canvas.getContext('2d')!,
      width: this.stage.width(),
      height: this.stage.height(),
    };
  }

  /**
   * Get the layer instance
   */
  getLayer(type: KonvaLayerType): Konva.Layer {
    return this.layers[type];
  }

  /**
   * Get all layers
   */
  getAllLayers(): Konva.Layer[] {
    return Object.values(this.layers);
  }

  /**
   * Get the stage instance
   */
  getStage(): Konva.Stage {
    return this.stage;
  }

  /**
   * Force immediate render of a specific layer
   */
  forceRenderLayer(type: KonvaLayerType): void {
    this.layers[type].batchDraw();
  }

  /**
   * Force immediate render of all layers
   */
  forceRenderAll(): void {
    Object.values(this.layers).forEach(layer => layer.batchDraw());
  }

  /**
   * Get performance statistics
   */
  getStats(): { renderCount: number; batchCount: number; nodeCount: number } {
    return {
      renderCount: this.renderCount,
      batchCount: this.batchCount,
      nodeCount: this.nodes.size,
    };
  }

  // ====== Viewport culling implementation ======

  /** Konva has clipFunc for viewport culling */
  private _viewport: ViewportRect | null = null;
  private _cullingEnabled = false;

  setViewport(viewport: ViewportRect): void {
    this._viewport = viewport;
    // Konva Stage supports clipFunc, but a more efficient approach is controlling each Layer's visibility
    // Here we just record the viewport info for external querying
  }

  getViewport(): ViewportRect | null {
    return this._viewport ? { ...this._viewport } : null;
  }

  setViewportCulling(enabled: boolean): void {
    this._cullingEnabled = enabled;
  }

  isViewportCullingEnabled(): boolean {
    return this._cullingEnabled;
  }

  setCullingBuffer(_ratio: number): void {
    // Culling buffer will be used when viewport culling is fully implemented
  }

  /**
   * Batch render scheduler
   * Uses requestAnimationFrame to merge multiple render requests
   */
  private scheduleBatchRender(): void {
    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(() => {
        this.batchRender();
        this.animationFrameId = null;
      });
    }
  }

  /**
   * Perform batch rendering
   * Only renders the layers that changed, reducing unnecessary redraws
   */
  private batchRender(): void {
    this.batchCount++;

    /** Determine which layers need redrawing */
    const needsBackgroundRender = this.pendingRenders.size === 0;
    const needsStaticRender = this.pendingRenders.size > 0;
    const needsDynamicRender = this.pendingRenders.size > 0;

    /** Layered rendering strategy */
    if (needsBackgroundRender) {
      this.layers.background.batchDraw();
    }

    if (needsStaticRender) {
      this.layers.static.batchDraw();
    }

    if (needsDynamicRender) {
      this.layers.dynamic.batchDraw();
    }

    /** The Overlay layer always needs rendering (selection box, etc.) */
    this.layers.overlay.batchDraw();

    this.pendingRenders.clear();
    this.renderCount++;
  }

  /**
   * Flush the batch render queue
   */
  private flushBatchRender(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    Object.values(this.layers).forEach(layer => layer.draw());
    this.pendingRenders.clear();
  }

  /**
   * Determine the layer a graphic belongs to based on its type
   */
  private getLayerTypeForGraphic(graphic: IGraphic): KonvaLayerType {
    const type = graphic.type;

    if (['grid', 'background', 'guide'].includes(type)) {
      return KonvaLayerType.Background;
    }

    if (['shape', 'label', 'image', 'textbox'].includes(type)) {
      return KonvaLayerType.Static;
    }

    if (['button', 'input', 'checkbox', 'chart', 'pump', 'valve', 'tank', 'gauge'].includes(type)) {
      return KonvaLayerType.Dynamic;
    }

    return KonvaLayerType.Dynamic;
  }

  /**
   * Get the layer instance for a graphic
   */
  private getLayerForGraphic(graphic: IGraphic): Konva.Layer {
    const layerType = this.getLayerTypeForGraphic(graphic);
    return this.layers[layerType];
  }

  private createKonvaNode(graphic: IGraphic): Konva.Node | null {
    const type = graphic.type;
    const geometry = graphic.config.geometry;
    const style = graphic.config.style;

    switch (type) {
      case 'button':
      case 'shape':
        return new Konva.Rect({
          id: graphic.id,
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          fill: style.backgroundColor,
          stroke: style.borderColor,
          strokeWidth: style.borderWidth || 0,
          cornerRadius: style.borderRadius || 0,
          rotation: geometry.rotation || 0,
          scaleX: geometry.scaleX || 1,
          scaleY: geometry.scaleY || 1,
        });

      case 'label':
      case 'textbox':
        return new Konva.Text({
          id: graphic.id,
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          text: graphic.config.customProps?.text || '',
          fontSize: style.fontSize || 14,
          fontFamily: style.fontFamily || 'Arial',
          fill: style.color || '#000',
          align: (style.textAlign as any) || 'left',
          rotation: geometry.rotation || 0,
          scaleX: geometry.scaleX || 1,
          scaleY: geometry.scaleY || 1,
        });

      case 'input':
        return new Konva.Rect({
          id: graphic.id,
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          fill: style.backgroundColor || '#fff',
          stroke: style.borderColor || '#ccc',
          strokeWidth: style.borderWidth || 1,
          cornerRadius: style.borderRadius || 4,
          rotation: geometry.rotation || 0,
          scaleX: geometry.scaleX || 1,
          scaleY: geometry.scaleY || 1,
        });

      case 'checkbox':
        return new Konva.Group({ id: graphic.id });

      case 'image':
        return new Konva.Image({
          id: graphic.id,
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          rotation: geometry.rotation || 0,
          scaleX: geometry.scaleX || 1,
          scaleY: geometry.scaleY || 1,
          image: document.createElement('img'),
        } as any);

      case 'chart':
        return new Konva.Rect({
          id: graphic.id,
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          fill: style.backgroundColor || '#fff',
          stroke: style.borderColor,
          strokeWidth: style.borderWidth || 1,
          cornerRadius: style.borderRadius || 4,
          rotation: geometry.rotation || 0,
          scaleX: geometry.scaleX || 1,
          scaleY: geometry.scaleY || 1,
        });

      default:
        return new Konva.Group({ id: graphic.id });
    }
  }

  private updateKonvaNode(node: Konva.Node, graphic: IGraphic): void {
    const geometry = graphic.config.geometry;
    const style = graphic.config.style;

    if ((node as any).className === 'Rect') {
      (node as any).position({ x: geometry.x, y: geometry.y })
        .size({ width: geometry.width, height: geometry.height })
        .rotation(geometry.rotation || 0)
        .scale({ x: geometry.scaleX || 1, y: geometry.scaleY || 1 })
        .fill(style.backgroundColor)
        .stroke(style.borderColor)
        .strokeWidth(style.borderWidth || 0)
        .cornerRadius(style.borderRadius || 0);
    } else if ((node as any).className === 'Text') {
      (node as any).position({ x: geometry.x, y: geometry.y })
        .size({ width: geometry.width, height: geometry.height })
        .rotation(geometry.rotation || 0)
        .scale({ x: geometry.scaleX || 1, y: geometry.scaleY || 1 })
        .text(graphic.config.customProps?.text || '')
        .fontSize(style.fontSize || 14)
        .fontFamily(style.fontFamily || 'Arial')
        .fill(style.color || '#000')
        .align((style.textAlign as any) || 'left');
    } else if ((node as any).className === 'Image') {
      (node as any).position({ x: geometry.x, y: geometry.y })
        .size({ width: geometry.width, height: geometry.height })
        .rotation(geometry.rotation || 0)
        .scale({ x: geometry.scaleX || 1, y: geometry.scaleY || 1 });
    }
  }
}
