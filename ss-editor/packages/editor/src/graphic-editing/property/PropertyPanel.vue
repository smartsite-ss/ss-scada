<template>
  <div
    class="property-panel"
    :style="themeStyles"
  >
    <div
      v-if="selectedGraphic"
      class="property-section"
    >
      <h3>{{ $t('propertyPanel.componentProperties') }}</h3>

      <!-- Tab switching -->
      <div class="property-tabs">
        <button
          class="tab-button"
          :class="{ active: activeTab === 'style' }"
          @click="activeTab = 'style'"
        >
          {{ $t('propertyPanel.style') }}
        </button>
        <button
          class="tab-button"
          :class="{ active: activeTab === 'data' }"
          @click="activeTab = 'data'"
        >
          {{ $t('propertyPanel.data') }}
        </button>
        <button
          class="tab-button"
          :class="{ active: activeTab === 'interaction' }"
          @click="activeTab = 'interaction'"
        >
          {{ $t('propertyPanel.interaction') }}
        </button>
      </div>

      <!-- Style panel -->
      <div
        v-if="activeTab === 'style'"
        class="tab-content"
      >
        <StylePanel
          :graphic-properties="graphicProperties"
          @update-graphic-properties="updateGraphicProperties"
        />
      </div>

      <!-- Data-binding panel -->
      <div
        v-if="activeTab === 'data'"
        class="tab-content"
      >
        <DataPanel
          :key="graphicProperties?.config?.id ?? 'data-panel'"
          :graphic-properties="graphicProperties"
          @update-graphic-properties="updateGraphicProperties"
        />
      </div>

      <!-- Event interaction panel -->
      <div
        v-if="activeTab === 'interaction'"
        class="tab-content"
      >
        <InteractionPanel
          :graphic-properties="graphicProperties"
          @update-graphic-properties="updateGraphicProperties"
        />
      </div>
    </div>

    <!-- Canvas properties -->
    <div
      v-else
      class="property-section"
    >
      <h3>{{ $t('propertyPanel.canvasProperties') }}</h3>
      
      <!-- Tab switching -->
      <div class="property-tabs">
        <button
          class="tab-button"
          :class="{ active: canvasActiveTab === 'properties' }"
          @click="canvasActiveTab = 'properties'"
        >
          {{ $t('propertyPanel.properties') }}
        </button>
        <button
          class="tab-button"
          :class="{ active: canvasActiveTab === 'timers' }"
          @click="canvasActiveTab = 'timers'"
        >
          {{ $t('propertyPanel.timers') }}
        </button>
        <button
          class="tab-button"
          :class="{ active: canvasActiveTab === 'json' }"
          @click="canvasActiveTab = 'json'"
        >
          {{ $t('tabPanel.json') }}
        </button>
      </div>

      <!-- Canvas properties content -->
      <div
        v-if="canvasActiveTab === 'properties'"
        class="tab-content"
      >
        <CanvasProperties 
          :page-properties="pageProperties" 
          @update-page-properties="updatePageProperties"
        />
      </div>

      <!-- Timer content -->
      <div
        v-if="canvasActiveTab === 'timers'"
        class="tab-content"
      >
        <TimerPanel 
          :page="(pageStore.currentPage || null) as any" 
          @update-page="updatePageProperties"
        />
      </div>

      <!-- JSON editor content -->
      <div
        v-if="canvasActiveTab === 'json'"
        class="tab-content"
      >
        <JsonPanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSelection } from '../../composables/useSelection';
import { useGraphic } from '../../composables/useGraphic';
import { useTheme, usePageStore } from '@scada-editor/core';
import StylePanel from './StylePanel.vue';
import DataPanel from './sections/data/DataPanel.vue';
import InteractionPanel from './InteractionPanel.vue';
import CanvasProperties from '../../canvas-page/CanvasProperties.vue';
import JsonPanel from '../../panels/json/JsonPanel.vue';
import TimerPanel from '../../scada-business/timer/TimerPanel.vue';

const { themeStyles } = useTheme();

const { selectedGraphic } = useSelection();
const { updateGraphic } = useGraphic();

// Graphic properties — use the any type to avoid complex type checks
const graphicProperties = ref<any>({
  config: {
    id: '',
    type: '',
    name: '',
    geometry: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      scale: 1,
    },
    style: {
      backgroundColor: '#ffffff',
      color: '#000000',
      fontSize: 14,
      fontFamily: 'Arial',
      fontStyle: 'normal',
      fontWeight: 'normal',
      textAlign: 'left',
      letterSpacing: 0,
      lineHeight: 1.5,
      borderColor: '#000000',
      borderWidth: 1,
      borderRadius: 0,
      borderStyle: 'solid',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowColor: 'rgba(0, 0, 0, 0.5)',
      shadowSpread: 0,
      opacity: 1,
      padding: '0px',
      margin: '0px',
    },
    locked: false,
    visible: true,
    disabled: false,
    zIndex: 0,
    isGroup: false,
    groupId: null,
    groupMembers: [],
    customProps: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  events: [],
  dataSource: {
    type: '',
    target: null,
    payload: {},
    timestamp: Date.now(),
    validation: {
      required: false,
      min: null,
      max: null,
      pattern: '',
      script: '',
      message: '',
    },
    enabled: false,
    dataSource: '',
    dataField: '',
    displayField: '',
    dataMapping: [],
  },
  animation: {
    enabled: false,
    type: 'fade-in',
    duration: 0.5,
    delay: 0,
    properties: {},
  },
});

// Tab state
const activeTab = ref('style');
const canvasActiveTab = ref('properties');

// Page properties
const pageStore = usePageStore();
const pageProperties = ref<any>(pageStore.currentPage || { id: '', name: '', width: 1920, height: 1080, scale: 1, backgroundColor: '#ffffff', backgroundImage: '' });

// Watch current-page change
watch(() => pageStore.currentPage, (newPage) => {
  if (newPage) {
    pageProperties.value = newPage;
  }
}, { immediate: true });

// Update page properties (supports undo/redo)
const updatePageProperties = () => {
  if (pageProperties.value && pageProperties.value.id) {
    const currentPage = pageStore.currentPage;
    if (currentPage && typeof currentPage.updatePageProperties === 'function') {
      const properties = {
        width: pageProperties.value.width,
        height: pageProperties.value.height,
        backgroundColor: pageProperties.value.backgroundColor,
        backgroundImage: pageProperties.value.backgroundImage,
        scale: pageProperties.value.scale,
      };
      currentPage.updatePageProperties(properties);
    } else {
      pageStore.updatePage(pageProperties.value.id, pageProperties.value);
    }
  }
};

// Watch selected-graphic change
watch(
  () => {
    const graphic = selectedGraphic.value;
    return graphic 
      ? [
          graphic.id,
          (graphic as any)?.config?.updatedAt,
        ] 
      : null;
  },
  (_newVal, _oldVal) => {
    const newGraphic = selectedGraphic.value;
    if (newGraphic) {
      const config = (newGraphic.config as any) || {};

      const animation = (newGraphic as any)?.animation || {
        enabled: false,
        type: 'fade-in',
        duration: 0.5,
        delay: 0,
        properties: {},
      };

      const dataSource = (newGraphic as any)?.dataSource || {};
      const dataMapping = dataSource?.dataMapping || [];
      const validation = dataSource?.validation || {};

      const events = (newGraphic as any)?.events;
      // Compatible with old data format: { eventHandlers: { [id]: IEvent } } → extract into an array
      const normalizedEvents = Array.isArray(events)
        ? events
        : (events?.eventHandlers ? Object.values(events.eventHandlers as Record<string, any>) : []);

      graphicProperties.value = {
        config: {
          ...config,
          id: newGraphic.id,
          type: newGraphic.type,
          updatedAt: Date.now(),
        },
        animation,
        dataSource: {
          ...dataSource,
          enabled: dataSource.enabled ?? false,
          dataSource: dataSource.dataSource ?? '',
          dataField: dataSource.dataField ?? '',
          displayField: dataSource.displayField ?? '',
          validation: {
            required: validation.required ?? false,
            min: validation.min ?? null,
            max: validation.max ?? null,
            pattern: validation.pattern ?? '',
            script: validation.script ?? '',
            message: validation.message ?? '',
          },
          dataMapping: [...dataMapping],
        },
        events: normalizedEvents,
      };
    }
  },
  { immediate: true, deep: true }
);

// Update graphic properties
const updateGraphicProperties = () => {
  if (selectedGraphic.value) {
    // Convert array-format events → eventHandlers Record format
    const eventsArray = graphicProperties.value.events;
    let eventsForUpdate: any = {};
    if (Array.isArray(eventsArray) && eventsArray.length > 0) {
      const handlers: Record<string, any> = {};
      for (const evt of eventsArray) {
        handlers[evt.id] = evt;
      }
      eventsForUpdate = { eventHandlers: handlers };
    }

    const updatedProperties = {
      config: {
        ...(graphicProperties.value.config || {}),
        updatedAt: Date.now(),
      },
      events: eventsForUpdate,
      dataSource: graphicProperties.value.dataSource || {
        type: '',
        target: null,
        payload: {},
        timestamp: Date.now(),
        validation: {
          required: false,
          min: null,
          max: null,
          pattern: '',
          script: '',
          message: '',
        },
        enabled: false,
        dataSource: '',
        dataField: '',
        displayField: '',
        dataMapping: [],
      },
      animation: graphicProperties.value.animation || {
        enabled: false,
        type: 'fade-in',
        duration: 0.5,
        delay: 0,
        properties: {},
      },
    };
    updateGraphic(selectedGraphic.value.id, updatedProperties);
  }
};
</script>


<style lang="scss">
// Global base style — not scoped, ensuring rules hit 100% without scope penetration
@import '../../panels/styles/property-panel.scss';
</style>




<style scoped>
.property-panel {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.property-tabs {
  display: flex;
  background-color: var(--background);
  border-bottom: 1px solid var(--border);
  margin: 0;
  padding: 0;
}

.tab-button {
  flex: 1;
  padding: 10px 12px;
  background-color: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s ease;
  position: relative;
  margin: 0;
}

.tab-button:hover {
  background-color: var(--control-button-hover);
  color: var(--text);
}

.tab-button.active {
  color: var(--primary);
  font-weight: 600;
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background-color: var(--primary);
  border-radius: 2px 2px 0 0;
}

.property-section h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background-color: var(--background);
  letter-spacing: 0.3px;
}

.property-section p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
  padding: 60px 24px;
  line-height: 1.6;
}

.tab-content {
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  outline: none !important;
}

.tab-content > * {
  margin-top: 0 !important;
}

/* Explicitly override the child component root's padding (@import has scope-penetration issues in scoped styles) */
.style-panel-content {
  padding: 0 !important;
  margin: 0 !important;
}
</style>
