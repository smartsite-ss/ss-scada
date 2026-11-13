<template>
  <!--
    【Layer 1 - Scroll container】.plugin-layer-manager
    Role: scroll container for the entire canvas area
    - display: flex + flex: 1 → auto-fill the parent's remaining space
    - padding: 20px → breathing room around the canvas
    - overflow: auto → auto-show scrollbars when the zoomed canvas exceeds the viewport
    - all mouse events (scroll) are captured here and emitted upward
    - cursor becomes grabbing in active state (during drag)
  -->
  <div
    ref="layerRootRef"
    class="plugin-layer-manager"
    :style="{ cursor: cursorStyle, padding: layerPadding }"
    @scroll="(event) => emit('scroll', event)"
  >
    <!--
      【Layer 2 - Viewport flex area】.canvas-viewport
      Role: elastic container holding canvas content, dynamically resized with zoom
      - position: relative → positioning reference for inner absolutely-positioned elements (Vue/SVG/CSS component containers)
      - flex-shrink: 0 → zoomed size cannot be compressed; only scrollbars can be used to view
      - margin: auto → auto-center when the canvas is smaller than the container
      - viewportStyle controls width/height = page original size × zoom
        example: a 1920×1080 canvas at zoom=0.58 has a viewport size of 1114×627px
    -->
    <div
      ref="viewportRef"
      class="canvas-viewport"
      :class="{ 'canvas-viewport--centered': enableAutoFit }"
      :style="viewportStyle"
    >
      <!--
        【Layer 3 - Canvas】.design-canvas
        Role: 2D drawing layer, the sole carrier of Canvas 2D API drawing
        - width/height attributes → canvas internal resolution (keeps original pixels, does not change with zoom)
        - canvasStyle controls CSS display size = original size × zoom (proportional to viewport)
        - background-color: var(--surface) → background color of undrawn canvas areas (light grey)
        - z-index: 1 → at the bottom; other component containers overlay it
        - all interaction events (click/drag/wheel, etc.) are captured here and emitted upward
        - the actual white canvas content (fillRect(#FFF)) is drawn on this canvas by useCanvasRender
      -->
      <canvas
        id="canvas"
        ref="canvasRef"
        :width="width"
        :height="height"
        class="design-canvas"
        :style="canvasStyle"
        @click="(event) => emit('click', event)"
        @mousedown="(event) => emit('mousedown', event)"
        @mousemove="(event) => emit('mousemove', event)"
        @mouseup="(event) => emit('mouseup', event)"
        @mouseleave="(event) => emit('mouseleave', event)"
        @mouseout="(event) => emit('mouseout', event)"
        @dblclick="(event) => emit('dblclick', event)"
        @dragover="(event) => emit('dragover', event)"
        @drop="(event) => emit('drop', event)"
        @wheel="(event) => emit('wheel', event)"
        @contextmenu="(event) => emit('contextmenu', event)"
      />

      <!--
        【Layer 4 - Vue component container】VueComponentsContainer
        Role: DOM container for rendering Vue plugins (runtime components)
        - filter graphics whose type is 'vue-component'
        - each graphic maps to an absolutely-positioned DOM node
        - zoom is used to sync the component's position and size
      -->
      <VueComponentsContainer
        :sorted-graphics="graphics"
        :zoom="zoom"
        :mode="mode"
        :canvas-el="canvasRef"
      />

      <!--
        【Layer 5 - SVG component container】SvgComponentsContainer
        Role: container for rendering SVG vector graphic components
        - filter graphics whose type is 'svg'
        - returns pure SVG DOM nodes, supporting lossless vector scaling
        - zoom is used to sync SVG element scaling
      -->
      <SvgComponentsContainer
        :sorted-graphics="graphics"
        :zoom="zoom"
        :canvas-el="canvasRef"
      />

      <!--
        【Layer 6 - CSS component container】CssComponentsContainer
        Role: container for rendering pure CSS/HTML style components
        - filter graphics whose type is 'css'
        - uses CSS transform to control position and scaling
        - zoom is used to dynamically compute transform params
      -->
      <CssComponentsContainer
        :sorted-graphics="graphics"
        :zoom="zoom"
        :canvas-el="canvasRef"
      />

      <!--
        【Layer 7 - 3D component container】ThreeComponentsContainer
        Role: independent container for rendering Three.js 3D scene components
        - does not depend on graphics (managed independently by the Three.js scene graph)
        - zoom is used to sync the 3D scene viewport scaling
      -->
      <ThreeComponentsContainer
        :sorted-graphics="graphics"
        :zoom="zoom"
        :canvas-el="canvasRef"
      />

      <!--
        【Layer 8 - Overlay slot】slot name="overlay"
        Role: allow the parent component to inject custom overlay content
        Typical uses: selection box, alignment guides, drag preview, measurement ruler, etc.
      -->
      <slot name="overlay" />

      <!--
        【Layer 9 - Grid overlay】GridOverlay
        Role: draw optional dot/grid reference lines on the canvas
        - showGrid controls visibility
        - helps users align and position graphics
      -->
      <GridOverlay :show-grid="showGrid" />

      <!--
        【Layer 10 - Graphic raw-value overlay】GraphicValueOverlay
        Role: in edit mode, show the data raw values (tagId/current value/quality) next to graphics on the canvas
        - visibility controlled by pageStore.showValueOverlay (DataPanel checkbox)
        - only shows graphics with data bindings
      -->
      <GraphicValueOverlay
        :graphics="graphics"
        :zoom="zoom"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import VueComponentsContainer from './VueComponentsContainer.vue';
import SvgComponentsContainer from './SvgComponentsContainer.vue';
import CssComponentsContainer from './CssComponentsContainer.vue';
import ThreeComponentsContainer from './ThreeComponentsContainer.vue';
import GridOverlay from '../overlays/GridOverlay.vue';
import GraphicValueOverlay from '../overlays/GraphicValueOverlay.vue';
import { VIEWPORT } from '../constants';
import type { IGraphic } from '@scada-editor/core';

const props = defineProps({
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  graphics: { type: Array as () => IGraphic[], required: true },
  panX: { type: Number, default: 0 },
  panY: { type: Number, default: 0 },
  zoom: { type: Number, default: 1 },
  showGrid: { type: Boolean, default: true },
  enableAutoFit: { type: Boolean, default: false },
  cursorStyle: { type: String, default: 'default' },
  mode: { type: String as () => 'edit' | 'runtime', default: 'edit' },
});

const emit = defineEmits<{
  scroll: [event: Event];
  click: [event: MouseEvent];
  mousedown: [event: MouseEvent];
  mousemove: [event: MouseEvent];
  mouseup: [event: MouseEvent];
  mouseleave: [event: MouseEvent];
  mouseout: [event: MouseEvent];
  dblclick: [event: MouseEvent];
  dragover: [event: DragEvent];
  drop: [event: DragEvent];
  wheel: [event: WheelEvent];
  contextmenu: [event: MouseEvent];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const layerRootRef = ref<HTMLDivElement | null>(null);
const viewportRef = ref<HTMLDivElement | null>(null);

// Scroll-layer surrounding padding: injected by the VIEWPORT.LAYER_PADDING constant, eliminating the CSS/JS dual-track value (optimization P2-4)
const layerPadding = `${VIEWPORT.LAYER_PADDING}px`;

const viewportStyle = computed(() => ({
  width: (props.width * props.zoom) + 'px',
  height: (props.height * props.zoom) + 'px',
}));

const canvasStyle = computed(() => ({
  width: (props.width * props.zoom) + 'px',
  height: (props.height * props.zoom) + 'px',
}));

defineExpose({ canvasRef, layerRootRef, viewportRef });
</script>

<style scoped>
.plugin-layer-manager {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.plugin-layer-manager:active {
  cursor: grabbing;
}
.canvas-viewport {
  position: relative;
  flex-shrink: 0;
}
.canvas-viewport--centered {
  margin: auto;
}
.design-canvas {
  display: block;
  background-color: var(--surface);
  z-index: 1;
}
</style>