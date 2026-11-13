<template>
  <div
    class="app"
    :style="themeStyles"
  >
    <!--Top Toolbar-->
    <header class="app-header">
      <AppHeader
        @open-settings="openSettings"
        @save="manualSave"
        @open-project="handleOpenProject"
        @close-project="handleCloseProject"
        @export-project="handleExportProject"
        @import-project="handleImportProject"
      />
    </header>

    <!--Template Edit Mode Prompt Bar-->
    <div v-if="isTemplateEditMode" class="template-edit-banner">
      <span class="template-edit-banner-icon">📐</span>
      <span class="template-edit-banner-text">{{ t('system.canvasTemplate.editing') }}</span>
      <button class="template-edit-banner-btn" @click="router.push('/system/canvas-templates')">
        {{ t('system.canvasTemplate.backToList') }}
      </button>
    </div>
    
    <!--Main Content Area-->
    <main class="app-content">
      <!--Left-side Layers Panel-->
      <aside 
        v-if="configStore.ui.showLayerPanel !== false"
        class="app-layer" 
        :class="{ collapsed: leftPanelCollapsed }"
        :style="{ width: leftPanelCollapsed ? configStore.ui.collapsedPanelWidth + 'px' : leftPanelWidth + 'px' }"
      >
        <!--Collapse Toggle Button-->
        <button
          class="panel-toggle-btn"
          :class="{ expanded: !leftPanelCollapsed }"
          :data-tooltip="leftPanelCollapsed ? t('editor.expandPanel') : t('editor.collapsePanel')"
          @click="toggleLeftPanel"
        >
          <span class="toggle-icon">{{ leftPanelCollapsed ? '›' : '‹' }}</span>
        </button>
        
        <!--Contents-->
        <div
          v-show="!leftPanelCollapsed"
          class="panel-content"
        >
          <SidePanel />
        </div>
        
        <!--Drag Handle-->
        <div 
          v-show="!leftPanelCollapsed"
          class="resize-handle right"
          @mousedown="startLeftResize"
        />
      </aside>
      
      <!--Central Design Area-->
      <div class="app-main">
        <!--Project recovery period loading overlay: Displayed from mounting to the completion of restoreProject-->
        <div
          v-if="projectLoading"
          class="app-main-loading"
        >
          <SsLoading
            text="正在恢复项目"
            size="medium"
          />
        </div>
        <div
          class="app-canvas"
          :class="{ 'app-canvas--hidden': projectLoading }"
        >
          <!--Canvas Toolbar-->
          <div
            v-if="configStore.ui.showToolbar !== false"
            class="canvas-controls"
          >
            <EditorTools
              :snap-to-grid="snapToGrid"
              :is-format-painter-active="isFormatPainterActive"
              @refresh="refresh"
              @zoom-in="zoomIn"
              @zoom-out="zoomOut"
              @reset-zoom="resetZoom"
              @fit-to-window="fitToWindow"
              @fit-to-content="fitToContent"
              @toggle-grid="toggleGrid"
              @toggle-snap-to-grid="toggleSnapToGrid"
              @toggle-ruler="toggleRuler"
              @toggle-reference-lines="toggleReferenceLines"
              @align-left="alignLeft"
              @align-right="alignRight"
              @align-top="alignTop"
              @align-bottom="alignBottom"
              @align-center="alignCenter"
              @align-middle="alignMiddle"
              @distribute-horizontal="distributeHorizontal"
              @distribute-vertical="distributeVertical"
              @undo="undo"
              @redo="redo"
              @preview="preview"
              @export="exportPage"
              @preview-in-new-tab="previewInNewTab"
              @format-painter="handleFormatPainter"
            />
          </div>
          
          <!--Pages Label-->
          <div class="canvas-tabs">
            <PageTabs :project-id="projectId" />
          </div>
          
          <!--Off-Canvas Area-->
          <DesignCanvas
            ref="designCanvasRef"
            :format-painter-manager="formatPainterManager"
          />
        </div>
      </div>
      
      <!--Right-side Properties Panel-->
      <aside
        v-if="configStore.ui.showPropertyPanel !== false"
        class="app-property"
        :class="{ collapsed: rightPanelCollapsed }"
        :style="{ width: rightPanelCollapsed ? configStore.ui.collapsedPanelWidth + 'px' : rightPanelWidth + 'px' }"
      >
        <!--Collapse Toggle Button-->
        <button
          class="panel-toggle-btn"
          :class="{ expanded: !rightPanelCollapsed }"
          :data-tooltip="rightPanelCollapsed ? t('editor.expandPanel') : t('editor.collapsePanel')"
          @click="toggleRightPanel"
        >
          <span class="toggle-icon">{{ rightPanelCollapsed ? '‹' : '›' }}</span>
        </button>

        <!--Contents-->
        <div
          v-show="!rightPanelCollapsed"
          class="panel-content"
        >
          <PropertyPanel />
        </div>

        <!--Drag Handle-->
        <div
          v-show="!rightPanelCollapsed"
          class="resize-handle left"
          @mousedown="startRightResize"
        />
      </aside>
    </main>

    <!--AI Assistant Floating Panel (Draggable, P1-T04)-->
    <FloatingAiPanel />

    <!--Bottom Script Editing Drawer-->
    <ScriptDrawer />

    <!--The bottom status bar has been integrated into DesignCanvas-->

    <!--Preview Modal-->
    <div
      v-if="showPreview"
      class="preview-modal"
      @click="closePreview"
    >
      <div
        class="preview-modal-content"
        @click.stop
      >
        <div class="preview-modal-header">
          <h2>{{ t('editor.pagePreview') }}</h2>
          <button
            class="close-button"
            @click="closePreview"
          >
            ×
          </button>
        </div>
        <div class="preview-modal-body">
          <PreviewCanvas
            :width="previewWidth"
            :height="previewHeight"
          />
        </div>
      </div>
    </div>

    <!--Set Modal Box-->
    <SettingsModal 
      :visible="showSettingsModal" 
      @close="closeSettingsModal" 
    />

    <!--Open Project Dialog-->
    <OpenProjectDialog
      v-model:visible="showOpenProjectDialog"
      :current-project-id="projectId"
      @selected="onProjectSelected"
    />

    <!--Import Project Dialog-->
    <div
      v-if="showImportDialog"
      class="dialog-overlay"
      @click.self="showImportDialog = false"
    >
      <div class="dialog-container">
        <div class="dialog-header">
          <h2>{{ t('editor.importProject') }}</h2>
          <button
            class="close-btn"
            @click="showImportDialog = false"
          >
            ×
          </button>
        </div>
        <div class="dialog-body">
          <p class="import-hint">
            {{ t('editor.selectZipFile') }}
          </p>
          <input
            ref="importFileInput"
            type="file"
            accept=".zip"
            class="import-file-input"
            @change="onImportFileSelected"
          >
          <div
            v-if="importStatus"
            class="import-status"
            :class="importStatus.type"
          >
            {{ importStatus.message }}
          </div>
        </div>
        <div class="dialog-footer">
          <button
            class="btn btn-cancel"
            @click="showImportDialog = false"
          >
            {{ t('editor.cancel') }}
          </button>
          <button
            v-if="importOverwriteNeeded"
            class="btn btn-warning"
            @click="confirmImportOverwrite"
          >
            {{ t('editor.overwrite') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DesignCanvas, PreviewCanvas, EditorTools, AppHeader, PropertyPanel, SidePanel, PageTabs, SettingsModal, ScriptDrawer, FloatingAiPanel

 } from '@scada-editor/editor';
import { 
  useTheme, 
  useConfigStore, 
  usePageStore, 
  useTemplateStore,
  keyboardService, 
  KeyboardContext, 
  eventBus, 
  Events,
  SaveServiceConfig,
  savePreviewData,
  saveAllPagesData,
  i18n,
  FormatPainterManager,
  MessageService,
  BasePage,
  stateService,
  normalizeTemplateGraphics,
  GraphicFactory,
} from '@scada-editor/core';
import type { PageTemplate } from '@scada-editor/core';
// t signature narrowed by unknown assertion: Deconstructing i18n.global triggers vue-i18n messages literal schema deep type instantiation (TS2589)
const t = (key: string, params?: Record<string, unknown>): string =>
  (i18n.global as unknown as { t: (key: string, params?: Record<string, unknown>) => string }).t(key, params);
import { showAlert, showConfirm, useGraphic, useProjectSave, useProjectData } from '@scada-editor/editor';
import { SsLoading } from '@scada-editor/shared';
import { createProjectSaveService, loadPageData } from '../services/projectSaveService';
import { pageApi, projectApi, useProjectStore, usePageDataSourceStore } from '@scada-editor/system';
import OpenProjectDialog from '../components/OpenProjectDialog.vue';
import { ScadaDataManager, BindingManager } from '@scada-editor/core';
import { useDataSourceLifecycle, buildGraphicBindingsFromPage } from '../composables/useDataSourceLifecycle';

const route = useRoute();
const router = useRouter();
const projectId = (route.params.projectId as string | undefined) || 'default-project';
const projectStore = useProjectStore();
const templateStore = useTemplateStore();

/** Edit Mode: Project Page / Template Page*/
type EditorMode = 'project' | 'template';

/** Current Editing Mode*/
const editorMode = ref<EditorMode>('project');

/** ID of the canvas template being edited (passed from route params, only has a value when editorMode=template)*/
const canvasTemplateEditId = ref<string | null>(
  (route.params.canvasTemplateId as string) || null,
);

/** Project ID when editing the template (passed from the query to distinguish between project-level and system-level template save paths)*/
const canvasTemplateProjectId = ref<string | null>(
  (route.query.projectId as string) || null,
);

// Initialize Edit Mode Based on Routing Parameters
if (canvasTemplateEditId.value) {
  editorMode.value = 'template';
}

/** Whether in template editing mode*/
const isTemplateEditMode = computed(() => editorMode.value === 'template');

// Panel Status - Use configStore
const configStore = useConfigStore();
const leftPanelWidth = computed({
  get: () => configStore.ui.leftPanelWidth,
  set: (val) => configStore.updateUIConfig({ leftPanelWidth: val })
});
const rightPanelWidth = computed({
  get: () => configStore.ui.rightPanelWidth,
  set: (val) => configStore.updateUIConfig({ rightPanelWidth: val })
});
const leftPanelCollapsed = computed({
  get: () => configStore.ui.leftPanelCollapsed,
  set: (val) => configStore.updateUIConfig({ leftPanelCollapsed: val })
});
const rightPanelCollapsed = computed({
  get: () => configStore.ui.rightPanelCollapsed,
  set: (val) => configStore.updateUIConfig({ rightPanelCollapsed: val })
});

// Drag State
const isResizingLeft = ref<boolean>(false);
const isResizingRight = ref<boolean>(false);
const resizeStartX = ref<number>(0);
const resizeStartWidth = ref<number>(0);

// Project Restore Loading State: Display the loading overlay from mounting to the completion of restoreProject
const projectLoading = ref<boolean>(true);

// Reference the DesignCanvas component
const designCanvasRef = ref<InstanceType<typeof DesignCanvas> | null>(null);

// Format Painter Manager
const formatPainterManager = new FormatPainterManager();
const isFormatPainterActive = ref(false);

formatPainterManager.onModeChange((mode) => {
  isFormatPainterActive.value = mode !== 'idle';
});

// Set Modal Box
const showSettingsModal = ref<boolean>(false);

// Project Operation Dialog Box
const showOpenProjectDialog = ref(false);
const showImportDialog = ref(false);
const importFileInput = ref<HTMLInputElement | null>(null);
const importStatus = ref<{ type: string; message: string } | null>(null);
const importOverwriteNeeded = ref(false);
let pendingImportFile: File | null = null;
const openSettings = () => {
  showSettingsModal.value = true;
};
const closeSettingsModal = () => {
  showSettingsModal.value = false;
};

// Topic-related
const pageStore = usePageStore();
const { themeStyles } = useTheme();
 
 

// Use a unified useGraphic composable
const {
  alignLeft: alignLeftFromGraphic,
  alignRight: alignRightFromGraphic,
  alignTop: alignTopFromGraphic,
  alignBottom: alignBottomFromGraphic,
  alignCenter: alignCenterFromGraphic,
  alignMiddle: alignMiddleFromGraphic,
  distributeHorizontal: distributeHorizontalFromGraphic,
  distributeVertical: distributeVerticalFromGraphic,
  undo: undoFromGraphic,
  redo: redoFromGraphic,
  exportPage: exportPageFromGraphic
} = useGraphic();
 
// Canvas Status
const snapToGrid = ref(true);

// Canvas Control Method
const zoomIn = () => designCanvasRef.value?.zoomIn();
const zoomOut = () => designCanvasRef.value?.zoomOut();
const resetZoom = () => designCanvasRef.value?.resetZoom();
const fitToWindow = () => designCanvasRef.value?.fitToWindow();
const fitToContent = () => designCanvasRef.value?.fitToContent();
const toggleGrid = () => designCanvasRef.value?.toggleGrid();
const toggleSnapToGrid = () => {
  designCanvasRef.value?.toggleSnapToGrid();
  snapToGrid.value = !snapToGrid.value;
};
const toggleRuler = () => designCanvasRef.value?.toggleRuler();
const toggleReferenceLines = () =>
  designCanvasRef.value?.toggleReferenceLines();
const alignLeft = () => {
  alignLeftFromGraphic();
  designCanvasRef.value?.refresh();
};
const alignRight = () => {
  alignRightFromGraphic();
  designCanvasRef.value?.refresh();
};
const alignTop = () => {
  alignTopFromGraphic();
  designCanvasRef.value?.refresh();
};
const alignBottom = () => {
  alignBottomFromGraphic();
  designCanvasRef.value?.refresh();
};
const alignCenter = () => {
  alignCenterFromGraphic();
  designCanvasRef.value?.refresh();
};
const alignMiddle = () => {
  alignMiddleFromGraphic();
  designCanvasRef.value?.refresh();
};
const distributeHorizontal = () => {
  distributeHorizontalFromGraphic();
  designCanvasRef.value?.refresh();
};
const distributeVertical = () => {
  distributeVerticalFromGraphic();
  designCanvasRef.value?.refresh();
};
const undo = () => {
  undoFromGraphic();
  designCanvasRef.value?.refresh();
};
const redo = () => {
  redoFromGraphic();
  designCanvasRef.value?.refresh();
};

// Format Painter Processing
const handleFormatPainter = () => {
  if (formatPainterManager.isActive()) {
    formatPainterManager.deactivate();
  } else {
    const page = pageStore.currentPage;
    if (page && pageStore.selectedGraphicIds?.length === 1) {
      const graphic = page.getGraphicById?.(pageStore.selectedGraphicIds[0]);
      if (graphic) {
        formatPainterManager.activate(graphic);
        return;
      }
    }
    formatPainterManager.activate();
  }
};

// Panel Collapse/Expand
const toggleLeftPanel = () => {
  leftPanelCollapsed.value = !leftPanelCollapsed.value;
};

const toggleRightPanel = () => {
  rightPanelCollapsed.value = !rightPanelCollapsed.value;
};

// Drag the left panel
const startLeftResize = (e: MouseEvent) => {
  isResizingLeft.value = true;
  resizeStartX.value = e.clientX;
  resizeStartWidth.value = leftPanelWidth.value;
  document.addEventListener('mousemove', onLeftResize);
  document.addEventListener('mouseup', stopLeftResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

const onLeftResize = (e: MouseEvent) => {
  if (!isResizingLeft.value) return;
  const delta = e.clientX - resizeStartX.value;
  const newWidth = Math.max(configStore.ui.minPanelWidth, Math.min(configStore.ui.maxPanelWidth, resizeStartWidth.value + delta));
  leftPanelWidth.value = newWidth;
};

const stopLeftResize = () => {
  isResizingLeft.value = false;
  document.removeEventListener('mousemove', onLeftResize);
  document.removeEventListener('mouseup', stopLeftResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

// Drag the right panel
const startRightResize = (e: MouseEvent) => {
  isResizingRight.value = true;
  resizeStartX.value = e.clientX;
  resizeStartWidth.value = rightPanelWidth.value;
  document.addEventListener('mousemove', onRightResize);
  document.addEventListener('mouseup', stopRightResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

const onRightResize = (e: MouseEvent) => {
  if (!isResizingRight.value) return;
  const delta = resizeStartX.value - e.clientX;
  const newWidth = Math.max(configStore.ui.minPanelWidth, Math.min(configStore.ui.maxPanelWidth, resizeStartWidth.value + delta));
  rightPanelWidth.value = newWidth;
};

const stopRightResize = () => {
  isResizingRight.value = false;
  document.removeEventListener('mousemove', onRightResize);
  document.removeEventListener('mouseup', stopRightResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
};

// Preview Current Page
const showPreview = ref(false);
const previewWidth = ref(800);
const previewHeight = ref(600);

const { initDataSourceLifecycle, destroyDataSourceLifecycle } = useDataSourceLifecycle();

/**
 * Activate the edit-mode data pipeline of the current page (called in EditorView).
 *
 * Note: Cannot return early due to "page-level dataSources being empty" – wsStore.connect is located
 * inside initDataSourceLifecycle (before the dataSources guard), the element directly connected to the bound variable
 * (tag-variable, etc., with binding information written in config.customProps) also rely on this connection to receive data.*/
async function activateEditModeDataSources() {
  const pageData = pageStore.currentPage as any;
  if (!pageData) return;
  // Ensure that graphicBindings have been populated (the page JSON may not have been persisted)
  if (pageData.dataSource) {
    pageData.dataSource.graphicBindings = buildGraphicBindingsFromPage(pageData);
  }
  await initDataSourceLifecycle(pageData, projectId, 'EditorView');
}

const preview = async () => {
  const page = pageStore.currentPage;
  if (page) {
    previewWidth.value = page.width || 800;
    previewHeight.value = page.height || 600;
  }

  // Clear the edit mode binding, then start the preview mode binding (align with §16.3 Lifecycle)
  await destroyDataSourceLifecycle();

  // Initialize the data source for the modal preview to make data binding effective in the preview (logic extracted to useDataSourceLifecycle)
  const pageData = pageStore.currentPage as any;
  pageData.dataSource.graphicBindings = buildGraphicBindingsFromPage(pageData);
  await initDataSourceLifecycle(pageData, projectId, 'EditorView');

  showPreview.value = true;
  keyboardService.setContext(KeyboardContext.PREVIEW);
};

const closePreview = async () => {
  showPreview.value = false;
  // Clear preview data source and restore edit mode data binding
  await destroyDataSourceLifecycle();
  await activateEditModeDataSources();
  // Restore keyboard context to global mode
  keyboardService.setContext(KeyboardContext.GLOBAL);
};

// Buttons related to registration preview
function registerPreviewKeys() {
  keyboardService.registerKey(
    'escape',
    (event) => {
      if (showPreview.value) {
        closePreview();
        event.preventDefault();
      }
    },
    {},
    KeyboardContext.PREVIEW,
    10
  );

  // Press ESC to exit Format Painter mode
  keyboardService.registerKey(
    'escape',
    (event) => {
      if (formatPainterManager.isActive()) {
        formatPainterManager.deactivate();
        event.preventDefault();
      }
    },
    {},
    KeyboardContext.GLOBAL,
    10
  );
}

// Refresh the currently edited page number and all graphics
const refresh = () => designCanvasRef.value?.refresh();

// Handling Changes in Layout Configuration
const handleLayoutConfigChanged = (config: {
  leftPanelDefaultWidth: number;
  rightPanelDefaultWidth: number;
}) => {
  leftPanelWidth.value = config.leftPanelDefaultWidth;
  rightPanelWidth.value = config.rightPanelDefaultWidth;
};

let triggerAutoSave: (() => void) | undefined;
let saveListener: (() => void) | null = null;

// Lifecycle Hooks
onMounted(async () => {
  // Initialize the project context so that components within the editor can obtain project information through projectStore.currentProject.
  if (projectId && projectId !== 'default-project') {
    projectStore.fetchProject(projectId).catch(() => {
      console.warn('[EditorView] 获取项目信息失败，projectId:', projectId);
    });
  }

  // Start listening for keyboard events
  keyboardService.startListening();
  // Buttons related to registration preview
  registerPreviewKeys();

  // Mark as in edit mode, allowing StateService to automatically save
  stateService.setEditMode(true);

  // Initialize Save Service
  initSaveService();

  // Register Save Shortcut Key Listener
  saveListener = () => {
    manualSave();
  };
  eventBus.on('save-page', saveListener);
  
  // Register to save all shortcut key listeners
  eventBus.on('save-all-pages', saveAllPages);
  
  // Register Preview Shortcut Key Listener
  eventBus.on('preview-in-new-tab', previewInNewTab);

  // Register Layout Configuration Change Listener
  eventBus.on('layout-config-changed', handleLayoutConfigChanged);

  // Registration Page Group Event Listener
  eventBus.on('page-group-created', handlePageGroupCreated);
  eventBus.on('page-group-renamed', handlePageGroupRenamed);
  eventBus.on('page-group-deleted', handlePageGroupDeleted);

  // Registration Page Action Event Listener
  eventBus.on('page-renamed', handlePageRenamed);
  eventBus.on('page-moved', handlePageMoved);

  // Register Page Refresh Event
  eventBus.on('page-refresh', handlePageRefresh);

  // Try to recover the item from the Save Service
  nextTick(async () => {
    // Template Editing Mode: Skip item restoration and load the template directly after clearing the page.
    if (canvasTemplateEditId.value) {
      projectLoading.value = false;
      pageStore.pages.splice(0, pageStore.pages.length);
      pageStore.closedPageIds.splice(0, pageStore.closedPageIds.length);
      await loadTemplateForEditing(canvasTemplateEditId.value);
    } else {
      await restoreProject();
      // Activate the data pipeline in edit mode, and the canvas element displays data values in real time (aligned with §16.3 Lifecycle)
      await activateEditModeDataSources();
    }
  });

  // Monitor element changes and trigger auto-save
  triggerAutoSave = () => scheduleAutoSave(saveProject);
  eventBus.on(Events.GRAPHIC_ADDED, triggerAutoSave);
  eventBus.on(Events.GRAPHIC_REMOVED, triggerAutoSave);
  eventBus.on(Events.GRAPHIC_UPDATED, triggerAutoSave);

  // Monitor the addition/deletion/update of elements, and dynamically maintain data binding
  eventBus.on(Events.GRAPHIC_ADDED, ({ graphic }: any) => {
    if (!graphic?.dataSource?.enabled) return;
    const dsId = graphic.dataSource.dataSource;
    if (!dsId) return;
    const propertyPath = graphic.dataSource.propertyPath || 'config.customProps.text';
    const currentPage = pageStore.currentPage as any;
    const variables = currentPage?.dataSource?.variables || [];
    const dsVars = variables.filter((v: any) => v.dataSourceId === dsId);
    for (const v of dsVars) {
      BindingManager.getInstance().bind(graphic.id, v.tagId, v.tagName || v.tagId, propertyPath);
    }
  });

  eventBus.on(Events.GRAPHIC_REMOVED, ({ graphicId }: any) => {
    BindingManager.getInstance().unbind(graphicId);
  });

  eventBus.on(Events.GRAPHIC_UPDATED, ({ graphic, properties }: any) => {
    if (!graphic) return;
    // §12 Unified solution: Rebuild subscriptions only when the dataSource configuration actually changes.
    // Changes such as style/geometry do not perform unnecessary unbind + rebind
    if (!properties?.dataSource) return;
    // Unlink the old binding first, then re-register according to the new configuration
    BindingManager.getInstance().unbind(graphic.id);
    if (!graphic.dataSource?.enabled) return;
    const dsId = graphic.dataSource.dataSource;
    if (!dsId) return;
    const propertyPath = graphic.dataSource.propertyPath || 'config.customProps.text';
    const currentPage = pageStore.currentPage as any;
    const variables = currentPage?.dataSource?.variables || [];
    const dsVars = variables.filter((v: any) => v.dataSourceId === dsId);
    for (const v of dsVars) {
      BindingManager.getInstance().bind(graphic.id, v.tagId, v.tagName || v.tagId, propertyPath);
    }
  });
});

onUnmounted(() => {
  // Mark exit from edit mode to prevent StateService from auto-saving
  stateService.setEditMode(false);

  // Stop listening to keyboard events
  keyboardService.stopListening();
  // Clear preview-related keybindings
  keyboardService.unregisterContext(KeyboardContext.PREVIEW);

  // Clear Saved Monitoring
  if (saveListener) {
    eventBus.off('save-page', saveListener);
  }
  eventBus.off('save-all-pages', saveAllPages);
  eventBus.off('preview-in-new-tab', previewInNewTab);

  // Clear Layout Configuration Change Listener
  eventBus.off('layout-config-changed', handleLayoutConfigChanged);

  // Clear Page Grouping Event Listener
  eventBus.off('page-group-created', handlePageGroupCreated);
  eventBus.off('page-group-renamed', handlePageGroupRenamed);
  eventBus.off('page-group-deleted', handlePageGroupDeleted);

  // Clear Page Action Event Listener
  eventBus.off('page-renamed', handlePageRenamed);
  eventBus.off('page-moved', handlePageMoved);

  // Clear Auto-Save Listener
  if (triggerAutoSave) {
    eventBus.off(Events.GRAPHIC_ADDED, triggerAutoSave);
    eventBus.off(Events.GRAPHIC_REMOVED, triggerAutoSave);
    eventBus.off(Events.GRAPHIC_UPDATED, triggerAutoSave);
  }

  // Clean up data pipeline in edit mode
  destroyDataSourceLifecycle();
});

// Export the current page in JSON format (using unified export)
const exportPage = () => {
  exportPageFromGraphic();
};

// ==================== Save Function (Composables) ====================

// Configuration Saving Service (localStorage used by default)
const customSaveService = projectId ? createProjectSaveService(projectId) : undefined;

const saveConfig: SaveServiceConfig = projectId
  ? { type: 'server' }
  : { type: 'local' };

const {
  initSaveService,
  saveProject: saveProjectFromComposable,
  restoreProject: restoreProjectFromComposable,
  scheduleAutoSave,
  setAutoSaveEnabled,
  setAutoSaveInterval,
} = useProjectSave(saveConfig, customSaveService, {
  enabled: configStore.autoSave?.enabled ?? true,
  intervalMs: (configStore.autoSave?.interval ?? 300) * 1000,
});

// Using Project Data Composable
const { collectProjectData, restorePagesToStore } = useProjectData();

// Monitor auto-save configuration changes and update dynamically
watch(
  () => ({ enabled: configStore.autoSave?.enabled, interval: configStore.autoSave?.interval }),
  ({ enabled, interval }) => {
    if (enabled !== undefined) {
      setAutoSaveEnabled(enabled);
    }
    if (interval !== undefined) {
      setAutoSaveInterval(interval * 1000);
    }
  },
  { immediate: false },
);

// Save Project (Encapsulate Composable Call)
const saveProject = async () => {
  const projectData = collectProjectData();
  if (!projectData) {
    MessageService.showWarning(t('editor.selectPageFirst'));
    return;
  }

  try {

    // Template Edit Mode: Save to Canvas Template API
    if (isTemplateEditMode.value && canvasTemplateEditId.value) {
      const currentPage = pageStore.currentPage;
      if (!currentPage) return;
      const pageData = currentPage.toJSON();
      const result = await templateStore.updateTemplate(canvasTemplateEditId.value, {
        pageConfig: {
          width: pageData.width || 1920,
          height: pageData.height || 1080,
          backgroundColor: pageData.backgroundColor || '#808080',
          layout: 'free',
        },
        graphics: pageData.graphics || [],
      });

      if (result) {
        pageStore.pages.forEach(p => p.clearDirty?.());
        MessageService.showSaveSuccess(t('editor.saveSuccess'));

        // Reference Mode: Prompt for Synchronous Association Page
        if (templateStore.configMode === 'reference') {
          const updatedTpl = templateStore.findTemplate(canvasTemplateEditId.value!);
          if (updatedTpl) {
            const linked = pageStore.pages
              .filter(p => p.templateId === canvasTemplateEditId.value)
              .map(p => p.name);

            if (linked.length > 0) {
              const confirmed = await showConfirm(
                t('editor.templateSyncConfirm', { name: updatedTpl.name, pages: linked.join('、') }),
                t('editor.saveSuccess'),
              );
              if (confirmed) {
                syncTemplateToPages(updatedTpl, canvasTemplateEditId.value!);
              }
            }
          }
        }
      }
      return;
    }

    // Simultaneously upload preview.png and preview_small.png of the current page (written to disk in the same request as page.json)
    const currentPage = pageStore.currentPage;
    if (currentPage) {
      const dataURL = (document.getElementById('canvas') as HTMLCanvasElement | null)?.toDataURL('image/png');
      if (dataURL) {
        const blob = dataURLtoBlob(dataURL);
        const smallDataURL = generateSmallPreviewDataURL(
          document.getElementById('canvas') as HTMLCanvasElement,
          PREVIEW_SMALL_MAX_WIDTH,
          PREVIEW_SMALL_MAX_HEIGHT,
        );
        (projectData as any).previews = {
          previewPageName: currentPage.name || 'Page',
          previewPageId: currentPage.id,
          preview: new File([blob], 'preview.png', { type: 'image/png' }),
          previewSmall: new File([dataURLtoBlob(smallDataURL)], 'preview_small.png', { type: 'image/png' }),
        };
      }
    }

    await saveProjectFromComposable(projectData);

    // Clear the dirty flag for all pages after successful saving
    pageStore.pages.forEach(p => p.clearDirty?.());

    if (currentPage) {
      const pageData = currentPage.toJSON();
      savePreviewData(pageData, currentPage.name || 'Page');
    }

    MessageService.showSaveSuccess(t('editor.saveSuccess'));
  } catch (error) {
    console.error('[EditorView] 保存失败', error);
    MessageService.showSaveError(t('editor.saveFailedRetry'));
  }
};

async function handlePageGroupCreated({ groupId: _groupId, groupName }: { groupId: string; groupName: string }) {
  try {
    await pageApi.createGroup(projectId, groupName);
  } catch (error) {
    console.error(`[EditorView] Failed to create group on server:`, error);
    showAlert(t('editor.groupCreateFailed', { name: groupName }));
  }
}

async function handlePageGroupRenamed({ groupId: _groupId, oldName, newName }: { groupId: string; oldName: string; newName: string }) {
  try {
    await pageApi.deleteGroup(projectId, oldName);
    await pageApi.createGroup(projectId, newName);
  } catch (error) {
    console.error(`[EditorView] Failed to rename group on server:`, error);
    showAlert(t('editor.groupRenameFailed', { old: oldName, new: newName }));
  }
}

async function handlePageGroupDeleted({ groupId: _groupId, groupName }: { groupId: string; groupName: string }) {
  try {
    await pageApi.deleteGroup(projectId, groupName);
  } catch (error) {
    console.error(`[EditorView] Failed to delete group on server:`, error);
    showAlert(t('editor.groupDeleteFailed', { name: groupName }));
  }
}

async function handlePageRenamed({ pageId: _pageId, oldName, newName, groupName }: { pageId: string; oldName: string; newName: string; groupName?: string }) {
  try {
    await pageApi.renamePage(projectId, oldName, newName, groupName);
  } catch (error) {
    console.error(`[EditorView] Failed to rename page on server:`, error);
    showAlert(t('editor.pageRenameFailed', { old: oldName, new: newName }));
  }
}

async function handlePageMoved({ pageId: _pageId, pageName, fromGroupName, toGroupName }: { pageId: string; pageName: string; fromGroupName?: string; toGroupName?: string }) {
  try {
    await pageApi.movePage(projectId, pageName, fromGroupName, toGroupName);
  } catch (error) {
    console.error(`[EditorView] Failed to move page on server:`, error);
    showAlert(t('editor.pageMoveFailed', { name: pageName }));
  }
}

// Save Manually (Ctrl+S / Menu Click)
const manualSave = () => {
  saveProject().catch(err => console.error('[EditorView] 手动保存失败', err));
};

// Save Project (Ctrl+Shift+S): Saves all loaded (non-_lazy) pages
const saveAllPages = async () => {
  const projectData = collectProjectData();
  if (!projectData) {
    MessageService.showWarning(t('editor.selectPageFirst'));
    return;
  }

  // Marked as Save All (passed to the projectSaveService save() method)
  (projectData as any).__saveAll = true;

  try {
    await saveProjectFromComposable(projectData);

    // Clear the dirty flag for all pages after successful saving
    pageStore.pages.forEach(p => p.clearDirty?.());

    MessageService.showSaveSuccess(t('editor.saveAllSuccess'));
  } catch (error) {
    console.error('[EditorView] 工程保存失败', error);
    MessageService.showSaveError(t('editor.saveAllFailed'));
  }
};

// Refresh page structure (reload from server)
async function handlePageRefresh() {
  try {
    const projectData = await restoreProjectFromComposable();
    if (projectData) {
      const lazyPageNames = restorePagesToStore(projectData);
      pageStore.pages.forEach(page => {
        if (page.scale !== 100) {
          page.scale = 100;
        }
      });
      // If there are pages with delayed loading, reset the loading status and load the current page
      if (lazyPageNames.length > 0) {
        loadedPageNames.clear();
        const currentPage = pageStore.currentPage;
        if (currentPage) {
          const currentName = currentPage.name || currentPage.id;
          if (lazyPageNames.includes(currentName)) {
            await ensurePageDataLoaded(currentPage.id);
          }
        }
      }

      // Reactivate the data pipeline after the page is rebuilt (Splice replaces the page without changing the currentPageId,
      // The watch for page switching will not be triggered. The binding must be explicitly recreated here.)
      await destroyDataSourceLifecycle();
      await activateEditModeDataSources();
    }
  } catch (error) {
    console.error('[EditorView] Failed to refresh page structure:', error);
  }
}

// ==================== Engineering Menu Operations ====================

function handleOpenProject() {
  showOpenProjectDialog.value = true;
}

async function onProjectSelected(projectName: string) {
  await saveProject();
  await savePreviewIfNeeded();

  router.push(`/editor/${projectName}`);
}

async function handleCloseProject() {
  const confirmed = await showConfirm(
    t('editor.closeProjectConfirm'),
    t('editor.closeProject'),
  );
  if (!confirmed) return;

  await saveProject();
  await savePreviewIfNeeded();

  router.push('/');
}

// Deferred Auxiliary Function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function handleExportProject() {
  try {
    // Display 9 export progress logs
    MessageService.showMessage(t('editor.exportStep1'), 'info', 2000);
    await delay(400);
    MessageService.showMessage(t('editor.exportStep2'), 'info', 2000);
    await delay(400);
    MessageService.showMessage(t('editor.exportStep3'), 'info', 2000);
    await delay(400);
    MessageService.showMessage(t('editor.exportStep4'), 'info', 2000);
    await delay(400);
    MessageService.showMessage(t('editor.exportStep5'), 'info', 2000);
    await delay(400);
    MessageService.showMessage(t('editor.exportStep6'), 'info', 5000);
    await delay(400);

    // Step 7: Call the backend API to generate the compressed package
    MessageService.showMessage(t('editor.exportStep7'), 'info', 10000);
    const blob = await projectApi.exportProjectZip(projectId);

    // Step 8: Download the file
    MessageService.showMessage(t('editor.exportStep8'), 'info', 3000);

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectId}_export.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    // Step 9: Export Complete
    MessageService.showExportSuccess(t('editor.exportStep9') + ' ' + t('editor.exportSuccess'));
  } catch (error) {
    console.error('[EditorView] Export failed:', error);
    MessageService.showError(t('editor.exportFailed'));
    await showAlert(t('editor.exportFailed'), t('editor.alertTitle.error'), 'error');
  }
}

function handleImportProject() {
  showImportDialog.value = true;
  importStatus.value = null;
  importOverwriteNeeded.value = false;
  pendingImportFile = null;
  nextTick(() => {
    if (importFileInput.value) {
      importFileInput.value.value = '';
    }
  });
}

async function onImportFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.zip')) {
    importStatus.value = { type: 'error', message: t('editor.invalidZipFile') };
    return;
  }

  importStatus.value = { type: 'info', message: t('editor.importing') };

  try {
    const result = await projectApi.importProjectZip(file, false);
    importStatus.value = { type: 'success', message: t('editor.importSuccess', { name: result.data?.projectName || '' }) };

    if (input) input.value = '';

    await showAlert(t('editor.importSuccessMessage', { name: result.data?.projectName || '' }), t('editor.importProject'), 'success');
    setTimeout(() => {
      showImportDialog.value = false;
    }, 1500);
  } catch (error: any) {
    const errMsg = error?.response?.data?.message || error?.message || '';

    if (errMsg.includes('已存在')) {
      importOverwriteNeeded.value = true;
      pendingImportFile = file;
      importStatus.value = { type: 'warning', message: t('editor.importOverwritePrompt', { name: errMsg }) };
    } else {
      importStatus.value = { type: 'error', message: t('editor.importFailed') + ': ' + errMsg };
    }
  }
}

async function confirmImportOverwrite() {
  if (!pendingImportFile) return;

  importStatus.value = { type: 'info', message: t('editor.importing') };
  importOverwriteNeeded.value = false;

  try {
    const result = await projectApi.importProjectZip(pendingImportFile, true);
    importStatus.value = { type: 'success', message: t('editor.importSuccess', { name: result.data?.projectName || '' }) };
    pendingImportFile = null;

    if (importFileInput.value) {
      importFileInput.value.value = '';
    }

    await showAlert(t('editor.importSuccessMessage', { name: result.data?.projectName || '' }), t('editor.importProject'), 'success');
    setTimeout(() => {
      showImportDialog.value = false;
    }, 1500);
  } catch (error: any) {
    const errMsg = error?.response?.data?.message || error?.message || '';
    importStatus.value = { type: 'error', message: t('editor.importFailed') + ': ' + errMsg };
  }
}

function getCurrentPageGroupName(): string | undefined {
  const page = pageStore.currentPage;
  if (!page) return undefined;
  const groupId = pageStore.pageGroupMap[page.id];
  if (!groupId) return undefined;
  const group = pageStore.pageGroups.find(g => g.id === groupId);
  return group?.name;
}

async function savePreviewIfNeeded() {
  const currentPage = pageStore.currentPage;
  if (currentPage) {
    try {
      const pageData = typeof (currentPage as any)?.toJSONAsync === 'function'
        ? await (currentPage as any).toJSONAsync()
        : currentPage.toJSON();
      savePreviewData(pageData, currentPage.name || 'Page');
      await uploadPageScreenshot(currentPage.name || 'Page', getCurrentPageGroupName());
    } catch (e) {
      console.warn('[EditorView] Failed to save preview:', e);
    }
  }
}

function dataURLtoBlob(dataURL: string): Blob {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

async function uploadPageScreenshot(pageName: string, groupName?: string) {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.warn('[EditorView] uploadPageScreenshot: canvas element not found');
    return;
  }

  try {
    const dataURL = canvas.toDataURL('image/png');
    const blob = dataURLtoBlob(dataURL);
    const file = new File([blob], 'preview.png', { type: 'image/png' });

    // Generate thumbnail (for display on the page panel)
    const smallDataURL = generateSmallPreviewDataURL(canvas, PREVIEW_SMALL_MAX_WIDTH, PREVIEW_SMALL_MAX_HEIGHT);
    const smallBlob = dataURLtoBlob(smallDataURL);
    const smallFile = new File([smallBlob], 'preview_small.png', { type: 'image/png' });

    await pageApi.uploadPreview(projectId, pageName, file, smallFile, groupName);
  } catch (err) {
    console.warn('[EditorView] Failed to upload page screenshot:', err);
  }
}

// Maximum thumbnail size (maintain aspect ratio, long side does not exceed this value)
const PREVIEW_SMALL_MAX_WIDTH = 320;
const PREVIEW_SMALL_MAX_HEIGHT = 240;

/**
 * Resize the canvas and export it as a PNG dataURL.
 * Uses the browser's native canvas, with no additional dependencies.*/
function generateSmallPreviewDataURL(source: HTMLCanvasElement, maxW: number, maxH: number): string {
  const ratio = Math.min(maxW / source.width, maxH / source.height, 1);
  const w = Math.max(1, Math.round(source.width * ratio));
  const h = Math.max(1, Math.round(source.height * ratio));

  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d');
  if (!ctx) {
    return source.toDataURL('image/png');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return small.toDataURL('image/png');
}

// ─── Lazy Loading: Set of page names with fully loaded data ───
const loadedPageNames = new Set<string>();

/**
 * Load complete page data (including graphics) on demand
 * Triggered when a user opens a page that has not loaded data*/
async function ensurePageDataLoaded(pageId: string): Promise<void> {
  if (loadedPageNames.has(pageId)) return;

  const pageIndex = pageStore.pages.findIndex(p => p.id === pageId);
  if (pageIndex === -1) return;

  const page = pageStore.pages[pageIndex];
  const pageName = page.name || pageId;

  // If it is a newly created local page (without the _lazy tag), there is no need to load data from the backend.
  if (!(page as any)._lazy) {
    loadedPageNames.add(pageId);
    return;
  }

  try {
    const pageData = await loadPageData(projectId, pageName, page.id);
    if (!pageData) {
      loadedPageNames.add(pageId);
      return;
    }

    // ── Create a new BasePage instance and load the complete data ──
    // The original page object cannot be modified directly (the BasePage property is not Vue-reactive),
    // Elements in the pages array must be replaced to trigger Vue's reactive update.
    const newPage = new BasePage();
    newPage.init({
      id: pageData.id || page.id,
      name: pageData.name || page.name,
      width: pageData.width || page.width,
      height: pageData.height || page.height,
      backgroundColor: pageData.backgroundColor || page.backgroundColor || '#808080',
    });
    if (pageData.backgroundImage) {
      newPage.backgroundImage = pageData.backgroundImage;
    }
    if (pageData.scale) {
      newPage.scale = pageData.scale;
    }

    // Load complete data such as graphics using fromJSON
    newPage.fromJSON(pageData);

    // Update pageGroupMap mapping (if ID has changed)
    const oldId = page.id;
    const newId = newPage.id;
    if (oldId !== newId) {
      const existingGroup = pageStore.pageGroupMap[oldId];
      if (existingGroup) {
        pageStore.pageGroupMap = {
          ...pageStore.pageGroupMap,
          [newId]: existingGroup,
        };
        delete pageStore.pageGroupMap[oldId];
      }
    }

    // Retain preview thumbnail URL from old page (from outline data)
    const previewSmallUrl = (page as any).previewSmallUrl;
    if (previewSmallUrl) {
      (newPage as any).previewSmallUrl = previewSmallUrl;
    }

    // Replace the pages in the pages array → Trigger Vue reactive update
    // pageStore.currentPage returns a new reference → computed properties such as sortedGraphics are re-evaluated
    // All watches (deep watch, PluginLayerManager, etc.) will be triggered automatically
    pageStore.pages.splice(pageIndex, 1, newPage);

    // If the new ID is different from the old ID, the currentPageId needs to be updated.
    if (oldId !== newId && pageStore.currentPageId === oldId) {
      pageStore.currentPageId = newId;
    }

    loadedPageNames.add(newId);
  } catch (error) {
    console.error(`[EditorView] Failed to load page data for "${pageName}":`, error);
  }
}

/** Open the template from the Canvas Template Management page to enter edit mode*/
async function loadTemplateForEditing(templateId: string): Promise<void> {
  try {
    // If there is a projectId (project-level template), load both the system template and the project template.
    if (canvasTemplateProjectId.value) {
      await templateStore.loadTemplates(canvasTemplateProjectId.value);
    } else {
      await templateStore.loadSystemTemplates();
    }

    // Search in both the System Templates and Project Templates lists
    let tpl = templateStore.systemTemplates.find(t => t.id === templateId);
    if (!tpl) {
      tpl = templateStore.projectTemplates.find(t => t.id === templateId);
    }

    if (!tpl) {
      console.warn('[EditorView] 模板不存在:', templateId);
      MessageService.showWarning('模板不存在');
      return;
    }

    const pageName = tpl.name || 'Template';
    const newPage = pageStore.addPage(pageName);
    const page = newPage as any;

    if (tpl.pageConfig) {
      page.width = tpl.pageConfig.width;
      page.height = tpl.pageConfig.height;
      page.backgroundColor = tpl.pageConfig.backgroundColor;
    }

    if (tpl.graphics && tpl.graphics.length > 0) {
      const normalized = normalizeTemplateGraphics(tpl.graphics as Record<string, any>[]);
      for (const g of normalized) {
        try {
          const graphic = GraphicFactory.createGraphicFromJSON(g);
          if (graphic) {
            page.addGraphic(graphic);
          }
        } catch (e) {
          console.warn('[EditorView] 模板图元创建失败:', g.type, e);
        }
      }
    }

    MessageService.showSuccess(`正在编辑模板：${tpl.name}`);
  } catch (error) {
    console.error('[EditorView] 加载模板失败:', error);
  }
}

/** Sync template elements and configurations to pages that reference the template*/
function syncTemplateToPages(template: PageTemplate, templateId: string) {
  const linkedPages = pageStore.pages.filter(p => p.templateId === templateId);

  const normalized = template.graphics && template.graphics.length > 0
    ? normalizeTemplateGraphics(template.graphics as Record<string, any>[])
    : [];

  for (const page of linkedPages) {
    const p = page as any;

    // Update Page Configuration
    if (template.pageConfig) {
      p.width = template.pageConfig.width;
      p.height = template.pageConfig.height;
      p.backgroundColor = template.pageConfig.backgroundColor;
    }

    // Replace Graphic Element
    if (p.graphics && typeof p.removeGraphic === 'function') {
      const current = [...(p.graphics || [])];
      for (const g of current) {
        try { p.removeGraphic(g.id); } catch { /* ignore */ }
      }
    }

    for (const g of normalized) {
      try {
        const graphic = GraphicFactory.createGraphicFromJSON(g);
        if (graphic) p.addGraphic(graphic);
      } catch (e) {
        console.warn('[EditorView] Sync graphic failed:', g.type, e);
      }
    }

    p.markDirty?.();
  }
}

// Restore Project (Encapsulate Composable Call)
const restoreProject = async (): Promise<boolean> => {
  try {
    const projectData = await restoreProjectFromComposable();
    if (!projectData) return false;

    const lazyPageNames = restorePagesToStore(projectData);

    pageStore.pages.forEach(page => {
      if (page.scale !== 100) {
        page.scale = 100;
      }
    });

    // If there are pages with lazy loading, load the full data of the current page immediately.
    if (lazyPageNames.length > 0) {
      const currentPage = pageStore.currentPage;
      if (currentPage) {
        const currentName = currentPage.name || currentPage.id;
        if (lazyPageNames.includes(currentName)) {
          await ensurePageDataLoaded(currentPage.id);
        }
      }
    }

    return true;
  } catch (error) {
    console.error('[EditorView] 恢复项目失败', error);
    return false;
  } finally {
    // Regardless of success or failure, close the loading overlay to prevent the canvas from being permanently obstructed.
    projectLoading.value = false;
  }
};

// Monitor page switching, trigger on-demand loading + data source lifecycle reconstruction
watch(
  () => pageStore.currentPageId,
  async (newPageId, oldPageId) => {
    if (!newPageId) return;
    if (!loadedPageNames.has(newPageId)) {
      await ensurePageDataLoaded(newPageId);
    }
    // Rebuild data source binding when switching pages
    if (oldPageId && newPageId !== oldPageId) {
      await destroyDataSourceLifecycle();
      await activateEditModeDataSources();
    }
  },
);

// Preview in a new tab
const previewInNewTab = async () => {
  const currentPage = pageStore.currentPage;
  if (!currentPage) {
    await showAlert(t('editor.selectPageFirst'), t('editor.alertTitle.info'), 'info');
    return;
  }

  try {
    const pageData = typeof (currentPage as any)?.toJSONAsync === 'function'
      ? await (currentPage as any).toJSONAsync()
      : currentPage.toJSON();

    // Save all page data to IndexedDB for use in previews by elements such as PageBrowser
    const allPages = pageStore.pages.map(p => ({
      name: p.name,
      data: p.toJSON(),
    }));
    saveAllPagesData(allPages).catch(() => {
      // silently ignore save errors for all pages
    });

    const pageName = currentPage.name || pageData.id;

    if (isTemplateEditMode.value) {
      // Template Mode: Loaded via IndexedDB, no projectId required
      // The preview address is based on the deployment base path (H5 embedded scenario VITE_BASE=/scada-preview/), and the root path /preview cannot be hard-coded.
      const previewUrl = `${window.location.origin}${import.meta.env.BASE_URL}preview?mode=template&pageName=${encodeURIComponent(pageName)}`;
      const newWindow = window.open(previewUrl, '_blank');
      if (!newWindow) {
        await showAlert(t('editor.previewTabBlocked'), t('editor.alertTitle.info'), 'info');
      }
      return;
    }

    // Project Mode: Save the current page to the backend to ensure it can be loaded from the backend during preview.
    try {
      const groupName = getCurrentPageGroupName();
      await pageApi.savePage(projectId, currentPage.name || pageData.id, pageData, groupName);
    } catch (saveErr) {
      console.warn('Preview - Failed to save page to backend, preview may show stale data:', saveErr);
    }

    const groupName = getCurrentPageGroupName();
    // The preview address is based on the deployment base path (H5 embedded scenario VITE_BASE=/scada-preview/), and the root path /preview cannot be hard-coded.
    let previewUrl = `${window.location.origin}${import.meta.env.BASE_URL}preview?projectId=${encodeURIComponent(projectId)}&pageName=${encodeURIComponent(pageName)}`;
    if (groupName) {
      previewUrl += `&group=${encodeURIComponent(groupName)}`;
    }
    const newWindow = window.open(previewUrl, '_blank');
    if (!newWindow) {
      await showAlert(t('editor.previewTabBlocked'), t('editor.alertTitle.info'), 'info');
    }

  } catch (error) {
    console.error('Preview - Failed to prepare preview:', error);
    await showAlert(t('editor.previewFailed'), t('editor.alertTitle.error'), 'error');
  }
};
</script>

<style>
/*Global Style Reset*/
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
</style>

<style scoped>
/*Application Main Container*/
.app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--background, #1a1a1a);
  color: var(--text, #ffffff);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}

/*Top Toolbar*/
.app-header {
  height: var(--header-height);
  border-bottom: 1px solid var(--border, #2a2a2a);
  background-color: var(--header-background, #2196F3);
  z-index: 100;
  box-shadow: var(--shadow-small);
}

/*Template Edit Mode Prompt Bar*/
.template-edit-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 20px;
  background: var(--primary-light, rgba(64, 158, 255, 0.08));
  border-bottom: 1px solid var(--border, #e0e0e0);
  font-size: 13px;
  color: var(--text, #333);
}

.template-edit-banner-icon {
  font-size: 15px;
  line-height: 1;
}

.template-edit-banner-text {
  flex: 1;
  color: var(--text-secondary, #666);
}

.template-edit-banner-btn {
  padding: 4px 14px;
  font-size: 12px;
  border: 1px solid var(--primary, #409EFF);
  border-radius: 4px;
  background: transparent;
  color: var(--primary, #409EFF);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.template-edit-banner-btn:hover {
  background: var(--primary, #409EFF);
  color: #fff;
}

/*Main Content Area*/
.app-content {
  flex: 1;
  display: flex;
  min-height: 0;
}

/*Left-side Layers Panel*/
.app-layer {
  width: var(--layer-width);
  border-right: 1px solid var(--border, #2a2a2a);
  background-color: var(--surface, #252525);
  z-index: 5;
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;
  position: relative;
}

 
/*Panel Content Container*/
.panel-content {
  flex: 1;
  overflow: hidden auto;
}

/*Panel Toggle Button*/
.panel-toggle-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 64px;
  background: linear-gradient(180deg, var(--surface, #252525) 0%, var(--background, #1a1a1a) 100%);
  border: 1px solid var(--border, #2a2a2a);
  cursor: pointer;
  color: var(--text-secondary, #888);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.toggle-icon {
  font-weight: 300;
  transition: transform 0.3s ease;
}

.panel-toggle-btn:hover {
  background: linear-gradient(180deg, var(--primary, #4a90d9) 0%, #357abd 100%);
  color: white;
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.4);
}

.panel-toggle-btn:hover .toggle-icon {
  transform: scale(1.2);
}

.panel-toggle-btn.expanded {
  background: linear-gradient(180deg, var(--surface, #252525) 0%, var(--background, #1a1a1a) 100%);
}

/*Tooltip Effect*/
.panel-toggle-btn::before {
  content: attr(data-tooltip);
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background-color: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: all 0.25s ease;
  z-index: 1000;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.app-layer .panel-toggle-btn::before {
  left: calc(100% + 8px);
}

.app-property .panel-toggle-btn::before {
  right: calc(100% + 8px);
}

.panel-toggle-btn:hover::before {
  opacity: 1;
  visibility: visible;
}

.app-layer .panel-toggle-btn {
  right: -12px;
  border-left: none;
  border-radius: 0 4px 4px 0;
}

.app-property .panel-toggle-btn {
  left: -16px;
  border-right: none;
  border-radius: 4px 0 0 4px;
}

.panel-toggle-btn:hover {
  background-color: var(--border, #2a2a2a);
  color: var(--text, #fff);
}

/*Drag Handle*/
.resize-handle {
  width: 4px;
  cursor: col-resize;
  background-color: transparent;
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 10;
  transition: background-color 0.2s;
}

.resize-handle:hover {
  background-color: var(--primary, #4a90d9);
}

.resize-handle.right {
  right: -2px;
}

.resize-handle.left {
  left: -2px;
}

/*Right-side Properties Panel*/
.app-property {
  width: var(--property-width);
  border-left: 1px solid var(--border, #2a2a2a);
  background-color: var(--surface, #252525);
  z-index: 10;
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;
  position: relative;
}

 
/*Central Design Area*/
.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background-color: var(--background, #1a1a1a);
  overflow: hidden;
  position: relative;
}

/*Project recovery period loading overlay*/
.app-main-loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--background, #1a1a1a);
  z-index: 50;
}

/*Hide canvas content during project recovery to prevent the appearance of an unprepared DesignCanvas.*/
.app-canvas--hidden {
  visibility: hidden;
}

/*Canvas Container*/
.app-canvas {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background-color: var(--background, #1a1a1a);
  overflow: hidden;
}

/*Canvas Toolbar*/
.canvas-controls {
  background-color: var(--surface, #252525);
  border-bottom: 1px solid var(--border, #2a2a2a);
  padding: 0;
  z-index: 20;
}

/*Pages Label*/
.canvas-tabs {
  background-color: var(--surface, #252525);
  border-bottom: 1px solid var(--border, #2a2a2a);
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  z-index: 15;
}

/*System Bottom Status Bar*/
.app-footer {
  height: var(--footer-height);
  border-top: 1px solid var(--border, #2a2a2a);
  background-color: var(--surface, #252525);
  z-index: 100;
  box-shadow: 0 -1px 3px rgba(0, 0, 0, 0.1);
}

/*Preview Modal Style*/
.preview-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.preview-modal-content {
  background-color: var(--surface);
  border-radius: 8px;
  box-shadow: var(--shadow-large);
  width: 840px;
  max-width: 90vw;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  animation: modalFadeIn 0.3s ease;
}

@keyframes modalFadeIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.preview-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background-color: var(--surface);
}

.preview-modal-header h2 {
  margin: 0;
  font-size: 18px;
  color: var(--text);
  font-weight: 600;
}

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-button:hover {
  background-color: var(--border);
  color: var(--text);
}

.preview-modal-body {
  padding: 0;
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: var(--surface);
}

/*Responsive layout */
@media (max-width: 1600px) {
  .app-layer:not(.collapsed) {
    width: 240px;
  }

  .app-property:not(.collapsed) {
    width: 280px;
  }
}

@media (max-width: 1400px) {
  .app-layer:not(.collapsed) {
    width: 220px;
  }

  .app-property:not(.collapsed) {
    width: 260px;
  }

  /*Reduce the size of toolbar buttons*/
  .panel-toggle-btn {
    width: 18px;
    height: 56px;
  }
}

@media (max-width: 1200px) {
  .app-layer:not(.collapsed) {
    width: 200px;
  }

  .app-property:not(.collapsed) {
    width: 240px;
  }
}

@media (max-width: 900px) {
  .app-layer {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.3);
  }

  .app-property {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
  }
}

/*Import Project Dialog*/
.import-hint {
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 14px;
}

.import-file-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background-color: var(--background);
  color: var(--text);
  font-size: 14px;
}

.import-status {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.import-status.info {
  background-color: var(--toast-info-bg, rgba(59, 130, 246, 0.1));
  color: var(--toast-info-text, var(--primary, #4a90d9));
  border: 1px solid var(--toast-info-border, rgba(59, 130, 246, 0.3));
}

.import-status.success {
  background-color: var(--toast-success-bg, rgba(34, 197, 94, 0.1));
  color: var(--toast-success-text, #22c55e);
  border: 1px solid var(--toast-success-border, rgba(34, 197, 94, 0.3));
}

.import-status.warning {
  background-color: var(--toast-warning-bg, rgba(245, 158, 11, 0.1));
  color: var(--toast-warning-text, #f59e0b);
  border: 1px solid var(--toast-warning-border, rgba(245, 158, 11, 0.3));
}

.import-status.error {
  background-color: var(--toast-error-bg, rgba(239, 68, 68, 0.1));
  color: var(--toast-error-text, #ef4444);
  border: 1px solid var(--toast-error-border, rgba(239, 68, 68, 0.3));
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.dialog-container {
  background-color: var(--surface);
  border-radius: 8px;
  box-shadow: var(--shadow-large);
  width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.dialog-header h2 {
  margin: 0;
  font-size: 16px;
  color: var(--text);
}

.dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text);
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn-cancel {
  background-color: var(--control-button-bg);
  color: var(--text);
}

.btn-cancel:hover {
  background-color: var(--control-button-hover);
}

.btn-warning {
  background-color: #f59e0b;
  color: #fff;
}

.btn-warning:hover {
  background-color: #d97706;
}
</style>
