<template>
  <div class="json-panel">
    <JsonEditor
      v-model="jsonContent"
      :compact="compact"
      @refresh="refreshJson"
      @apply="apply"
      @format="format"
      @copy="copyJson"
      @export="handleExport"
      @import="handleImport"
      @generate-test-graphics="handleGenerateTestGraphics"
    />
  </div>
</template>

<script setup lang="ts">
import { useJsonEditor } from '../../composables/useJsonEditor'
import JsonEditor from '../../common/JsonEditor.vue'
import { GraphicGenerator } from '@scada-editor/core'
import { usePageStore } from '@scada-editor/core'

interface Props {
  compact?: boolean;
}

const _props = withDefaults(defineProps<Props>(), {
  compact: false,
});

const {
  jsonContent,
  refreshJson,
  applyJson,
  formatJson,
  copyJson,
  exportJson,
  validateJson,
} = useJsonEditor()

// Apply changes
const apply = () => {
  if (validateJson(jsonContent.value)) {
    applyJson(jsonContent.value)
  }
}

// Format
const format = () => {
  jsonContent.value = formatJson(jsonContent.value)
}

// Export
const handleExport = () => {
  exportJson(jsonContent.value)
}

// Import — the JsonEditor component already handles file selection and content update,
// Here we only need to apply changes after the content updates
const handleImport = () => {
  // JsonEditor handles file selection, then updates jsonContent via v-model
  // After jsonContent updates, we could apply directly, but for safety,
  // Let the user manually click the apply button
}

// Generate test graphics — 1000 buttons
const handleGenerateTestGraphics = () => {
  const generator = new GraphicGenerator()
  
  // Generate 1000 buttons using a grid layout
  const result = generator.generate({
    type: 'button',
    count: 1000,
    layoutMode: 'grid',
    startX: 50,
    startY: 50,
    areaWidth: 3000,
    areaHeight: 2000,
    cols: 50,
    fixedWidth: 40,
    fixedHeight: 30,
    gapX: 5,
    gapY: 5,
    randomColors: true,
  })
  
  // Get the current page and add a graphic
  const pageStore = usePageStore()
  const currentPage = pageStore.currentPage
  
  if (currentPage) {
    result.graphics.forEach(g => {
      currentPage.addGraphic(g)
    })
    
  } else {
    console.error('❌ 没有找到当前页面')
  }
}
</script>

<style scoped>
@import '../styles/property-panel.scss';

.json-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  background-color: var(--surface);
  min-height: 0; /* Prevent flex children from overflowing */
  overflow: hidden;
}

.json-panel:not(.compact) {
  border-left: 0;
}
</style>
