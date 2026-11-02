// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Knowledge base type definitions — pure-file approach (v2.0 multi-product architecture)
 *
 * Storage model:
 *   - manifest.json: multi-product list + per-product module list and route mappings (language-independent)
 *   - Markdown frontmatter: each article carries its own metadata (id/title/lang/module etc.)
 *   - Git: version history (no built-in version table)
 *
 * File structure:
 *   ${KB_ROOT}/{lang}/{product}/{module}/*.md
 */

/** Knowledge base module metadata (language-independent, from manifest.json) */
export interface KbModule {
  id: string;
  name: string;
  nameI18n?: Record<string, string>;
  icon?: string;
  order: number;
  routePath?: string;
  /** Whether this is a global section (system overview/user manual) */
  isGlobal?: boolean;
  /** Global section type: overview (system overview) / manual (user manual) */
  globalType?: 'overview' | 'manual';
}

/** Route mapping (language-independent, from manifest.json) */
export interface KbRouteMapping {
  routePattern: string;
  knowledgePath: string;
  hintTextKey?: string;
  hintDismissible?: boolean;
}

/** A single product's knowledge base definition */
export interface KbProduct {
  id: string;
  name: string;
  nameI18n?: Record<string, string>;
  icon?: string;
  order: number;
  /** This product's module list */
  modules: KbModule[];
  /** This product's route mappings */
  routeMap: KbRouteMapping[];
}

/** manifest.json structure (v2.0 multi-product) */
export interface KbManifest {
  version: string;
  /** Product list (v2.0 addition, replaces v1.0's top-level modules/routeMap fields) */
  products: KbProduct[];
}

/** Product list item (slimmed down, for the frontend product selector) */
export interface KbProductListItem {
  id: string;
  name: string;
  nameI18n?: Record<string, string>;
  icon?: string;
  order: number;
  moduleCount: number;
}

/** Full article content */
export interface KbArticle {
  id: string;
  title: string;
  lang: string;
  /** Product ID (v2.0 addition) */
  product: string;
  module: string;
  category: string;
  order: number;
  tags: string[];
  updatedAt: string;
  updatedBy?: string;
  status: string;
  /** Markdown body (excluding frontmatter) */
  content: string;
  /** Path relative to {KB_ROOT}/{lang}/{product} */
  filePath: string;
  /** Whether this hit came from a fallback */
  fallback: boolean;
  /** The originally requested language when a fallback occurred */
  requestedLang?: string;
}

/** Directory tree node */
export interface KbTreeNode {
  id: string;
  title: string;
  type: 'folder' | 'article';
  lang: string;
  /** Product ID (v2.0 addition) */
  product?: string;
  /** Whether this is a global section */
  isGlobal?: boolean;
  globalType?: 'overview' | 'manual';
  fallback: boolean;
  order?: number;
  updatedAt?: string;
  children?: KbTreeNode[];
}

/** Route match result */
export interface KbRouteMatch {
  knowledgePath: string;
  hintTextKey?: string;
  articleId?: string;
  lang: string;
  /** Product ID (v2.0 addition) */
  product: string;
  fallback: boolean;
  requestedLang?: string;
}

/** Search result */
export interface KbSearchResult {
  id: string;
  title: string;
  module: string;
  /** Product ID (v2.0 addition) */
  product: string;
  filePath: string;
  /** Matched snippet */
  snippet: string;
  lang: string;
}

/** Language statistics (per product) */
export interface KbLangStat {
  lang: string;
  /** Per-product article statistics */
  products: Array<{
    product: string;
    articleCount: number;
    moduleCount: number;
  }>;
  /** Compatibility field: total article count */
  articleCount: number;
  /** Compatibility field: total module count */
  moduleCount: number;
}

export interface KbLangsResponse {
  defaultLang: string;
  supportedLangs: string[];
  stats: KbLangStat[];
}

/** Product list response */
export interface KbProductsResponse {
  products: KbProductListItem[];
  defaultProduct: string;
}
