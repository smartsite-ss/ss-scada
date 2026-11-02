// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { SystemMenuItem } from '../../config/system-menu.config';

export interface SystemMenuButton {
  id: string;
  menuId: string;
  labelKey: string;
  permissionCode: string;
  sortOrder: number;
}

/** Menu i18n entry */
export interface MenuI18nItem {
  labelKey: string;
  label: string;
  sortOrder: number;
  description: string;
}

/** Menu i18n table */
export interface MenuI18nTable {
  menuId: string;
  menuName: string;
  category: string;
  description: string;
  version: string;
  sortOrder: number;
  items: MenuI18nItem[];
}

export const menuApi = {
  /** Get the menu tree */
  getMenu(subsystem?: string): Promise<SystemMenuItem[]> {
    return client.get('/system/menu/', { params: subsystem ? { subsystem } : {} })
      .then((res) => res.data?.data ?? res.data);
  },

  /** Batch update the menu tree */
  updateMenu(menus: SystemMenuItem[]): Promise<{ ok: boolean }> {
    return client.put('/system/menu/', { menus }).then((res) => res.data);
  },

  /** Create a single menu item */
  createMenuItem(item: SystemMenuItem, parentId?: string): Promise<{ ok: boolean }> {
    return client.post('/system/menu/item', { item, parentId }).then((res) => res.data);
  },

  /** Update a single menu item */
  updateMenuItem(id: string, item: SystemMenuItem, parentId?: string): Promise<{ ok: boolean }> {
    return client.put(`/system/menu/item/${id}`, { item, parentId }).then((res) => res.data);
  },

  /** Delete a menu item */
  deleteMenuItem(id: string): Promise<{ ok: boolean }> {
    return client.delete(`/system/menu/${id}`).then((res) => res.data);
  },

  /** Get all menu buttons */
  getButtons(): Promise<SystemMenuButton[]> {
    return client.get('/system/menu/buttons').then((res) => res.data?.data ?? res.data);
  },

  /** Get the buttons of a specified menu */
  getButtonsByMenu(menuId: string): Promise<SystemMenuButton[]> {
    return client.get(`/system/menu/${menuId}/buttons`).then((res) => res.data?.data ?? res.data);
  },

  /** Batch update buttons */
  updateButtons(buttons: SystemMenuButton[]): Promise<{ ok: boolean }> {
    return client.put('/system/menu/buttons', { buttons }).then((res) => res.data);
  },

  /** Create a single button */
  createButton(btn: SystemMenuButton): Promise<{ ok: boolean }> {
    return client.post('/system/menu/buttons', btn).then((res) => res.data);
  },

  /** Delete a button */
  deleteButton(id: string): Promise<{ ok: boolean }> {
    return client.delete(`/system/menu/buttons/${id}`).then((res) => res.data);
  },

  /** Get the menu i18n data */
  getMenuI18n(locale?: string, menuId?: string): Promise<MenuI18nTable | MenuI18nTable[]> {
    const params: Record<string, string> = {};
    if (locale) params.locale = locale;
    if (menuId) params.menuId = menuId;
    return client.get('/system/menu/i18n', { params }).then((res) => res.data?.data ?? res.data);
  },

  /** Batch update menu i18n entries */
  updateMenuI18nItems(locale: string, menuId: string, items: MenuI18nItem[]): Promise<{ ok: boolean }> {
    return client.put('/system/menu/i18n/items', { locale, menuId, items }).then((res) => res.data);
  },

  /** Sync menu i18n data to the locale JSON files */
  syncMenuI18n(locale: string): Promise<{ synced: number; errors: string[] }> {
    return client.post('/system/menu/i18n/sync', { locale }).then((res) => res.data);
  },

  /** Get the list of supported languages */
  getMenuI18nLocales(): Promise<string[]> {
    return client.get('/system/menu/i18n/locales').then((res) => res.data?.data ?? res.data);
  },
};
