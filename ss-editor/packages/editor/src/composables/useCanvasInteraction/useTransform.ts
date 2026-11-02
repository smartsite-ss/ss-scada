// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, computed, nextTick } from 'vue';
import { usePageStore, useGraphicStore } from '@scada-editor/core';
import { useViewportStore } from '../../stores/useViewportStore';
import type { CanvasInteractionOptions, DrawCanvasCallback } from './types';
import { VIEWPORT, calculateFitScale } from '../../canvas-page/design-canvas/constants';

export function useTransform(options: CanvasInteractionOptions) {
  const { canvasWidth, canvasHeight } = options;

  const pageStore = usePageStore();
  const graphicStore = useGraphicStore();
  const viewportStore = useViewportStore();

  // Pan state
  const isPanning = ref(false);
  const startPanX = ref(0);
  const startPanY = ref(0);

  // Move state
  const isMoving = ref(false);
  const moveStartX = ref(0);
  const moveStartY = ref(0);
  const startGraphicPositions = ref<Record<string, { x: number; y: number }>>({});

  // Zoom state
  const isResizing = ref(false);
  const resizeStartX = ref(0);
  const resizeStartY = ref(0);
  const resizeHandle = ref('');
  const startGraphicSizes = ref<Record<string, { width: number; height: number; x: number; y: number }>>({});

  // Rotation state
  const isRotating = ref(false);
  const rotateStartX = ref(0);
  const rotateStartY = ref(0);
  const startGraphicRotations = ref<Record<string, number>>({});

  // ===== Viewport management constants =====
  const EDITOR_SELECTOR = '.plugin-layer-manager';

  const _debug = (...args: any[]) => {
    if (import.meta.env.DEV) console.debug('[Viewport]', ...args);
  };

  /**
   * With multiplicative stepping (ZOOM_STEP=1.2), starting from a non-100% scale cannot return exactly to 100%.
   * When the step target falls within "one step away from 100", automatically snap to 100%.
   *
   * Range definition: the interval of values that would cross 100% after one more zoomIn/zoomOut step.
   *   - zoomIn:  target >= 100/zoom_step ≈ 83.3% (i.e. values coming from 69.4% or above)
   *   - zoomOut: target <= 100*zoom_step = 120% (i.e. values coming from 144% or below)
   */
  const snapToHundred = (current: number, target: number): number => {
    if (current < 100 && target >= 100 / viewportStore.zoomStep) return 100;
    if (current > 100 && target <= 100 * viewportStore.zoomStep) return 100;
    return target;
  };

  // ===== Composite graphic transform support =====
  // Detect whether the current selection is a composite graphic
  const isGroupSelected = computed(() => {
    if (pageStore.selectedGraphicIds.length === 0) return false;

    const currentPage = pageStore.currentPage;
    if (!currentPage || typeof currentPage.getGroupManager !== 'function') return false;

    const groupManager = currentPage.getGroupManager();
    if (!groupManager) return false;

    // Check whether the selected graphics are in the same group
    for (const id of pageStore.selectedGraphicIds) {
      if (groupManager.isGraphicInGroup(id)) {
        return true;
      }
      if (groupManager.isGroup(id)) {
        return true;
      }
    }
    return false;
  });

  // Get the currently selected group ID (if any)
  const selectedGroupId = computed(() => {
    if (!isGroupSelected.value) return null;

    const currentPage = pageStore.currentPage;
    if (!currentPage || typeof currentPage.getGroupManager !== 'function') return null;

    const groupManager = currentPage.getGroupManager();
    if (!groupManager) return null;

    // Try to find a group containing all selected graphics
    for (const id of pageStore.selectedGraphicIds) {
      const group = groupManager.getGroupForGraphic(id);
      if (group) return group.id;
    }
    return null;
  });

  // Composite graphic move
  const moveGroup = (dx: number, dy: number, drawCanvas: DrawCanvasCallback) => {
    if (!selectedGroupId.value) return;

    const currentPage = pageStore.currentPage;
    if (!currentPage || typeof currentPage.getGroupManager !== 'function') return;

    const groupManager = currentPage.getGroupManager();
    if (!groupManager) return;

    groupManager.moveGroup(selectedGroupId.value, dx, dy);
    drawCanvas();
  };

  // Composite graphic zoom
  const scaleGroup = (scaleX: number, scaleY: number, drawCanvas: DrawCanvasCallback) => {
    if (!selectedGroupId.value) return;

    const currentPage = pageStore.currentPage;
    if (!currentPage || typeof currentPage.getGroupManager !== 'function') return;

    const groupManager = currentPage.getGroupManager();
    if (!groupManager) return;

    groupManager.scaleGroup(selectedGroupId.value, scaleX, scaleY);
    drawCanvas();
  };

  // Composite graphic rotation
  const rotateGroup = (angle: number, drawCanvas: DrawCanvasCallback) => {
    if (!selectedGroupId.value) return;

    const currentPage = pageStore.currentPage;
    if (!currentPage || typeof currentPage.getGroupManager !== 'function') return;

    const groupManager = currentPage.getGroupManager();
    if (!groupManager) return;

    groupManager.rotateGroup(selectedGroupId.value, angle);
    drawCanvas();
  };

  // ====== Smart viewport management system ======

  /**
   * Get the actual available size of the canvas container (minus padding)
   */
  const getContainerSize = () => {
    const editor = document.querySelector(EDITOR_SELECTOR) as HTMLElement | null;

    if (editor) {
      return {
        width: editor.clientWidth,
        height: editor.clientHeight,
      };
    }

    return {
      width: canvasWidth.value,
      height: canvasHeight.value,
    };
  };

  /**
   * No pan constraint needed under the CSS-driven model
   * flexbox handles centering, scroll-wrapper handles scrolling
   */
  const clampPan = () => {
  };

  /**
   * Zoom around the specified anchor point (keeps that point's position in the viewport unchanged)
   * New model: canvas CSS = page x zoom; keep the anchor by adjusting scroll
   */
  const zoomAtAnchor = (
    anchorLogicalX: number,
    anchorLogicalY: number,
    newScaleVal: number,
    drawCanvas: DrawCanvasCallback
  ) => {
    if (!pageStore.currentPage) return;

    _debug('zoomAtAnchor', { anchorLogicalX, anchorLogicalY, targetScale: newScaleVal });
    newScaleVal = Math.max(viewportStore.scaleMin, Math.min(viewportStore.scaleMax, newScaleVal));

    const oldZoom = pageStore.currentPage.scale / 100;
    const newZoom = newScaleVal / 100;
    const pageW = pageStore.currentPage.width || 1920;
    const pageH = pageStore.currentPage.height || 1080;

    const editorEl = document.querySelector(EDITOR_SELECTOR) as HTMLElement | null;
    const editorWidth = editorEl ? editorEl.clientWidth : 0;
    const editorHeight = editorEl ? editorEl.clientHeight : 0;

    const oldCanvasCSSW = pageW * oldZoom;
    const oldCanvasCSSH = pageH * oldZoom;
    const oldFlexOffsetX = editorWidth > oldCanvasCSSW ? (editorWidth - oldCanvasCSSW) / 2 : 0;
    const oldFlexOffsetY = editorHeight > oldCanvasCSSH ? (editorHeight - oldCanvasCSSH) / 2 : 0;

    const scrollLeft = editorEl ? editorEl.scrollLeft : 0;
    const scrollTop = editorEl ? editorEl.scrollTop : 0;

    const anchorDisplayX = anchorLogicalX * oldZoom + oldFlexOffsetX - scrollLeft;
    const anchorDisplayY = anchorLogicalY * oldZoom + oldFlexOffsetY - scrollTop;

    viewportStore.scale = newScaleVal;

    drawCanvas();

    nextTick(() => {
      const editor = document.querySelector(EDITOR_SELECTOR) as HTMLElement | null;
      if (!editor) return;
      const newCanvasCSSW = pageW * newZoom;
      const newCanvasCSSH = pageH * newZoom;
      const newFlexOffsetX = editorWidth > newCanvasCSSW ? (editorWidth - newCanvasCSSW) / 2 : 0;
      const newFlexOffsetY = editorHeight > newCanvasCSSH ? (editorHeight - newCanvasCSSH) / 2 : 0;

      editor.scrollLeft = anchorLogicalX * newZoom + newFlexOffsetX - anchorDisplayX;
      editor.scrollTop = anchorLogicalY * newZoom + newFlexOffsetY - anchorDisplayY;
    });
  };

  /**
   * Zoom the canvas (viewport-center anchored) - fixed version
   */
  const zoomIn = (drawCanvas: DrawCanvasCallback) => {
    if (!pageStore.currentPage) return;

    _debug('zoomIn', { currentScale: pageStore.currentPage.scale });
    const currentScale = pageStore.currentPage.scale;
    let newScaleVal = currentScale * viewportStore.zoomStep;

    newScaleVal = snapToHundred(currentScale, newScaleVal);

    // Use the canvas logical center as the anchor
    const anchorX = (pageStore.currentPage.width || 1920) / 2;
    const anchorY = (pageStore.currentPage.height || 1080) / 2;

    zoomAtAnchor(anchorX, anchorY, newScaleVal, drawCanvas);
  };

  /**
   * Zoom out the canvas (viewport-center anchored) - fixed version
   */
  const zoomOut = (drawCanvas: DrawCanvasCallback) => {
    if (!pageStore.currentPage) return;

    const currentScale = pageStore.currentPage.scale;
    let newScaleVal = currentScale / viewportStore.zoomStep;

    newScaleVal = snapToHundred(currentScale, newScaleVal);

    // Use the canvas logical center as the anchor
    const anchorX = (pageStore.currentPage.width || 1920) / 2;
    const anchorY = (pageStore.currentPage.height || 1080) / 2;

    zoomAtAnchor(anchorX, anchorY, newScaleVal, drawCanvas);
  };

  /**
   * Reset zoom to 100%
   */
  const resetZoom = (drawCanvas: DrawCanvasCallback) => {
    viewportStore.scale = 100;
    drawCanvas();
  };

  /**
   * Fit to window: calculate scale so the canvas CSS size fits the container; flex centering handles the rest
   */
  const fitToWindow = (drawCanvas: DrawCanvasCallback) => {
    const container = getContainerSize();

    _debug('fitToWindow', container);
    if (container.width <= 0 || container.height <= 0) {
      console.warn('[useTransform] fitToWindow: invalid container size');
      return;
    }

    const cw = pageStore.currentPage?.width || 1920;
    const ch = pageStore.currentPage?.height || 1080;

    const newScale = calculateFitScale(container.width, container.height, cw, ch, viewportStore.scaleMin);

    viewportStore.scale = Math.round(newScale * 100);
    drawCanvas();
  };

  /**
   * Fit to content: for scenes with graphics
   */
  const fitToContent = (drawCanvas: DrawCanvasCallback) => {
    const graphics = graphicStore.sortedGraphics || [];
    if (graphics.length === 0) {
      fitToWindow(drawCanvas);
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const graphic of graphics) {
      if (!graphic || typeof graphic.getPosition !== 'function') continue;

      const { x, y } = graphic.getPosition();
      const { width, height } = graphic.getSize();
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }

    const contentWidth = maxX - minX + 100;
    const contentHeight = maxY - minY + 100;
    const container = getContainerSize();

    if (container.width <= 0 || container.height <= 0) {
      return;
    }

    const scaleX = container.width / contentWidth;
    const scaleY = container.height / contentHeight;
    const newScale = Math.max(
      viewportStore.scaleMin / 100,
      Math.min(scaleX, scaleY) * VIEWPORT.FIT_MARGIN
    );

    viewportStore.scale = Math.round(newScale * 100);

    drawCanvas();

    nextTick(() => {
      const editor = document.querySelector(EDITOR_SELECTOR) as HTMLElement | null;
      if (editor) {
        editor.scrollLeft = (minX - 50) * newScale;
        editor.scrollTop = (minY - 50) * newScale;
      }
    });
  };

  /**
   * Canvas-center anchored zoom entry point (called by buttons/slider)
   */
  const centerZoom = (delta: number, drawCanvas: DrawCanvasCallback) => {
    if (!pageStore.currentPage) return;
    
    const newScaleVal = pageStore.currentPage.scale + delta;
    
    // Use the canvas logical center as the anchor
    const anchorX = (pageStore.currentPage.width || 1920) / 2;
    const anchorY = (pageStore.currentPage.height || 1080) / 2;

    zoomAtAnchor(anchorX, anchorY, newScaleVal, drawCanvas);
  };

  /**
   * Mouse wheel zoom (anchored at the mouse position)
   * New model: mouse position relative to canvas in pixels → canvas logical coordinates → keep that position after zoom
   */
  const handleWheel = (event: WheelEvent, drawCanvas: DrawCanvasCallback) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();

      const step = 10;
      const delta = event.deltaY > 0 ? -step : step;

      if (!pageStore.currentPage) return;

      const canvasEl = document.querySelector('canvas.design-canvas') as HTMLElement | null;
      if (!canvasEl) return;

      const canvasRect = canvasEl.getBoundingClientRect();
      const currentZoom = pageStore.currentPage.scale / 100;

      const mouseCSSX = event.clientX - canvasRect.left;
      const mouseCSSY = event.clientY - canvasRect.top;

      const logicalX = mouseCSSX / currentZoom;
      const logicalY = mouseCSSY / currentZoom;

      const newScaleVal = pageStore.currentPage.scale + delta;

      zoomAtAnchor(logicalX, logicalY, snapToHundred(pageStore.currentPage.scale, newScaleVal), drawCanvas);
    }
  };

  /**
   * Ensure content is within the visible area (smart fit)
   * Called on page switches, window resize, etc.
   */
  const ensureContentVisible = (drawCanvas: DrawCanvasCallback) => {
    // If there are graphics, use fitToContent; otherwise use fitToWindow
    const graphics = graphicStore.sortedGraphics || [];
    
    if (graphics.length > 0) {
      fitToContent(drawCanvas);
    } else {
      fitToWindow(drawCanvas);
    }
  };

  return {
    isPanning,
    startPanX,
    startPanY,
    isMoving,
    moveStartX,
    moveStartY,
    startGraphicPositions,
    isResizing,
    resizeStartX,
    resizeStartY,
    resizeHandle,
    startGraphicSizes,
    isRotating,
    rotateStartX,
    rotateStartY,
    startGraphicRotations,
    // Composite graphic support
    isGroupSelected,
    selectedGroupId,
    moveGroup,
    scaleGroup,
    rotateGroup,
    // Canvas zoom (optimized)
    zoomIn,
    zoomOut,
    resetZoom,
    fitToWindow,
    fitToContent,
    centerZoom,
    handleWheel,
    zoomAtAnchor,
    // Added: viewport management
    ensureContentVisible,
    clampPan,
    getContainerSize,
  };
}
