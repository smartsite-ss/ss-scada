<template>
  <div>
    <!-- Floating toggle button -->
    <button
      v-if="!panelOpen"
      class="ai-fab"
      :style="fabStyle"
      :title="t('system.aiAssistant.openHint')"
      @click="panelOpen = true"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
        <path d="M8 12h.01M12 8h.01M16 12h.01M12 16h.01" />
      </svg>
    </button>

    <!-- Floating panel (reuses AiAssistantPanel's header as the drag handle) -->
    <div
      v-if="panelOpen"
      ref="panelRef"
      class="ai-floating-panel"
      :style="panelStyle"
    >
      <AiAssistantPanel @close="panelOpen = false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useConfigStore, useI18n } from '@scada-editor/core';
import AiAssistantPanel from './AiAssistantPanel.vue';

const { t } = useI18n();
const configStore = useConfigStore();

const panelOpen = ref(false);
const panelRef = ref<HTMLElement | null>(null);
// Drag handle element (.ai-header inside AiAssistantPanel)
let dragHeaderEl: HTMLElement | null = null;

// Panel position (pixels, relative to viewport)
const posX = ref<number>(0);
const posY = ref<number>(0);

// Drag state
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let panelStartX = 0;
let panelStartY = 0;

const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 520;
const MARGIN = 10;

/** Initial position: read from config or default to bottom-right */
function initPosition() {
  const savedX = configStore.ui?.aiAssistantX;
  const savedY = configStore.ui?.aiAssistantY;
  if (savedX != null && savedY != null) {
    posX.value = clampX(savedX);
    posY.value = clampY(savedY);
  } else {
    posX.value = window.innerWidth - PANEL_WIDTH - MARGIN;
    posY.value = window.innerHeight - PANEL_HEIGHT - MARGIN;
  }
}

function clampX(x: number): number {
  return Math.max(MARGIN, Math.min(x, window.innerWidth - PANEL_WIDTH - MARGIN));
}

function clampY(y: number): number {
  return Math.max(MARGIN, Math.min(y, window.innerHeight - PANEL_HEIGHT - MARGIN));
}

const panelStyle = computed(() => ({
  left: `${posX.value}px`,
  top: `${posY.value}px`,
  width: `${PANEL_WIDTH}px`,
  height: `${PANEL_HEIGHT}px`,
}));

const fabStyle = computed(() => ({
  right: `${MARGIN}px`,
  bottom: `${MARGIN}px`,
}));

/**
 * Watch panelOpen: after the panel opens, nextTick waits for DOM rendering to complete,
 * then binds the mousedown event to the .ai-header element inside AiAssistantPanel.
 * Also adds a cursor: move visual hint to the header.
 */
watch(panelOpen, async (open) => {
  if (open) {
    await nextTick();
    bindHeaderDrag();
  } else {
    unbindHeaderDrag();
  }
}, { immediate: true });

function bindHeaderDrag() {
  if (!panelRef.value) return;
  const header = panelRef.value.querySelector('.ai-header') as HTMLElement | null;
  if (!header) return;
  dragHeaderEl = header;
  // Visual hint: title bar is draggable
  header.style.cursor = 'move';
  header.style.userSelect = 'none';
  header.addEventListener('mousedown', startDrag);
}

function unbindHeaderDrag() {
  if (dragHeaderEl) {
    dragHeaderEl.style.cursor = '';
    dragHeaderEl.style.userSelect = '';
    dragHeaderEl.removeEventListener('mousedown', startDrag);
    dragHeaderEl = null;
  }
}

function startDrag(e: MouseEvent) {
  // Ignore clicks on header buttons (agent mode switch, clear, close, etc.)
  const target = e.target as HTMLElement;
  if (target.closest('button')) return;
  dragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  panelStartX = posX.value;
  panelStartY = posY.value;
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  e.preventDefault();
}

function onDrag(e: MouseEvent) {
  if (!dragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  posX.value = clampX(panelStartX + dx);
  posY.value = clampY(panelStartY + dy);
}

function stopDrag() {
  if (!dragging) return;
  dragging = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  // Persist position
  configStore.updateUIConfig({
    aiAssistantX: posX.value,
    aiAssistantY: posY.value,
  });
}

function handleResize() {
  posX.value = clampX(posX.value);
  posY.value = clampY(posY.value);
}

onMounted(() => {
  initPosition();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  unbindHeaderDrag();
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
});
</script>

<style scoped>
/* Floating button */
.ai-fab {
  position: fixed;
  z-index: 9998;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent, #6366f1), var(--primary, #3b82f6));
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
}

.ai-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(99, 102, 241, 0.4);
}

.ai-fab:active {
  transform: scale(0.95);
}

/* Floating panel */
.ai-floating-panel {
  position: fixed;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

/* Panel body — AiAssistantPanel fills the entire floating panel */
.ai-floating-panel > :deep(.ai-assistant-panel) {
  flex: 1;
  border-left: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Title-bar draggable visual hint (enhanced) */
.ai-floating-panel :deep(.ai-header) {
  cursor: move;
  user-select: none;
}

.ai-floating-panel :deep(.ai-header):hover {
  background-color: var(--elevated, var(--background));
}
</style>
