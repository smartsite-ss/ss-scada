// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { computed } from 'vue';
import {
  type ChartTagBinding,
  type ChartVariableBinding,
  createDefaultSeriesStyle,
  DEFAULT_TREND_COLORS,
} from '@scada-editor/shared';
import type { SelectableVariable } from '../components/tag-variable/types';
import { useProjectId } from './useProjectId';

export type TagBindingMode = 'flat' | 'array-single' | 'array-multiple';

export type TagBindingItem = ChartVariableBinding | ChartTagBinding;

export interface TagBindingOptions {
  /** Binding storage form: flat flat fields / array-single single-variable array / array-multiple multi-variable array */
  mode: TagBindingMode;
  /** Whether binding items carry trend styles (used only by array-multiple trend components) */
  withStyle?: boolean;
  /** Extra fields written back when a variable is selected in flat mode (e.g. unit / decimalPlaces carry-over) */
  extraFields?: (variable: SelectableVariable) => Record<string, unknown>;
}

/**
 * Unified management of device-variable binding read/write logic, reused by config panels of system plugins.
 * The generic TBinding distinguishes style-less (ChartVariableBinding) from trend-styled (ChartTagBinding) binding items.
 */
export function useTagBinding<TBinding extends TagBindingItem = ChartVariableBinding>(
  props: { graphicProperties: any },
  emit: () => void,
  options: TagBindingOptions,
) {
  const projectId = useProjectId();
  const customProps = computed(() => props.graphicProperties?.config?.customProps ?? {});

  const tags = computed<TBinding[]>(() => {
    const raw = customProps.value.tags;
    return Array.isArray(raw) ? (raw as TBinding[]) : [];
  });

  const current = computed<ChartVariableBinding | null>(() => {
    const cp = customProps.value;
    if (!cp.tagId) return null;
    return {
      projectId: cp.projectId ?? projectId.value,
      deviceId: cp.deviceId ?? '',
      deviceCode: cp.deviceCode ?? '',
      deviceName: cp.deviceName ?? '',
      tagId: cp.tagId,
      tagName: cp.tagName ?? '',
      dataType: cp.dataType ?? 'float',
    };
  });

  function bindLabel(item: TagBindingItem): string {
    const device = item.deviceName || item.deviceCode || '';
    const tag = item.tagName || item.tagId;
    return device ? `${device}.${tag}` : tag;
  }

  function buildBinding(variable: SelectableVariable): TBinding {
    const base = {
      projectId: projectId.value,
      deviceId: variable.deviceId,
      deviceCode: variable.deviceCode,
      deviceName: variable.deviceName,
      tagId: variable.tagId,
      tagName: variable.tagName,
      dataType: variable.dataType,
    };
    if (!options.withStyle) return base as TBinding;
    const color = DEFAULT_TREND_COLORS[tags.value.length % DEFAULT_TREND_COLORS.length];
    return { ...base, style: createDefaultSeriesStyle(color) } as TBinding;
  }

  function writeTags(next: TagBindingItem[]) {
    const gp = props.graphicProperties as any;
    if (!gp?.config) return;
    if (!gp.config.customProps) gp.config.customProps = {};
    gp.config.customProps.tags = next;
    emit();
  }

  /** Modify tags by replacing the reference to guarantee reactive refresh in edit mode; trend components reuse this method to modify per-variable styles */
  function mutateTags(mutator: (list: TBinding[]) => void) {
    const next = tags.value.slice();
    mutator(next);
    writeTags(next);
  }

  function addVariable(variable: SelectableVariable) {
    if (options.mode === 'flat') {
      const gp = props.graphicProperties as any;
      if (!gp?.config) return;
      if (!gp.config.customProps) gp.config.customProps = {};
      Object.assign(gp.config.customProps, {
        projectId: projectId.value,
        deviceId: variable.deviceId,
        deviceCode: variable.deviceCode,
        deviceName: variable.deviceName,
        tagId: variable.tagId,
        tagName: variable.tagName,
        dataType: variable.dataType,
        ...(options.extraFields ? options.extraFields(variable) : {}),
      });
      emit();
      return;
    }

    if (options.mode === 'array-single') {
      writeTags([buildBinding(variable)]);
      return;
    }

    mutateTags((list) => {
      if (list.some((t) => t.tagId === variable.tagId)) return;
      list.push(buildBinding(variable));
    });
  }

  function removeTag(index: number) {
    mutateTags((list) => {
      list.splice(index, 1);
    });
  }

  function clearTag() {
    writeTags([]);
  }

  function clearBind() {
    const gp = props.graphicProperties as any;
    if (!gp?.config) return;
    if (!gp.config.customProps) gp.config.customProps = {};
    Object.assign(gp.config.customProps, {
      projectId: '',
      deviceId: '',
      deviceCode: '',
      deviceName: '',
      tagId: '',
      tagName: '',
      dataType: 'float',
    });
    emit();
  }

  return {
    projectId,
    tags,
    current,
    bindLabel,
    addVariable,
    removeTag,
    clearTag,
    clearBind,
    mutateTags,
  };
}
