// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { RenderBackend } from '@scada-editor/plugin-sdk';
import type { IRenderer, IPluginInstance } from '@scada-editor/plugin-sdk';
import type { BasePlugin } from '@scada-editor/plugin-sdk';
import type { DrawContext } from '@scada-editor/plugin-sdk';

/**
 * Renderer registry — centrally manages the IRenderer instances for 5 rendering backends
 *
 * Design principles:
 *   - Each RenderBackend has only one IRenderer instance (shared resources)
 *   - Canvas 2D is a built-in rendering backend, bridged to the existing
 *     BasePlugin system via an adapter
 *   - Vue/SVG/CSS/Three.js are registered dynamically via register()
 *   - The three-layer hybrid container is responsible for pan/zoom sync of
 *     the DOM Overlay layer in the editor
 */
export class RendererRegistry {
  private static _renderers = new Map<RenderBackend, IRenderer>();

  /**
   * Register a renderer instance
   */
  static register(renderer: IRenderer): void {
    if (this._renderers.has(renderer.backend)) {
      console.warn(`[RendererRegistry] Renderer for "${renderer.backend}" already registered, overwriting.`);
    }
    this._renderers.set(renderer.backend, renderer);
  }

  /**
   * Get the renderer for a given backend
   */
  static getRenderer(backend: RenderBackend): IRenderer | null {
    return this._renderers.get(backend) ?? null;
  }

  /**
   * Check whether a backend renderer is registered
   */
  static hasRenderer(backend: RenderBackend): boolean {
    return this._renderers.has(backend);
  }

  /**
   * Unregister a renderer
   */
  static unregister(backend: RenderBackend): void {
    this._renderers.delete(backend);
  }

  /**
   * Get all registered backend types
   */
  static getRegisteredBackends(): RenderBackend[] {
    return Array.from(this._renderers.keys());
  }

  /**
   * Render a single graphic to a given backend
   * - Canvas 2D: draw directly using render(dc)
   * - DOM types: manage DOM elements using mount/unmount
   */
  static renderPlugin(plugin: BasePlugin<any>, dc: DrawContext): void {
    (plugin as unknown as { render(dc: DrawContext): void }).render(dc);
  }

  /**
   * Determine the backend type used by a graphic instance
   * Priority: Vue > SVG > CSS > Three > Canvas 2D (render as fallback)
   */
  static getBackendForPlugin(plugin: IPluginInstance): RenderBackend {
    // Check specific rendering backends first (they may have a render method
    // for editor use, but runtime should use the dedicated backend)
    if (typeof (plugin as any).getComponent === 'function') {
      return RenderBackend.VUE_COMPONENT;
    }
    if (typeof (plugin as any).getSvgTemplate === 'function') {
      return RenderBackend.SVG_DOM;
    }
    if (typeof (plugin as any).getHtmlTemplate === 'function') {
      return RenderBackend.CSS_DOM;
    }
    if (typeof (plugin as any).loadScene === 'function') {
      return RenderBackend.THREE_3D;
    }
    // Canvas 2D as fallback: any component with a render method is classified as Canvas 2D
    if (typeof (plugin as any).render === 'function') {
      return RenderBackend.CANVAS_2D;
    }
    return RenderBackend.CANVAS_2D;
  }

  /**
   * Clear all registrations (for test resets)
   */
  static reset(): void {
    this._renderers.clear();
  }
}
