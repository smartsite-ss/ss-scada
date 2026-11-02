<template>
  <span
    class="dict-label"
    :title="titleText"
  >{{ displayText }}</span>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useDict, type DictItem } from '../composables/useDict';

const props = withDefaults(
  defineProps<{
    /** Dictionary identifier */
    dictId: string;
    /** Dictionary item value */
    value: string;
    /** Fallback text shown when no match; defaults to the value itself */
    fallback?: string;
  }>(),
  {
    fallback: '',
  },
);

const { loadDict } = useDict();

/** Loaded dictionary items (used to resolve on value change without re-requesting) */
const items = ref<DictItem[]>([]);

/** Current display text */
const displayText = ref<string>(props.fallback || props.value);

/** Tooltip text: value — label */
const titleText = computed(() => {
  const display = displayText.value;
  return display !== props.value ? `${props.value} — ${display}` : display;
});

/** Resolve the label from items and value */
function resolveLabel() {
  const item = items.value.find((it) => it.value === props.value);
  displayText.value = item?.label ?? (props.fallback || props.value);
}

async function loadAndResolve() {
  try {
    items.value = await loadDict(props.dictId);
    resolveLabel();
  } catch {
    displayText.value = props.fallback || props.value;
  }
}

onMounted(loadAndResolve);

// Reload when dictId changes
watch(() => props.dictId, loadAndResolve);

// Resolve from cached items on value change (no re-request)
watch(() => props.value, resolveLabel);

// Re-resolve when fallback changes
watch(() => props.fallback, resolveLabel);
</script>

<style scoped>
.dict-label {
  color: var(--text, inherit);
  font-size: inherit;
}
</style>
