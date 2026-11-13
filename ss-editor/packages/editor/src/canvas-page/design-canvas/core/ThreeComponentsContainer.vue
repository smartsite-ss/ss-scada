<template>
  <div
    ref="containerRef"
    class="three-components-container"
  >
    <div
      v-for="item in threeList"
      :key="item.id"
      :ref="(el) => setContainerRef(item.id, el)"
      :style="item.style"
      class="three-plugin-wrapper"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick, toRef, type PropType } from 'vue';
import type { IGraphic } from '@scada-editor/core';
import { useContainerPosition } from '../../../composables/useContainerPosition';

interface ThreeItem {
  id: string;
  style: Record<string, any>;
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

const containerMap = ref<Record<string, HTMLDivElement | null>>({});
const mountedIds = ref<Set<string>>(new Set());

const setContainerRef = (id: string, el: any) => {
  containerMap.value[id] = el as HTMLDivElement | null;
};

const is3dPlugin = (graphic: IGraphic): boolean => {
  return typeof (graphic as any).loadScene === 'function';
};

const threeList = computed<ThreeItem[]>(() => {
  const list = (props.sortedGraphics as IGraphic[]);
  const filtered = list.filter((item) => item && is3dPlugin(item));
  const items = filtered.map((item) => ({
    id: item.id,
    style: calcItemStyle(item, props.zoom, props.panX, props.panY, {
      overflowHidden: true,
      zoomY: props.zoomY ?? undefined,
    }),
  }));
  return items;
});

const mountPlugin = async (graphic: IGraphic, el: HTMLDivElement) => {
  if (mountedIds.value.has(graphic.id)) return;
  mountedIds.value.add(graphic.id);

  try {
    if (typeof (graphic as any).mount === 'function') {
      await (graphic as any).mount(el);
      await nextTick();
      updateCanvasOffset();
    }
  } catch (err) {
    console.error('[ThreeComponentsContainer] mount failed:', graphic.id, err);
    mountedIds.value.delete(graphic.id);
  }
};

const unmountPlugin = (graphic: IGraphic) => {
  if (!mountedIds.value.has(graphic.id)) return;
  mountedIds.value.delete(graphic.id);

  try {
    if (typeof (graphic as any).unmount === 'function') {
      (graphic as any).unmount();
    }
  } catch (err) {
    console.error('[ThreeComponentsContainer] unmount failed:', graphic.id, err);
  }
};

watch(
  () => threeList.value.map((t) => t.id).join(','),
  async () => {
    await nextTick();

    const list = (props.sortedGraphics as IGraphic[]);

    const currentIds = new Set(
      list.filter((g) => is3dPlugin(g)).map((g) => g.id)
    );

    for (const graphic of list) {
      if (!is3dPlugin(graphic)) continue;
      const el = containerMap.value[graphic.id];
      if (el) {
        await mountPlugin(graphic, el);
      }
    }

    for (const id of mountedIds.value) {
      if (!currentIds.has(id)) {
        const graphic = list.find((g) => g.id === id);
        if (graphic) {
          unmountPlugin(graphic);
        }
      }
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  for (const id of mountedIds.value) {
    const graphic = (props.sortedGraphics as IGraphic[]).find((g) => g.id === id);
    if (graphic) unmountPlugin(graphic);
  }
  mountedIds.value.clear();
});
</script>

<style scoped>
.three-components-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 5;
}

.three-plugin-wrapper {
  pointer-events: none;
}
.three-plugin-wrapper :deep(*) {
  pointer-events: none;
}

</style>