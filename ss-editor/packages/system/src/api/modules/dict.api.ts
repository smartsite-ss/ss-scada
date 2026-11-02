// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';

export interface DictItem {
  value: string;
  label: string;
  sortOrder: number;
  description: string;
}

export interface DictTable {
  dictId: string;
  dictName: string;
  category: string;
  description: string;
  version: string;
  sortOrder: number;
  items: DictItem[];
}

export interface DictCategory {
  category: string;
  tables: DictTable[];
}

export const dictApi = {
  /** Get the dictionary category tree (grouped by category) */
  getCategories(locale?: string): Promise<ApiResponse<DictCategory[]>> {
    return client.get('/dicts', { params: { locale } }).then((r) => r.data);
  },

  /** Get all dictionaries (flat list) */
  getAll(locale?: string): Promise<ApiResponse<DictTable[]>> {
    return client.get('/dicts/all', { params: { locale } }).then((r) => r.data);
  },

  /** Get dictionary details by dictId */
  getDict(dictId: string, locale?: string): Promise<ApiResponse<DictTable | null>> {
    return client.get(`/dicts/${dictId}`, { params: { locale } }).then((r) => r.data);
  },

  /** Create a category */
  createCategory(locale: string, name: string): Promise<ApiResponse<null>> {
    return client.post('/dicts/categories', { locale, name }).then((r) => r.data);
  },

  /** Rename a category */
  renameCategory(locale: string, oldName: string, newName: string): Promise<ApiResponse<null>> {
    return client.patch('/dicts/categories', { locale, oldName, newName }).then((r) => r.data);
  },

  /** Delete a category */
  deleteCategory(locale: string, name: string): Promise<ApiResponse<null>> {
    return client.delete('/dicts/categories', { data: { locale, name } }).then((r) => r.data);
  },

  /** Create a dictionary */
  createTable(locale: string, category: string, table: DictTable): Promise<ApiResponse<null>> {
    return client.post('/dicts/tables', { locale, category, table }).then((r) => r.data);
  },

  /** Update a dictionary */
  updateTable(locale: string, category: string, dictId: string, table: Partial<DictTable>): Promise<ApiResponse<null>> {
    return client.put(`/dicts/tables/${dictId}`, { table }, { params: { locale, category } }).then((r) => r.data);
  },

  /** Delete a dictionary */
  deleteTable(locale: string, category: string, dictId: string): Promise<ApiResponse<null>> {
    return client.delete(`/dicts/tables/${dictId}`, { data: { locale, category } }).then((r) => r.data);
  },

  /** Export a dictionary (returns the full JSON) */
  exportTable(dictId: string, locale: string, category: string): Promise<ApiResponse<DictTable>> {
    return client.get(`/dicts/tables/${dictId}/export`, { params: { locale, category } }).then((r) => r.data);
  },

  /** Import a dictionary */
  importTable(locale: string, category: string, dictId: string, table: DictTable): Promise<ApiResponse<null>> {
    return client.post('/dicts/tables/import', { locale, category, dictId, table }).then((r) => r.data);
  },

  /** Hot-reload all dictionaries */
  reload(): Promise<ApiResponse<{ locales: string[]; count: number }>> {
    return client.post('/dicts/reload').then((r) => r.data);
  },
};