<template>
  <div class="graphic-renderer">
    <canvas
      ref="canvasRef"
      :width="width"
      :height="height"
      class="graphic-canvas"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import type { IGraphic } from '@scada-editor/core';

// Found the issue! The rafThrottle function uses requestAnimationFrame for throttling,
// This causes the drawCanvas function to be deferred to the next animation frame. When adding a graphic,
// We first modify the graphics array, then immediately select the graphic, but the draw operation was deferred,
// so the graphic was not shown immediately. We need to remove rafThrottle so drawCanvas runs immediately.

/*
 * Graphic renderer component
 * Used to render a single graphic
 */
const props = defineProps({
  graphic: {
    type: Object as () => IGraphic,
    required: true,
  },
  width: {
    type: Number,
    default: 100,
  },
  height: {
    type: Number,
    default: 100,
  },
});

const canvasRef = ref<HTMLCanvasElement | null>(null);

// Draw graphics
const drawGraphic = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  // Clear canvas
  context.clearRect(0, 0, props.width, props.height);

  // Save current state
  context.save();

  // Move to origin
  context.translate(
    -props.graphic.config.geometry.x,
    -props.graphic.config.geometry.y
  );

  // Draw graphics
  props.graphic.draw(context);

  // Restore state
  context.restore();
};

// Watch graphic changes
watch(
  () => props.graphic,
  () => {
    drawGraphic();
  },
  { deep: true }
);

// Draw graphics after component mount
onMounted(() => {
  nextTick(() => {
    drawGraphic();
  });
});
</script>

<style scoped>
.graphic-renderer {
  position: relative;
  display: inline-block;
}

.graphic-canvas {
  display: block;
}
</style>
