// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { SystemMenuItem, SystemRole } from '../config/system-menu.config';
import client from '../api/client';

export const useMenuStore = defineStore('system-menu', () => {
  // DB-as-single-source-of-truth: initially an empty array, loaded from the backend by loadMenu()
  const items = ref<SystemMenuItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Flag whether remote menus have been loaded */
  const loaded = ref(false);
  /** Current subsystem identifier, read from window.__SUBSYSTEM__ */
  const currentSubsystem = ref<string | null>(
    (typeof window !== 'undefined' && (window as any).__SUBSYSTEM__) || null
  );

  /** Set the current subsystem */
  function setSubsystem(subsystem: string | null) {
    currentSubsystem.value = subsystem;
  }

  /**
   * Load remote menus (async; fills items on success)
   * Compatible with the TransformInterceptor-wrapped format: { code, data, message, timestamp }
   * DB-as-single-source-of-truth: on load failure the empty array is kept, no local defaults fallback
   */
  async function loadMenu() {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, string> = {};
      if (currentSubsystem.value) {
        params.subsystem = currentSubsystem.value;
      }
      const response = await client.get('/system/menu', { params });
      // TransformInterceptor-wrapped: response.data = { code, data: [...], message, timestamp }
      // Unwrapped format (raw array): response.data = [...]
      const menuData: unknown = response.data?.data ?? response.data;
      if (Array.isArray(menuData)) {
        items.value = menuData as SystemMenuItem[];
      }
      loaded.value = true;
    } catch (e: any) {
      error.value = e.message || '菜单加载失败';
      // Keep the empty array, no fallback
    } finally {
      loading.value = false;
    }
  }

  /**
   * Filter visible menus by role
   * @param menu Menu list
   * @param role Current user role; null/undefined means a not-logged-in user
   * @returns The filtered menu list, with sub-menus processed recursively
   * @deprecated Replaced by filterByMenuIds since v7.1. Kept only for testing and rollback reference; business code should not call it.
   */
  function filterByRole(menu: SystemMenuItem[], role?: SystemRole | null): SystemMenuItem[] {
    if (!role) {
      // Not-logged-in users only see menus without role restrictions
      return menu.filter(item => !item.roles || item.roles.length === 0);
    }

    return menu
      .filter(item => !item.roles || item.roles.length === 0 || item.roles.includes(role))
      .map(item => ({
        ...item,
        children: item.children ? filterByRole(item.children, role) : undefined,
      }));
  }

  /**
   * Filter visible menus by role menuIds (new mechanism in v7.1, replacing filterByRole)
   *
   * Rules:
   * - admin (isAdmin=true): return all menus
   * - Non-admin: keep only items present in menuIds
   * - A parent menu unchecked but with checked children: kept as a container, showing only the checked children
   * - A parent menu checked: kept, its children are also filtered by menuIds (children become undefined if empty after filtering)
   * - menuIds empty/undefined: return an empty array
   *
   * @param menu The full menu tree
   * @param ids The current role menuIds list
   * @param isAdmin Whether the user is admin (bypasses filtering)
   */
  function filterByMenuIds(
    menu: SystemMenuItem[],
    ids: string[] | undefined | null,
    isAdmin: boolean,
  ): SystemMenuItem[] {
    if (isAdmin) return menu;

    const idSet = new Set(ids || []);
    const result: SystemMenuItem[] = [];

    for (const item of menu) {
      const selfSelected = idSet.has(item.id);
      // Recursively filter sub-menus (child levels are always non-admin to avoid misjudgment)
      const filteredChildren = item.children?.length
        ? filterByMenuIds(item.children, ids, false)
        : undefined;

      if (selfSelected) {
        // Self checked: keep, with the filtered children (set undefined when empty, as a leaf node)
        result.push({
          ...item,
          children: filteredChildren && filteredChildren.length > 0 ? filteredChildren : undefined,
        });
      } else if (filteredChildren && filteredChildren.length > 0) {
        // Self unchecked but with checked children: keep as a container
        result.push({ ...item, children: filteredChildren });
      }
      // Otherwise discard
    }
    return result;
  }

  return { items, loading, loaded, error, currentSubsystem, setSubsystem, loadMenu, filterByRole, filterByMenuIds };
});