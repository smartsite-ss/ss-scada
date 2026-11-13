<template>
  <div
    v-if="showValueOverlay"
    class="graphic-value-overlay-layer"
  >
    <div
      v-for="item in overlayItems"
      :key="item.graphicId"
      class="value-overlay-badge"
      :class="`quality-${item.quality}`"
      :style="{
        left: `${item.x * zoom}px`,
        top: `${Math.max(0, item.y * zoom - 28)}px`,
        width: `${Math.max(120, item.width * zoom)}px`,
      }"
    >
      <span class="overlay-tag-name">{{ item.tagName }}</span>
      <span class="overlay-value">{{ item.displayValue }}</span>
      <span class="overlay-quality">{{ item.qualityLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePageStore, BindingManager } from '@scada-editor/core';
import { useWsStore } from '@scada-editor/system';
import type { IGraphic } from '@scada-editor/core';

const props = defineProps({
  graphics: {
    type: Array as () => IGraphic[],
    required: true,
  },
  zoom: {
    type: Number,
    default: 1,
  },
});

const pageStore = usePageStore();
const wsStore = useWsStore();

/** Read toggle state from pageStore (controlled by DataPanel checkbox) */
const showValueOverlay = computed(() => (pageStore as any).showValueOverlay === true);

const QUALITY_LABELS: Record<string, string> = {
  good: '✓',
  uncertain: '?',
  bad: '✗',
  stale: '~',
  disconnected: '--',
};

interface OverlayItem {
  graphicId: string;
  x: number;
  y: number;
  width: number;
  tagName: string;
  displayValue: string;
  quality: string;
  qualityLabel: string;
}

/**
 * Traverse graphics on the canvas, filter those with data bindings, read live values from wsStore.tagValues,
 * and build overlay display items. computed depends on wsStore.tagValues (shallowRef Map),
 * and recalculates automatically when tagValues changes.
 */
const overlayItems = computed<OverlayItem[]>(() => {
  // Trigger reactivity tracking of wsStore.tagValues
  void wsStore.tagValues;
  const result: OverlayItem[] = [];
  const bindingManager = BindingManager.getInstance();

  for (const graphic of props.graphics) {
    const bindings = bindingManager.getGraphicBindings(graphic.id);
    if (bindings.length === 0) continue;

    const geometry = graphic.config?.geometry;
    if (!geometry) continue;

    // Use the first bound tag's value as the primary display value
    const firstBinding = bindings[0];
    const tagEntry = wsStore.tagValues.get(firstBinding.tagId);
    const value = tagEntry?.value;
    const quality = tagEntry?.quality || 'disconnected';

    result.push({
      graphicId: graphic.id,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      tagName: firstBinding.tagName || firstBinding.tagId,
      displayValue: formatValue(value),
      quality,
      qualityLabel: QUALITY_LABELS[quality] || '?',
    });
  }
  return result;
});

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '--';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === 'string') return value.length > 20 ? value.slice(0, 20) + '…' : value;
  try {
    return JSON.stringify(value).slice(0, 20);
  } catch {
    return String(value);
  }
}
</script>

<style scoped>
.graphic-value-overlay-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 100;
}

.value-overlay-badge {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #dcdfe6);
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text, #303333);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  white-space: nowrap;
  overflow: hidden;
}

.overlay-tag-name {
  color: var(--text-secondary, #909399);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.overlay-value {
  font-weight: 600;
  color: var(--text, #303333);
}

.overlay-quality {
  margin-left: auto;
  font-weight: 700;
}

.quality-good {
  border-left: 3px solid #4CAF50;
}
.quality-good .overlay-quality {
  color: #4CAF50;
}

.quality-uncertain {
  border-left: 3px solid #FF9800;
}
.quality-uncertain .overlay-quality {
  color: #FF9800;
}

.quality-bad {
  border-left: 3px solid #F44336;
}
.quality-bad .overlay-quality {
  color: #F44336;
}

.quality-stale {
  border-left: 3px solid #9E9E9E;
  opacity: 0.7;
}
.quality-stale .overlay-quality {
  color: #9E9E9E;
}

.quality-disconnected {
  border-left: 3px solid #607D8B;
  opacity: 0.5;
}
.quality-disconnected .overlay-quality {
  color: #607D8B;
}
</style>
