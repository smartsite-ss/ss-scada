// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref } from 'vue';
import { usePageStore, useGraphicStore, displayToLogical } from '@scada-editor/core';
import type { CanvasInteractionOptions } from '../../types';
import type { DrawCanvasCallback, AlignTarget, SnapTarget } from '@scada-editor/core';
import {
  emitWidgetTemplateDrop,
  WIDGET_TEMPLATE_MIME,
} from '../../canvas-page/templates/widget-template-drop-bus';

export function useDragDrop(options: CanvasInteractionOptions) {
  const { panX, panY } = options;

  const pageStore = usePageStore();
  const graphicStore = useGraphicStore();

  const snapToGrid = ref(true);
  const gridSize = ref(20);

  // ===== Smart alignment support =====
  const alignTargets = ref<AlignTarget[]>([]);
  const showAlignLines = ref(true);

  // ===== Grid snapping support =====
  const snapTargets = ref<SnapTarget[]>([]);
  const showSnapIndicator = ref(true);

  // ===== Drag state tracking (fixes coordinate system issue) =====
  const isDragging = ref(false);
  const startDisplayPos = ref<{ x: number; y: number } | null>(null);
  const startGraphicLogicalPos = ref<{ x: number; y: number } | null>(null);

  // Get the current page's zoom scale
  const getScale = () => {
    return pageStore.currentPageScaleFactor;
  };

  // Get the SmartAlignManager instance
  const getSmartAlignManager = () => {
    try {
      const currentPage = pageStore.currentPage;
      if (currentPage && typeof currentPage.getSmartAlignManager === 'function') {
        return currentPage.getSmartAlignManager();
      }
    } catch (e) {
      console.warn('Failed to get SmartAlignManager:', e);
    }
    return null;
  };

  // Get the GridSnapManager instance
  const getGridSnapManager = () => {
    try {
      const currentPage = pageStore.currentPage;
      if (currentPage && typeof currentPage.getGridSnapManager === 'function') {
        return currentPage.getGridSnapManager();
      }
    } catch (e) {
      console.warn('Failed to get GridSnapManager:', e);
    }
    return null;
  };

  const snapToGridPosition = (x: number, y: number) => {
    if (snapToGrid.value) {
      return {
        x: Math.round(x / gridSize.value) * gridSize.value,
        y: Math.round(y / gridSize.value) * gridSize.value,
      };
    }
    return { x, y };
  };

  const toggleSnapToGrid = () => {
    snapToGrid.value = !snapToGrid.value;
  };

  const isGraphicLocked = (id: string): boolean => {
    const graphic = (graphicStore.sortedGraphics || []).find((g) => g.id === id);
    return graphic ? graphic.config.locked : false;
  };

  // ===== Enhanced drag handling - integrates smart alignment and grid snapping =====
  const handleGraphicDrag = (
    event: MouseEvent,
    drawCanvas: DrawCanvasCallback
  ) => {
    const canvas = document.querySelector('canvas.design-canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const viewState = { scale: getScale(), offset: { x: panX.value, y: panY.value } };

    // Get the graphic being dragged
    const selectedGraphics = graphicStore.selectedGraphics || [];
    if (selectedGraphics.length === 0) return;

    const draggingGraphic = selectedGraphics[0];

    // Record the drag start position (on first call)
    if (!isDragging.value || !startDisplayPos.value || !startGraphicLogicalPos.value) {
      isDragging.value = true;
      startDisplayPos.value = { x: displayX, y: displayY };
      const graphicPos = draggingGraphic.getPosition();
      startGraphicLogicalPos.value = { x: graphicPos.x, y: graphicPos.y };
    }

    // Calculate new logical coordinates from offsets (fixes coordinate system issue)
    const displayDeltaX = displayX - startDisplayPos.value.x;
    const displayDeltaY = displayY - startDisplayPos.value.y;
    const logicalDeltaX = displayDeltaX / viewState.scale;
    const logicalDeltaY = displayDeltaY / viewState.scale;

    const newLogicalX = startGraphicLogicalPos.value.x + logicalDeltaX;
    const newLogicalY = startGraphicLogicalPos.value.y + logicalDeltaY;

    // 1. Detect smart alignment targets
    const smartAlignManager = getSmartAlignManager();
    if (smartAlignManager && showAlignLines.value) {
      const otherGraphics = (graphicStore.sortedGraphics || []).filter(
        (g) => g.id !== draggingGraphic.id
      );
      const targets = smartAlignManager.detectAlignTargets(draggingGraphic, otherGraphics);
      alignTargets.value = targets;

      // If there is an alignment target, apply the alignment
      if (targets.length > 0) {
        smartAlignManager.applyAlignment(draggingGraphic, targets[0]);
        drawCanvas();
        return;
      }
    } else {
      alignTargets.value = [];
    }

    // 2. Grid snapping (based on correct logical coordinates)
    const gridSnapManager = getGridSnapManager();
    if (gridSnapManager && snapToGrid.value) {
      const otherGraphics = (graphicStore.sortedGraphics || []).filter(
        (g) => g.id !== draggingGraphic.id
      );
      const snapResult = gridSnapManager.snapPosition(
        newLogicalX,
        newLogicalY,
        otherGraphics
      );

      snapTargets.value = snapResult.targets;

      // Apply the snapped position
      if (snapResult.targets.length > 0) {
        draggingGraphic.setPosition(snapResult.x, snapResult.y);
        drawCanvas();
        return;
      }
    } else {
      snapTargets.value = [];
    }

    // 3. Default movement (based on correct logical coordinates)
    const snappedPos = snapToGridPosition(newLogicalX, newLogicalY);
    draggingGraphic.setPosition(snappedPos.x, snappedPos.y);
    drawCanvas();
  };

  // Reset drag state (called on mouseup)
  const resetDragState = () => {
    isDragging.value = false;
    startDisplayPos.value = null;
    startGraphicLogicalPos.value = null;
  };

  // Clear alignment and snapping indicators
  const clearAlignAndSnapIndicators = () => {
    alignTargets.value = [];
    snapTargets.value = [];
    resetDragState();  // also reset the drag state
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  };

  const handleDrop = (event: DragEvent, addGraphic: any, drawCanvas: DrawCanvasCallback) => {
    event.preventDefault();
    const canvas = event.currentTarget as HTMLCanvasElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    const viewState = { scale: getScale(), offset: { x: panX.value, y: panY.value } };
    const logicalPos = displayToLogical({ x: displayX, y: displayY }, viewState);
    const snappedPos = snapToGridPosition(logicalPos.x - 50, logicalPos.y - 25);

    // Component template drop: delegate to the component template panel (read/variable assignment/instantiation)
    const widgetTemplateId = event.dataTransfer?.getData(WIDGET_TEMPLATE_MIME);
    if (widgetTemplateId) {
      emitWidgetTemplateDrop({
        templateId: widgetTemplateId,
        logicalPos: snapToGridPosition(logicalPos.x, logicalPos.y),
      });
      clearAlignAndSnapIndicators();
      return;
    }

    const graphicType = event.dataTransfer?.getData('text/plain');
    if (graphicType) {
      addGraphic(graphicType, snappedPos.x, snappedPos.y);
      drawCanvas();
    }

    // Clear indicators
    clearAlignAndSnapIndicators();
  };

  return {
    snapToGrid,
    gridSize,
    getScale,
    snapToGridPosition,
    toggleSnapToGrid,
    isGraphicLocked,
    // Smart alignment
    alignTargets,
    showAlignLines,
    // Grid snapping
    snapTargets,
    showSnapIndicator,
    // Enhanced features
    handleGraphicDrag,
    clearAlignAndSnapIndicators,
    resetDragState,
    handleDragOver,
    handleDrop,
  };
}
