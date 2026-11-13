<template>
  <div class="preview-view">
    <!-- Error/loading state UI -->
    <div
      v-if="!isReady && !hasError"
      class="preview-loading"
    >
      <SsLoading :text="t('editor.loadingPreview')" />
    </div>

    <div
      v-else-if="hasError"
      class="preview-error"
    >
      <div class="error-icon">
        ⚠️
      </div>
      <div class="error-title">
        {{ errorTitle }}
      </div>
      <div class="error-message">
        {{ errorMessage }}
      </div>
      <div
        v-if="errorHint"
        class="error-hint"
      >
        {{ errorHint }}
      </div>
      <button
        class="back-button"
        @click="goBack"
      >
        {{ t('editor.backToEditor') }}
      </button>
    </div>

    <!-- Normal preview UI -->
    <PreviewCanvas
      v-else
      :width="previewWidth"
      :height="previewHeight"
      :show-controls="false"
      :carousel-config="carouselConfig"
      @carousel-config-changed="handleCarouselConfigChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { PreviewCanvas } from '@scada-editor/editor';
import {
  usePageStore,
  BasePage,
  KeyboardContext,
  keyboardService,
  loadAllPagesData,
  validatePageData,
  i18n,
  DEFAULT_CAROUSEL_CONFIG,
  type CarouselConfig,
  ScadaDataManager,
  BindingManager,
} from '@scada-editor/core';
import { pageApi, projectApi, usePageDataSourceStore } from '@scada-editor/system';
import { SsLoading } from '@scada-editor/shared';
import { pluginReady } from '../plugins';
import { useDataSourceLifecycle } from '../composables/useDataSourceLifecycle';

// Narrow the t signature via unknown assertion: destructuring i18n.global triggers deep type instantiation of the vue-i18n messages literal schema (TS2589)
const t = (key: string): string =>
  (i18n.global as unknown as { t: (key: string) => string }).t(key);
const route = useRoute();

const pageStore = usePageStore();

// Preview size — fill the entire window
const previewWidth = ref(window.innerWidth);
const previewHeight = ref(window.innerHeight);

// State management
const isReady = ref(false);
const hasError = ref(false);
const errorTitle = ref('');
const errorMessage = ref('');
const errorHint = ref('');

// Carousel config (loaded from the project's projectinfo.json)
const carouselConfig = ref<CarouselConfig>({ ...DEFAULT_CAROUSEL_CONFIG });

// Show error
const showError = (title: string, message: string, hint?: string) => {
  hasError.value = true;
  isReady.value = false;
  errorTitle.value = title;
  errorMessage.value = message;
  errorHint.value = hint || '';
};

// Return to editor
const goBack = () => {
  window.close();
  // If it cannot be closed (not opened via window.open), try returning to history
  if (window.history.length > 1) {
    window.history.back();
  }
};

// Window resize handling
const handleResize = () => {
  previewWidth.value = window.innerWidth;
  previewHeight.value = window.innerHeight;
};

// Restore all page data from IndexedDB for graphics like PageBrowser to use in preview
const restoreAllPages = async () => {
  try {
    const allPages = await loadAllPagesData();
    if (!allPages || allPages.length === 0) return;

    const restoredPages = allPages.map((item: any) => {
      const page = new BasePage();
      page.init({
        id: item.data?.id || 'preview-page',
        name: item.data?.name || item.name || 'Preview Page',
        width: item.data?.width || 1920,
        height: item.data?.height || 1080,
        backgroundColor: item.data?.backgroundColor || '#FFFFFF',
      });
      page.fromJSON(item.data);
      return page;
    });

    if (restoredPages.length > 0) {
      // Keep the current page (main page loaded from backend); merge in other pages (for PageBrowser use)
      const currentPage = pageStore.currentPage;
      const mergedPages = [currentPage, ...restoredPages.filter(p => p.id !== currentPage?.id)].filter(Boolean) as NonNullable<typeof currentPage>[];
      pageStore.pages = mergedPages;
    }
  } catch (e) {
    console.warn('[PreviewView] Failed to restore all pages:', e);
  }
};

// Template-mode only: restore page data from IndexedDB
const restoreFromIndexedDB = async (pageName?: string) => {
  try {
    const allPages = await loadAllPagesData();
    if (!allPages || allPages.length === 0) {
      showError(
        t('preview.cannotLoadPreview'),
        t('preview.dataNotFound'),
        t('preview.previewHint')
      );
      return;
    }

    // Find a matching page, or use the first
    const matchedPage = pageName
      ? allPages.find((p: any) => (p.data?.name || p.name) === pageName)
      : allPages[0];
    const pageData = matchedPage?.data || allPages[0]?.data;

    if (!pageData) {
      showError(
        t('preview.cannotLoadPreview'),
        t('preview.dataNotFound'),
        t('preview.previewHint')
      );
      return;
    }

    const tempPage = new BasePage();
    tempPage.init({
      id: pageData.id || 'preview-page',
      name: pageData.name || 'Preview Page',
      width: pageData.width || window.innerWidth,
      height: pageData.height || window.innerHeight,
      backgroundColor: pageData.backgroundColor || '#FFFFFF',
    });
    tempPage.fromJSON(pageData);

    // Restore all pages to the store
    const restoredPages = allPages.map((item: any) => {
      const page = new BasePage();
      page.init({
        id: item.data?.id || item.name || 'preview-page',
        name: item.data?.name || item.name || 'Preview Page',
        width: item.data?.width || 1920,
        height: item.data?.height || 1080,
        backgroundColor: item.data?.backgroundColor || '#FFFFFF',
      });
      page.fromJSON(item.data);
      return page;
    });

    pageStore.pages = restoredPages;
    pageStore.currentPageId = tempPage.id;

    // ── Unified data-source scheduling: template mode has no projectId, use a temporary ID ──
    await initDataSourceManager(tempPage, 'template-mode');

    nextTick(() => {
      isReady.value = true;
      hasError.value = false;
    });
  } catch (error) {
    console.error('[PreviewView] Failed to load from IndexedDB:', error);
    showError(
      t('preview.cannotLoadPreview'),
      t('preview.dataNotFound'),
      t('preview.previewHint')
    );
  }
};

// Load page data from the backend API or IndexedDB
const restorePageFromStorage = async () => {
  const mode = route.query.mode as string | undefined;
  const projectId = route.query.projectId as string | undefined;
  const pageName = route.query.pageName as string | undefined;
  const groupName = route.query.group as string | undefined;

  // One-time ticket auth bridge (plan 06 route B #2): mobile (uni-app H5/App) uses a Bearer session
  // The signed ticket is passed via URL; this shell first exchanges it for a Bearer Token (in memory), then loads page data that requires auth.
  // Exchange failure does not block: if this shell already has a Bearer session (e.g. opened directly in a browser), loading still works.
  const previewTicket = route.query.ticket as string | undefined;
  if (previewTicket) {
    await exchangePreviewTicket(previewTicket);
  }

  // Template mode: load directly from IndexedDB, without depending on the backend project API
  if (mode === 'template') {
    await restoreFromIndexedDB(pageName);
    return;
  }

  if (!projectId || !pageName) {
    showError(
      t('preview.cannotLoadPreview'),
      t('preview.dataNotFound'),
      t('preview.previewHint')
    );
    return;
  }

  try {
    const response = await pageApi.readPage(projectId, pageName, groupName);
    // The backend response may have multiple wrapper layers:
    //   No interceptor: { success: true, data: pageJSON }
    //   With interceptor: { data: { success: true, data: pageJSON }, message, timestamp }
    const pageResult = (response as any)?.data || (response as any);
    const pageData = pageResult?.data;

    if (!pageData) {
      showError(
        t('preview.cannotLoadPreview'),
        t('preview.dataNotFound'),
        t('preview.previewHint')
      );
      return;
    }

    const validation = validatePageData(pageData);
    if (!validation.valid) {
      showError(
        t('preview.dataValidationFailed'),
        validation.message || t('preview.dataFormatInvalid'),
        t('preview.regenerateHint')
      );
      return;
    }

    const tempPage = new BasePage();
    tempPage.init({
      id: pageData.id || 'preview-page',
      name: pageData.name || 'Preview Page',
      width: pageData.width || window.innerWidth,
      height: pageData.height || window.innerHeight,
      backgroundColor: pageData.backgroundColor || '#FFFFFF',
    });

    tempPage.fromJSON(pageData);
    // Set projectId to resolve background-image relative paths (e.g. bg.png) in PreviewCanvas
    // Scenarios that resolve to /api/v1/projects/{projectId}/pages/{pageName}/bg.png
    (tempPage as any).projectId = projectId;

    // Set the current page first
    pageStore.pages = [tempPage];
    pageStore.currentPageId = tempPage.id;

    // Restore all page data from IndexedDB for graphics like PageBrowser
    await restoreAllPages();

    // ── Unified data-source scheduling: initialize DataSourceManager ──
    // Must pass tempPage (a BasePage instance with getGraphicById), not the raw JSON pageData
    // Otherwise getGraphicById returns undefined when BindingManager registers, and all bindings are skipped
    await initDataSourceManager(tempPage, projectId);

    // Load carousel config from the project's projectinfo.json
    await loadCarouselConfig(projectId);

    nextTick(() => {
      isReady.value = true;
      hasError.value = false;
    });

  } catch (error) {
    console.error('[PreviewView] Failed to load page from backend:', error);
    showError(
      t('preview.cannotLoadPreview'),
      t('preview.dataNotFound'),
      t('preview.previewHint')
    );
  }
};

/**
 * Unified data-source scheduling: start DataSourceManager via ScadaDataManager.initPage,
 * whose internal WebSocketDriver / HttpPollingDriver / SqlQueryDriver, etc. take over the lifecycle of all data sources.
 *
 * Data flow: ws/api/sql driver → DataSourceManager._onDataReceived → EventBus.emit('tagValueChanged')
 *        → BindingManager.handleDataUpdate → graphic property update.
 *
 * Once wsStore.flushTagUpdates detects that WebSocketDriver registered an onFlushed listener,
 * it no longer emits EventBus directly, avoiding double triggering.
 *
 * Implementation extracted into the useDataSourceLifecycle composable, shared by PreviewView/EditorView.
 */
const { initDataSourceLifecycle, destroyDataSourceLifecycle } = useDataSourceLifecycle();

const initDataSourceManager = async (pageData: any, projectId: string) => {
  await initDataSourceLifecycle(pageData, projectId, 'PreviewView');
};

/**
 * Load carousel config from the project's projectinfo.json
 */
const loadCarouselConfig = async (projectId: string) => {
  try {
    const project = await projectApi.getById(projectId);
    const result = (project as any)?.data || project;
    const projectData = result?.data || result;
    if (projectData?.config?.carousel) {
      carouselConfig.value = {
        ...DEFAULT_CAROUSEL_CONFIG,
        ...projectData.config.carousel,
      };
    }
  } catch (err) {
    console.warn('[PreviewView] 加载轮播配置失败，使用默认配置:', err);
  }
};

/**
 * Persist carousel config to the project's projectinfo.json
 */
const handleCarouselConfigChanged = async (config: CarouselConfig) => {
  carouselConfig.value = { ...config };
  const projectId = route.query.projectId as string;
  if (!projectId) return;
  try {
    await projectApi.update(projectId, { config: { carousel: config } });
  } catch (err) {
    console.warn('[PreviewView] 保存轮播配置失败:', err);
  }
};

/**
 * Exchange a one-time preview ticket for a Bearer session credential (backend POST /auth/preview-ticket-exchange).
 *
 * Auth mode: Bearer Token (returned in response body). The in-shell axios interceptor reads the token from memory and injects it into the
 * `Authorization` header; JwtStrategy already supports reading the token from this header.
 *
 * Background: originally an HttpOnly Cookie (SameSite=Strict) was set, which only fits "shell and H5 same-origin deployment".
 * Now the H5 iframe connects directly to the remote 8080 shell (cross-origin), so the browser treats it as a third-party Cookie and blocks it → 401.
 * Switching to Bearer works cross-origin; the token is kept in memory (consistent with client.ts S-C03).
 *
 * After success, remove the ticket param from the address bar (the ticket is single-use; leaving it in the URL only misleads refresh retries and risks leakage).
 */
const exchangePreviewTicket = async (previewTicket: string) => {
  try {
    const response = await fetch('/api/v1/auth/preview-ticket-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ previewTicket }),
    });
    if (!response.ok) {
      console.warn('[PreviewView] 预览票据兑换失败，回退既有会话:', response.status);
      return;
    }
    const data = await response.json();
    // The backend wraps it via the global TransformInterceptor into { code, data: { accessToken, refreshToken }, message }
    const tokenPair = data?.data ?? data;
    if (tokenPair?.accessToken && tokenPair?.refreshToken) {
      const { setToken, setRefreshToken } = await import('@scada-editor/system');
      setToken(tokenPair.accessToken);
      setRefreshToken(tokenPair.refreshToken);
    }
  } catch (error) {
    console.warn('[PreviewView] 预览票据兑换请求异常，回退既有会话:', error);
  } finally {
    const cleanedUrl = new URL(window.location.href);
    cleanedUrl.searchParams.delete('ticket');
    window.history.replaceState(null, '', cleanedUrl.toString());
  }
};

onMounted(async () => {
  await pluginReady;

  setTimeout(async () => {
    await restorePageFromStorage();
  }, 100);

  keyboardService.startListening();
  keyboardService.setContext(KeyboardContext.PREVIEW);
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  // ── Unified data-source scheduling: clean up DataSourceManager ──
  destroyDataSourceLifecycle();

  // Stop listening to keyboard events
  keyboardService.stopListening();
  // Clear preview-related key bindings
  keyboardService.unregisterContext(KeyboardContext.PREVIEW);
  // Restore the keyboard context to global mode
  keyboardService.setContext(KeyboardContext.GLOBAL);
  // Remove listeners
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
.preview-view {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background-color: var(--background, #1a1a1a);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Loading state */
.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Error state */
.preview-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-primary, #e2e8f0);
  text-align: center;
  max-width: 400px;
  padding: 24px;
}

.error-icon {
  font-size: 48px;
}

.error-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--danger, #ef4444);
}

.error-message {
  font-size: 14px;
  opacity: 0.9;
}

.error-hint {
  font-size: 13px;
  opacity: 0.7;
  margin-top: 8px;
}

.back-button {
  margin-top: 16px;
  padding: 10px 24px;
  background-color: var(--primary, #3b82f6);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.back-button:hover {
  background-color: var(--primary-dark, #2563eb);
}

/* Canvas style */
:deep(.preview-canvas-container) {
  border: none !important;
  border-radius: 0 !important;
  width: 100% !important;
  height: 100% !important;
}

:deep(.preview-canvas-container .preview-controls) {
  display: none !important;
}

/* Keep overflow:auto: fitWidth/fitHeight expanded bitmaps need native scroll to hold them; forcing hidden would clip content */
:deep(.preview-canvas-container .canvas-wrapper.no-controls) {
  padding: 0 !important;
  height: 100% !important;
  width: 100% !important;
}
</style>
