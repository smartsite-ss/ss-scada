<template>
  <div
    class="resize-handle"
    :class="position"
    @mousedown="handleMouseDown"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  position: {
    type: String,
    required: true,
  },
  graphicId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['resize']);

const isResizing = ref(false);
const startX = ref(0);
const startY = ref(0);
const startWidth = ref(0);
const startHeight = ref(0);

// Handle mouse-down event
const handleMouseDown = (e: MouseEvent) => {
  e.stopPropagation();
  isResizing.value = true;
  startX.value = e.clientX;
  startY.value = e.clientY;
  // Here you should get the graphic's initial size
  // Temporarily use the default value
  startWidth.value = 100;
  startHeight.value = 100;
};

// Handle mouse-move event
const handleMouseMove = (e: MouseEvent) => {
  if (!isResizing.value) return;

  const deltaX = e.clientX - startX.value;
  const deltaY = e.clientY - startY.value;

  let newWidth = startWidth.value;
  let newHeight = startHeight.value;

  // Resize by position
  switch (props.position) {
    case 'top-left':
      newWidth = startWidth.value - deltaX;
      newHeight = startHeight.value - deltaY;
      break;
    case 'top-right':
      newWidth = startWidth.value + deltaX;
      newHeight = startHeight.value - deltaY;
      break;
    case 'bottom-left':
      newWidth = startWidth.value - deltaX;
      newHeight = startHeight.value + deltaY;
      break;
    case 'bottom-right':
      newWidth = startWidth.value + deltaX;
      newHeight = startHeight.value + deltaY;
      break;
  }

  // Ensure the size is not negative
  newWidth = Math.max(10, newWidth);
  newHeight = Math.max(10, newHeight);

  emit('resize', { width: newWidth, height: newHeight });
};

// Handle mouse-up event
const handleMouseUp = () => {
  isResizing.value = false;
};

// Mount event listeners
onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
});

// Remove event listeners
onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
});
</script>

<style scoped>
.resize-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background-color: #4caf50;
  border: 2px solid white;
  border-radius: 50%;
  pointer-events: all;
  cursor: nwse-resize;
  z-index: 10;
}

.resize-handle.top-left {
  top: -4px;
  left: -4px;
}

.resize-handle.top-right {
  top: -4px;
  right: -4px;
  cursor: nesw-resize;
}

.resize-handle.bottom-left {
  bottom: -4px;
  left: -4px;
  cursor: nesw-resize;
}

.resize-handle.bottom-right {
  bottom: -4px;
  right: -4px;
  cursor: nwse-resize;
}
</style>
