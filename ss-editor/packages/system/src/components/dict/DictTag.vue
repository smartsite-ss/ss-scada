<template>
  <span
    v-if="type === 'tag'"
    class="dict-tag"
    :class="[`dict-tag--${size}`]"
    :style="tagStyle"
    :title="titleText"
  >
    {{ displayText }}
  </span>
  <span
    v-else
    class="dict-badge"
    :class="[`dict-badge--${size}`]"
    :style="badgeStyle"
    :title="titleText"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useDict } from '../../composables/useDict';

const props = withDefaults(defineProps<{
  dictId: string;
  value: string;
  locale?: string;
  colorMap?: Record<string, string>;
  size?: 'small' | 'default';
  type?: 'tag' | 'badge';
}>(), {
  locale: 'zh-CN',
  size: 'default',
  type: 'tag',
});

const { loadDict, getLabel, getDict } = useDict();

const displayText = computed(() => getLabel(props.dictId, props.value));
const titleText = computed(() => {
  const display = displayText.value;
  return display !== props.value ? `${props.value} — ${display}` : display;
});

/** Built-in color palette */
const COLOR_PALETTE = [
  '#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1',
  '#13c2c2', '#eb2f96', '#fa8c16', '#a0d911', '#2f54eb',
];

/** dictId hash index for stable color assignment */
function hashIndex(dictId: string): number {
  let hash = 0;
  for (let i = 0; i < dictId.length; i++) {
    hash = ((hash << 5) - hash) + dictId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Get the color corresponding to a value */
function getValueColor(): string {
  // 1. Prefer the custom colorMap
  if (props.colorMap?.[props.value]) {
    return props.colorMap[props.value];
  }

  // 2. Built-in mapping
  const presetMap: Record<string, Record<string, string>> = {
    alarmStatus: {
      active: '#f5222d',
      acknowledged: '#fa8c16',
      cleared: '#52c41a',
      shelved: '#d9d9d9',
    },
    dataQuality: {
      good: '#52c41a',
      uncertain: '#faad14',
      bad: '#f5222d',
      stale: '#d9d9d9',
    },
    templateStatus: {
      draft: '#d9d9d9',
      published: '#1890ff',
      deprecated: '#f5222d',
    },
  };

  if (presetMap[props.dictId]?.[props.value]) {
    return presetMap[props.dictId][props.value];
  }

  // 3. Assign the color-ring color by dictId hash
  const dict = getDict(props.dictId);
  if (dict) {
    const idx = dict.items.findIndex((it) => it.value === props.value);
    if (idx >= 0) {
      return COLOR_PALETTE[idx % COLOR_PALETTE.length];
    }
  }

  // 4. Fallback: assign based on dictId hash
  return COLOR_PALETTE[hashIndex(props.dictId) % COLOR_PALETTE.length];
}

const valueColor = computed(() => getValueColor());

const tagStyle = computed(() => ({
  backgroundColor: `${valueColor.value}18`,
  color: valueColor.value,
  borderColor: `${valueColor.value}30`,
}));

const badgeStyle = computed(() => ({
  backgroundColor: valueColor.value,
}));

onMounted(() => {
  loadDict(props.dictId, props.locale);
});

watch(
  () => props.locale,
  (locale) => {
    loadDict(props.dictId, locale);
  },
);
</script>

<style scoped>
.dict-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  border: 1px solid transparent;
  white-space: nowrap;
  user-select: none;
}

.dict-tag--small {
  padding: 0 6px;
  font-size: 11px;
  line-height: 1.5;
  border-radius: 3px;
}

.dict-badge {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  vertical-align: middle;
}

.dict-badge--small {
  width: 6px;
  height: 6px;
}
</style>