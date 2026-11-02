// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * usePropertyEditor - Property panel core logic composable
 *
 * Extracted from StylePanel.vue, providing:
 * - config/geometry/style computed references
 * - Automatic injection of style property default values
 * - Group collapse state management
 * - Debounced updates (150ms)
 * - Custom property add/remove
 * - Graphic ID copy
 *
 * Usage:
 *   const { config, geometry, style, expandedGroups, ... } = usePropertyEditor(props, emit);
 */
import { ref, reactive, computed, watch, type ComputedRef } from 'vue';
import { usePageStore, type IGraphicConfig, type IGeometry, type IGraphicStyle } from '@scada-editor/core';

// ==================== Type exports ====================

export interface GraphicPropertiesData {
  config: IGraphicConfig;
  animation?: {
    enabled: boolean;
    type: string;
    duration: number;
    delay: number;
    properties: Record<string, any>;
  };
}

interface GroupKey {
  [key: string]: boolean;
}

// ==================== Constants ====================

const TEXT_RELEVANT_TYPES = ['label', 'text', 'button', 'input-text', 'textarea', 'link'];

const DEFAULT_STYLE: Partial<IGraphicStyle> = {
  borderWidth: 0,
  borderRadius: 0,
  opacity: 1,
  borderStyle: 'solid',
  backgroundColor: '#ffffff',
  borderColor: '#000000',
  fontColor: '#000000',
  fontSize: 14,
  fontFamily: 'Arial',
  fontStyle: 'normal',
  fontWeight: 'normal',
  textAlign: 'left',
  letterSpacing: 0,
  lineHeight: 1.2,
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowSpread: 0,
  shadowColor: 'rgba(0,0,0,0.2)',
  padding: '',
  margin: '',
};

const DEFAULT_EXPANDED: GroupKey = {
  graphic: true,
  position: true,
  fillBorder: false,
  textStyle: false,
  shadow: false,
  animation: false,
  layout: false,
  custom: false,
  generic: true,
};

const DEBOUNCE_MS = 150;

// ==================== Composable ====================

export function usePropertyEditor(
  graphicProperties: () => GraphicPropertiesData | undefined,
  emit: (event: 'updateGraphicProperties') => void,
) {
  // ---- Store ----
  const pageStore = usePageStore();

  function updateGraphic(id: string, properties: Partial<Record<string, any>>) {
    const currentPage = pageStore.currentPage;
    if (currentPage?.updateGraphic) {
      currentPage.updateGraphic(id, properties);
    }
  }

  // ---- Core references ----
  const config: ComputedRef<IGraphicConfig | undefined> = computed(
    () => graphicProperties()?.config,
  );

  const geometry: ComputedRef<IGeometry | undefined> = computed(() => config.value?.geometry);
  const style: ComputedRef<IGraphicStyle | undefined> = computed(() => config.value?.style);

  const hasGeometry = computed(() => !!geometry.value);
  const hasStyleConfig = computed(() => !!style.value);

  // ---- Text style visibility ----
  const showTextStyle = computed(() =>
    config.value ? TEXT_RELEVANT_TYPES.includes(config.value.type) : false,
  );

  // ---- style default value injection ----
  watch(config, (newConfig) => {
    if (!newConfig?.style) return;
    const s = newConfig.style;
    for (const [key, val] of Object.entries(DEFAULT_STYLE)) {
      if ((s as Record<string, unknown>)[key] === undefined) {
        (s as Record<string, unknown>)[key] = val;
      }
    }
  }, { immediate: true });

  // ---- Group collapse ----
  const expandedGroups = reactive<GroupKey>({ ...DEFAULT_EXPANDED });

  function toggleGroup(key: string, event: MouseEvent) {
    if ((event.target as HTMLElement).closest('.group-label') === event.currentTarget) {
      expandedGroups[key] = !expandedGroups[key];
    }
  }

  // ---- Debounced updates ----
  let updateTimer: ReturnType<typeof setTimeout> | null = null;

  function commitUpdate() {
    if (!config.value) return;
    const gp = graphicProperties();
    const updatedProperties: Record<string, any> = {
      ...config.value,
      updatedAt: Date.now(),
    };
    if (gp?.animation) {
      updatedProperties.animation = gp.animation;
    }
    updateGraphic(config.value.id, updatedProperties);
    emit('updateGraphicProperties');
  }

  function debouncedUpdate() {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      commitUpdate();
    }, DEBOUNCE_MS);
  }

  /** All input/change events go through the unified debounce */
  function onFieldChange() {
    debouncedUpdate();
  }

  function previewAnimation() {
    if (!config.value) return;
    const page = pageStore.currentPage as any;
    const engine = page?.getAnimationEngine?.();
    if (!engine) return;
    const graphic = page?.graphics?.find((g: any) => g.id === config.value!.id);
    if (graphic) {
      engine.previewOnce(graphic);
    }
  }

  // ---- Custom properties ----
  const newPropKey = ref('');
  const newPropValue = ref('');

  function addProp() {
    if (newPropKey.value && newPropValue.value && config.value) {
      config.value.customProps[newPropKey.value] = newPropValue.value;
      newPropKey.value = '';
      newPropValue.value = '';
      commitUpdate(); // commit immediately, bypassing the debounce
    }
  }

  function removeProp(key: string) {
    if (config.value) {
      delete config.value.customProps[key];
      commitUpdate(); // commit immediately
    }
  }

  // ---- Copy ID ----
  function copyGraphicId() {
    if (config.value) {
      navigator.clipboard.writeText(config.value.id).catch(err => {
        console.error('复制失败:', err);
      });
    }
  }

  // ---- Safe numeric property accessors ----
  function styleNum(key: keyof IGraphicStyle): number {
    return (style.value?.[key] as number) ?? 0;
  }

  function setStyleNum(key: keyof IGraphicStyle, value: number) {
    if (style.value) {
      (style.value as Record<string, unknown>)[key] = value;
    }
  }

  return {
    // Core references
    config,
    geometry,
    style,
    hasGeometry,
    hasStyleConfig,
    showTextStyle,
    // Group collapse
    expandedGroups,
    toggleGroup,
    // Updates
    onFieldChange,
    commitUpdate,
    previewAnimation,
    // Custom properties
    newPropKey,
    newPropValue,
    addProp,
    removeProp,
    // Copy ID
    copyGraphicId,
    // Safe numeric properties
    styleNum,
    setStyleNum,
  };
}
