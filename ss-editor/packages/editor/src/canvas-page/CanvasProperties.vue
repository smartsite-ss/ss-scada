<template>
  <div class="style-panel-content">
    <!-- Canvas size settings -->
    <div class="property-group">
      <label>{{ $t('canvasProperties.canvasSize') }}</label>
      <div class="canvas-size-container">
        <div class="canvas-size-item">
          <span>{{ $t('canvasProperties.width') }}</span>
          <ValueAdjuster
            v-model="props.pageProperties.width"
            :step="10"
            :min="100"
            input-width="80"
            @update:model-value="updatePageProperties"
          />
        </div>
        <div class="canvas-size-item">
          <span>{{ $t('canvasProperties.height') }}</span>
          <ValueAdjuster
            v-model="props.pageProperties.height"
            :step="10"
            :min="100"
            input-width="80"
            @update:model-value="updatePageProperties"
          />
        </div>
      </div>
    </div>
    
    <!-- Background settings -->
    <div class="property-group">
      <label>{{ $t('canvasProperties.backgroundSettings') }}</label>
      
      <!-- Background image upload -->
      <div class="property-item background-upload-container">
        <div class="background-upload-area">
          <input
            type="file"
            accept="image/*"
            class="background-upload-input"
            @change="handleBackgroundImageUpload"
          >
          <div 
            class="background-upload-placeholder" 
            :style="{ backgroundImage: canvasBackgroundImage ? `url(${canvasBackgroundImage})` : 'none' }"
          >
            <div
              v-if="!canvasBackgroundImage"
              class="background-upload-content"
            >
              <div class="background-upload-icon">
                📷
              </div>
              <div class="background-upload-text">
                {{ $t('canvasProperties.clickToUpload') }}
              </div>
            </div>
          </div>
        </div>
        <p class="background-upload-hint">
          {{ $t('canvasProperties.backgroundImageHint') }}
        </p>
      </div>
      
      <!-- Background color -->
      <div class="property-item">
        <span>{{ $t('canvasProperties.backgroundColor') }}</span>
        <ColorPicker
          :model-value="props.pageProperties.backgroundColor"
          @color-change="handleBackgroundColorChange"
        />
      </div>
      
      <!-- App type -->
      <div class="property-item">
        <span>{{ $t('canvasProperties.applicationType') }}</span>
        <select
          v-model="canvasApplicationType"
          @change="updateCanvasApplicationType"
        >
          <option value="applicationColor">
            {{ $t('canvasProperties.applicationColor') }}
          </option>
          <option value="applicationImage">
            {{ $t('canvasProperties.applicationImage') }}
          </option>
        </select>
      </div>
      
      <!-- Background control button -->
      <div class="property-item background-control-buttons">
        <button
          class="btn btn--text"
          @click="clearBackgroundImage"
        >
          {{ $t('canvasProperties.clearBackground') }}
        </button>
        <button
          class="btn btn--text"
          @click="clearBackgroundColor"
        >
          {{ $t('canvasProperties.clearColor') }}
        </button>
      </div>
    </div>
    
    <!-- Renderer selection -->
    <div class="property-group">
      <label>{{ $t('canvasProperties.rendererMode') }}</label>
      <div class="property-item">
        <select
          v-model="renderMode"
          class="renderer-select"
          @change="updateRenderMode"
        >
          <option value="canvas">
            {{ $t('canvasProperties.canvasRenderer') }}
          </option>
          <option value="konva">
            {{ $t('canvasProperties.konvaRenderer') }}
          </option>
          <option value="svg">
            {{ $t('canvasProperties.svgRenderer') }}
          </option>
          <option value="webgl">
            {{ $t('canvasProperties.webglRenderer') }}
          </option>
        </select>
      </div>
      <p class="renderer-hint">
        {{ getRendererHint() }}
      </p>
    </div>
    
    <!-- Selection mode -->
    <div class="property-group">
      <label>{{ $t('canvasProperties.selectionMode') }}</label>
      <div class="property-item">
        <select
          v-model="selectionMode"
          class="selection-mode-select"
          @change="updateSelectionMode"
        >
          <option value="dom">
            {{ $t('canvasProperties.domSelection') }}
          </option>
          <option value="canvas">
            {{ $t('canvasProperties.canvasSelection') }}
          </option>
        </select>
      </div>
    </div>
    
    <!-- Window fit mode (runtime) -->
    <div class="property-group">
      <label>{{ $t('canvasProperties.viewportFit') }}</label>
      <div class="property-item viewport-fit-buttons">
        <button 
          :class="{ active: viewportFitMode === 'auto', 'viewport-fit-button': true }" 
          :title="viewportFitMode === 'auto' ? `🤖 ${$t('canvasProperties.autoFit')}（${$t('canvasProperties.current')}）` : `🤖 ${$t('canvasProperties.autoFit')}：${$t('canvasProperties.autoFitDesc')}`"
          @click="viewportFitMode = 'auto'; updateViewportFitMode()"
        >
          🤖
        </button>
        <button 
          :class="{ active: viewportFitMode === 'contain', 'viewport-fit-button': true }" 
          :title="viewportFitMode === 'contain' ? `📦 ${$t('canvasProperties.containFit')}（${$t('canvasProperties.current')}）` : `📦 ${$t('canvasProperties.containFit')}：${$t('canvasProperties.containFitDesc')}`"
          @click="viewportFitMode = 'contain'; updateViewportFitMode()"
        >
          📦
        </button>
        <button 
          :class="{ active: viewportFitMode === 'fitWidth', 'viewport-fit-button': true }" 
          :title="viewportFitMode === 'fitWidth' ? `↔️ ${$t('canvasProperties.fitWidth')}（${$t('canvasProperties.current')}）` : `↔️ ${$t('canvasProperties.fitWidth')}：${$t('canvasProperties.fitWidthDesc')}`"
          @click="viewportFitMode = 'fitWidth'; updateViewportFitMode()"
        >
          ↔️
        </button>
        <button 
          :class="{ active: viewportFitMode === 'fitHeight', 'viewport-fit-button': true }" 
          :title="viewportFitMode === 'fitHeight' ? `↕️ ${$t('canvasProperties.fitHeight')}（${$t('canvasProperties.current')}）` : `↕️ ${$t('canvasProperties.fitHeight')}：${$t('canvasProperties.fitHeightDesc')}`"
          @click="viewportFitMode = 'fitHeight'; updateViewportFitMode()"
        >
          ↕️
        </button>
        <button 
          :class="{ active: viewportFitMode === 'stretch', 'viewport-fit-button': true }" 
          :title="viewportFitMode === 'stretch' ? `⬜ ${$t('canvasProperties.stretchFit')}（${$t('canvasProperties.current')}）` : `⬜ ${$t('canvasProperties.stretchFit')}：${$t('canvasProperties.stretchFitDesc')}`"
          @click="viewportFitMode = 'stretch'; updateViewportFitMode()"
        >
          ⬜
        </button>
      </div>
      <p class="viewport-hint">
        {{ $t('canvasProperties.viewportDefaultHint') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { i18n, useConfigStore, resolveAssetPath } from '@scada-editor/core';
import { ColorPicker } from '@scada-editor/shared';
import ValueAdjuster from '../common/ValueAdjuster.vue';
import { showAlert } from '../utils/messageBox';

const { t } = i18n.global;

const props = defineProps<{
  pageProperties: any;
}>();

const emit = defineEmits<{
  updatePageProperties: [];
}>();

// Canvas properties
const canvasBackgroundImage = ref('');
const _canvasBackgroundColor = ref('#ffffff');
const canvasApplicationType = ref('applicationColor');
const _canvasFitMode = ref('stretch');
const renderMode = ref<'canvas' | 'konva' | 'svg' | 'webgl'>('canvas');
const viewportFitMode = ref<'auto' | 'contain' | 'fitWidth' | 'fitHeight' | 'stretch'>('auto');
const selectionMode = ref<'dom' | 'canvas'>('dom');

// Get the config store
const configStore = useConfigStore();

// Cache created object URLs for later release (must be declared before watch to avoid TDZ)
let bgObjectUrl: string | null = null;

/**
 * Load a background image with auth and return a blob URL (ensures CSS background-image can display auth-protected images)
 * Same logic as loadImageWithAuth, but returns a blob URL for CSS use instead of an Image object
 */
async function loadBgImageWithAuth(src: string): Promise<string> {
  const resolvedSrc = resolveAssetPath(src);
  // blob/data URLs require no auth
  if (resolvedSrc.startsWith('blob:') || resolvedSrc.startsWith('data:')) {
    return resolvedSrc;
  }
  try {
    // S-C03: Token is transmitted via HttpOnly Cookie, carried with credentials: 'include'
    const token = localStorage.getItem('scada_access_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(resolvedSrc, { credentials: 'include', headers });
    if (!response.ok) {
      // 404 means the image resource does not exist; clear it directly and stop retrying
      if (response.status === 404) {
        console.debug('[CanvasProperties] Background image asset missing (404), cleared:', resolvedSrc);
        return '';
      }
      throw new Error(`Failed to load background image (${response.status})`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn('[CanvasProperties] Authenticated background image load failed, falling back to direct URL:', err);
    return resolvedSrc;
  }
}

// Load config on component mount
onMounted(() => {
  renderMode.value = configStore.canvas.renderMode || 'canvas';
  if (props.pageProperties?.fitMode) {
    viewportFitMode.value = props.pageProperties.fitMode;
  }
});

// Watch page switch: sync the background image preview (use auth load so CSS background-image can display protected images)
watch(() => props.pageProperties?.backgroundImage, async (newBg) => {
  // If the new URL equals the current bgObjectUrl, it means it was set by the upload handler itself,
  // Skip the revoke operation to avoid revoking the blob URL just created
  if (newBg === bgObjectUrl) return;

  // Clean up the old object URL
  if (bgObjectUrl) {
    URL.revokeObjectURL(bgObjectUrl);
    bgObjectUrl = null;
  }
  if (newBg) {
    bgObjectUrl = await loadBgImageWithAuth(newBg);
    canvasBackgroundImage.value = bgObjectUrl;
  } else {
    canvasBackgroundImage.value = '';
  }
}, { immediate: true });

// Update renderer mode
const updateRenderMode = () => {
  configStore.updateCanvasConfig({ renderMode: renderMode.value });
  const rendererNames: Record<string, string> = {
    canvas: 'Canvas',
    konva: 'Konva',
    svg: 'SVG',
    webgl: 'WebGL',
  };
  showAlert(t('canvasProperties.rendererSwitched', { renderer: rendererNames[renderMode.value] || renderMode.value }), t('canvasProperties.tip'), 'info');
};

const getRendererHint = () => {
  const hints: Record<string, string> = {
    canvas: 'canvasHint',
    konva: 'konvaHint',
    svg: 'svgHint',
    webgl: 'webglHint',
  };
  return t(`canvasProperties.${hints[renderMode.value] || 'canvasHint'}`);
};

// Update page properties
const updatePageProperties = () => {
  if (props.pageProperties) {
    emit('updatePageProperties');
  }
};

// Handle background image upload
const handleBackgroundImageUpload = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    // Check file size
    if (file.size > 10 * 1024 * 1024) {
      await showAlert(i18n.global.t('canvasProperties.errorMessages.fileSizeError'), t('settings.error'), 'error');
      return;
    }
    // Check file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      await showAlert(i18n.global.t('canvasProperties.errorMessages.fileTypeError'), t('settings.error'), 'error');
      return;
    }
    // Release the old object URL
    if (bgObjectUrl) {
      URL.revokeObjectURL(bgObjectUrl);
    }
    // Convert the file to a base64 data URL for storage (replacing the blob URL)
    // blob URLs can become invalid due to revoke or GC, causing urlToBlob to fail to fetch data on save
    // data URL is self-contained and readable at any time; urlToBlob already supports data URL paths
    bgObjectUrl = await fileToDataUrl(file);
    canvasBackgroundImage.value = bgObjectUrl;
    // Selected an image background; switch to the applied-image type in sync
    canvasApplicationType.value = 'applicationImage';
    // Save the background image into the page properties
    if (props.pageProperties && typeof props.pageProperties.updatePageProperties === 'function') {
      props.pageProperties.updatePageProperties({
        backgroundImage: canvasBackgroundImage.value
      });
    } else if (props.pageProperties) {
      props.pageProperties.backgroundImage = canvasBackgroundImage.value;
    }
  }
};

/** Convert a File to a base64 data URL */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file as data URL'));
    reader.readAsDataURL(file);
  });
}

// Update the canvas background
const updateCanvasBackground = () => {
  // Here you can add logic to update the canvas background
};

const handleBackgroundColorChange = (color: string) => {
  props.pageProperties.backgroundColor = color;
  updateCanvasBackground();
};

// Update app type
const updateCanvasApplicationType = () => {
  // Here you can add logic to update the app type
};

// Clear background image
const clearBackgroundImage = () => {
  if (bgObjectUrl) {
    URL.revokeObjectURL(bgObjectUrl);
    bgObjectUrl = null;
  }
  canvasBackgroundImage.value = '';
  if (props.pageProperties && typeof props.pageProperties.updatePageProperties === 'function') {
    props.pageProperties.updatePageProperties({
      backgroundImage: ''
    });
  } else if (props.pageProperties) {
    props.pageProperties.backgroundImage = '';
  }
};

// Clear background color
const clearBackgroundColor = () => {
  if (props.pageProperties && typeof props.pageProperties.updatePageProperties === 'function') {
    props.pageProperties.updatePageProperties({
      backgroundColor: ''
    });
  } else if (props.pageProperties) {
    props.pageProperties.backgroundColor = '';
  }
};

// Update the window fit mode to the page
const updateViewportFitMode = () => {
  if (props.pageProperties && typeof props.pageProperties.updatePageProperties === 'function') {
    props.pageProperties.updatePageProperties({
      fitMode: viewportFitMode.value
    });
  }
};

// Update selection mode
const updateSelectionMode = () => {
  configStore.updateCanvasConfig({ useCanvasSelection: selectionMode.value === 'canvas' });
};
</script>

<style scoped>
@import '../panels/styles/property-panel.scss';

.property-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
  gap: 2px;
}

.property-section h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
  background-color: var(--background);
}

/* Background upload container */
.background-upload-container {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-sm);
}

/* Background upload area */
.background-upload-area {
  width: 100%;
  display: flex;
  justify-content: center;
  margin: var(--spacing-sm) 0;
  position: relative;
}

/* Background upload input */
.background-upload-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* Background upload placeholder */
.background-upload-placeholder {
  width: 120px;
  height: 120px;
  border: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
}

/* Background upload content */
.background-upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

/* Background upload icon */
.background-upload-icon {
  font-size: 24px;
  margin-bottom: 5px;
}

/* Background upload text */
.background-upload-text {
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
}

/* Background upload hint */
.background-upload-hint {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  width: 100%;
  margin: 0;
  cursor: help;
}

/* Background control button */
.background-control-buttons {
  flex-direction: row;
  gap: var(--spacing-sm);
  justify-content: center;
}

/* Fit-mode button */
.fit-mode-buttons {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  justify-content: center;
}

/* Fit-mode button */
.fit-mode-button {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background-color: var(--surface);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

/* Fit-mode button hover */
.fit-mode-button:hover {
  background-color: var(--control-button-hover);
  border-color: var(--primary);
}

/* Fit-mode button active */
.fit-mode-button.active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

/* Viewport-fit button container */
.viewport-fit-buttons {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  justify-content: center;
}

/* Viewport-fit button */
.viewport-fit-button {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background-color: var(--surface);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 16px;
}

/* Viewport-fit button hover */
.viewport-fit-button:hover {
  background-color: var(--control-button-hover);
  border-color: var(--primary);
}

/* Viewport-fit button active */
.viewport-fit-button.active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

/* Viewport hint */
.viewport-hint {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  margin: 4px 0 0 0;
}

/* Canvas size container */
.canvas-size-container {
  display: flex;
  gap: var(--spacing-xs);
  width: 100%;
  margin: 0;
  padding: 0;
}

/* compact property-group style */
.property-group {
  margin: 0 0 4px 0;
  padding: 4px 6px;
  gap: 4px;
  display: flex;
  flex-direction: column;
}

/* Canvas size item */
.canvas-size-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

/* Canvas size item label */
.canvas-size-item span {
  width: 40px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* Renderer selection box */
.renderer-select {
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--border);
  border-radius: 4px;
  background-color: var(--surface);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.renderer-select:hover {
  border-color: var(--primary);
}

.renderer-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

/* Renderer hint */
.renderer-hint {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 0;
  padding: 0 var(--spacing-xs);
  line-height: 1.4;
  opacity: 0.8;
}

/* Selection-mode dropdown */
.selection-mode-select {
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--border);
  border-radius: 4px;
  background-color: var(--surface);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.selection-mode-select:hover {
  border-color: var(--primary);
}

.selection-mode-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}
</style>