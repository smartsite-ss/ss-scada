// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Data-dictionary item
 */
export interface DictItem {
  value: string;
  label: string;
  sortOrder?: number;
  description?: string;
}

/**
 * Data-dictionary table
 */
export interface DictTable {
  dictId: string;
  dictName: string;
  category: string;
  items: DictItem[];
}

/**
 * Data-dictionary category
 */
export interface DictCategory {
  category: string;
  name: string;
  tables: DictTable[];
}
