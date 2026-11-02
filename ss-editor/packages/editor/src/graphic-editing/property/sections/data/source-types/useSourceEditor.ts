// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { watch, ref, type Ref } from 'vue';
import { useI18n } from '@scada-editor/core';

/**
 * useSourceEditor — SourceEditor common sync logic
 *
 * Extracted from the common boilerplate of StaticSourceEditor / ApiSourceEditor / TagSourceSelector / DbSourceEditor:
 * 1. useI18n initialization
 * 2. Create a reactive ref based on props.typeData with automatic change watching
 * 3. emitUpdate utility function that fires the 'update' event
 *
 * Compared to extracting a base component, the composable does not intrude into template layout, adapting to the 4 components' quite different UI structures.
 */
export interface SourceEditorContext {
  /** Function that reads a value from typeData */
  getValue: (typeData: Record<string, any>) => any;
  /** Default value */
  fallback: any;
}

export function useSourceEditor() {
  const { t } = useI18n();

  /**
   * Create a ref synchronized with props.typeData and automatically register a deep watch.
   * When the corresponding field in typeData changes, the ref value is updated automatically.
   *
   * @param typeDataSource Getter function returning the current typeData
   * @param ctx Value reading context
   */
  function syncedRef(
    typeDataSource: () => Record<string, any> | undefined,
    ctx: SourceEditorContext,
  ): Ref<any> {
    const initial = typeDataSource() ?? {};
    const r = ref(ctx.getValue(initial) ?? ctx.fallback);

    watch(
      typeDataSource,
      (val) => {
        if (!val) return;
        const next = ctx.getValue(val);
        if (next !== undefined && next !== r.value) r.value = next;
      },
      { deep: true },
    );

    return r;
  }

  /**
   * Utility function that fires the 'update' event.
   */
  function emitUpdate(
    emit: (event: 'update', data: Record<string, any>) => void,
    data: Record<string, any>,
  ): void {
    emit('update', data);
  }

  return { t, syncedRef, emitUpdate };
}
