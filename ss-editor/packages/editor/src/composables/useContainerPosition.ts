// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';
import type { IGraphic } from '@scada-editor/core';

export interface ItemStyle {
  position: 'absolute';
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string;
  display: string;
  zIndex: number;
  overflow?: string;
}

/**
 * useContainerPosition options (optimization plan P0-2)
 */
export interface ContainerPositionOptions {
  /**
   * canvas element reference: when provided, use it directly to compute the offset instead of a global querySelector.
   * Fixes the issue where preview mode (canvas class=preview-canvas) could not find the canvas or wrongly used the edit-mode canvas offset.
   */
  canvasEl?: Ref<HTMLCanvasElement | null>;
}

export function useContainerPosition(positionOptions?: ContainerPositionOptions) {
  const containerRef = ref<HTMLDivElement | null>(null);
  const canvasOffset = ref({ left: 0, top: 0 });

  const updateCanvasOffset = () => {
    // Prefer the explicitly injected canvas reference; fall back to the edit-mode legacy path (querySelector) when not injected
    const canvas = positionOptions?.canvasEl?.value
      ?? document.querySelector('canvas.design-canvas');
    const container = containerRef.value;
    if (canvas && container) {
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      canvasOffset.value = {
        left: canvasRect.left - containerRect.left,
        top: canvasRect.top - containerRect.top,
      };
    }
  };

  onMounted(() => {
    updateCanvasOffset();
    window.addEventListener('resize', updateCanvasOffset);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateCanvasOffset);
  });

  /**
   * Uniformly compute the position style of graphics within the container (optimization plan P0-1 non-uniform scaling)
   * Formula: position = geometry x zoomX/zoomY + pan + canvasOffset
   * When zoomY is absent it degrades to uniform scaling (edit-mode behavior unchanged); in stretch mode zoomX/zoomY are applied separately
   */
  function calcItemStyle(
    graphic: IGraphic,
    zoom: number,
    panX: number,
    panY: number,
    styleOptions?: { overflowHidden?: boolean; zoomY?: number },
  ): ItemStyle {
    const g = graphic.config?.geometry;
    const zoomY = styleOptions?.zoomY ?? zoom;
    return {
      position: 'absolute',
      left: ((g?.x || 0) * zoom + panX + canvasOffset.value.left) + 'px',
      top: ((g?.y || 0) * zoomY + panY + canvasOffset.value.top) + 'px',
      width: ((g?.width || 100) * zoom) + 'px',
      height: ((g?.height || 100) * zoomY) + 'px',
      transform: `rotate(${g?.rotation || 0}deg)`,
      display: graphic.config?.visible !== false ? 'block' : 'none',
      zIndex: graphic.config?.zIndex || 0,
      ...(styleOptions?.overflowHidden ? { overflow: 'hidden' } : {}),
    };
  }

  return { containerRef, canvasOffset, updateCanvasOffset, calcItemStyle };
}