// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { defineStore } from 'pinia';
import { IGraphic } from '../types';
import { usePageStore } from './page.store';
import { stateService } from '../services/state.service';
import { BasePage } from '../graphic-editing/graphic/base/BasePage';
import { ClipboardManager } from '../graphic-editing/managers/ClipboardManager';
import { InterpageTransferService } from '../services/InterpageTransferService';

// Submodule: defaults, constants, cache
import { graphicCache } from './graphic-defaults';

// Submodule: CRUD operations
import {
  getGraphicById,
  getCurrentPage,
  getCurrentPageGraphics,
  findGraphicById,
  addGraphic,
  removeGraphic,
  copyPageGraphics,
  removePageGraphics,
  toggleSelection,
  adjustSpacing,
  batchEdit,
  saveAsTemplate,
  applyTemplate,
} from './graphic-crud';

// Submodule: clipboard operations
import {
  copyHelper,
  cutHelper,
  pasteHelper,
  duplicateGraphicHelper,
  duplicateGroupHelper,
} from './graphic-clipboard';

// Submodule: style operations
import {
  applyStyleHelper,
  copyStyleHelper,
  pasteStyleHelper,
  resetStyleHelper,
  applyPropertyHelper,
  applyQualityIndicatorHelper,
} from './graphic-style';

// Submodule: data binding, events, animation
import {
  bindDataHelper,
  unbindDataHelper,
  applyDataHelper,
  addEventHandlerHelper,
  removeEventHandlerHelper,
  addActionHelper,
  removeActionHelper,
  triggerEventHandlerHelper,
  executeActionHelper,
  addAnimationHelper,
  removeAnimationHelper,
} from './graphic-binding';

// Graphic state management
export const useGraphicStore = defineStore('graphic', {
  state: () => ({
    // Style clipboard (shared across pages)
    styleClipboard: null as Record<string, any> | null,
    // Graphic clipboard (shared across pages)
    clipboardManager: new ClipboardManager(),
    transferService: new InterpageTransferService(),
    // Performance optimization related
    isBatchOperating: false,
    batchDepth: 0,
    useGraphicCache: false,
    autoSaveInterval: null as any,
  }),

  getters: {
    // Get the graphic list of the current page
    graphics: (): IGraphic[] => {
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;
      if (!currentPage) return [];
      const graphics = currentPage.graphics;
      return Array.isArray(graphics)
        ? graphics
        : ((graphics as { value: IGraphic[] }).value ?? []);
    },

    /**
     * Sorted graphic list (cached to avoid re-sorting on every getter call)
     * Cache lives in graphicCache; rebuilt after invalidate
     */
    sortedGraphics: (): IGraphic[] => {
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;
      if (!currentPage) return [];
      const graphics =
        'value' in currentPage.graphics
          ? (currentPage.graphics.value as IGraphic[])
          : (currentPage.graphics as IGraphic[]);
      return graphicCache.getSorted(graphics);
    },

    selectedGraphic: (): IGraphic | undefined => {
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;
      if (!currentPage) return undefined;
      const selectedId = currentPage.selectedGraphicId;
      if (!selectedId) return undefined;
      const graphics =
        'value' in currentPage.graphics
          ? currentPage.graphics.value
          : currentPage.graphics;
      return ((graphics as IGraphic[]).find(
        (graphic: IGraphic) => graphic.id === selectedId
      )) as IGraphic | undefined;
    },


    selectedGraphicId: () => {
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;
      return currentPage?.selectedGraphicId || null;
    },

    selectedGraphicIds: () => {
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;
      return currentPage?.selectedGraphicIds || [];
    },

    /**
     * Selected graphic list (uses an ID set for faster filtering)
     */
    selectedGraphics: (): IGraphic[] => {
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;
      if (!currentPage || !currentPage.selectedGraphicIds?.length) return [];
      const graphics =
        'value' in currentPage.graphics
          ? currentPage.graphics.value
          : (currentPage.graphics as IGraphic[]);
      const idSet = new Set(currentPage.selectedGraphicIds);
      return (graphics as IGraphic[]).filter((g: IGraphic) => idSet.has(g.id));
    },
  },

  actions: {
    // ========== CRUD operations (delegated to graphic-crud.ts) ==========

    /** Get graphic by ID */
    getGraphicById(id: string): IGraphic | undefined {
      return getGraphicById(id);
    },

    /** Get current page */
    getCurrentPage() {
      return getCurrentPage();
    },

    /** Get the graphic list of the current page */
    getCurrentPageGraphics(): IGraphic[] | undefined {
      return getCurrentPageGraphics();
    },

    /** Find graphic by ID */
    findGraphicById(id: string): IGraphic | undefined {
      return findGraphicById(id);
    },

    /** Add graphic */
    addGraphic(
      type: string,
      x: number,
      y: number,
      width: number,
      height: number
    ): IGraphic | undefined {
      return addGraphic(type, x, y, width, height);
    },

    /** Remove graphic */
    removeGraphic(id: string) {
      removeGraphic(id);
    },

    /** Toggle selection state */
    toggleSelection(id: string) {
      toggleSelection(id);
    },

    /** Copy page graphics */
    copyPageGraphics(sourcePageId: string, targetPageId: string) {
      copyPageGraphics(sourcePageId, targetPageId);
    },

    /** Remove page graphics */
    removePageGraphics(pageId: string) {
      removePageGraphics(pageId);
    },

    /** Adjust spacing */
    adjustSpacing(spacing: number, direction: 'horizontal' | 'vertical') {
      adjustSpacing(spacing, direction);
    },

    /** Batch edit */
    batchEdit(properties: Partial<IGraphic>) {
      batchEdit(properties);
    },

    /** Template editing - save as template */
    saveAsTemplate(name: string) {
      return saveAsTemplate(name);
    },

    /** Template editing - apply template */
    applyTemplate(templateIndex: number) {
      applyTemplate(templateIndex);
    },

    // ========== Clipboard operations (delegated to graphic-clipboard.ts) ==========

    /** Copy selected graphics to clipboard */
    copy() {
      copyHelper(this as any);
    },

    /** Cut selected graphics to clipboard */
    cut() {
      cutHelper(this as any);
    },

    /** Paste graphics from clipboard to the current page */
    paste(offsetX: number = 20, offsetY: number = 20): IGraphic[] {
      return pasteHelper(this as any, offsetX, offsetY);
    },

    /** Duplicate a graphic (supports single element and group) */
    duplicateGraphic(id: string) {
      return duplicateGraphicHelper(id);
    },

    /** Duplicate an entire group (createGroupCopy) */
    duplicateGroup(groupId: string): { groupId: string; memberIds: string[] } | null {
      return duplicateGroupHelper(groupId);
    },

    // ========== Style operations (delegated to graphic-style.ts) ==========

    /** Style management - apply style */
    applyStyle(graphicId: string, style: Record<string, any>) {
      applyStyleHelper(graphicId, style);
    },

    /** Style management - copy style */
    copyStyle(sourceGraphicId: string) {
      return copyStyleHelper(this, sourceGraphicId);
    },

    /** Style management - paste style */
    pasteStyle(targetGraphicId: string) {
      return pasteStyleHelper(this, targetGraphicId);
    },

    /** Style management - reset style */
    resetStyle(graphicId: string) {
      return resetStyleHelper(graphicId);
    },

    /** Apply a property to a graphic */
    applyProperty(graphicId: string, propertyPath: string, value: any) {
      applyPropertyHelper(graphicId, propertyPath, value);
    },

    /** Apply quality indicator */
    applyQualityIndicator(graphicId: string, quality: string) {
      applyQualityIndicatorHelper(graphicId, quality);
    },

    // ========== Data binding + events + animation (delegated to graphic-binding.ts) ==========

    /** Data binding - bind data */
    bindData(graphicId: string, dataSource: string, dataField: string) {
      bindDataHelper(graphicId, dataSource, dataField);
    },

    /** Data binding - unbind */
    unbindData(graphicId: string) {
      unbindDataHelper(graphicId);
    },

    /** Data binding - apply data */
    applyData(data: Record<string, any>) {
      applyDataHelper(data);
    },

    /** Event interaction - add event */
    addEvent(graphicId: string, eventType: string) {
      addEventHandlerHelper(graphicId, eventType);
    },

    /** Event interaction - remove event */
    removeEvent(graphicId: string, eventId: string) {
      removeEventHandlerHelper(graphicId, eventId);
    },

    /** Event interaction - add action */
    addAction(graphicId: string, eventId: string, actionType: string) {
      addActionHelper(graphicId, eventId, actionType);
    },

    /** Event interaction - remove action */
    removeAction(graphicId: string, eventId: string, actionId: string) {
      removeActionHelper(graphicId, eventId, actionId);
    },

    /** Event interaction - trigger event */
    triggerEvent(graphicId: string, eventType: string, eventData?: any) {
      triggerEventHandlerHelper(graphicId, eventType, eventData);
    },

    /** Event interaction - execute action */
    executeAction(action: any, _graphicId?: string, _eventData?: any) {
      executeActionHelper(action, _graphicId, _eventData);
    },

    /** Animation effects - add animation */
    addAnimation(graphicId: string, animation: any) {
      addAnimationHelper(graphicId, animation);
    },

    /** Animation effects - remove animation */
    removeAnimation(graphicId: string, animationIndex: number) {
      removeAnimationHelper(graphicId, animationIndex);
    },

    // ========== Group operations ==========

    // Remove graphic from group
    removeFromGroup(graphicId: string) {
      const currentPage = this.getCurrentPage();
      if (!currentPage || typeof currentPage.removeFromGroup !== 'function')
        return;
      currentPage.removeFromGroup(graphicId);
      currentPage.selectGraphic(graphicId);
    },

    // Add graphic to group
    addToGroup(graphicId: string, groupId: string) {
      const currentPage = this.getCurrentPage();
      if (!currentPage || typeof currentPage.addToGroup !== 'function') return;
      currentPage.addToGroup(graphicId, groupId);
    },

    // Update group bounds
    updateGroupBounds(groupId: string) {
      const currentPage = this.getCurrentPage();
      if (!currentPage || typeof currentPage.updateGroupBounds !== 'function')
        return;
      currentPage.updateGroupBounds(groupId);
    },

    // Select all graphics in a group
    selectGroupMembers(groupId: string) {
      const currentPage = this.getCurrentPage();
      if (!currentPage || typeof currentPage.selectGroupMembers !== 'function')
        return;
      currentPage.selectGroupMembers(groupId);
    },

    // ========== Batch operations ==========

    // Begin batch operation (supports nesting)
    startBatchOperation(): void {
      this.batchDepth++;
      if (this.batchDepth === 1) {
        this.isBatchOperating = true;
      }
    },

    // End batch operation
    endBatchOperation(): void {
      this.batchDepth = Math.max(0, this.batchDepth - 1);
      if (this.batchDepth === 0) {
        this.isBatchOperating = false;
        // Batch operation finished; invalidate cache to trigger rebuild
        graphicCache.invalidate();
      }
    },

    /**
     * Batch-update wrapper - merges multiple operations into a single reactive notification
     * @param fn The function to run; all store mutations inside are deferred until fn completes
     */
    async batchUpdate<T>(fn: () => T | Promise<T>): Promise<T> {
      this.startBatchOperation();
      try {
        const result = await fn();
        return result;
      } finally {
        this.endBatchOperation();
      }
    },

    /**
     * Synchronous version of batchUpdate (for synchronous operations)
     */
    batchUpdateSync<T>(fn: () => T): T {
      this.startBatchOperation();
      try {
        return fn();
      } finally {
        this.endBatchOperation();
      }
    },

    // ========== Grouping ==========

    // Grouping - delegate to BasePage.groupGraphics() to record history
    groupGraphics(ids: string[]) {
      const currentPage = this.getCurrentPage();
      if (currentPage) {
        currentPage.groupGraphics(ids);
      }
    },

    ungroupGraphics(groupId: string) {
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;
      if (!currentPage) return;

      const groupManager = currentPage.getGroupManager();
      if (groupManager) {
        const isGroup = groupManager.isGroup(groupId);
        if (isGroup) {
          // Use BasePage.ungroupGraphic() to record history
          currentPage.ungroupGraphic(groupId);
        } else {
          const graphics = currentPage.graphics;
          const groupGraphic = graphics.find(
            (g) => g.id === groupId && g.type === 'group'
          );

          if (groupGraphic) {
            currentPage.graphics = graphics.filter((g) => g.id !== groupId);

            const childIds = (groupGraphic.config?.groupMembers ||
                             groupGraphic.children || []) as string[];

            const childGraphics = childIds
              .map((childId) => graphics.find((g) => g.id === childId))
              .filter(Boolean) as IGraphic[];

            if (childGraphics.length > 0) {
              currentPage.selectMultipleGraphics(childGraphics.map(g => g.id));
            }
          }
        }
      }
    },

    // ========== Project management ==========

    // Project management - save project
    saveProject(name: string) {
      return stateService.saveProject(name);
    },

    // Project management - load project
    loadProject(projectIndex: number) {
      return stateService.loadProject(projectIndex);
    },

    // Project management - delete project
    deleteProject(projectIndex: number) {
      return stateService.deleteProject(projectIndex);
    },

    // ========== Export & publish ==========

    // Export & publish - export as JSON
    exportAsJSON() {
      const pageStore = usePageStore();
      const project = {
        pages: pageStore.pages,
        exportTime: new Date().toISOString(),
      };

      return JSON.stringify(project, null, 2);
    },

    // Export & publish - export as HTML
    exportAsHTML() {
      const jsonData = this.exportAsJSON();
      const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>导出的组态</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
    }
    #canvas {
      width: 100%;
      height: 100vh;
      border: 1px solid #ddd;
    }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script>
    const projectData = JSON.parse('${jsonData.replace(/'/g, "\\'")}');
    // Add rendering logic here

  </script>
</body>
</html>
      `;

      return html;
    },

    // Export & publish - download file
    downloadFile(content: string, filename: string, type: string) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    // ========== Collaboration ==========

    // Collaboration - generate share link
    generateShareLink() {
      const projectData = this.exportAsJSON();
      const encodedData = btoa(unescape(encodeURIComponent(projectData)));
      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${encodedData}`;
      return shareUrl;
    },

    // Collaboration - load shared project
    loadSharedProject() {
      const urlParams = new URLSearchParams(window.location.search);
      const shareData = urlParams.get('share');
      if (!shareData) return false;

      try {
        const decodedData = decodeURIComponent(escape(atob(shareData)));
        const project = JSON.parse(decodedData);

        const pageStore = usePageStore();
        // Ensure BasePage instances are created
        pageStore.pages = project.pages.map((pageData: any) => {
          const page = new BasePage();
          page.fromJSON(pageData);
          return page;
        });

        pageStore.currentPageId = pageStore.pages[0]?.id;

        return true;
      } catch (error) {
        console.error('Error loading shared project:', error);
        return false;
      }
    },

    // ========== Performance optimization ==========

    // Performance optimization - batch operation
    batchOperation(operations: Array<{ type: string; payload: any }>) {
      stateService.batchOperation(operations);
    },

    // Performance optimization - graphic cache
    enableGraphicCache() {
      this.useGraphicCache = true;
    },

    disableGraphicCache() {
      this.useGraphicCache = false;
    },

    // ========== Extensibility ==========

    // Extensibility - import external component
    importExternalComponent(componentUrl: string) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = componentUrl;
        script.onload = () => {
          // Assume the external component is registered on a global variable
          const component = (window as any)['ExternalComponent'];
          if (component) {
            resolve(component);
          } else {
            reject(new Error('External component not found'));
          }
        };
        script.onerror = () => {
          reject(new Error('Failed to load external component'));
        };
        document.head.appendChild(script);
      });
    },

    // Extensibility - register custom primitive
    registerCustomPrimitive(type: string, primitiveClass: any) {
      if (!(window as any)['customPrimitives']) {
        (window as any)['customPrimitives'] = {};
      }
      (window as any)['customPrimitives'][type] = primitiveClass;
    },

    // ========== Advanced features ==========

    // Advanced - auto save
    enableAutoSave(interval: number = 30000) {
      this.autoSaveInterval = setInterval(() => {
        this.saveProject('Auto Save');
      }, interval);
    },

    disableAutoSave() {
      if (this.autoSaveInterval) {
        clearInterval(this.autoSaveInterval);
        this.autoSaveInterval = null;
      }
    },

    // Advanced - canvas snapshot
    takeCanvasSnapshot() {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (canvas) {
        return canvas.toDataURL('image/png');
      }
      return null;
    },
  },
});

/**
 * Convenience helper: get the current page instance
 * Replaces 38 repeated usePageStore().currentPage patterns in graphic operations
 */
export function useCurrentPage() {
  return usePageStore().currentPage;
}
