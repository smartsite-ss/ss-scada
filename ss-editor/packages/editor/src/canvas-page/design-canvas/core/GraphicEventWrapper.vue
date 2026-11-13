<template>
  <div
    ref="wrapperRef"
    class="graphic-event-wrapper"
    :style="graphicStyle"
    :data-graphic-id="graphic.id"
    :data-graphic-type="graphic.type"
  >
    <component
      :is="componentDef"
      v-bind="componentProps"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeMount, onBeforeUnmount } from 'vue';
import type { IGraphic } from '@scada-editor/core';
import { EventExecutionEngine } from '@scada-editor/core';
import type { Component } from 'vue';

const props = defineProps<{
  graphic: IGraphic;
  mode: 'edit' | 'runtime';
  componentDef: Component;
  style: Record<string, any>;
  componentProps: Record<string, any>;
}>();

const wrapperRef = ref<HTMLDivElement | null>(null);
const engine = EventExecutionEngine.getInstance();

/**
 * In edit mode, do not register event listeners to preserve editing interactions (select/drag/zoom)
 * In runtime mode, register DOM event listeners and trigger lifecycle events
 */
const isRuntime = computed(() => props.mode === 'runtime');

const graphicStyle = computed(() => ({
  ...props.style,
  // Allow mouse events to pass through to child components at runtime
  pointerEvents: (isRuntime.value ? 'auto' : undefined) as 'auto' | undefined,
}));

// Lifecycle event: vnodeBeforeMount
onBeforeMount(() => {
  if (isRuntime.value) {
    engine.triggerLifecycleEvent(props.graphic, 'vnodeBeforeMount');
  }
});

// Lifecycle event: vnodeMounted + DOM event registration
onMounted(() => {
  if (!isRuntime.value) return;

  // Trigger lifecycle events
  engine.triggerLifecycleEvent(props.graphic, 'vnodeMounted');

  // Register DOM event listeners
  if (wrapperRef.value) {
    const element = wrapperRef.value as HTMLElement;
    engine.registerGraphicEvents(props.graphic, element);
  }
});

// Clean up event listeners on unmount
onBeforeUnmount(() => {
  engine.unregisterGraphicEvents(props.graphic.id);
});
</script>

<style scoped>
.graphic-event-wrapper {
  /* Inherit the parent container's positioning */
  position: absolute;
  /* pointer-events is dynamically controlled by graphicStyle */
}
</style>