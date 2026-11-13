<template>
  <div 
    class="canvas-ruler-container"
    @contextmenu.prevent="handleContextMenu"
    @click="closeContextMenu"
  >
    <div
      v-if="showRuler"
      class="ruler-intersection"
    >
      <button 
        class="guide-line-toggle" 
        :class="{ 'active': showReferenceLines }"
        :title="$t('ruler.toggleGuideLines')"
        @click="handleToggleReferenceLines"
      >
        <span class="icon">👁️</span>
      </button>
    </div>
    
    <VerticalRuler
      v-if="showRuler"
      ref="verticalRulerRef"
      :canvas-width="canvasWidth"
      :canvas-height="canvasHeight"
      :scale="scale"
      :scroll-left="scrollLeft"
      :scroll-top="scrollTop"
      :mouse-position="mousePosition"
      :container-height="containerHeight"
      :canvas-origin-offset="canvasOriginOffsetY"
      :unit="unit"
      :grid-size="gridSize"
      @update-mouse-position="handleUpdateMousePosition"
      @create-guide-line="handleCreateGuideLine"
      @delete-last-guide-line="handleDeleteLastGuideLine"
      @keydown="handleRulerKeyDown"
    />
    
    <div
      ref="canvasContentWrapperRef"
      class="canvas-content-wrapper"
    >
      <HorizontalRuler
        v-if="showRuler"
        ref="horizontalRulerRef"
        :canvas-width="canvasWidth"
        :canvas-height="canvasHeight"
        :scale="scale"
        :scroll-left="scrollLeft"
        :scroll-top="scrollTop"
        :mouse-position="mousePosition"
        :container-width="containerWidth"
        :canvas-origin-offset="canvasOriginOffsetX"
        :unit="unit"
        :grid-size="gridSize"
        @update-mouse-position="handleUpdateMousePosition"
        @create-guide-line="handleCreateGuideLine"
        @delete-last-guide-line="handleDeleteLastGuideLine"
        @keydown="handleRulerKeyDown"
      />
      <slot />
    </div>
    
    <!-- Right-click context menu -->
    <Teleport to="body">
      <div 
        v-if="showContextMenu"
        class="ruler-context-menu"
        :style="{ top: `${contextMenuY}px`, left: `${contextMenuX}px` }"
        @click.stop
      >
        <div
          class="menu-item"
          @click="clearAllGuides"
        >
          <span class="menu-icon">🗑️</span> {{ $t('ruler.clearAllGuides') }}
        </div>
        <div
          class="menu-item"
          @click="toggleRulerVisibility"
        >
          <span class="menu-icon">{{ showRuler ? '🙈' : '👁️' }}</span> 
          {{ showRuler ? $t('ruler.hideRulers') : $t('ruler.showRulers') }}
        </div>
        <div class="menu-divider" />
        <div
          class="menu-item"
          @click="openSettings"
        >
          <span class="menu-icon">⚙️</span> {{ $t('ruler.settings') }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import VerticalRuler from './VerticalRuler.vue';
import HorizontalRuler from './HorizontalRuler.vue';

const { t: _t } = useI18n();

const PLM_PADDING = 20;
const HORIZONTAL_RULER_HEIGHT = 30;

// Ruler component reference (for Tab focus switching)
const verticalRulerRef = ref<InstanceType<typeof VerticalRuler> | null>(null);
const horizontalRulerRef = ref<InstanceType<typeof HorizontalRuler> | null>(null);
const canvasContentWrapperRef = ref<HTMLElement | null>(null);

// canvas-content-wrapper size (responsive)
const wrapperWidth = ref(0);
const wrapperHeight = ref(0);
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (canvasContentWrapperRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        wrapperWidth.value = entry.contentRect.width;
        wrapperHeight.value = entry.contentRect.height;
      }
    });
    resizeObserver.observe(canvasContentWrapperRef.value);
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

const props = withDefaults(defineProps<{
  showRuler?: boolean;
  showReferenceLines?: boolean;
  showAutoFitCentering?: boolean;  // Whether the canvas is centered (AutoFit mode)
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  scrollLeft: number;
  scrollTop: number;
  mousePosition: { x: number; y: number } | null;
  containerWidth?: number;   // Container visible width (for the horizontal viewport indicator)
  containerHeight?: number;  // Container visible height (for the vertical viewport indicator)
  unit?: string;            // P3: ruler unit (px/cm/inch/mm/m)
  gridSize?: number;        // P3: grid size (grid-linked highlight)
}>(), {
  showRuler: true,
  showReferenceLines: false,
  showAutoFitCentering: false,
  containerWidth: 0,
  containerHeight: 0,
});

// CSS-pixel offset of the canvas origin from the ruler edge (X: left horizontal-ruler edge, Y: top vertical-ruler edge)
const canvasOriginOffsetX = computed(() => {
  const baseOffset = PLM_PADDING;
  if (!props.showAutoFitCentering) return baseOffset;

  const canvasScaledWidth = props.canvasWidth * props.scale;
  const plmContentWidth = wrapperWidth.value - PLM_PADDING * 2;
  if (plmContentWidth <= 0 || canvasScaledWidth >= plmContentWidth) return baseOffset;

  return baseOffset + (plmContentWidth - canvasScaledWidth) / 2;
});

const canvasOriginOffsetY = computed(() => {
  const baseOffset = PLM_PADDING;
  if (!props.showAutoFitCentering) return baseOffset;

  const canvasScaledHeight = props.canvasHeight * props.scale;
  // PLM height = wrapper height − horizontal ruler height (30px)
  const plmHeight = wrapperHeight.value - HORIZONTAL_RULER_HEIGHT;
  const plmContentHeight = plmHeight - PLM_PADDING * 2;
  if (plmContentHeight <= 0 || canvasScaledHeight >= plmContentHeight) return baseOffset;

  return baseOffset + (plmContentHeight - canvasScaledHeight) / 2;
});

const emit = defineEmits<{
  'toggle-reference-lines': [];
  'update-mouse-position': [position: { x: number; y: number } | null];
  'create-guide-line': [position: number, direction: 'horizontal' | 'vertical'];
  'delete-last-guide-line': []; // Added: delete the last guide line
  'clear-all-guides': [];       // Added: clear all guide lines
  'toggle-ruler-visibility': []; // Added: toggle ruler show/hide
  'open-ruler-settings': [];     // Added: open ruler settings
}>();

// ===== Right-click context menu state =====
const showContextMenu = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

const handleToggleReferenceLines = () => {
  emit('toggle-reference-lines');
};

const handleUpdateMousePosition = (position: { x: number; y: number } | null) => {
  emit('update-mouse-position', position);
};

const handleCreateGuideLine = (position: number, direction: 'horizontal' | 'vertical') => {
  emit('create-guide-line', position, direction);
};

const handleDeleteLastGuideLine = () => {
  emit('delete-last-guide-line');
};

// ===== Right-click context menu handling =====
const handleContextMenu = (event: MouseEvent) => {
  event.preventDefault();
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  showContextMenu.value = true;
};

const closeContextMenu = () => {
  if (showContextMenu.value) {
    showContextMenu.value = false;
  }
};

const clearAllGuides = () => {
  emit('clear-all-guides');
  closeContextMenu();
};

const toggleRulerVisibility = () => {
  emit('toggle-ruler-visibility');
  closeContextMenu();
};

const openSettings = () => {
  emit('open-ruler-settings');
  closeContextMenu();
};

// ===== Tab focus switching (doc 10.3 plan) =====
// Switch focus between the vertical and horizontal rulers via Tab/Shift+Tab
type _RulerRef = { $el: HTMLElement } | null;
let activeRuler: 'vertical' | 'horizontal' = 'vertical';

const handleRulerKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Tab') {
    event.preventDefault();

    const targetRuler: 'vertical' | 'horizontal' =
      event.shiftKey
        ? (activeRuler === 'horizontal' ? 'vertical' : 'horizontal')
        : (activeRuler === 'vertical' ? 'horizontal' : 'vertical');

    activeRuler = targetRuler;

    // Use nextTick to ensure focus after the DOM updates
    setTimeout(() => {
      const targetEl = targetRuler === 'vertical'
        ? verticalRulerRef.value?.$el
        : horizontalRulerRef.value?.$el;
      targetEl?.focus();
    }, 0);
  }
};
</script>

<style scoped>
.canvas-ruler-container {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.ruler-intersection {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 100;
  width: 30px;
  height: 30px;
  background-color: var(--surface);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.guide-line-toggle {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background-color: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.guide-line-toggle:hover {
  background-color: var(--control-button-hover);
  border-color: var(--primary);
}

.guide-line-toggle.active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

.guide-line-toggle .icon {
  font-size: 12px;
}

.canvas-content-wrapper {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* ===== Right-click context menu style ===== */
.ruler-context-menu {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 0;
  min-width: 180px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  z-index: 9999;
  animation: menu-fade-in 0.15s ease-out;
}

@keyframes menu-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.menu-item {
  padding: 8px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
  transition: background-color 0.15s ease;
}

.menu-item:hover {
  background-color: var(--control-button-hover);
}

.menu-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}

.menu-divider {
  height: 1px;
  background-color: var(--border);
  margin: 4px 8px;
}
</style>
