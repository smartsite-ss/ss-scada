<template>
  <div
    ref="containerRef"
    class="svg-components-container"
  >
    <template v-if="svgList.length > 0">
      <div
        v-for="(item, index) in svgList"
        :key="item.id || index"
        class="svg-plugin-wrapper"
        :style="item.style"
        v-html="item.svgContent"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, type PropType } from 'vue';
import type { IGraphic } from '@scada-editor/core';
import { useContainerPosition } from '../../../composables/useContainerPosition';

interface SvgItem {
  id: string;
  style: Record<string, any>;
  svgContent: string;
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

const svgList = computed<SvgItem[]>(() => {
  const list = props.sortedGraphics
    .filter((item): item is IGraphic & { getSvgTemplate?: () => string; svgContent?: string } =>
      item != null &&
      (typeof (item as any).getSvgTemplate === 'function' ||
       typeof (item as any).svgContent === 'string' ||
       ((item.type?.endsWith('-svg') || item.type?.startsWith('svg-')) && typeof (item as any).svgContent === 'string'))
    )
    .map(item => {
      const svgContent =
        typeof (item as any).getSvgTemplate === 'function'
          ? (item as any).getSvgTemplate(item.config?.data || {})
          : (item as any).svgContent || '';

      return {
        id: item.id || (item as any).type,
        style: {
          ...calcItemStyle(item, props.zoom, props.panX, props.panY, {
            zoomY: props.zoomY ?? undefined,
          }),
          overflow: 'hidden',
        },
        svgContent,
      };
    });

    return list;
});
</script>

<style scoped>
.svg-components-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 11;
}
.svg-plugin-wrapper {
  pointer-events: none;
}
.svg-plugin-wrapper :deep(*) {
  pointer-events: none;
}
.svg-plugin-wrapper :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>