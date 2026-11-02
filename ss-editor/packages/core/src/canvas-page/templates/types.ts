// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Page template management — type definitions
 *
 * Module: ss-editor / canvas and page / template management
 */

/** Template category */
export type TemplateCategory =
  | 'blank'          // Blank
  | 'login'          // Login page
  | 'dashboard'      // Dashboard
  | 'industrial'     // Industrial monitoring
  | 'data-screen'    // Data screen
  | 'mobile'         // Mobile
  | 'custom';        // Custom

/** Template source */
export type TemplateSource = 'builtin' | 'user' | 'market';

/** Layout type */
export type TemplateLayoutType = 'free' | 'grid' | 'flow' | 'circle';

/** Page template */
export interface PageTemplate {
  /** Template unique identifier */
  id: string;
  /** Template name */
  name: string;
  /** Template description */
  description?: string;
  /** Category */
  category: TemplateCategory;
  /** Icon (emoji or URL) */
  icon?: string;
  /** Thumbnail (dataURL or remote URL) */
  thumbnail?: string;

  /** Source identifier */
  source: TemplateSource;
  /** Author */
  author?: string;
  /** Version number */
  version: string;

  /** Page config */
  pageConfig: {
    width: number;
    height: number;
    backgroundColor: string;
    backgroundImage?: string;
    layout: TemplateLayoutType;
    themeName?: string;
  };

  /** Graphic JSON array */
  graphics: unknown[];

  /** Tags */
  tags?: string[];
  /** Creation time */
  createdAt: number;
  /** Update time */
  updatedAt: number;
}

/** Template category metadata */
export interface TemplateCategoryMeta {
  key: TemplateCategory;
  labelKey: string;
  icon: string;
}

/** Template category list */
export const TEMPLATE_CATEGORIES: TemplateCategoryMeta[] = [
  { key: 'blank',       labelKey: 'template.category.blank',       icon: '📄' },
  { key: 'login',       labelKey: 'template.category.login',       icon: '🔑' },
  { key: 'dashboard',   labelKey: 'template.category.dashboard',   icon: '📊' },
  { key: 'industrial',  labelKey: 'template.category.industrial',  icon: '⚙️' },
  { key: 'data-screen', labelKey: 'template.category.dataScreen',  icon: '🖥️' },
  { key: 'mobile',      labelKey: 'template.category.mobile',      icon: '📱' },
  { key: 'custom',      labelKey: 'template.category.custom',      icon: '📋' },
];
