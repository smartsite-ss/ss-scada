<template>
  <div
    class="state-variable-graphic"
    :style="containerStyle"
    :title="bindTitle"
  >
    <img
      v-if="currentImage"
      :src="currentImage"
      class="state-variable-image"
      :style="imageStyle"
      alt=""
    >
    <span
      v-else
      class="state-variable-placeholder"
    >{{ $t('stateVariable.graphic.placeholder') }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ScadaDataManager } from '@scada-editor/core';
import { useWsStore } from '@scada-editor/system';
import { resolveStateImage, type StateRule } from './stateVariableUtils';

const props = defineProps<{
  w: number;
  h: number;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  tagId: string;
  tagName: string;
  dataType: string;
  decimalPlaces: number;
  states: StateRule[];
  defaultImage: string;
  imageFit: string;
  opacity: number;
  imageScale: number;
  imageRotation: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: string;
  borderRadius: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
}>();

const wsStore = useWsStore();

/** Fallback refresh version: runtime EventBus or HTTP polling channels trigger via tagValueChanged */
const localVersion = ref(0);

/** Live value: depends on wsStore.tagFlushVersion and localVersion; any change forces recompute */
const currentValue = computed(() => {
  void wsStore.tagFlushVersion;
  void localVersion.value;
  if (!props.tagId) return null;

  const wsValue = wsStore.getTagValue(props.tagId);
  if (wsValue !== null && wsValue !== undefined) return wsValue;

  return ScadaDataManager.getTagValue(props.tagId) ?? null;
});

/** Match the current value against status rules to get the image to display */
const currentImage = computed(() =>
  resolveStateImage(currentValue.value, props.states || [], props.dataType, props.defaultImage || ''),
);

const bindTitle = computed(() =>
  props.tagId ? `${props.deviceName || props.deviceCode} · ${props.tagName || props.tagId}` : '',
);

const containerStyle = computed(() => ({
  width: '100%',
  height: '100%',
  position: 'relative' as const,
  overflow: 'hidden',
  boxSizing: 'border-box' as const,
  border: `${props.borderWidth}px ${props.borderStyle} ${props.borderColor === '#00000000' ? 'transparent' : props.borderColor}`,
  borderRadius: `${props.borderRadius}px`,
  boxShadow:
    props.shadowColor && props.shadowColor !== '#00000000'
      ? `${props.shadowOffsetX}px ${props.shadowOffsetY}px ${props.shadowBlur}px ${props.shadowColor}`
      : 'none',
}));

const imageStyle = computed(() => ({
  width: '100%',
  height: '100%',
  objectFit: props.imageFit as 'contain' | 'cover' | 'fill' | 'none' | 'scale-down',
  opacity: props.opacity,
  transform: `scale(${props.imageScale}) rotate(${props.imageRotation}deg)`,
}));

let unsubscribeEventBus: (() => void) | null = null;
/** Tags registered to wsStore, used to unsubscribe / add on binding changes */
let registeredTagId: string | null = null;

function syncSubscription() {
  const next = props.tagId || null;
  if (registeredTagId && registeredTagId !== next) {
    wsStore.unsubscribeTags([registeredTagId]);
  }
  if (next && next !== registeredTagId && wsStore.isConnected) {
    wsStore.subscribeTags([next]);
  }
  registeredTagId = next;
}

onMounted(() => {
  syncSubscription();
  unsubscribeEventBus = ScadaDataManager.eventBus.on('tagValueChanged', (event) => {
    const payload = (event as { payload?: { tagId?: string } }).payload;
    if (payload?.tagId === props.tagId) {
      localVersion.value++;
    }
  });
});

// Compensate subscription after the first connection is established
watch(
  () => wsStore.isConnected,
  (connected) => {
    if (!connected) return;
    if (props.tagId) wsStore.subscribeTags([props.tagId]);
  },
);

// Sync subscription on binding change
watch(
  () => props.tagId,
  () => syncSubscription(),
);

onUnmounted(() => {
  if (registeredTagId) {
    wsStore.unsubscribeTags([registeredTagId]);
  }
  registeredTagId = null;
  unsubscribeEventBus?.();
});
</script>

<style scoped>
.state-variable-graphic {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: Arial, sans-serif;
}

.state-variable-image {
  display: block;
}

.state-variable-placeholder {
  font-size: 12px;
  color: var(--text-tertiary, #999999);
}
</style>
