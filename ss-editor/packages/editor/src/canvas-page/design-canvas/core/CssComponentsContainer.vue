<template>
  <div
    ref="containerRef"
    class="css-components-container"
  >
    <template v-if="domList.length > 0">
      <div
        v-for="(item, index) in domList"
        :key="item.id || index"
        class="css-plugin-wrapper"
        :style="item.style"
        v-html="item.htmlContent"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, type PropType } from 'vue';
import type { IGraphic } from '@scada-editor/core';
import { useContainerPosition } from '../../../composables/useContainerPosition';

interface DomItem {
  id: string;
  style: Record<string, any>;
  htmlContent: string;
}

const props = defineProps({
  sortedGraphics: {
    type: Array as () => IGraphic[],
    default: () => [],
  },
  zoom: {
    type: Number,
    default: 1,
  },
  panX: {
    type: Number,
    default: 0,
  },
  panY: {
    type: Number,
    default: 0,
  },
  /** Vertical zoom (stretch non-uniform scaling); defaults to following zoom (uniform scaling) */
  zoomY: {
    type: Number,
    default: null,
  },
  /** Canvas element reference: used to compute the graphic offset relative to the canvas (optimization P0-2) */
  canvasEl: {
    type: Object as PropType<HTMLCanvasElement | null>,
    default: null,
  },
});

const { containerRef, calcItemStyle, updateCanvasOffset } = useContainerPosition({
  canvasEl: toRef(props, 'canvasEl'),
});

// For the parent to refresh the canvas offset after fit/container size changes (optimization P0-2)
defineExpose({ updateCanvasOffset });

const domList = computed<DomItem[]>(() => {
  return props.sortedGraphics
    .filter((item): item is IGraphic & { getHtmlTemplate?: () => string; htmlContent?: string } =>
      item != null &&
      (typeof (item as any).getHtmlTemplate === 'function' ||
       typeof (item as any).htmlContent === 'string' ||
       !!(item.type && (item.type.endsWith('-css') || item.type.startsWith('css-'))))
    )
    .map(item => {
      const htmlContent =
        typeof (item as any).getHtmlTemplate === 'function'
          ? (item as any).getHtmlTemplate(item.config?.data || {})
          : (item as any).htmlContent || '';

      return {
        id: item.id || (item as any).type,
        style: {
          ...calcItemStyle(item, props.zoom, props.panX, props.panY, {
            zoomY: props.zoomY ?? undefined,
          }),
          overflow: 'hidden',
        },
        htmlContent,
      };
    });
});
</script>

<style scoped>
.css-components-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 12;
}
.css-plugin-wrapper {
  pointer-events: none;
}
.css-plugin-wrapper :deep(*) {
  pointer-events: none;
}
</style>