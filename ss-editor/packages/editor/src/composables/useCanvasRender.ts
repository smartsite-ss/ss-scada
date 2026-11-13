// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { watch, onUnmounted, ref, nextTick } from 'vue';
import { usePageStore } from '@scada-editor/core';
import { manipulationState } from '@scada-editor/core';
import { performanceMonitor } from '@scada-editor/core';
import type { ViewportRect } from '@scada-editor/core';
import { resolveAssetPath } from '@scada-editor/core';
import { loadImageWithAuth } from '../utils/loadImageWithAuth';

export interface DrawCanvasOptions {
  partial?: boolean;
  dirtyRect?: { x: number; y: number; width: number; height: number };
}

/**
 * Viewport clipping configuration interface
 * Used to enable/disable the viewport clipping optimization during canvas rendering
 */
export interface ViewportCullingOptions {
  /** Whether to enable viewport clipping (default false) */
  enabled?: boolean;
  /**
   * Clipping buffer ratio (0-1), expands the detection range to prevent edge flickering
   * Default 0.05, i.e. expand 5% beyond each edge of the viewport
   */
  bufferRatio?: number;
}

export function useCanvasRender(
  canvasRef: any,
  canvasWidth: any,
  canvasHeight: any,
  _panX: any,
  _panY: any,
  graphicDecorators: any,
  hoveredGraphicId: any,
  selectionRenderData: any = null,
  useCanvasSelection: any = ref(false)
) {
  const pageStore = usePageStore();
  
  let animationFrameId: number | null = null;
  let pendingDirtyRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  let isPartialPending = false;
  let isDrawing = false;
  
  // Cache the background image object to avoid creating a new Image() on every render
  let cachedBgImage: HTMLImageElement | null = null;
  let cachedBgImageSrc: string | null = null;

  // Retry limit for background image load failures
  const BG_IMAGE_MAX_RETRIES = 3;
  const bgImageRetryCount = new Map<string, number>();
  const bgImageExhausted = new Set<string>(); // image sources whose retries are exhausted

  // ====== Viewport clipping state ======
  let viewportConfig: ViewportCullingOptions | null = null;
  let currentViewport: ViewportRect | null = null;
  
  // Get or create the cached background image
  const getBackgroundImage = async (src: string): Promise<HTMLImageElement | null> => {
    const resolvedSrc = resolveAssetPath(src);

    // Retry limit exceeded, no longer loading
    if (bgImageExhausted.has(resolvedSrc)) {
      return null;
    }

    if (cachedBgImage && cachedBgImageSrc === resolvedSrc && cachedBgImage.complete) {
      return cachedBgImage;
    }

    try {
      const img = await loadImageWithAuth(src);
      cachedBgImage = img;
      cachedBgImageSrc = resolvedSrc;
      bgImageRetryCount.delete(resolvedSrc);
      return img;
    } catch {
      const count = (bgImageRetryCount.get(resolvedSrc) || 0) + 1;
      bgImageRetryCount.set(resolvedSrc, count);
      if (count >= BG_IMAGE_MAX_RETRIES) {
        bgImageExhausted.add(resolvedSrc);
        console.warn(`[useCanvasRender] Background image failed to load ${count} times, stopping retries: ${resolvedSrc}`);
      }
      return null;
    }
  };

  const isInManipulation = () => {
    return manipulationState.isActive();
  };
  
  const setManipulationState = (state: Partial<{ moving: boolean; resizing: boolean; rotating: boolean }>) => {
    manipulationState.set(state);
  };

  const drawSelectionBox = (
    ctx: CanvasRenderingContext2D,
    rect: { left: number; top: number; width: number; height: number }
  ) => {
    if (!rect || rect.width === 0 || rect.height === 0) return;

    ctx.save();
    
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
    
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    
    ctx.restore();
  };

  const drawSelectedGraphicsBox = (
    ctx: CanvasRenderingContext2D,
    selectedGraphics: any[]
  ) => {
    if (!selectedGraphics || selectedGraphics.length === 0) return;

    if (selectedGraphics.length === 1) {
      const graphic = selectedGraphics[0];
      if (!graphic || typeof graphic.getPosition !== 'function' || typeof graphic.getSize !== 'function') return;
      
      const { x, y } = graphic.getPosition();
      const { width, height } = graphic.getSize();
      const rotation = typeof graphic.getRotation === 'function' ? graphic.getRotation() : 0;
      
      ctx.save();
      
      if (rotation !== 0) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate(rotation * Math.PI / 180);
        ctx.translate(-centerX, -centerY);
      }
      
      ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
      ctx.fillRect(x, y, width, height);
      
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      
      ctx.restore();
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      
      for (const graphic of selectedGraphics) {
        if (!graphic || typeof graphic.getPosition !== 'function' || typeof graphic.getSize !== 'function') continue;
        const { x, y } = graphic.getPosition();
        const { width, height } = graphic.getSize();
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      }
      
      const rect = {
        left: minX,
        top: minY,
        width: maxX - minX,
        height: maxY - minY
      };
      
      ctx.save();
      
      ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
      
      ctx.restore();
    }
  };

  const mergeDirtyRect = (
    rect1: { x: number; y: number; width: number; height: number } | null,
    rect2: { x: number; y: number; width: number; height: number } | null
  ) => {
    if (!rect1) return rect2;
    if (!rect2) return rect1;
    
    const minX = Math.min(rect1.x, rect2.x);
    const minY = Math.min(rect1.y, rect2.y);
    const maxX = Math.max(
      rect1.x + rect1.width,
      rect2.x + rect2.width
    );
    const maxY = Math.max(
      rect1.y + rect1.height,
      rect2.y + rect2.height
    );
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  };

  /**
   * Get the viewport with buffer (prevents edge graphic flickering)
   */
  const getBufferedViewport = (): ViewportRect | null => {
    if (!currentViewport || !viewportConfig?.enabled) return null;

    const ratio = viewportConfig.bufferRatio ?? 0.05;
    const bufX = currentViewport.width * ratio;
    const bufY = currentViewport.height * ratio;

    return {
      x: currentViewport.x - bufX,
      y: currentViewport.y - bufY,
      width: currentViewport.width + bufX * 2,
      height: currentViewport.height + bufY * 2,
    };
  };

  /**
   * Fast AABB intersection test: determine whether a graphic is inside the viewport
   */
  const isGraphicInViewport = (graphic: any, vp: ViewportRect): boolean => {
    try {
      if (typeof graphic.getPosition !== 'function' || typeof graphic.getSize !== 'function') return true;
      const { x, y } = graphic.getPosition();
      const { width, height } = graphic.getSize();
      // AABB intersection test
      return x + width > vp.x && x < vp.x + vp.width && y + height > vp.y && y < vp.y + vp.height;
    } catch {
      return true; // default to visible when undeterminable, ensuring nothing is lost from rendering
    }
  };

  const performDraw = () => {
    isDrawing = true;
    const startTime = performance.now();
    
    const canvas = canvasRef.value;
    if (!canvas) {
      nextTick(() => { isDrawing = false; });
      animationFrameId = null;
      pendingDirtyRect = null;
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      nextTick(() => { isDrawing = false; });
      animationFrameId = null;
      pendingDirtyRect = null;
      return;
    }

    const shouldPartial = isPartialPending && !!pendingDirtyRect;
    
    let currentSortedGraphics: any[] = [];
    const currentPage = pageStore.currentPage;
    if (currentPage) {
      const graphics = (currentPage as any).graphics || [];
      const graphicsArray = 'value' in graphics ? graphics.value : graphics;
      currentSortedGraphics = [...(graphicsArray as any[])].sort(
        (a: any, b: any) =>
          (a.config.zIndex ?? 0) - (b.config.zIndex ?? 0)
      );
    }

    // ====== Viewport clipping: pre-filter visible graphics ======
    const bufferedVp = getBufferedViewport();
    const visibleGraphics = bufferedVp
      ? currentSortedGraphics.filter(g => isGraphicInViewport(g, bufferedVp))
      : currentSortedGraphics;

    let drawnGraphicsCount = 0;

    if (!shouldPartial) {
      performanceMonitor.recordFullRender();
      
      context.clearRect(0, 0, canvasWidth.value, canvasHeight.value);

      context.save();

      if (currentPage) {
        context.fillStyle = currentPage.backgroundColor || '#FFFFFF';
        context.fillRect(0, 0, canvasWidth.value, canvasHeight.value);
        
        if (currentPage.backgroundImage) {
          const resolvedSrc = resolveAssetPath(currentPage.backgroundImage);
          // Retry limit exceeded, no longer loading the background image
          if (bgImageExhausted.has(resolvedSrc)) {
            // Do not display the background image
          }
          // Use the cached background image to avoid flickering
          else if (cachedBgImage && cachedBgImageSrc === resolvedSrc && cachedBgImage.complete) {
            context.drawImage(cachedBgImage, 0, 0, canvasWidth.value, canvasHeight.value);
          } else {
            // Load the background image asynchronously and redraw after loading
            getBackgroundImage(currentPage.backgroundImage).then((img) => {
              if (img && img.complete && !isInManipulation()) {
                drawCanvas();
              }
            });
          }
        }
      }

      for (const graphic of visibleGraphics || []) {
        if (
          !graphic ||
          typeof graphic.getPosition !== 'function' ||
          typeof graphic.getSize !== 'function' ||
          typeof graphic.draw !== 'function'
        ) {
          continue;
        }

        try {
          if (graphicDecorators.value[graphic.id]) {
            graphicDecorators.value[graphic.id].draw(context);
          } else {
            graphic.draw(context);
          }

          if (graphic.id === hoveredGraphicId.value) {
            context.save();
            context.strokeStyle = '#1890ff';
            context.lineWidth = 2;
            context.setLineDash([5, 5]);
            const { x, y } = graphic.getPosition();
            const { width, height } = graphic.getSize();
            context.strokeRect(x, y, width, height);
            context.setLineDash([]);
            context.restore();
          }
          
          drawnGraphicsCount++;
        } catch (e) {
          console.warn(`[CanvasRender] Error drawing graphic ${graphic.id}:`, e);
        }
      }
      
      if (useCanvasSelection.value && selectionRenderData) {
        if (selectionRenderData.isSelecting && selectionRenderData.selectionRect) {
          drawSelectionBox(context, selectionRenderData.selectionRect);
        }
        
        if (selectionRenderData.selectedGraphics && selectionRenderData.selectedGraphics.length > 0) {
          drawSelectedGraphicsBox(context, selectionRenderData.selectedGraphics);
        }
      }

      context.restore();
    } else if (pendingDirtyRect) {
      performanceMonitor.recordPartialRender();
      
      context.save();

      if (currentPage) {
        context.clearRect(
          pendingDirtyRect.x,
          pendingDirtyRect.y,
          pendingDirtyRect.width,
          pendingDirtyRect.height
        );
        
        context.fillStyle = currentPage.backgroundColor || '#FFFFFF';
        context.fillRect(
          pendingDirtyRect.x,
          pendingDirtyRect.y,
          pendingDirtyRect.width,
          pendingDirtyRect.height
        );
      }

      for (const graphic of visibleGraphics || []) {
        if (
          !graphic ||
          typeof graphic.getPosition !== 'function' ||
          typeof graphic.getSize !== 'function' ||
          typeof graphic.draw !== 'function'
        ) {
          continue;
        }

        let shouldDraw = true;
        if (typeof graphic.intersectsRegion === 'function') {
          shouldDraw = graphic.intersectsRegion(
            pendingDirtyRect.x,
            pendingDirtyRect.y,
            pendingDirtyRect.width,
            pendingDirtyRect.height
          );
        }

        if (shouldDraw) {
          try {
            if (graphicDecorators.value[graphic.id]) {
              graphicDecorators.value[graphic.id].draw(context);
            } else {
              graphic.draw(context);
            }

            if (graphic.id === hoveredGraphicId.value) {
              context.save();
              context.strokeStyle = '#1890ff';
              context.lineWidth = 2;
              context.setLineDash([5, 5]);
              const { x, y } = graphic.getPosition();
              const { width, height } = graphic.getSize();
              context.strokeRect(x, y, width, height);
              context.setLineDash([]);
              context.restore();
            }
            
            drawnGraphicsCount++;
          } catch (e) {
            console.warn(`[CanvasRender] Error drawing graphic ${graphic.id}:`, e);
          }
        }
      }
      
      if (useCanvasSelection.value && selectionRenderData) {
        if (selectionRenderData.isSelecting && selectionRenderData.selectionRect) {
          drawSelectionBox(context, selectionRenderData.selectionRect);
        }
        
        if (selectionRenderData.selectedGraphics && selectionRenderData.selectedGraphics.length > 0) {
          drawSelectedGraphicsBox(context, selectionRenderData.selectedGraphics);
        }
      }

      context.restore();
    }

    const totalTime = performance.now() - startTime;
    performanceMonitor.recordRenderTime(totalTime);
    performanceMonitor.recordGraphicCount(drawnGraphicsCount);

    animationFrameId = null;
    pendingDirtyRect = null;
    isPartialPending = false;
    nextTick(() => { isDrawing = false; });
  };

  const drawCanvas = (options: DrawCanvasOptions = {}) => {
    if (isDrawing) return;
    const { partial = false, dirtyRect } = options;

    if (animationFrameId !== null) {
      pendingDirtyRect = mergeDirtyRect(pendingDirtyRect, dirtyRect || null);
      isPartialPending = isPartialPending && partial && !!pendingDirtyRect;
      return;
    }

    if (dirtyRect) {
      pendingDirtyRect = dirtyRect;
      isPartialPending = partial;
    }

    animationFrameId = requestAnimationFrame(performDraw);
  };

  onUnmounted(() => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
  });

  // Watch for background image changes, clear cache and retry counts
  let prevBgImage: string | null = null;
  watch(
    () => (pageStore.currentPage as any)?.backgroundImage,
    (newBg) => {
      if (newBg !== prevBgImage) {
        cachedBgImage = null;
        cachedBgImageSrc = null;
        // When the background image changes, clear the old failure count
        if (prevBgImage) {
          const oldSrc = resolveAssetPath(prevBgImage);
          bgImageRetryCount.delete(oldSrc);
          bgImageExhausted.delete(oldSrc);
        }
        prevBgImage = newBg;
      }
      if (!isInManipulation()) {
        drawCanvas();
      }
    }
  );

  // Merge the deep watches of graphics and page, using debounce to avoid double rendering
  let pageDrawTimer: ReturnType<typeof setTimeout> | null = null;
  watch(
    () => pageStore.currentPage,
    () => {
      if (isDrawing) {
        return;
      }
      if (isInManipulation()) {
        return;
      }
      if (pageStore.pageMode === 'preview') {
        return;
      }
      if (pageDrawTimer) {
        clearTimeout(pageDrawTimer);
      }
      pageDrawTimer = setTimeout(() => {
        drawCanvas();
        pageDrawTimer = null;
      }, 16); // ~1 frame debounce, merging consecutive changes
    },
    { deep: true }
  );

  watch(
    [canvasWidth, canvasHeight],
    () => {
      if (isInManipulation()) {
        return;
      }
      drawCanvas();
    },
    { deep: true }
  );

  watch(
    () => (pageStore.currentPage as any)?.selectedGraphicIds,
    () => {
      if (isInManipulation()) {
        return;
      }
      drawCanvas();
    },
    { deep: true }
  );

  watch(
    () => (pageStore.currentPage as any)?.selectedGraphicId,
    () => {
      if (isInManipulation()) {
        return;
      }
      drawCanvas();
    }
  );

  return {
    drawCanvas,
    setManipulationState,

    // ====== Viewport clipping API ======

    /**
     * Set the current viewport rectangle (world coordinates)
     * After clipping is enabled, drawCanvas only draws graphics inside the viewport
     */
    setViewport(viewport: ViewportRect): void {
      currentViewport = viewport;
    },

    /**
     * Get the current viewport
     */
    getViewport(): ViewportRect | null {
      return currentViewport ? { ...currentViewport } : null;
    },

    /**
     * Configure viewport clipping options
     */
    setViewportCulling(options: ViewportCullingOptions): void {
      viewportConfig = { enabled: options.enabled ?? true, bufferRatio: options.bufferRatio ?? 0.05 };
      if (!options.enabled) {
        currentViewport = null;
      }
    },

    /**
     * Get viewport clipping statistics (for debugging/benchmarks)
     */
    getCullingStats(): { totalGraphics: number; visibleGraphics: number; cullingRatio: number } | null {
      if (!viewportConfig?.enabled || !currentViewport) return null;
      const currentPage = pageStore.currentPage;
      if (!currentPage) return null;
      const graphics = (currentPage as any).graphics || [];
      const graphicsArray = 'value' in graphics ? graphics.value : graphics;
      const total = (graphicsArray as any[]).length;
      const bufferedVp = getBufferedViewport();
      const visible = bufferedVp
        ? (graphicsArray as any[]).filter(g => isGraphicInViewport(g, bufferedVp)).length
        : total;
      return {
        totalGraphics: total,
        visibleGraphics: visible,
        cullingRatio: total > 0 ? ((total - visible) / total) : 0,
      };
    },
  };
}
