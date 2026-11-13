<template>
  <div
    ref="containerRef"
    class="vue-components-container"
  >
    <template v-if="componentList.length > 0">
      <GraphicEventWrapper
        v-for="(item, index) in componentList"
        :key="item.id || index"
        :graphic="item.graphic"
        :mode="mode"
        :component-def="item.componentDef"
        :style="item.style"
        :component-props="item.componentProps"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, toRef, type PropType } from 'vue';
import { eventBus, Events } from '@scada-editor/core';
import type { IGraphic } from '@scada-editor/core';
import { GraphicComponentRegistry } from '@scada-editor/plugin-sdk';
import type { Component } from 'vue';
import GraphicEventWrapper from './GraphicEventWrapper.vue';
import { useContainerPosition } from '../../../composables/useContainerPosition';

interface ComponentItem {
  id: string;
  graphic: IGraphic;
  componentDef: Component;
  style: Record<string, any>;
  componentProps: Record<string, any>;
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
  /** Runtime mode: 'edit' | 'runtime' */
  mode: {
    type: String as () => 'edit' | 'runtime',
    default: 'edit',
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

// Graphic properties (including customProps variable bindings) are updated in place via updateGraphic, without changing the graphics array reference.
// Rely on the GRAPHIC_UPDATED event to drive componentList recomputation, so Vue components get the latest props (consistent between edit and runtime).
const refreshVersion = ref(0);

function handleGraphicUpdated() {
  refreshVersion.value++;
}

onMounted(() => {
  eventBus.on(Events.GRAPHIC_UPDATED, handleGraphicUpdated);
});

onBeforeUnmount(() => {
  eventBus.off(Events.GRAPHIC_UPDATED, handleGraphicUpdated);
});

const componentList = computed<ComponentItem[]>(() => {
  void refreshVersion.value;
  const rawItems = props.sortedGraphics;
  return (rawItems || [])
    .filter((item): item is IGraphic & { componentName: string; getComponentProps?: () => Record<string, any> } =>
      item && typeof (item as any).componentName === 'string'
    )
    .map(item => {
      const componentDef = GraphicComponentRegistry.get(item.componentName);
      if (!componentDef) {
        return null;
      }
      return {
        id: item.id,
        graphic: item,
        componentDef,
        style: {
          ...calcItemStyle(item, props.zoom, props.panX, props.panY, {
            zoomY: props.zoomY ?? undefined,
          }),
        },
        componentProps: {
          graphic: item,
          ...(item.getComponentProps?.() || {}),
        },
      };
    })
    .filter(Boolean) as ComponentItem[];
});
</script>

<style scoped>
.vue-components-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 10;
}
</style>