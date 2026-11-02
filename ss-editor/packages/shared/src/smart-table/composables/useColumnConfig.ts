// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, computed, watch, type Ref } from 'vue';
import type { SmartTableColumn, ColumnPersist } from '../types';

const STORAGE_PREFIX = 'smart-table:';
const STORAGE_SUFFIX = ':columns';

export function useColumnConfig(tableId: () => string, columnsRef: Ref<SmartTableColumn[]>) {
  const hiddenKeys = ref<string[]>([]);
  const dropdownVisible = ref(false);

  const storageKey = computed(() => `${STORAGE_PREFIX}${tableId()}${STORAGE_SUFFIX}`);

  /** Load persisted config */
  function loadFromStorage(): ColumnPersist | null {
    if (!tableId()) return null;
    try {
      const raw = localStorage.getItem(storageKey.value);
      if (!raw) return null;
      return JSON.parse(raw) as ColumnPersist;
    } catch {
      return null;
    }
  }

  /** Persist to localStorage */
  function persist() {
    if (!tableId()) return;
    try {
      const data: ColumnPersist = {
        hiddenKeys: hiddenKeys.value,
        updatedAt: Date.now(),
      };
      localStorage.setItem(storageKey.value, JSON.stringify(data));
    } catch {
      // localStorage may be full or disabled
    }
  }

  /** Initialize hidden columns */
  function init() {
    const columns = columnsRef.value;
    const persisted = loadFromStorage();
    if (persisted) {
      hiddenKeys.value = persisted.hiddenKeys.filter(
        (k) => columns.some((c) => c.key === k),
      );
    } else {
      hiddenKeys.value = columns
        .filter((c) => c.defaultVisible === false && !c.required)
        .map((c) => c.key);
    }
  }

  // Re-initialize when tableId or columns change
  watch(
    [tableId, columnsRef],
    () => {
      init();
    },
    { immediate: true },
  );

  /** Visible columns */
  const visibleColumns = computed(() => {
    return columnsRef.value.filter((c) => !hiddenKeys.value.includes(c.key));
  });

  /** Configurable columns (non-required) */
  const configurableColumns = computed(() => {
    return columnsRef.value.filter((c) => !c.required);
  });

  /** Toggle a column's visibility */
  function toggleColumn(key: string) {
    const col = columnsRef.value.find((c) => c.key === key);
    if (!col || col.required) return;

    const idx = hiddenKeys.value.indexOf(key);
    if (idx >= 0) {
      hiddenKeys.value.splice(idx, 1);
    } else {
      hiddenKeys.value.push(key);
    }
    persist();
  }

  /** Reset to default */
  function resetToDefault() {
    hiddenKeys.value = columnsRef.value
      .filter((c) => c.defaultVisible === false && !c.required)
      .map((c) => c.key);
    persist();
    dropdownVisible.value = false;
  }

  function toggleDropdown() {
    dropdownVisible.value = !dropdownVisible.value;
  }

  function closeDropdown() {
    dropdownVisible.value = false;
  }

  return {
    hiddenKeys,
    visibleColumns,
    configurableColumns,
    dropdownVisible,
    toggleColumn,
    resetToDefault,
    toggleDropdown,
    closeDropdown,
  };
}
