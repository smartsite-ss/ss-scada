<template>
  <div
    ref="rootRef"
    class="page-browser"
    :style="rootStyle"
  >
    <!-- Canvas 2D rendering layer — always present in the DOM to avoid canvasRef becoming invalid due to v-if -->
    <canvas
      ref="canvasRef"
      :width="pageWidth"
      :height="pageHeight"
      :style="canvasStyle"
      class="page-browser-canvas"
    />

    <!-- Vue component rendering layer -->
    <div class="page-browser-vue-layer">
      <template v-if="vueComponents.length > 0">
        <component
          :is="item.componentDef"
          v-for="item in vueComponents"
          :key="item.id"
          :style="item.style"
          v-bind="item.componentProps"
        />
      </template>
    </div>

    <!-- SVG rendering layer -->
    <div class="page-browser-svg-layer">
      <div
        v-for="g in svgGraphics"
        :key="g.id"
        :style="getGraphicStyle(g)"
        v-html="getGraphicHtml(g)"
      />
    </div>

    <!-- CSS rendering layer -->
    <div class="page-browser-css-layer">
      <div
        v-for="g in cssGraphics"
        :key="g.id"
        :style="getGraphicStyle(g)"
        v-html="getGraphicHtml(g)"
      />
    </div>

    <!-- Three.js rendering layer -->
    <div class="page-browser-three-layer">
      <div
        v-for="g in threeGraphics"
        :key="g.id"
        :ref="(el) => mountThreeGraphic(g, el as HTMLElement)"
        :style="getGraphicStyle(g)"
      />
    </div>

    <!-- Loading overlay -->
    <div
      v-show="loading"
      class="page-browser-loading"
    >
      <span>{{ t('page-browser.loading') }}</span>
    </div>

    <!-- Load-failure overlay -->
    <div
      v-show="error"
      class="page-browser-error"
    >
      <span>{{ error }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type PropType, type Component } from 'vue';
import type { IGraphic } from '@scada-editor/plugin-sdk';
import {
  RendererRegistry,
} from '@scada-editor/core';
import {
  GraphicFactory,
  RenderBackend,
  GraphicComponentRegistry,
} from '@scada-editor/plugin-sdk';
import { Canvas2DBackend, usePageStore, i18n, saveServiceManager } from '@scada-editor/core';
import { loadImageWithAuth } from '../../utils/loadImageWithAuth';

const { t } = i18n.global;

// ─── Props ───
const props = defineProps({
  pageName: { type: String, default: '' },
  displayMode: { type: String as () => 'tile' | 'actual' | 'stretch', default: 'stretch' },
  borderStyle: { type: String as () => 'none' | 'solid' | 'dashed' | 'dotted', default: 'solid' },
  borderWidth: { type: Number, default: 1 },
  borderColor: { type: String, default: '#CCCCCC' },
  backgroundColor: { type: String, default: '#FFFFFF' },
  width: { type: Number, default: 400 },
  height: { type: Number, default: 300 },
  /** Page data load-complete callback: resize PageBrowser to the target page size so the selection box matches the actual content */
  onPageLoaded: { type: Function as PropType<(pageWidth: number, pageHeight: number) => void>, default: null },
});

// ─── Status ───
const rootRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const pageWidth = ref(800);
const pageHeight = ref(600);
const loading = ref(false);
const error = ref<string | null>(null);

// Page background — read from target page data; defaults to transparent when unset
const pageBackgroundColor = ref<string | null>(null);
const pageBackgroundImage = ref<string | null>(null);
const pageBackgroundImageEl = ref<HTMLImageElement | null>(null);

// Graphics after categorization
const canvas2dGraphics = ref<IGraphic[]>([]);
const vueGraphics = ref<IGraphic[]>([]);
const svgGraphics = ref<IGraphic[]>([]);
const cssGraphics = ref<IGraphic[]>([]);
const threeGraphics = ref<IGraphic[]>([]);

// Zoom (zoomX/zoomY support non-uniform stretch)
const zoomX = ref(1);
const zoomY = ref(1);

// Canvas2DBackend
let canvasBackend: Canvas2DBackend | null = null;

// Three.js mount record
const threeMounts = new Map<string, HTMLElement>();

// Container size listener
let resizeObserver: ResizeObserver | null = null;

// ─── Zoom calculation ───
function recalculateZoom(): void {
  if (pageWidth.value <= 0 || pageHeight.value <= 0) return;

  const cw = rootRef.value?.clientWidth || props.width;
  const ch = rootRef.value?.clientHeight || props.height;

  if (props.displayMode === 'stretch') {
    zoomX.value = cw / pageWidth.value;
    zoomY.value = ch / pageHeight.value;
  } else if (props.displayMode === 'tile') {
    const z = Math.min(cw / pageWidth.value, ch / pageHeight.value);
    zoomX.value = z;
    zoomY.value = z;
  } else {
    zoomX.value = 1;
    zoomY.value = 1;
  }
}

// ─── Computed style ───
const rootStyle = computed(() => ({
  width: '100%',
  height: '100%',
  border: props.borderStyle !== 'none'
    ? `${props.borderWidth}px ${BORDER_STYLE_MAP[props.borderStyle]} ${props.borderColor}`
    : 'none',
  backgroundColor: pageBackgroundColor.value || 'transparent',
  overflow: 'hidden',
  position: 'relative' as const,
}));

const canvasStyle = computed(() => {
  if (props.displayMode === 'stretch') {
    // Stretch to full screen: does not preserve ratio; X/Y scaling computed separately
    return {
      transform: `scale(${zoomX.value}, ${zoomY.value})`,
      transformOrigin: 'top left',
      width: `${pageWidth.value}px`,
      height: `${pageHeight.value}px`,
    };
  }
  if (props.displayMode === 'tile') {
    const cw = rootRef.value?.clientWidth || props.width;
    const ch = rootRef.value?.clientHeight || props.height;
    const scale = Math.min(cw / pageWidth.value, ch / pageHeight.value);
    return {
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
      width: `${pageWidth.value}px`,
      height: `${pageHeight.value}px`,
    };
  }
  return {
    width: `${pageWidth.value}px`,
    height: `${pageHeight.value}px`,
  };
});

const BORDER_STYLE_MAP: Record<string, string> = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
};

// ─── Vue component list ───
const vueComponents = computed(() => {
  return vueGraphics.value
    .filter((g: any) => g.componentName)
    .map((g: any) => {
      const def = GraphicComponentRegistry.get(g.componentName);
      if (!def) return null;
      return {
        id: g.id,
        componentDef: def,
        style: getGraphicStyle(g),
        componentProps: g.getComponentProps?.() || {},
      };
    })
    .filter(Boolean) as Array<{ id: string; componentDef: Component; style: Record<string, string>; componentProps: Record<string, any> }>;
});

// ─── Graphic style ───
function getGraphicStyle(g: any): Record<string, string> {
  const pos = g.getPosition?.() || g.config?.geometry || { x: 0, y: 0 };
  const size = g.getSize?.() || g.config?.geometry || { width: 0, height: 0 };
  const rotation = g.getRotation?.() ?? g.config?.geometry?.rotation ?? 0;
  return {
    position: 'absolute',
    left: `${pos.x * zoomX.value}px`,
    top: `${pos.y * zoomY.value}px`,
    width: `${size.width * zoomX.value}px`,
    height: `${size.height * zoomY.value}px`,
    transform: `rotate(${rotation}deg)`,
    pointerEvents: 'none',
    overflow: 'hidden',
  };
}

// ─── SVG/CSS graphic HTML ───
function getGraphicHtml(g: any): string {
  if (typeof g.getSvgTemplate === 'function') {
    return g.getSvgTemplate(g.props);
  }
  if (typeof g.getHtmlTemplate === 'function') {
    return g.getHtmlTemplate(g.props);
  }
  return '';
}

// ─── Three.js graphic mount ───
function mountThreeGraphic(g: any, el: HTMLElement | null): void {
  if (!el || threeMounts.has(g.id)) return;
  threeMounts.set(g.id, el);
  if (typeof g.mount === 'function') {
    g.mount(el);
  }
}

// ─── Graphic category ───
function classifyGraphics(graphics: IGraphic[]): void {
  const c2d: IGraphic[] = [];
  const vue: IGraphic[] = [];
  const svg: IGraphic[] = [];
  const css: IGraphic[] = [];
  const three: IGraphic[] = [];

  for (const g of graphics) {
    try {
      const backend = RendererRegistry.getBackendForPlugin(g as any);
      switch (backend) {
        case RenderBackend.CANVAS_2D:     c2d.push(g); break;
        case RenderBackend.VUE_COMPONENT:  vue.push(g); break;
        case RenderBackend.SVG_DOM:       svg.push(g); break;
        case RenderBackend.CSS_DOM:       css.push(g); break;
        case RenderBackend.THREE_3D:      three.push(g); break;
      }
    } catch {
      c2d.push(g);
    }
  }

  canvas2dGraphics.value = c2d.sort((a, b) => (a.config?.zIndex ?? 0) - (b.config?.zIndex ?? 0));
  vueGraphics.value = vue;
  svgGraphics.value = svg;
  cssGraphics.value = css;
  threeGraphics.value = three;
}

// ─── Load page data ───
async function loadPageData(): Promise<void> {
  if (!props.pageName) return;

  loading.value = true;
  error.value = null;

  try {
    // Look up in pageStore (open pages) — prefer in-memory data
    let targetPageData: { width: number; height: number; graphics: any[] } | null = null;
    const pageStore = usePageStore();
    const targetPage = pageStore.pages.find(p => p.name === props.pageName);

    if (targetPage) {
      targetPageData = {
        width: targetPage.width || 800,
        height: targetPage.height || 600,
        graphics: (targetPage.graphics || []) as any[],
      };
      pageBackgroundColor.value = targetPage.backgroundColor || null;
      pageBackgroundImage.value = targetPage.backgroundImage || null;
    }

    // When not found in pageStore, try loading the specified page from project persisted data
    if (!targetPageData) {
      try {
        const projectData = await saveServiceManager.load();
        if (projectData?.pages) {
          const pageData = projectData.pages.find(p => p.name === props.pageName);
          if (pageData) {
            targetPageData = {
              width: pageData.width,
              height: pageData.height,
              graphics: pageData.graphics || [],
            };
            pageBackgroundColor.value = pageData.backgroundColor || null;
            pageBackgroundImage.value = pageData.backgroundImage || null;
          }
        }
      } catch {
        // If the save service is unavailable or uninitialized, handle silently
      }
    }

    // Neither method found it; report that the page does not exist
    if (!targetPageData) {
      error.value = props.pageName + t('page-browser.errors.pageNotFound');
      loading.value = false;
      return;
    }

    pageWidth.value = targetPageData.width || 800;
    pageHeight.value = targetPageData.height || 600;

    // Deserialize graphic
    // Note: the graphics from pageStore are already IGraphic instances (deserialized by BasePage.fromJSON),
    // Must first convert back to raw JSON via toJSON() before deserializing; otherwise createGraphicFromJSON cannot correctly extract geometry info.
    const rawGraphics = targetPageData.graphics || [];

    const allGraphics = rawGraphics
      .map((g: any) => {
        try {
          const jsonData = typeof g.toJSON === 'function' ? g.toJSON() : g;
          return GraphicFactory.createGraphicFromJSON(jsonData);
        }
        catch (e) {
          console.warn(`[PageBrowser] Failed to create graphic:`, typeof g.toJSON === 'function' ? g.type : g?.type, e);
          return null;
        }
      })
      .filter(Boolean) as IGraphic[];

    // Category
    classifyGraphics(allGraphics);

    // Compute zoom (based on actual container size, ensuring consistency with editor zoom)
    recalculateZoom();

    // Preload the page background image
    await preloadPageBackgroundImage();

    await nextTick();
    initCanvasBackend();
    syncCanvasGraphics();

    // Notify the external page that loading is complete and auto-resize PageBrowser to the target page size
    // Make the selection box in the editor match the actual page content size
    if (typeof props.onPageLoaded === 'function') {
      props.onPageLoaded(pageWidth.value, pageHeight.value);
    }
  } catch (err: any) {
    error.value = err?.message || t('page-browser.errors.loadFailed');
    console.warn(`[PageBrowser] Failed to load page: ${props.pageName}`, err);
  } finally {
    loading.value = false;
  }
}

// ─── Preload the page background image ───
async function preloadPageBackgroundImage(): Promise<void> {
  pageBackgroundImageEl.value = null;
  const src = pageBackgroundImage.value;
  if (!src) return;

  try {
    const img = await loadImageWithAuth(src);
    pageBackgroundImageEl.value = img;
  } catch {
    console.warn(`[PageBrowser] Failed to load background image: ${src}`);
  }
}

// ─── Canvas2DBackend ───
function initCanvasBackend(): void {
  if (canvasBackend) {
    canvasBackend.destroy();
  }

  if (!canvasRef.value) {
    console.warn('[PageBrowser] canvasRef not available');
    return;
  }

  canvasBackend = new Canvas2DBackend(canvasRef.value as HTMLElement, {
    canvas: canvasRef.value,
    width: pageWidth.value,
    height: pageHeight.value,
    renderMode: 'canvas',
    onBackgroundRender: (ctx: CanvasRenderingContext2D) => {
      // Draw the background color (stay transparent when no background color; do not fill)
      const bgColor = pageBackgroundColor.value;
      if (bgColor && bgColor !== 'transparent') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, pageWidth.value, pageHeight.value);
      }
      // Draw the background image (async load; appears automatically on the next frame once loaded)
      const bgImage = pageBackgroundImageEl.value;
      if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
        ctx.drawImage(bgImage, 0, 0, pageWidth.value, pageHeight.value);
      }
    },
  });
}

function syncCanvasGraphics(): void {
  if (!canvasBackend) return;
  for (const g of canvas2dGraphics.value) {
    canvasBackend.render(g);
  }
}

// ─── Lifecycle ───
onMounted(async () => {
  await nextTick();

  // Watch container size change (auto-recompute zoom on editor zoom / geometry adjust)
  if (rootRef.value) {
    resizeObserver = new ResizeObserver(() => {
      recalculateZoom();
    });
    resizeObserver.observe(rootRef.value);
  }

  await loadPageData();
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (canvasBackend) {
    canvasBackend.destroy();
    canvasBackend = null;
  }
  // Unmount Three.js graphics
  for (const [id, _el] of threeMounts) {
    const g = threeGraphics.value.find(g => g.id === id);
    if (g && typeof (g as any).unmount === 'function') {
      (g as any).unmount();
    }
  }
  threeMounts.clear();
});

// Watch pageName change
watch(() => props.pageName, () => { loadPageData(); });

// Watch pageStore.pages change; retry when page data finishes loading
// Fix the issue where preview-mode pageStore lazy loading causes the target page to be not found
watch(
  () => usePageStore().pages.map(p => p.name),
  () => {
    if (error.value && props.pageName) {
      loadPageData();
    }
  },
);

// Watch displayMode change
watch(() => props.displayMode, () => {
  recalculateZoom();
});

// Watch geometry change
watch(() => [props.width, props.height], () => {
  if (pageWidth.value > 0 && pageHeight.value > 0) {
    recalculateZoom();
  }
});
</script>

<style scoped>
.page-browser {
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}

.page-browser-canvas {
  display: block;
  position: absolute;
  top: 0;
  left: 0;
}

.page-browser-vue-layer,
.page-browser-svg-layer,
.page-browser-css-layer,
.page-browser-three-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 10;
}

.page-browser-loading,
.page-browser-error {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #999;
  background: rgba(255, 255, 255, 0.85);
  z-index: 100;
}

.page-browser-error {
  color: #FF4444;
}
</style>