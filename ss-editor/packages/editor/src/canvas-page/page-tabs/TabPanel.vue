<template>
  <div class="tab-panel">
    <!-- Tab switching — canvas properties / component properties / JSON -->
    <div class="property-tabs">
      <button
        v-for="tab in mainTabs"
        :key="tab.id"
        class="tab-button"
        :class="{ active: activeMainTab === tab.id }"
        @click="activeMainTab = tab.id"
      >
        {{ $t(tab.labelKey) || tab.label }}
      </button>
    </div>

    <!-- Main content area -->
    <div class="tab-content">
      <!-- Canvas properties -->
      <div v-if="activeMainTab === 'canvas'">
        <CanvasProperties
          :page-properties="pageProperties"
          @update-page-properties="updatePageProperties"
        />
      </div>

      <!-- Component properties -->
      <div v-else-if="activeMainTab === 'component'">
        <PropertyPanel />
      </div>

      <!-- JSON -->
      <div v-else-if="activeMainTab === 'json'">
        <JsonPanel />
      </div>
    </div>

    <!-- Layer — always visible -->
    <div class="layer-section">
      <LayerPanel />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { usePageStore } from '@scada-editor/core';
import CanvasProperties from '../CanvasProperties.vue';
import PropertyPanel from '../../graphic-editing/property/PropertyPanel.vue';
import LayerPanel from '../../graphic-editing/layer/LayerPanel.vue';
import JsonPanel from '../../panels/json/JsonPanel.vue';

// Active main tab
const activeMainTab = ref('canvas');

// Dynamically adjust tabs based on whether a graphic is selected
const mainTabs = computed(() => {
  const tabs: Array<{ id: string; labelKey: string; label: string }> = [];

  // First force-show the canvas properties + JSON to ensure visibility
  tabs.push({
    id: 'canvas',
    labelKey: 'canvasProperties.canvasProperties',
    label: '画布属性',
  });
  tabs.push({
    id: 'json',
    labelKey: 'tabPanel.json',
    label: 'JSON',
  });

  return tabs;
});

// Watch tab changes; ensure activeMainTab is in the tab list
watch(mainTabs, (newTabs) => {
  const hasActiveTab = newTabs.some(tab => tab.id === activeMainTab.value);
  if (!hasActiveTab && newTabs.length > 0) {
    // If the current tab is not in the new tab list, select the first tab
    activeMainTab.value = newTabs[0].id;
  }
}, { immediate: true });

// Page properties
const pageStore = usePageStore();
const pageProperties = ref<any>(pageStore.currentPage || { id: '', name: '', width: 1920, height: 1080 });

// Watch current-page change
watch(() => pageStore.currentPage, (newPage) => {
  if (newPage) {
    pageProperties.value = newPage;
  }
}, { immediate: true });

// Update page properties
const updatePageProperties = () => {
  if (pageProperties.value && (pageProperties.value as any).id) {
    pageStore.updatePage((pageProperties.value as any).id, pageProperties.value);
  }
};
</script>

<style scoped>
@import '../../panels/styles/property-panel.scss';

.tab-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--surface);
  overflow: hidden;
}

/* Ensure the property-tabs style is applied correctly */
:deep(.property-tabs) {
  display: flex;
  background-color: var(--background);
  border-bottom: 1px solid var(--border);
  margin: 0;
  padding: 0;
}

:deep(.tab-button) {
  flex: 1;
  padding: 4px 8px;
  background-color: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  margin: 0;
}

:deep(.tab-button:hover) {
  background-color: var(--control-button-hover);
  color: var(--text);
}

:deep(.tab-button.active) {
  color: var(--primary);
  font-weight: 600;
}

:deep(.tab-button.active::after) {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: var(--primary);
  border-radius: 2px 2px 0 0;
}

.tab-content {
  flex: 1;
  padding: 0 !important;
  overflow-y: auto;
  background-color: var(--surface);
  margin: 0 !important;
  border: none !important;
  outline: none !important;
}

.tab-content > * {
  margin-top: 0 !important;
}

.layer-section {
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  max-height: 250px;
  overflow: auto;
}
</style>
