<template>
  <div
    ref="containerRef"
    class="preview-canvas-container"
    :class="transitionClass"
  >
    <!-- Device size selection — shown only when showControls=true -->
    <div
      v-if="showControls"
      class="preview-controls"
    >
      <select
        v-model="selectedDevice"
        @change="changeDevice"
      >
        <option value="custom">
          {{ $t('runtime.preview.deviceCustom') }}
        </option>
        <option value="desktop">
          {{ $t('runtime.preview.deviceDesktop') }} (1920x1080)
        </option>
        <option value="tablet">
          {{ $t('runtime.preview.deviceTablet') }} (768x1024)
        </option>
        <option value="mobile">
          {{ $t('runtime.preview.deviceMobile') }} (375x667)
        </option>
      </select>
      <!-- Badge for the current effective fit mode (auto resolved to a concrete mode; optimization C2 strategy made visible) -->
      <span
        class="fit-mode-badge"
        :title="fitModeDescription"
      >
        {{ fitModeLabel }}
      </span>
      <ZoomSlider 
        v-model="zoomValue" 
        :use-page-scale="false"
        :min-scale="scaleMinPercent"
        :max-scale="scaleMaxPercent"
        :disabled="computedFitMode === 'stretch'"
        @scale-change="handleScaleChange"
      />
      <button
        class="zoom-button"
        @click="resetZoom"
      >
        {{ $t('runtime.preview.reset') }}
      </button>
    </div>

    <!-- Canvas container -->
    <div
      ref="wrapperRef"
      class="canvas-wrapper"
      :class="canvasWrapperClass"
      @mousedown="showControls ? handleMouseDown : null"
      @mousemove="showControls ? handleMouseMove : null"
      @mouseup="showControls ? handleMouseUp : null"
      @mouseleave="showControls ? handleMouseUp : null"
      @wheel.passive="showControls ? handleWheel : null"
      @contextmenu.prevent="handleContextMenu"
    >
      <div class="canvas-content-area">
        <canvas
          ref="canvasRef"
          :width="canvasWidth"
          :height="canvasHeight"
          class="preview-canvas"
          @click="handleCanvasClick"
        />
      </div>

      <VueComponentsContainer
        ref="vueContainerRef"
        :sorted-graphics="sortedGraphics"
        :zoom="zoom"
        :zoom-y="zoomY"
        :pan-x="panX"
        :pan-y="panY"
        :canvas-el="canvasRef"
        mode="runtime"
      />

      <SvgComponentsContainer
        ref="svgContainerRef"
        :sorted-graphics="sortedGraphics"
        :zoom="zoom"
        :zoom-y="zoomY"
        :pan-x="panX"
        :pan-y="panY"
        :canvas-el="canvasRef"
      />

      <CssComponentsContainer
        ref="cssContainerRef"
        :sorted-graphics="sortedGraphics"
        :zoom="zoom"
        :zoom-y="zoomY"
        :pan-x="panX"
        :pan-y="panY"
        :canvas-el="canvasRef"
      />

      <ThreeComponentsContainer
        ref="threeContainerRef"
        :sorted-graphics="sortedGraphics"
        :zoom="zoom"
        :zoom-y="zoomY"
        :pan-x="panX"
        :pan-y="panY"
        :canvas-el="canvasRef"
      />
    </div>

    <RuntimeDataPanel
      :visible="showDataPanel"
      :sources="dataPanelSources"
      :ws-connected="wsStore.isConnected"
      @close="closeDataPanel"
      @refresh="() => refreshDataPanel(false)"
    />

    <ContextMenuUI
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :items="contextMenuItems"
      @close="closeContextMenu"
      @item-click="handleContextMenuItem"
    />

    <ThemeSelectorPanel
      :visible="showThemePanel"
      :current-theme="currentTheme"
      @close="closeThemePanel"
      @select="handleSelectTheme"
    />

    <PerformancePanel
      :visible="showPerformancePanel"
      @close="showPerformancePanel = false"
    />

    <StatisticsPanel
      :visible="showStatisticsPanel"
      @close="showStatisticsPanel = false"
    />

    <ScriptMonitorDialog
      :visible="showScriptMonitorDialog"
      @close="showScriptMonitorDialog = false"
    />

    <DebugPanel
      :visible="showDebugPanel"
      :diagnostic-info="diagnosticInfo"
      :show-overlay="showDiagnosticOverlay"
      :fit-mode="currentFitModeSelection"
      :zoom="zoom"
      :pan-x="panX"
      :pan-y="panY"
      :canvas-width="canvasWidth"
      :canvas-height="canvasHeight"
      :graphics-count="graphicsList.length"
      :backend-exists="!!canvasBackend"
      @close="showDebugPanel = false"
      @run-diagnostic="runCanvasDiagnostics"
      @toggle-overlay="toggleDiagnosticOverlay"
      @refresh-page="refreshPage"
      @change-fit-mode="switchFitMode"
    />

    <!-- Carousel indicator -->
    <CarouselIndicator
      :visible="carouselControlsVisible"
      :pages="carouselState.carouselPages"
      :current-index="carouselState.currentIndex"
      @go-to="carouselManager?.goTo($event)"
    />

    <!-- Carousel control bar -->
    <CarouselControls
      :visible="carouselControlsVisible"
      :state="carouselState"
      :interval="carouselConfig.interval"
      @play="carouselManager?.play()"
      @pause="carouselManager?.pause()"
      @previous="carouselManager?.previous()"
      @next="carouselManager?.next()"
      @go-to="carouselManager?.goTo($event)"
    />

    <!-- Carousel settings panel -->
    <CarouselSettingsPanel
      :visible="showCarouselSettings"
      :config="carouselConfig"
      :all-pages="pageStore.pages.map(p => ({ id: p.id, name: p.name }))"
      @close="showCarouselSettings = false"
      @save="handleCarouselConfigSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, onUnmounted } from 'vue';
import { usePageStore, type IGraphic, BasePage, ZoomManager, defaultAutoFitConfig, type FitMode, EnterAnimationEngine, Canvas2DBackend, RendererRegistry, ScriptEngine, themeManager, invalidateThemeCache, resolveAssetPath, i18n, saveServiceManager, CarouselManager, type CarouselConfig, DEFAULT_CAROUSEL_CONFIG, type CarouselState, loadAllPagesData, extractTagIds, readTagSnapshot, buildSourceSummary, ScadaDataManager } from '@scada-editor/core';
import { RenderBackend } from '@scada-editor/plugin-sdk';
import { pageApi, useWsStore, usePageDataSourceStore } from '@scada-editor/system';
import { loadImageWithAuth } from '../utils/loadImageWithAuth';
import { VIEWPORT } from '../canvas-page/design-canvas/constants';
import ZoomSlider from '../common/ZoomSlider.vue';
import VueComponentsContainer from '../canvas-page/design-canvas/core/VueComponentsContainer.vue';
import SvgComponentsContainer from '../canvas-page/design-canvas/core/SvgComponentsContainer.vue';
import CssComponentsContainer from '../canvas-page/design-canvas/core/CssComponentsContainer.vue';
import ThreeComponentsContainer from '../canvas-page/design-canvas/core/ThreeComponentsContainer.vue';
import RuntimeDataPanel from './RuntimeDataPanel.vue';
import ThemeSelectorPanel from './ThemeSelectorPanel.vue';
import PerformancePanel from './PerformancePanel.vue';
import StatisticsPanel from './StatisticsPanel.vue';
import ContextMenuUI from '../common/ContextMenu.vue';
import ScriptMonitorDialog from './ScriptMonitorDialog.vue';
import DebugPanel from './DebugPanel.vue';
import CarouselControls from './CarouselControls.vue';
import CarouselIndicator from './CarouselIndicator.vue';
import CarouselSettingsPanel from './CarouselSettingsPanel.vue';

const props = defineProps({
  width: {
    type: Number,
    default: 800,
  },
  height: {
    type: Number,
    default: 600,
  },
  autoSize: {
    type: Boolean,
    default: true
  },
  showControls: {
    type: Boolean,
    default: true
  },
  fitMode: {
    type: String as () => FitMode,
    default: 'auto'
  },
  /** Initial carousel config (loaded from the project's projectinfo.json) */
  carouselConfig: {
    type: Object as () => CarouselConfig | null,
    default: null,
  },
});

const emit = defineEmits<{
  /** Carousel config change (saved by the user via the settings panel) */
  carouselConfigChanged: [config: CarouselConfig];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLDivElement | null>(null);
// Canvas scroll viewport (.canvas-wrapper): this is the source of truth for size measurement; clientWidth already excludes the vertical scrollbar width
const wrapperRef = ref<HTMLDivElement | null>(null);
// References to the four graphic-container components: refresh canvas offset after fit/container size changes (optimization P0-2)
const vueContainerRef = ref<{ updateCanvasOffset: () => void } | null>(null);
const svgContainerRef = ref<{ updateCanvasOffset: () => void } | null>(null);
const cssContainerRef = ref<{ updateCanvasOffset: () => void } | null>(null);
const threeContainerRef = ref<{ updateCanvasOffset: () => void } | null>(null);
const containerWidth = ref(props.width);
const containerHeight = ref(props.height);
// Canvas resolution = container size (always fills the container, no overflow, no scrollbar)
const canvasWidth = ref(props.width);
const canvasHeight = ref(props.height);
const pageStore = usePageStore();
const wsStore = useWsStore();

// Background-image draw params (unified by fitMode)
const bgImageDrawParams = ref<{
  x: number;
  y: number;
  width: number;
  height: number;
}>({ x: 0, y: 0, width: props.width, height: props.height });
let resizeObserver: ResizeObserver | null = null;

// Store the graphic-list ref directly to avoid reactivity dependency issues
const graphicsList = ref<IGraphic[]>([]);

// Cache background image
let cachedBgImage: HTMLImageElement | null = null;
let cachedBgImageSrc: string | null = null;

let animEngine: EnterAnimationEngine | null = null;
let animPageContext: any = null;
let animInitialized = false;

let canvasBackend: Canvas2DBackend | null = null;
const registeredGraphics = new Set<string>();

// Retry-count limit for failed background-image loads
const BG_IMAGE_MAX_RETRIES = 3;
const bgImageRetryCount = new Map<string, number>();
const bgImageExhausted = new Set<string>();

// Debug panel state
const showDebugPanel = ref(false);
const showDiagnosticOverlay = ref(false);

// Canvas diagnostics result interface
interface CanvasDiagnosticResult {
  timestamp: number;
  canvasRefExists: boolean;
  canvasRefTag: string;
  canvasRefInDOM: boolean;
  totalCanvasesInDOM: number;
  canvasWidth: number;
  canvasHeight: number;
  canvasCssDisplay: string;
  canvasCssVisibility: string;
  canvasCssOpacity: string;
  canvasCssWidth: string;
  canvasCssHeight: string;
  containerCssDisplay: string;
  testDrawSuccess: boolean;
  backendExists: boolean;
  backendStats: Record<string, any> | null;
  graphicsCount: number;
  zoom: number;
  panX: number;
  panY: number;
  fitMode: string;
  currentPageName: string;
  currentPageId: string;
  currentPageSize: string;
  backgroundImageLoaded: boolean;
}

const diagnosticInfo = ref<CanvasDiagnosticResult | null>(null);

/** Run canvas diagnostics — callable independently */
function runCanvasDiagnostics(): CanvasDiagnosticResult {
  const allCanvases = document.querySelectorAll('canvas');
  const canvas = canvasRef.value;

  let testDrawSuccess = false;
  if (canvas) {
    try {
      const testCtx = canvas.getContext('2d');
      if (testCtx) {
        const w = canvas.width;
        const h = canvas.height;
        testCtx.save();
        testCtx.fillStyle = 'rgba(0, 0, 255, 0.3)';
        testCtx.fillRect(0, 0, w, h);
        testCtx.fillStyle = '#FFFFFF';
        testCtx.font = 'bold 28px sans-serif';
        testCtx.textAlign = 'center';
        testCtx.textBaseline = 'middle';
        testCtx.fillText('DIAGNOSTIC', w / 2, h / 2);
        testCtx.restore();
        testDrawSuccess = true;
      }
    } catch (e) {
      console.warn('[Diagnostic] 测试绘制失败:', e);
    }
  }

  const currentPage = pageStore.currentPage;

  const result: CanvasDiagnosticResult = {
    timestamp: Date.now(),
    canvasRefExists: !!canvas,
    canvasRefTag: canvas?.tagName || 'N/A',
    canvasRefInDOM: canvas ? document.contains(canvas) : false,
    totalCanvasesInDOM: allCanvases.length,
    canvasWidth: canvas?.width || 0,
    canvasHeight: canvas?.height || 0,
    canvasCssDisplay: canvas ? getComputedStyle(canvas).display : 'N/A',
    canvasCssVisibility: canvas ? getComputedStyle(canvas).visibility : 'N/A',
    canvasCssOpacity: canvas ? getComputedStyle(canvas).opacity : 'N/A',
    canvasCssWidth: canvas ? getComputedStyle(canvas).width : 'N/A',
    canvasCssHeight: canvas ? getComputedStyle(canvas).height : 'N/A',
    containerCssDisplay: containerRef.value ? getComputedStyle(containerRef.value).display : 'N/A',
    testDrawSuccess,
    backendExists: !!canvasBackend,
    backendStats: canvasBackend?.getStats?.() || null,
    graphicsCount: graphicsList.value.length,
    zoom: zoom.value,
    panX: panX.value,
    panY: panY.value,
    fitMode: computedFitMode.value,
    currentPageName: currentPage?.name || 'N/A',
    currentPageId: currentPage?.id || 'N/A',
    currentPageSize: currentPage ? `${(currentPage as any).width} × ${(currentPage as any).height}` : 'N/A',
    backgroundImageLoaded: !!cachedBgImage && cachedBgImage.complete,
  };

  diagnosticInfo.value = result;
  return result;
}

/** Toggle the diagnostic overlay */
function toggleDiagnosticOverlay(on?: boolean) {
  showDiagnosticOverlay.value = on !== undefined ? on : !showDiagnosticOverlay.value;
}

// Load background image (with cache + retry limit)
const loadBackgroundImage = async (src: string): Promise<HTMLImageElement | null> => {
  // Resolve a relative path (e.g. bg.png) into the full API path under the page directory
  const effectiveSrc = resolvePageAssetPath(src);
  const resolvedSrc = resolveAssetPath(effectiveSrc);

  // Validate path validity: ignore obviously invalid paths (truncated base64, double-encoded dirty data, etc.)
  if (!isValidImagePath(resolvedSrc)) {
    bgImageExhausted.add(resolvedSrc);
    console.warn('[PreviewCanvas] 背景图片路径无效，已跳过:', resolvedSrc);
    return null;
  }

  // Retry count exceeded; stop loading
  if (bgImageExhausted.has(resolvedSrc)) {
    return null;
  }

  if (cachedBgImage && cachedBgImageSrc === resolvedSrc && cachedBgImage.complete) {
    return cachedBgImage;
  }

  try {

    const img = await loadImageWithAuth(effectiveSrc);
    cachedBgImage = img;
    cachedBgImageSrc = resolvedSrc;
    bgImageRetryCount.delete(resolvedSrc);
    return img;
  } catch (err) {
    const count = (bgImageRetryCount.get(resolvedSrc) || 0) + 1;
    bgImageRetryCount.set(resolvedSrc, count);
    console.error(`[PreviewCanvas] 背景图片加载失败(第${count}次):`, resolvedSrc, err);
    if (count >= BG_IMAGE_MAX_RETRIES) {
      bgImageExhausted.add(resolvedSrc);
      console.warn(`[PreviewCanvas] 背景图片加载失败 ${count} 次，停止重试: ${resolvedSrc}`);
    }
    return null;
  }
};

/** Resolve a page-relative path to a full API path: bg.png → /api/v1/projects/{project}/pages/{page}/bg.png */
function resolvePageAssetPath(src: string): string {
  if (!src) return src;
  // Already an absolute path or full URL; return directly
  if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/')) {
    return src;
  }
  const currentPage = pageStore.currentPage;
  const projectName = (currentPage as any)?.projectId || '';
  const pageName = currentPage?.name || '';
  if (!projectName || !pageName) return src;
  return `/api/v1/projects/${encodeURIComponent(projectName)}/pages/${encodeURIComponent(pageName)}/${src}`;
}

/** Combined resolution: first resolve the page-relative path, then normalize the API version prefix */
function resolvePageBgSrc(src: string | undefined): string | null {
  if (!src) return null;
  return resolveAssetPath(resolvePageAssetPath(src));
}

/** Validate whether an image path is a valid format */
function isValidImagePath(path: string): boolean {
  if (!path) return false;
  // data URL / blob URL: always valid
  if (path.startsWith('data:image/') || path.startsWith('blob:')) return true;
  // HTTP(S) URL: always valid
  if (path.startsWith('http://') || path.startsWith('https://')) return true;
  // /api/v{digits}/... contains a valid resource segment
  if (/^\/api\/v\d+\/.+/.test(path)) return true;
  // Relative path (e.g. bg.png) — starts with a letter/digit/underscore and has an extension
  if (/^[a-zA-Z0-9_].+\.[a-zA-Z]{2,}$/.test(path)) return true;
  // Truncated base64 fragments (e.g. 9k=, %25%3D) or a version prefix only with no resource segment: invalid
  return false;
}

const preloadBackgroundImage = () => {
  const currentPage = pageStore.currentPage;
  if (!currentPage?.backgroundImage) {
    cachedBgImage = null;
    cachedBgImageSrc = null;
    return;
  }

  loadBackgroundImage(currentPage.backgroundImage).then((img) => {
    if (img) {
      drawCanvas();
    }
  });
};

const initAnimationEngine = () => {
  if (!animInitialized) {
    animEngine = new EnterAnimationEngine(() => {
      drawCanvas();
    });
    animPageContext = { 
      animationEngine: animEngine,
      getPage: () => ({ 
        mode: 'preview' as const,
        selectedGraphicIds: [],
      }),
    };
    animInitialized = true;
  }
};

// Safely get the graphic array
const getSafeGraphics = (page: any): IGraphic[] => {
  if (!page) return [];

  if (Array.isArray(page.graphics)) {
    return page.graphics;
  }
  
  if (page.graphics && 'value' in page.graphics && Array.isArray(page.graphics.value)) {
    return page.graphics.value;
  }
  
  return [];
};

// Sync the graphic list
const syncGraphics = () => {
  const currentPage = pageStore.currentPage;
  if (!currentPage) {
    graphicsList.value = [];
    return;
  }

  const graphics = getSafeGraphics(currentPage);

  // Assign directly; do not spread
  graphicsList.value = graphics.slice().sort(
    (a: IGraphic, b: IGraphic) =>
      (a.config?.zIndex ?? 0) - (b.config?.zIndex ?? 0)
  );
};

// Simplify sortedGraphics; directly return graphicsList.value
const sortedGraphics = computed(() => {
  return graphicsList.value;
});

// Canvas wrapper CSS class
const canvasWrapperClass = computed(() => {
  const classes: Record<string, boolean> = {};
  if (!props.showControls) {
    classes['no-controls'] = true;
  }
  if (computedFitMode.value === 'stretch') {
    classes['stretch-mode'] = true;
  }
  // Lock the scroll axis by the actually-effective mode: fit-width must not show a horizontal scrollbar, fit-height likewise (avoid extra scrollbars from sub-pixels/out-of-bounds graphics)
  if (resolvedFitMode.value === 'fitWidth') {
    classes['fit-width-mode'] = true;
  }
  if (resolvedFitMode.value === 'fitHeight') {
    classes['fit-height-mode'] = true;
  }
  return classes;
});

// Device size config
const devices = {
  desktop: { width: 1920, height: 1080 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 },
};

// State management
const selectedDevice = ref('custom');

/** Currently selected device simulation size (null when no device selected, optimization P1-1) */
const getActiveDeviceSize = (): { width: number; height: number } | null =>
  selectedDevice.value !== 'custom'
    ? devices[selectedDevice.value as keyof typeof devices]
    : null;

// Canvas-related state
const zoom = ref(1);
const zoomX = ref(1);
const zoomY = ref(1);
const zoomValue = ref(100);
const panX = ref(0);
const panY = ref(0);
const computedFitMode = ref<FitMode>('auto');
// User-configured fit mode before auto resolution (used for menu check state and badge)
const pageFitMode = ref<FitMode>('auto');
// Actually effective fit mode (auto resolved to a concrete mode; used for the control-area badge, optimization C2)
const resolvedFitMode = ref<FitMode>('contain');

// Fit-mode badge text (auto shows the resolved result; non-auto shows the mode name directly)
// Narrow the t signature via unknown assertion: a non-literal key triggers deep instantiation of the vue-i18n messages literal schema (TS2589)
const translate = (key: string): string =>
  (i18n.global as unknown as { t: (key: string) => string }).t(key);
const fitModeLabel = computed(() => {
  const label = translate(`zoomManager.fitModes.${resolvedFitMode.value}.label`);
  return pageFitMode.value === 'auto' ? `auto → ${label}` : label;
});
const fitModeDescription = computed(() =>
  translate(`zoomManager.fitModes.${resolvedFitMode.value}.description`)
);

// ★ Unified zoom range (percentage): from pageStore's three configurable zoom params, aligned with the edit-mode constraint chain (optimization C3)
// Previously, preview relied on ZoomManager's internal fallback default 10~200, bypassing the user's config in CanvasSettings
const scaleMinPercent = computed(() => pageStore.scaleMin ?? VIEWPORT.SCALE_MIN);
const scaleMaxPercent = computed(() => pageStore.scaleMax ?? VIEWPORT.SCALE_MAX);

/**
 * ★ Update zoom anchored at the container center (aligns with editor zoomAtAnchor's CANVAS_CENTER semantics, optimization P1-4)
 * Keep the canvas center's visual position fixed: pan' = center - (center - pan) × (newZoom / oldZoom)
 * Previously the slider/wheel only changed zoom without adjusting pan; zooming around the (0,0) origin flew the center content out of the viewport
 */
const zoomAtContainerCenter = (newZoom: number) => {
  const oldZoom = zoom.value;
  if (oldZoom <= 0 || newZoom === oldZoom) return;
  const ratio = newZoom / oldZoom;
  const centerX = containerWidth.value / 2;
  const centerY = containerHeight.value / 2;
  panX.value = centerX - (centerX - panX.value) * ratio;
  panY.value = centerY - (centerY - panY.value) * ratio;
};

/** Apply new zoom and sync Canvas backend (clamp + center anchor + zoomX/zoomY sync) */
const applyZoom = (newScalePercent: number) => {
  const clampedPercent = Math.max(
    scaleMinPercent.value,
    Math.min(scaleMaxPercent.value, newScalePercent),
  );
  const newZoom = clampedPercent / 100;
  zoomAtContainerCenter(newZoom);
  zoom.value = newZoom;
  zoomX.value = newZoom;
  zoomY.value = newZoom;
  zoomValue.value = clampedPercent;
  if (canvasBackend) {
    canvasBackend.setScale(zoom.value);
    canvasBackend.setPan(panX.value, panY.value);
  }
};

// Locally temporarily overridden display mode (not persisted to page, only valid for current preview session)
const localFitMode = ref<FitMode | null>(null);
// Current display-mode selected state (local override priority): right-click menu checkbox and debug panel highlight share state, ensuring consistency (unified runtime display mode)
const currentFitModeSelection = computed<FitMode>(() => localFitMode.value || pageFitMode.value);
const isDragging = ref(false);
const hasDragged = ref(false);
const startX = ref(0);
const startY = ref(0);
const startPanX = ref(0);
const startPanY = ref(0);

const showDataPanel = ref(false);
const dataPanelSources = ref<any[]>([]);
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
const AUTO_REFRESH_INTERVAL = 3000; // Auto-refresh every 3 seconds while panel is open (fallback)

// Reactive auto-refresh: trigger on every wsStore flush (aligns with editor DataSourceConfigDialog)
// Call syncGraphics() to generate a new array reference + drawCanvas() to redraw Canvas 2D graphics
const wsVersion = ref(0);
let tagValueUnsubscribeFn: (() => void) | null = null;
watch(
  () => wsStore.tagFlushVersion,
  (newVersion) => {
    wsVersion.value++;
    syncGraphics();
    drawCanvas();
  },
);

const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = computed(() => {
  const fitModes: FitMode[] = ['auto', 'contain', 'fitWidth', 'fitHeight', 'stretch'];
  const currentMode = currentFitModeSelection.value;
  return [
    { id: 'refresh', label: translate('runtime.menu.refresh') },
    { id: 'divider-1', label: '─' },
    { id: 'data-panel', label: translate('runtime.menu.dataPanel') },
    { id: 'fullscreen', label: translate('runtime.menu.fullscreen') },
    { id: 'theme-toggle', label: translate('runtime.menu.themeToggle') },
    { id: 'performance', label: translate('runtime.menu.performance') },
    { id: 'statistics', label: translate('runtime.menu.statistics') },
    { id: 'script-monitor', label: translate('runtime.menu.scriptMonitor') },
    { id: 'divider-2', label: '─' },
    // Display mode grouping (restore the menu item corresponding to P2-1c dead code, current mode prefix ✓)
    { id: 'fitmode-header', label: translate('runtime.preview.fitModeGroup') },
    ...fitModes.map(mode => ({
      id: `fitmode-${mode}`,
      label: (mode === currentMode ? '✓ ' : '') + translate(`zoomManager.fitModes.${mode}.label`),
    })),
    { id: 'divider-3', label: '─' },
    { id: 'debug-panel', label: translate('runtime.menu.debugPanel') },
    { id: 'divider-4', label: '─' },
    { id: 'carousel-settings', label: translate('runtime.menu.carouselSettings') },
  ];
});

function handleContextMenu(event: MouseEvent) {
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuVisible.value = true;
}

function closeContextMenu() {
  contextMenuVisible.value = false;
}

const showThemePanel = ref(false);
const currentTheme = ref(themeManager.getCurrentThemeName());

const showPerformancePanel = ref(false);
const showStatisticsPanel = ref(false);
const showScriptMonitorDialog = ref(false);

// Carousel-related state
const carouselManager = ref<CarouselManager | null>(null);
const carouselStateTimer = ref<ReturnType<typeof setInterval> | null>(null);
const carouselConfig = ref<CarouselConfig>(
  props.carouselConfig ? { ...DEFAULT_CAROUSEL_CONFIG, ...props.carouselConfig } : { ...DEFAULT_CAROUSEL_CONFIG },
);
const carouselState = ref<CarouselState>({
  isRunning: false,
  isPaused: false,
  currentIndex: 0,
  elapsedTime: 0,
  carouselPages: [],
});
const showCarouselSettings = ref(false);
const carouselControlsVisible = computed(() => {
  return carouselConfig.value.enabled
    && (carouselState.value.carouselPages.length > 1
      || carouselConfig.value.showSinglePage);
});
const transitionClass = ref('');

function handleContextMenuItem(item: { id: string; label: string }) {
  if (item.id === 'refresh') {
    refreshPage();
  } else if (item.id === 'data-panel') {
    openDataPanel();
  } else if (item.id === 'fullscreen') {
    toggleFullscreen();
  } else if (item.id === 'theme-toggle') {
    showThemePanel.value = true;
  } else if (item.id === 'performance') {
    showPerformancePanel.value = !showPerformancePanel.value;
  } else if (item.id === 'statistics') {
    showStatisticsPanel.value = !showStatisticsPanel.value;
  } else if (item.id === 'script-monitor') {
    showScriptMonitorDialog.value = true;
  } else if (item.id === 'debug-panel') {
    showDebugPanel.value = !showDebugPanel.value;
    if (showDebugPanel.value) {
      nextTick(() => runCanvasDiagnostics());
    }
  } else if (item.id === 'carousel-settings') {
    showCarouselSettings.value = true;
  } else if (item.id === 'fitmode-header') {
    // Clicking the "显示模式" title does nothing, it only serves as a group identifier
  } else if (item.id && typeof item.id === 'string' && item.id.startsWith('fitmode-')) {
    const mode = item.id.replace('fitmode-', '') as FitMode;
    switchFitMode(mode);
  }
}

/** Switch display mode (only updates current display, not persisted to page) */
function switchFitMode(mode: FitMode) {
  localFitMode.value = mode;
  scrollbarCompensationApplied = false;
  applyAutoFit();
  drawCanvas();
  scheduleScrollbarCompensation();
}

function closeThemePanel() {
  showThemePanel.value = false;
}

function handleSelectTheme(themeName: string) {
  themeManager.setTheme(themeName);
  invalidateThemeCache();
  localStorage.setItem('runtime-theme', themeName);
  currentTheme.value = themeName;
  showThemePanel.value = false;

  const graphics = sortedGraphics.value;
  if (Array.isArray(graphics)) {
    for (const graphic of graphics) {
      if (graphic && typeof (graphic as any).onThemeChanged === 'function') {
        try {
          (graphic as any).onThemeChanged(themeName);
        } catch { /* ignore */ }
      }
    }
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
}

function openDataPanel() {
  showDataPanel.value = true;

  // When preview runs in an iframe, the Pinia instance is isolated from the parent window, need to establish WS connection itself
  if (!wsStore.isConnected) {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('projectId');
    if (projectId) {
      // Collect tagIds of all data sources on the current page
      const pageData = pageStore.currentPage as any;
      const dsGroup = pageData?.dataSource;
      const allTagIds: string[] = [];
      if (dsGroup?.dataSources) {
        for (const ds of dsGroup.dataSources) {
          const tagIds = extractTagIds(ds);
          allTagIds.push(...tagIds);
        }
      }
      wsStore.connect(projectId).then(() => {
        if (allTagIds.length > 0) {
          wsStore.subscribeTags(allTagIds);
        }
        refreshDataPanel(false);
      }).catch((err: any) => {
        console.warn('[PreviewCanvas] wsStore.connect FAILED:', err?.message || err);
        // Refresh panel even if WS connection fails: runtime data sources may use non-WS drivers like HTTP polling/Static
        refreshDataPanel(false);
      });
    } else {
      console.warn('[PreviewCanvas] openDataPanel: 无法获取 projectId');
      refreshDataPanel(false);
    }
  } else {
    refreshDataPanel(false);
  }

  // Start auto-refresh: refresh every 3s while panel is open, wsStore keeps receiving WS pushes in background
  if (!autoRefreshTimer) {
    autoRefreshTimer = setInterval(() => refreshDataPanel(true), AUTO_REFRESH_INTERVAL);
  }
}

function closeDataPanel() {
  showDataPanel.value = false;
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// Reactive auto-refresh: update panel immediately when wsStore pushes data (aligns with editor DataSourceConfigDialog)
watch(wsVersion, () => {
  if (showDataPanel.value) {
    refreshDataPanel(true);
  }
});

function refreshDataPanel(silent = false) {
  const currentPage = pageStore.currentPage as any;
  if (!currentPage) {
    dataPanelSources.value = [];
    return;
  }

  try {
    const sources: any[] = [];
    const dsGroup = currentPage.dataSource;
    const dm = ScadaDataManager.dataSourceManager;

  // Runtime: when DataSourceManager is initialized, read its real status and cached values (all via public API)
  if (dm.initialized) {
    const dmSources = dm.getAllSources();
    // Use the public getStatus() to get each data source's status info (replaces direct access to _driverRegistry private property)
    const statusSnap = dm.getStatus();
    const statusBySourceId = new Map(
      (statusSnap?.sources || []).map((s: any) => [s.id, s]),
    );

    // Get all bindings and group by variable.dataSourceId into corresponding data sources (avoid reverse-deriving from driver config)
    const allBindings = dm.getBindings();
    const bindingsBySourceId = new Map<string, any[]>();
    for (const b of allBindings) {
      const meta = dm.getVariableMeta(b.tagId);
      const dsId = meta?.dataSourceId;
      if (!dsId) continue;
      if (!bindingsBySourceId.has(dsId)) bindingsBySourceId.set(dsId, []);
      bindingsBySourceId.get(dsId)!.push(b);
    }

    for (const dsInfo of dmSources) {
      const statusEntry = statusBySourceId.get(dsInfo.id);

      const dsBindings = bindingsBySourceId.get(dsInfo.id) || [];
      // Deduplicate tagIds (multiple graphics may bind the same tag)
      const seenTagIds = new Set<string>();
      const tags: any[] = [];
      for (const b of dsBindings) {
        if (seenTagIds.has(b.tagId)) continue;
        seenTagIds.add(b.tagId);
        const cached = dm.getCachedValue(b.tagId);
        const meta = dm.getVariableMeta(b.tagId);
        tags.push({
          tagId: b.tagId,
          tagName: meta?.tagName || b.tagId,
          currentValue: cached?.value ?? null,
          quality: cached?.quality ?? 'uncertain',
          lastUpdate: cached?.timestamp ?? 0,
          unit: meta?.unit,
          dataType: meta?.dataType,
        });
      }

      // Data-source level aggregated value
      const firstTag = tags[0];
      sources.push({
        id: dsInfo.id,
        name: statusEntry?.name || dsInfo.id,
        type: dsInfo.type,
        status: statusEntry?.status || dsInfo.status || 'active',
        lastFetchTime: statusEntry?.lastFetchTime || 0,
        errorMessage: statusEntry?.errorMessage || dsInfo.lastError || undefined,
        lastValue: firstTag?.currentValue != null ? String(firstTag.currentValue) : null,
        updatedAt: firstTag?.lastUpdate || null,
        quality: tags.length === 0 ? 'uncertain'
          : tags.length === 1 ? firstTag?.quality
          : tags.some((t: any) => t.quality === 'bad') ? 'bad' : 'good',
        tags,
      });
    }

    dataPanelSources.value = sources;
    return;
  }

  // Editor fallback: read from pageDsStore / wsStore (keep original logic)

  if (dsGroup?.dataSources) {
    // Use pageDsStore (aligns with editor DataSourceConfigDialog), ensures sharing the data model with editor
    const pageDsStore = usePageDataSourceStore();
    const allVariables = pageDsStore.variables.length > 0
      ? pageDsStore.variables
      : (dsGroup.variables || []);

    for (const ds of dsGroup.dataSources) {
      // Use DataSourceReader to uniformly extract tagIds
      let sourceVars = allVariables
        .filter((v: any) => v.dataSourceId === ds.id);

      const tagIds = extractTagIds(ds);
      if (sourceVars.length === 0 && tagIds.length > 0) {
        sourceVars = tagIds.map((tagId: string) => ({
          tagId,
          tagName: tagId,
          dataSourceId: ds.id,
          dataType: 'float',
        }));
      }

      // Build tags array: DataSourceReader uniformly reads wsStore.tagValues
      const tags = sourceVars.map((v: any) =>
        readTagSnapshot(v.tagId, v.tagName || v.tagId, wsStore),
      );

      // DataSourceReader unified aggregation summary
      const summary = buildSourceSummary(
        ds,
        sourceVars.map((v: any) => v.tagId),
        sourceVars.map((v: any) => v.tagName || v.tagId),
        wsStore,
      );

      sources.push({
        id: ds.id,
        name: ds.name || ds.id,
        type: ds.type || 'unknown',
        status: ds.enabled !== false ? 'active' : 'paused',
        lastFetchTime: Date.now(),
        lastValue: summary.lastValue,
        updatedAt: summary.updatedAt,
        quality: summary.quality,
        tags,
        wsConnected: wsStore.isConnected,
      });
    }
  }

  dataPanelSources.value = sources;
  } catch (err) {
    console.error('[PreviewCanvas] refreshDataPanel error:', err);
    dataPanelSources.value = [];
  }
}

const syncGraphicsToBackend = () => {
  if (!canvasBackend) {
    console.warn('[PreviewCanvas] syncGraphicsToBackend: canvasBackend is NULL!');
    return;
  }

  const currentIds = new Set<string>();
  const graphics = sortedGraphics.value;
  if (!Array.isArray(graphics)) return;

  initAnimationEngine();

  let canvasBackendUpdateCount = 0;
  for (const graphic of graphics) {
    if (!graphic || !graphic.id) continue;

    // ★ Only add CANVAS_2D-type graphics to Canvas2DBackend
    // Align with PageBrowser.vue's classifyGraphics() logic
    const backend = RendererRegistry.getBackendForPlugin(graphic as any);
    if (backend !== RenderBackend.CANVAS_2D) {
      continue;
    }

    currentIds.add(graphic.id);

    // ★ Re-inject runtime pageContext on every sync, overriding the editor-injected pageContextImpl
    if (graphic && typeof (graphic as any)._setPageContext === 'function') {
      (graphic as any)._setPageContext(animPageContext);
    }

    if (registeredGraphics.has(graphic.id)) {
      canvasBackend.update(graphic);
    } else {
      canvasBackend.render(graphic);
      registeredGraphics.add(graphic.id);
    }
    canvasBackendUpdateCount++;
  }

  for (const id of registeredGraphics) {
    if (!currentIds.has(id)) {
      canvasBackend.remove(id);
      registeredGraphics.delete(id);
    }
  }
  console.log(`[PreviewCanvas.syncGraphicsToBackend] total=${graphics.length}, canvas2d=${canvasBackendUpdateCount}, registered=${registeredGraphics.size}`);
};

/** Refresh page: reload page data from server, reset cache, recompute layout and redraw */
async function refreshPage(): Promise<void> {
  let freshDataLoaded = false;

  // 1. Prefer reloading current page data from backend API
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('projectId');
  // Load by the current page's name instead of the fixed pageName in URL (URL does not change during carousel switch)
  const currentPageForLoad = pageStore.currentPage;
  const currentPageName = currentPageForLoad?.name || urlParams.get('pageName');
  if (projectId && currentPageName) {
    try {
      const response = await pageApi.readPage(projectId, currentPageName);
      // The backend response may have multiple wrapper layers:
      //   No interceptor: { success: true, data: pageJSON }
      //   With interceptor: { data: { success: true, data: pageJSON }, message, timestamp }
      const pageResult = (response as any)?.data || (response as any);
      const pageData = pageResult?.data;
      if (pageData) {
        const currentPage = pageStore.currentPage as BasePage;
        if (currentPage && typeof currentPage.fromJSON === 'function') {
          currentPage.fromJSON(pageData);
          freshDataLoaded = true;
        }
      }
    } catch (err) {
      console.warn('[PreviewCanvas] refreshPage: 从后端 API 重新加载页面失败:', err);
    }
  }

  // 2. If cannot load from URL, try SaveService (in-editor preview mode)
  if (!freshDataLoaded && saveServiceManager.isInitialized()) {
    try {
      const projectData = await saveServiceManager.load();
      if (projectData?.pages?.length) {
        const currentPageId = pageStore.currentPage?.id || pageStore.currentPageId;
        const updatedPageData = projectData.pages.find((p: any) => p.id === currentPageId);
        if (updatedPageData) {
            const currentPage = pageStore.currentPage as BasePage;
            if (currentPage && typeof currentPage.fromJSON === 'function') {
              currentPage.fromJSON(updatedPageData);
              freshDataLoaded = true;
            }
          }
      }
    } catch (err) {
      console.warn('[PreviewCanvas] refreshPage: 从 SaveService 重新加载页面数据失败，将使用当前缓存数据刷新:', err);
    }
  }

  // 3. Clear background image cache + retry limit
  cachedBgImage = null;
  cachedBgImageSrc = null;
  bgImageRetryCount.clear();
  bgImageExhausted.clear();

  // 4. Reset graphics registered in Canvas backend
  if (canvasBackend) {
    canvasBackend.clear();
  }
  registeredGraphics.clear();

  // 5. Re-sync graphic list
  syncGraphics();

  // 6. Recompute layout
  applyAutoFit();

  // 7. Reload background image
  preloadBackgroundImage();

  // 8. Redraw
  drawCanvas();
}

/**
 * ★ Page switching (per design doc §13.4.3 carousel page-switch chain)
 * Store-driven, does not modify the URL. CarouselManager and button navigation both use this entry point.
 *
 * targetPageId may be a page id (from carousel) or a page name (button optionsProvider uses p.name as value).
 * Strategy: look up by id first, then by name, resolve to the real id before operating.
 *
 * When the target page is not in the store, load it by priority from SaveService -> IndexedDB -> backend API.
 * After loading, run the full flow: stopTimers -> applyAutoFit -> syncGraphics -> startTimers.
 */
async function handlePageSwitch(targetPageId: string, oldPageId?: string): Promise<void> {
  // ★ Unified resolution: targetPageId may be a page name (button dropdown value=p.name) or a page ID (carousel value=p.id)
  let resolvedId = targetPageId;
  let existingPage = pageStore.pages.find(p => p.id === targetPageId);
  if (!existingPage) {
    existingPage = pageStore.pages.find(p => p.name === targetPageId);
    if (existingPage) {
      resolvedId = existingPage.id;
      console.log('[PreviewCanvas] handlePageSwitch: 名称→ID 解析:', { name: targetPageId, id: resolvedId });
    }
  }

  // 1. If target page is in store but has no graphics (IndexedDB may store an empty page),
  //    Or not in store: need to reload from data source
  const pageHasGraphics = existingPage ? getSafeGraphics(existingPage).length > 0 : false;
  if (!existingPage || !pageHasGraphics) {
    if (!existingPage) {
      console.log('[PreviewCanvas] handlePageSwitch: 页面不在 store 中，尝试从数据源加载:', targetPageId);
    } else {
      console.log('[PreviewCanvas] handlePageSwitch: 页面在 store 中但无图元，需要从后端重新加载:', targetPageId);
    }
    let pageData: any = null;

    // 1a. In-editor preview: load via SaveService
    if (saveServiceManager.isInitialized()) {
      try {
        const projectData = await saveServiceManager.load();
        pageData = projectData?.pages?.find((p: any) => p.id === targetPageId || p.name === targetPageId);
        console.log('[PreviewCanvas] handlePageSwitch: SaveService 查找结果:', { found: !!pageData });
      } catch (error) {
        console.warn('[PreviewCanvas] handlePageSwitch: SaveService 加载失败:', error);
      }
    }

    // 1b. Standalone preview window: load via IndexedDB (supports both id and name matching)
    if (!pageData) {
      try {
        const allPages = await loadAllPagesData();
        console.log('[PreviewCanvas] handlePageSwitch: IndexedDB 页面列表:',
          allPages.map((p: any) => ({ id: p.data?.id, name: p.data?.name })));
        const pageEntry = allPages.find((p: any) =>
          p.data?.id === targetPageId || p.data?.name === targetPageId);
        pageData = pageEntry?.data;
        console.log('[PreviewCanvas] handlePageSwitch: IndexedDB 查找结果:', {
          targetId: targetPageId, found: !!pageData,
        });
      } catch (error) {
        console.warn('[PreviewCanvas] handlePageSwitch: IndexedDB 加载失败:', error);
      }
    }

    // 1c. Backend API fallback
    if (!pageData) {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('projectId');
      if (projectId) {
        try {
          // targetPageId may simply be the pageName
          const response = await pageApi.readPage(projectId, targetPageId);
          const result = (response as any)?.data || response;
          pageData = result?.data || result;
        } catch (error) {
          console.warn('[PreviewCanvas] handlePageSwitch: 后端 API 加载失败:', error);
        }
      }
    }

    if (!pageData) {
      console.warn('[PreviewCanvas] handlePageSwitch: 无法加载目标页面:', targetPageId);
      return;
    }

    resolvedId = pageData.id || targetPageId;

    if (existingPage) {
      // Page already in store but no graphics → refresh data in place
      (existingPage as BasePage).fromJSON(pageData);
      console.log('[PreviewCanvas] handlePageSwitch: 页面数据已刷新:', { id: resolvedId, name: pageData.name });
    } else {
      // Page not in store → create and add
      const targetPage = new BasePage();
      targetPage.init({
        id: resolvedId,
        name: pageData.name || '',
        width: pageData.width || 1920,
        height: pageData.height || 1080,
        backgroundColor: pageData.backgroundColor || '#FFFFFF',
      });
      targetPage.fromJSON(pageData);
      pageStore.pages = [...pageStore.pages, targetPage];
      console.log('[PreviewCanvas] handlePageSwitch: 页面已加载并添加到 store:', { id: resolvedId, name: pageData.name });
    }
  }

  // 2. Stop old page timers
  if (oldPageId) {
    const oldPage = pageStore.pages.find(p => p.id === oldPageId);
    oldPage?.stopTimers?.();
  }

  // 3. Switch to target page (Store-driven) - use the resolved real ID
  pageStore.setCurrentPage(resolvedId);

  // 4-8. Refresh rendering per §13.4.3 flow
  applyAutoFit();
  preloadBackgroundImage();
  initAnimationEngine();
  syncGraphics();
  syncGraphicsToBackend();
  drawCanvas();

  // 9. Start new page timers
  const newPage = pageStore.currentPage;
  newPage?.startTimers?.();
}

// Draw canvas
const drawCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  syncGraphics();

  if (canvasBackend) {
    syncGraphicsToBackend();
    return;
  }

  // Fallback: draw graphic directly (old path)
  context.clearRect(0, 0, canvas.width, canvas.height);

  const currentPage = pageStore.currentPage;
  if (currentPage) {
    context.fillStyle = currentPage.backgroundColor || '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (currentPage.backgroundImage) {
      const resolvedBgSrc = resolvePageBgSrc(currentPage.backgroundImage);
      // Exceeded retry count, stop loading (resolvedBgSrc can be null: returns null on invalid parse)
      if (resolvedBgSrc !== null && bgImageExhausted.has(resolvedBgSrc)) {
        // Do not show background image
      } else if (cachedBgImage && cachedBgImageSrc === resolvedBgSrc && cachedBgImage.complete) {
        const params = bgImageDrawParams.value;
        context.drawImage(cachedBgImage, params.x, params.y, params.width, params.height);
      } else {
        loadBackgroundImage(currentPage.backgroundImage).then((img) => {
          if (img && img.complete) {
            drawCanvas();
          }
        });
      }
    }
  }

  context.save();
  context.translate(panX.value, panY.value);

  if (computedFitMode.value === 'stretch') {
    context.scale(zoomX.value, zoomY.value);
  } else {
    context.scale(zoom.value, zoom.value);
  }

  const graphics = sortedGraphics.value;
  if (Array.isArray(graphics)) {
    for (let i = 0; i < graphics.length; i++) {
      try {
        const graphic = graphics[i];
        // ★ Only draw CANVAS_2D-type graphics
        const backend = RendererRegistry.getBackendForPlugin(graphic as any);
        if (backend !== RenderBackend.CANVAS_2D) continue;
        if (graphic && typeof graphic.draw === 'function') {
          graphic.draw(context);
        }
      } catch { /* empty */ }
    }
  }

  context.restore();
}

// Device simulation viewport (optimization P1-1): use container as viewport, device resolution as fit target size,
// Content is proportionally centered in the container showing the device ratio area; bitmap resolution stays = container size, no bitmap stretch
const changeDevice = () => {
  const device = getActiveDeviceSize();
  scrollbarCompensationApplied = false;
  if (device) {
    applyAutoFit(device.width, device.height);
    scheduleScrollbarCompensation(device.width, device.height);
  } else {
    handleResize();
  }
  drawCanvas();
};

// Zoom feature (slider callback): clamp + container-center anchor + zoomX/zoomY sync uniformly handled by applyZoom (optimization P1-4)
const handleScaleChange = (newScale: number) => {
  // Disable manual zoom in stretch mode to protect non-uniform ratio (zoomX/zoomY only set by applyAutoFit)
  if (computedFitMode.value === 'stretch') return;
  applyZoom(newScale);
  drawCanvas();
};

// ★ Reset = return to auto-fit state (aligns with editor resetZoom semantics), not bare 100% (optimization C4)
// applyAutoFit already syncs canvasBackend's scale/scaleXY/pan/resize internally;
// When device simulation is selected, reset to device-fit state (optimization P1-1)
const resetZoom = () => {
  const deviceSize = getActiveDeviceSize();
  scrollbarCompensationApplied = false;
  applyAutoFit(deviceSize?.width, deviceSize?.height);
  drawCanvas();
  scheduleScrollbarCompensation(deviceSize?.width, deviceSize?.height);
};

// Mouse event handling
const handleMouseDown = (event: MouseEvent) => {
  isDragging.value = true;
  hasDragged.value = false;
  startX.value = event.clientX;
  startY.value = event.clientY;
  startPanX.value = panX.value;
  startPanY.value = panY.value;
};

const handleMouseMove = (event: MouseEvent) => {
  if (isDragging.value) {
    const deltaX = event.clientX - startX.value;
    const deltaY = event.clientY - startY.value;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      hasDragged.value = true;
    }
    panX.value = startPanX.value + deltaX;
    panY.value = startPanY.value + deltaY;
    if (canvasBackend) {
      canvasBackend.setPan(panX.value, panY.value);
    }
    drawCanvas();
  }
};

const handleMouseUp = () => {
  isDragging.value = false;
};

const handleWheel = (event: WheelEvent) => {
  // Only zoom when the Ctrl key is held
  if (event.ctrlKey) {
    // Disable zoom in stretch mode to protect non-uniform ratio
    if (computedFitMode.value === 'stretch') return;
    // In passive mode preventDefault is ignored, but zoom calculation still takes effect
    // Step constant + clamp + container-center anchor are uniformly handled by applyZoom (optimization P1-4/C3)
    const wheelFactor = event.deltaY > 0
      ? VIEWPORT.PREVIEW_WHEEL_ZOOM_OUT
      : VIEWPORT.PREVIEW_WHEEL_ZOOM_IN;
    applyZoom(zoomValue.value * wheelFactor);
    drawCanvas();
  }
  // Otherwise do not prevent default events, allow normal page scrolling
};

// Canvas click event
const handleCanvasClick = (event: MouseEvent) => {
  // Drag operation does not trigger click navigation
  if (hasDragged.value) return;

  const canvas = canvasRef.value;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  
  // Use different scaling factors to compute click coordinates based on whether it is stretch mode
  const scaleX = computedFitMode.value === 'stretch' ? zoomX.value : zoom.value;
  const scaleY = computedFitMode.value === 'stretch' ? zoomY.value : zoom.value;
  
  const x = (event.clientX - rect.left - panX.value) / scaleX;
  const y = (event.clientY - rect.top - panY.value) / scaleY;

  // Check if a graphic was clicked
  const graphics = sortedGraphics.value;
  if (Array.isArray(graphics)) {
    for (let i = graphics.length - 1; i >= 0; i--) {
      const graphic = graphics[i];
      if (graphic && graphic.containsPoint && graphic.containsPoint(x, y)) {
        handleGraphicNavigate(graphic);
        break;
      }
    }
  }
};

/** Handle graphic navigation (read navigation config from customProps) */
const handleGraphicNavigate = (graphic: IGraphic) => {
  const customProps = (graphic as any).config?.customProps;
  if (!customProps || customProps.targetType === 'none') return;

  if (customProps.targetType === 'page' && customProps.targetPage) {
    const targetPageId = customProps.targetPage;
    const pageExists = pageStore.pages.some(p => p.id === targetPageId);
    if (pageExists) {
      pageStore.setCurrentPage(targetPageId);
    }
  } else if (customProps.targetType === 'url' && customProps.targetUrl) {
    window.open(customProps.targetUrl, '_blank');
  }
};

/**
 * Compute the graphic bounding box and apply auto-fit.
 * Bitmap sizing behavior by container mode (optimization P1-3):
 * - default/device-simulation: canvas fills the container, no overflow, no scrollbar;
 * - fitWidth/fitHeight: when content exceeds size, expand bitmap resolution (capped at MAX_BITMAP_SIZE,
 *   beyond cap keep container size and center), overflow handled by .canvas-wrapper native scroll,
 *   runtime and control-mode behavior are consistent (no-controls container also supports expanded bitmap + scroll, no degradation).
 * @param targetWidth device-simulation target width (optional): when passed, force contain centered,
 *        bitmap keeps container size, avoid bitmap stretch distortion (optimization P1-1)
 * @param targetHeight device-simulation target height (optional)
 */
const applyAutoFit = (targetWidth?: number, targetHeight?: number) => {
  const currentPage = pageStore.currentPage as BasePage;
  if (!currentPage) return;

  let panXOffset = 0;
  let panYOffset = 0;

  // Device simulation fit target uses device resolution, otherwise page size (optimization P1-1)
  const pageWidth = targetWidth ?? currentPage.width;
  const pageHeight = targetHeight ?? currentPage.height;
  const isDeviceSimulation = targetWidth !== undefined && targetHeight !== undefined;

  // Priority: local override > page property > component prop > auto.
  // Device simulation is forced to contain (P1-1).
  const configuredFitMode: FitMode = isDeviceSimulation
    ? 'contain'
    : (localFitMode.value || currentPage.fitMode || props.fitMode || 'auto');
  pageFitMode.value = configuredFitMode;

  // Runtime display: "auto" resolves to stretch so the page always fills the
  // container and never produces scrollbars (auto previously resolved to
  // fitWidth/fitHeight, which left a horizontal/vertical scrollbar).
  const currentFitMode: FitMode =
    configuredFitMode === 'auto' && !isDeviceSimulation ? 'stretch' : configuredFitMode;
  computedFitMode.value = currentFitMode;

  // Default path: canvas fills container, no overflow/scrollbar (control-mode expand branch see below)
  canvasWidth.value = containerWidth.value;
  canvasHeight.value = containerHeight.value;

  // Special handling for stretch mode (not applicable to device simulation: non-uniform scaling conflicts with proportional-centering semantics)
  if (currentFitMode === 'stretch' && !isDeviceSimulation) {
    // Compute x and y scaling factors separately so content fully fills the container
    zoomX.value = containerWidth.value / pageWidth;
    zoomY.value = containerHeight.value / pageHeight;
    resolvedFitMode.value = 'stretch';

    panXOffset = 0;
    panYOffset = 0;

    zoom.value = zoomX.value;
    zoomValue.value = zoomX.value * 100;

    // Background image: stretch to fill the entire canvas
    bgImageDrawParams.value = {
      x: 0, y: 0,
      width: canvasWidth.value,
      height: canvasHeight.value,
    };
  } else {
    // Non-stretch mode uses ZoomManager computation (zoom range wired to pageStore configurable param, optimization C3)
    const result = ZoomManager.calculateScaleByMode(
      currentFitMode,
      pageWidth,
      pageHeight,
      containerWidth.value,
      containerHeight.value,
      defaultAutoFitConfig,
      { minScale: scaleMinPercent.value, maxScale: scaleMaxPercent.value },
    );

    const actualFitMode = result.fitMode;
    const scaleValue = result.scale;

    resolvedFitMode.value = actualFitMode;

    // Set unified scaling factor
    zoom.value = scaleValue / 100;
    zoomX.value = zoom.value;
    zoomY.value = zoom.value;
    zoomValue.value = scaleValue;

    // Compute scaled size
    const scaledWidth = pageWidth * zoom.value;
    const scaledHeight = pageHeight * zoom.value;

    // Compute offset (canvas = container, content centered or aligned to edge)
    switch (actualFitMode) {
      case 'contain':
        panXOffset = (canvasWidth.value - scaledWidth) / 2;
        panYOffset = (canvasHeight.value - scaledHeight) / 2;
        bgImageDrawParams.value = {
          x: panXOffset, y: panYOffset,
          width: scaledWidth, height: scaledHeight,
        };
        break;
      case 'fitWidth':
        panXOffset = 0;
        panYOffset = scaledHeight > canvasHeight.value ? 0 : (canvasHeight.value - scaledHeight) / 2;
        // When content height exceeds container, expand canvas height to show full content (consistent in control/runtime mode),
        // When exceeding MAX_BITMAP_SIZE, keep container size and center (optimization P1-3)
        if (scaledHeight > canvasHeight.value) {
          if (scaledHeight > VIEWPORT.MAX_BITMAP_SIZE) {
            console.warn(`[PreviewCanvas] fitWidth 扩展位图高度 ${Math.round(scaledHeight)}px 超过上限 ${VIEWPORT.MAX_BITMAP_SIZE}px，已保持容器尺寸并居中显示`);
            panYOffset = (canvasHeight.value - scaledHeight) / 2;
          } else {
            canvasHeight.value = scaledHeight;
          }
        }
        bgImageDrawParams.value = {
          x: 0, y: panYOffset,
          width: scaledWidth, height: scaledHeight,
        };
        break;
      case 'fitHeight':
        panXOffset = scaledWidth > canvasWidth.value ? 0 : (canvasWidth.value - scaledWidth) / 2;
        panYOffset = 0;
        // When content width exceeds container, expand canvas width to show full content (consistent in control/runtime mode),
        // When exceeding MAX_BITMAP_SIZE, keep container size and center (optimization P1-3)
        if (scaledWidth > canvasWidth.value) {
          if (scaledWidth > VIEWPORT.MAX_BITMAP_SIZE) {
            console.warn(`[PreviewCanvas] fitHeight 扩展位图宽度 ${Math.round(scaledWidth)}px 超过上限 ${VIEWPORT.MAX_BITMAP_SIZE}px，已保持容器尺寸并居中显示`);
            panXOffset = (canvasWidth.value - scaledWidth) / 2;
          } else {
            canvasWidth.value = scaledWidth;
          }
        }
        bgImageDrawParams.value = {
          x: panXOffset, y: 0,
          width: scaledWidth, height: scaledHeight,
        };
        break;
      default:
        panXOffset = (canvasWidth.value - scaledWidth) / 2;
        panYOffset = (canvasHeight.value - scaledHeight) / 2;
        bgImageDrawParams.value = {
          x: panXOffset, y: panYOffset,
          width: scaledWidth, height: scaledHeight,
        };
    }
  }

  panX.value = panXOffset;
  panY.value = panYOffset;

  if (canvasBackend) {
    if (computedFitMode.value === 'stretch') {
      // stretch mode requires non-uniform scaling, use setScaleXY
      if (canvasBackend.setScaleXY) {
        canvasBackend.setScaleXY(zoomX.value, zoomY.value);
      } else {
        canvasBackend.setScale(zoomX.value);
      }
    } else {
      canvasBackend.setScale(zoom.value);
    }
    canvasBackend.setPan(panXOffset, panYOffset);
    // Canvas size may expand due to fitWidth/fitHeight mode, need to sync update to backend
    canvasBackend.resize(canvasWidth.value, canvasHeight.value);
  }

  // After canvas size/position changes, refresh the container component's canvas offset to avoid DOM-layer vs Canvas-layer drift (optimization P0-2)
  refreshContainerOffsets();
};

/** Refresh canvas offset for the four graphic containers (read after DOM size takes effect, optimization P0-2) */
const refreshContainerOffsets = () => {
  nextTick(() => {
    vueContainerRef.value?.updateCanvasOffset();
    svgContainerRef.value?.updateCanvasOffset();
    cssContainerRef.value?.updateCanvasOffset();
    threeContainerRef.value?.updateCanvasOffset();
  });
};

// Zero-size fallback retry (optimization P1-2): hidden tab/embedded iframe mount may have container size 0,
// Delay re-measure by PREVIEW_INIT_RETRY_DELAYS to avoid applyAutoFit producing a degenerate zoom≈0 view,
// Align with editor INIT_RETRY_DELAYS retry mechanism (doc 00 §7.2)
let zeroSizeRetryCount = 0;
let zeroSizeRetryTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleZeroSizeRetry = () => {
  if (zeroSizeRetryCount >= VIEWPORT.PREVIEW_INIT_MAX_RETRIES) {
    console.warn('[PreviewCanvas] 容器尺寸持续为 0，已放弃适配重试');
    return;
  }
  const delay = VIEWPORT.PREVIEW_INIT_RETRY_DELAYS[zeroSizeRetryCount % VIEWPORT.PREVIEW_INIT_RETRY_DELAYS.length];
  zeroSizeRetryCount++;
  zeroSizeRetryTimer = setTimeout(() => {
    zeroSizeRetryTimer = null;
    handleResize();
  }, delay);
};

// Handle container size change (device simulation uses device resolution as fit target, optimization P1-1)
let pendingResize = false;
// Scrollbar compensation: expanding bitmap (fitWidth/fitHeight) may trigger vertical scrollbar, narrowing wrapper visible width,
// Need one more fit to avoid content wider than visible area causing horizontal scrollbar; each fit action limits compensation to once to prevent oscillation
let scrollbarCompensationApplied = false;
const scheduleScrollbarCompensation = (targetWidth?: number, targetHeight?: number) => {
  if (scrollbarCompensationApplied) return;
  scrollbarCompensationApplied = true;
  nextTick(() => {
    const wrapper = wrapperRef.value;
    if (!wrapper || wrapper.clientWidth === containerWidth.value) return;
    containerWidth.value = wrapper.clientWidth;
    containerHeight.value = wrapper.clientHeight;
    applyAutoFit(targetWidth, targetHeight);
    if (canvasBackend) {
      canvasBackend.resize(canvasWidth.value, canvasHeight.value);
    }
    drawCanvas();
  });
};
const handleResize = () => {
  if (pendingResize) return;
  pendingResize = true;
  requestAnimationFrame(() => {
    pendingResize = false;
    if (!props.autoSize || !containerRef.value) return;

    // Prefer measuring canvas-wrapper (scroll viewport): clientWidth already excludes the vertical scrollbar width,
    // If measuring outer containerRef, after scrollbar appears the bitmap is wider than the visible area, causing horizontal scrollbar (scrollbar feedback loop)
    let measuredWidth: number;
    let measuredHeight: number;
    if (wrapperRef.value) {
      measuredWidth = wrapperRef.value.clientWidth;
      measuredHeight = wrapperRef.value.clientHeight;
    } else {
      const controlsHeight = props.showControls ? (containerRef.value.querySelector('.preview-controls')?.getBoundingClientRect().height || 0) : 0;
      measuredWidth = containerRef.value.clientWidth;
      measuredHeight = containerRef.value.clientHeight - controlsHeight;
    }

    // Delay retry when container size is 0 (optimization P1-2)
    if (measuredWidth <= 0 || measuredHeight <= 0) {
      scheduleZeroSizeRetry();
      return;
    }
    zeroSizeRetryCount = 0;
    scrollbarCompensationApplied = false;

    containerWidth.value = measuredWidth;
    containerHeight.value = measuredHeight;

    const deviceSize = getActiveDeviceSize();
    applyAutoFit(deviceSize?.width, deviceSize?.height);

    if (canvasBackend) {
      canvasBackend.resize(canvasWidth.value, canvasHeight.value);
    }

    drawCanvas();

    // Scrollbar compensation: if first fit triggers vertical scrollbar due to expanded bitmap, refit once with the narrowed visible width (limited to once)
    scheduleScrollbarCompensation(deviceSize?.width, deviceSize?.height);
  });
};

// ★ Page-switch Watch (Store-driven, per design doc §13.4.3)
// Watch currentPageId changes, uniformly call handlePageSwitch.
// CarouselManager.next() and button navigation both trigger this watch via pageStore.setCurrentPage().
watch(
  () => pageStore.currentPageId,
  (newId, oldId) => {
    // On first mount oldId is undefined, skip (initial drawing handled by onMounted)
    if (!oldId || newId === oldId) return;
    handlePageSwitch(newId, oldId);
  }
);

// Page-size change fallback watch (background color/fitMode already have separate watches; page switch uniformly handled by currentPageId watch,
// Avoid double-trigger with it causing applyAutoFit to run twice, optimization P2-2)
watch(
  () => {
    const page = pageStore.currentPage as BasePage | null;
    return page ? `${page.width}x${page.height}` : '';
  },
  (newSize, oldSize) => {
    if (!oldSize || newSize === oldSize) return;
    applyAutoFit();
    drawCanvas();
  }
);

// Listen to fit-mode changes
watch(
  () => props.fitMode,
  () => {
    applyAutoFit();
    drawCanvas();
  }
);

// Listen to fitMode changes in page properties
watch(
  () => (pageStore.currentPage as BasePage)?.fitMode,
  (newFitMode) => {
    if (newFitMode) {
      applyAutoFit();
      drawCanvas();
    }
  }
);

// Listen to background image changes, preload new image
watch(
  () => (pageStore.currentPage as BasePage)?.backgroundImage,
  (newBgImage) => {
    if (newBgImage) {
      preloadBackgroundImage();
    } else {
      cachedBgImage = null;
      cachedBgImageSrc = null;
      drawCanvas();
    }
    // When changing background image, clear the old failure count
    if (newBgImage) {
      bgImageRetryCount.delete(resolveAssetPath(newBgImage));
      bgImageExhausted.delete(resolveAssetPath(newBgImage));
    }
  }
);

// === Carousel feature ===

/**
 * Perform page switch (store-driven, does not touch URL)
 */
function performPageSwitch(pageId: string): void {
  pageStore.setCurrentPage(pageId);
  // Subsequently, watch(currentPageId) / watch(currentPage) auto-trigger render updates
}

/**
 * Carousel page-switch callback (supports transition effects)
 */
function handleCarouselPageSwitch(pageId: string): void {
  if (carouselConfig.value.transition !== 'none') {
    executeTransition(pageId, carouselConfig.value.transition);
  } else {
    performPageSwitch(pageId);
  }
}

/**
 * Execute transition animation
 */
function executeTransition(pageId: string, type: string): void {
  carouselManager.value?.pause();
  transitionClass.value = `carousel-transition-${type}`;
  setTimeout(() => {
    performPageSwitch(pageId);
    transitionClass.value = '';
    carouselManager.value?.resume();
  }, 300);
}

/**
 * Save carousel config
 */
function handleCarouselConfigSave(config: CarouselConfig): void {
  carouselConfig.value = { ...config };
  carouselManager.value?.updateConfig(config);
  emit('carouselConfigChanged', config);
}

/**
 * Initialize the carousel manager
 */
function initCarousel(): void {
  console.log('[PreviewCanvas] initCarousel 开始:', {
    enabled: carouselConfig.value.enabled,
    autoStart: carouselConfig.value.autoStart,
    interval: carouselConfig.value.interval,
    pageCount: pageStore.pages.length,
  });

  if (!carouselManager.value) {
    carouselManager.value = new CarouselManager(
      carouselConfig.value,
      handleCarouselPageSwitch,
    );
  }

  const pages = pageStore.pages.map((p: { id: string; name: string }, i: number) => ({
    id: p.id,
    name: p.name,
    index: i,
  }));
  carouselManager.value.buildCarouselPages(pages);
  carouselState.value = { ...carouselManager.value.getState() } as CarouselState;

  console.log('[PreviewCanvas] initCarousel 页面列表:', {
    carouselPages: carouselState.value.carouselPages,
    count: carouselState.value.carouselPages.length,
  });

  // Periodically sync carousel status to reactive ref (drives UI updates: dots, progress, timers, etc.)
  if (carouselStateTimer.value) clearInterval(carouselStateTimer.value);
  carouselStateTimer.value = setInterval(() => {
    if (carouselManager.value) {
      carouselState.value = { ...carouselManager.value.getState() } as CarouselState;
    }
  }, 100);

  // Auto-start carousel (requires page count > 1 and autoStart=true)
  if (carouselConfig.value.autoStart && carouselState.value.carouselPages.length > 1) {
    console.log('[PreviewCanvas] initCarousel: autoStart=true, 启动轮播');
    carouselManager.value.start();
  } else {
    console.log('[PreviewCanvas] initCarousel: 未自动启动', {
      autoStart: carouselConfig.value.autoStart,
      pageCount: carouselState.value.carouselPages.length,
    });
  }
}

// === Carousel feature end ===

// Listen to externally passed carousel config changes (e.g. async load from project config)
watch(
  () => props.carouselConfig,
  (newConfig) => {
    if (newConfig) {
      carouselConfig.value = { ...DEFAULT_CAROUSEL_CONFIG, ...newConfig };
    }
  },
);

// Draw canvas after component mount
onMounted(() => {
  pageStore.setPageMode('preview');
  nextTick(() => {
    if (canvasRef.value) {
      // Ensure canvas initial size is valid: prefer reading the container's actual size (previously canvasWidth initially hit props.width,
      // The fallback chain never uses the container's measured value, optimization P1-2)
      const initWidth = containerRef.value?.clientWidth || canvasWidth.value || window.innerWidth || 1024;
      const initHeight = containerRef.value?.clientHeight || canvasHeight.value || window.innerHeight || 768;

      canvasBackend = new Canvas2DBackend(canvasRef.value as HTMLElement, {
        canvas: canvasRef.value,
        width: initWidth,
        height: initHeight,
        renderMode: 'canvas' as const,
        onBackgroundRender: (ctx: CanvasRenderingContext2D) => {
          try {
            const currentPage = pageStore.currentPage;
            const resolvedSrc = resolvePageBgSrc(currentPage?.backgroundImage);
            const isExhausted = resolvedSrc ? bgImageExhausted.has(resolvedSrc) : false;
            if (currentPage) {
              // Background color fills the entire canvas
              const bgColor = currentPage.backgroundColor;
              if (bgColor && bgColor !== 'transparent') {
                ctx.fillStyle = bgColor;
                ctx.fillRect(0, 0, canvasRef.value!.width, canvasRef.value!.height);
              }
              // Background image drawn uniformly per fitMode
              const shouldDrawBgImage = currentPage.backgroundImage
                && !isExhausted
                && cachedBgImage?.complete
                && cachedBgImageSrc === resolvedSrc;
              if (shouldDrawBgImage && cachedBgImage) {
                const params = bgImageDrawParams.value;
                ctx.drawImage(cachedBgImage, params.x, params.y, params.width, params.height);
              }
            }

            // ★ Diagnostic marker (controlled by showDiagnosticOverlay)
            if (showDiagnosticOverlay.value) {
              const cw = canvasRef.value?.width || 0;
              const ch = canvasRef.value?.height || 0;
              if (cw > 0 && ch > 0) {
                ctx.save();
                // Semi-transparent red overlay (verify canvas is visible)
                ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
                ctx.fillRect(0, 0, cw, ch);
                // Yellow border
                ctx.strokeStyle = '#FFFF00';
                ctx.lineWidth = 6;
                ctx.strokeRect(3, 3, cw - 6, ch - 6);
                // Corner triangles
                ctx.fillStyle = '#FF0000';
                ctx.strokeStyle = '#FFFF00';
                ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(60, 0); ctx.lineTo(0, 60); ctx.closePath();
                ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(cw, 0); ctx.lineTo(cw-60, 0); ctx.lineTo(cw, 60); ctx.closePath();
                ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, ch); ctx.lineTo(60, ch); ctx.lineTo(0, ch-60); ctx.closePath();
                ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(cw, ch); ctx.lineTo(cw-60, ch); ctx.lineTo(cw, ch-60); ctx.closePath();
                ctx.fill(); ctx.stroke();
                // Center text
                ctx.fillStyle = '#FFFF00';
                ctx.font = 'bold 28px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('CANVAS 诊断', cw/2, ch/2 - 20);
                ctx.font = '16px sans-serif';
                ctx.fillText(`${cw} x ${ch}`, cw/2, ch/2 + 20);
                ctx.restore();
              }
            }
          } catch (e) {
            console.warn('[PreviewCanvas] onBackgroundRender error:', e);
          }
        },
      });
    }

    if (props.autoSize) {
      handleResize();
      if (containerRef.value) {
        // Device simulation container changes also need re-fit (target device resolution, optimization P1-1),
        // Zero-size scenario is handled by handleResize's internal retry chain (optimization P1-2)
        resizeObserver = new ResizeObserver(() => {
          handleResize();
        });
        resizeObserver.observe(containerRef.value);
      }
    } else {
      applyAutoFit();
    }

    initAnimationEngine();
    preloadBackgroundImage();
    drawCanvas();

    // ★ Diagnostic: use the unified diagnostic method
    const _diagResult = runCanvasDiagnostics();

    // ★ Connect the script engine's graphic-change handler to Canvas2DBackend
    // So that script APIs like moveGraphic / setGraphicProps can directly update runtime rendering
    const scriptEngine = ScriptEngine.getInstance();
    scriptEngine.setGraphicChangeHandler((graphicId: string, props: Record<string, any>) => {
      if (!canvasBackend) return;
      const graphic = canvasBackend.getGraphic(graphicId);
      if (!graphic) return;

      // Update graphic position
      if (typeof props.x === 'number' || typeof props.y === 'number') {
        const pos = graphic.getPosition();
        const newX = typeof props.x === 'number' ? props.x : pos.x;
        const newY = typeof props.y === 'number' ? props.y : pos.y;
        graphic.setPosition(newX, newY);
      }

      // Update visibility
      if (typeof props.visible === 'boolean') {
        graphic.setVisible(props.visible);
      }

      // Update rotation angle
      if (typeof props.rotation === 'number') {
        graphic.setRotation(props.rotation);
      }

      // Update custom properties
      const customProps: Record<string, any> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!['x', 'y', 'visible', 'rotation'].includes(key)) {
          customProps[key] = value;
        }
      }
      if (Object.keys(customProps).length > 0) {
        if (typeof (graphic as any).setPluginProps === 'function') {
          (graphic as any).setPluginProps(customProps as any);
        }
      }

      // Notify Canvas2DBackend to update
      canvasBackend.update(graphic);
    });

    // Start page timers (core runtime feature)
    const currentPage = pageStore.currentPage as BasePage | null;
    if (currentPage && typeof currentPage.startTimers === 'function') {
      currentPage.startTimers();
    }

    // Initialize carousel manager
    initCarousel();

    // ★ Listen to DataSourceManager/EventBus tagValueChanged events (HTTP polling/Static/expression drivers all go through EventBus)
    // After data arrives, call syncGraphics() to generate new array reference + drawCanvas() to redraw Canvas 2D graphics (e.g. Label)
    // (BindingManager.handleDataUpdate only modifies graphic.config internal properties, does not trigger Canvas redraw)
    tagValueUnsubscribeFn = ScadaDataManager.eventBus.on('tagValueChanged', (event: unknown) => {
      const payload = (event as any)?.payload;
      console.log(`[PreviewCanvas] tagValueChanged event: tagId=${payload?.tagId?.slice(0,8) || '?'}, value=${String(payload?.value || '').slice(0,20)}`);
      syncGraphics();
      drawCanvas();
    });
  });
});

onUnmounted(() => {
  pageStore.setPageMode('edit');

  // Clean up EventBus tagValueChanged listener
  if (tagValueUnsubscribeFn) {
    tagValueUnsubscribeFn();
    tagValueUnsubscribeFn = null;
  }

  // Clean up data-panel auto-refresh timer
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  // Clean up carousel manager
  if (carouselStateTimer.value) clearInterval(carouselStateTimer.value);
  carouselManager.value?.destroy();
  carouselManager.value = null;
  // Clean up script engine's graphic-change handler
  ScriptEngine.getInstance().setGraphicChangeHandler(null);
  
  // Stop page timers, clear window.setInterval/setTimeout handles
  const currentPage = pageStore.currentPage as BasePage | null;
  if (currentPage && typeof currentPage.stopTimers === 'function') {
    currentPage.stopTimers();
  }
  
  if (animEngine) {
    animEngine.destroy();
    animEngine = null;
  }
  animInitialized = false;

  if (canvasBackend) {
    canvasBackend.destroy();
    canvasBackend = null;
  }
  registeredGraphics.clear();
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (zeroSizeRetryTimer) {
    clearTimeout(zeroSizeRetryTimer);
    zeroSizeRetryTimer = null;
  }
});
</script>

<style scoped>
.preview-canvas-container {
  position: relative;
  border: 1px solid var(--border, #ccc);
  background-color: var(--background, #f5f5f5);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 300px;
}

.preview-controls {
  display: flex;
  gap: 10px;
  padding: 10px;
  background-color: var(--surface, #e0e0e0);
  border-bottom: 1px solid var(--border, #ccc);
  align-items: center;
  flex-shrink: 0;
}

.preview-controls select {
  padding: 5px 10px;
  border: 1px solid var(--border, #ccc);
  border-radius: 4px;
  font-size: 14px;
  background-color: var(--surface, #ffffff);
  color: var(--text, #333333);
}

.fit-mode-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  color: var(--text, #333333);
  background-color: var(--surface, #ffffff);
  border: 1px solid var(--border, #ccc);
}

.zoom-button {
  padding: 5px 10px;
  border: 1px solid var(--control-button-border, #ccc);
  border-radius: 4px;
  background-color: var(--control-button-background, #f5f5f5);
  color: var(--control-button-text, #333333);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.zoom-button:hover {
  background-color: var(--control-button-hover, #d0d0d0);
}

.canvas-wrapper {
  flex: 1;
  overflow: auto;
  position: relative;
  cursor: grab;
  background-color: var(--background, #f5f5f5);
}

.canvas-content-area {
  position: relative;
  display: inline-block;
}

.canvas-wrapper:active {
  cursor: grabbing;
}

.canvas-wrapper.no-controls {
  cursor: default;
  /* Consistent with control mode: allow expanded bitmap (fitWidth/fitHeight) native scroll, no longer force-clip */
  overflow: auto;
  display: flex;
  padding: 0;
  width: 100%;
  height: 100%;
}

/* stretch mode: fills the entire container, no padding, no scrollbar (declared after no-controls to override its overflow) */
.canvas-wrapper.stretch-mode {
  overflow: hidden;
  padding: 0;
}

.canvas-wrapper.stretch-mode .canvas-content-area {
  display: block;
  width: 100%;
  height: 100%;
}

/* Safe centering: when content is smaller than the container, margin:auto centers it; when larger, degrade to top/left-aligned and scrollable,
 * avoiding flex forced-centering that clips the overflow and makes it unscrollable (content-area keeps the bitmap's natural size) */
.canvas-wrapper.no-controls .canvas-content-area {
  margin: auto;
}

/* Lock the scroll axis by the actually-effective mode: fit-width must not show a horizontal scrollbar (sub-pixel rounding, out-of-bounds graphics,
 * and scrollbar compensation residuals must not cause extra scrollbars); fit-height locks the vertical axis likewise */
.canvas-wrapper.fit-width-mode {
  overflow-x: hidden;
}

.canvas-wrapper.fit-height-mode {
  overflow-y: hidden;
}

/* In preview mode the canvas fills the container (background uses theme variables; transparent-background pages are taken over by the page backgroundColor, optimization P2-1a) */
.preview-canvas {
  display: block;
  margin: 0;
  background-color: var(--surface);
  box-shadow: none;
}

/* Carousel transition effect */
.preview-canvas-container.carousel-transition-fade {
  transition: opacity 0.3s ease;
  opacity: 1;
}

.preview-canvas-container.carousel-transition-fade.transition-out {
  opacity: 0;
}

.preview-canvas-container.carousel-transition-slide-left {
  transition: transform 0.3s ease;
  transform: translateX(0);
}

.preview-canvas-container.carousel-transition-slide-left.transition-out {
  transform: translateX(-10%);
}

.preview-canvas-container.carousel-transition-slide-right {
  transition: transform 0.3s ease;
  transform: translateX(0);
}

.preview-canvas-container.carousel-transition-slide-right.transition-out {
  transform: translateX(10%);
}
</style>