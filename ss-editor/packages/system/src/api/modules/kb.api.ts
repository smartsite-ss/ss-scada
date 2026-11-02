// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';

/** Knowledge base module metadata */
export interface KbModule {
  id: string;
  name: string;
  nameI18n?: Record<string, string>;
  icon?: string;
  order: number;
  routePath?: string;
  /** Whether it is a global chapter (system overview / operation manual) */
  isGlobal?: boolean;
  /** Global chapter type */
  globalType?: 'overview' | 'manual';
}

/** Route mapping */
export interface KbRouteMapping {
  routePattern: string;
  knowledgePath: string;
  hintTextKey?: string;
  hintDismissible?: boolean;
}

/** Knowledge base definition of a single product */
export interface KbProduct {
  id: string;
  name: string;
  nameI18n?: Record<string, string>;
  icon?: string;
  order: number;
  modules: KbModule[];
  routeMap: KbRouteMapping[];
}

/** manifest.json structure (v2.0 multi-product) */
export interface KbManifest {
  version: string;
  products: KbProduct[];
}

/** Product list item (compact) */
export interface KbProductListItem {
  id: string;
  name: string;
  nameI18n?: Record<string, string>;
  icon?: string;
  order: number;
  moduleCount: number;
}

/** Product list response */
export interface KbProductsResponse {
  products: KbProductListItem[];
  defaultProduct: string;
}

/** Full article content */
export interface KbArticle {
  id: string;
  title: string;
  lang: string;
  /** Product ID (added in v2.0) */
  product: string;
  module: string;
  category: string;
  order: number;
  tags: string[];
  updatedAt: string;
  updatedBy?: string;
  status: string;
  /** Markdown body (without frontmatter) */
  content: string;
  /** Path relative to {KB_ROOT}/{lang}/{product} */
  filePath: string;
  /** Whether it was a fallback hit */
  fallback: boolean;
  /** The originally requested language when fallback occurred */
  requestedLang?: string;
}

/** Table-of-contents tree node */
export interface KbTreeNode {
  id: string;
  title: string;
  type: 'folder' | 'article';
  lang: string;
  /** Product ID (added in v2.0) */
  product?: string;
  /** Whether it is a global chapter */
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
  /** Product ID (added in v2.0) */
  product: string;
  fallback: boolean;
  requestedLang?: string;
}

/** Search result */
export interface KbSearchResult {
  id: string;
  title: string;
  module: string;
  /** Product ID (added in v2.0) */
  product: string;
  filePath: string;
  snippet: string;
  lang: string;
}

/** Language statistics */
export interface KbLangStat {
  lang: string;
  products: Array<{
    product: string;
    articleCount: number;
    moduleCount: number;
  }>;
  articleCount: number;
  moduleCount: number;
}

export interface KbLangsResponse {
  defaultLang: string;
  supportedLangs: string[];
  stats: KbLangStat[];
}

/** Image upload response */
export interface KbUploadImageResult {
  url: string;
}

/** Default product ID */
export const DEFAULT_PRODUCT = 'ss-data';

export const kbApi = {
  /** Get the list of all products */
  getProducts(): Promise<ApiResponse<KbProductsResponse>> {
    return client.get('/kb/products').then((res) => res.data);
  },

  /** Get the list of supported languages and statistics */
  getLangs(product?: string): Promise<ApiResponse<KbLangsResponse>> {
    const params = product ? { product } : {};
    return client.get('/kb/langs', { params }).then((res) => res.data);
  },

  /** Get the knowledge base table-of-contents tree */
  getTree(product?: string, lang?: string): Promise<ApiResponse<KbTreeNode[]>> {
    const params: Record<string, string> = {};
    if (product) params.product = product;
    if (lang) params.lang = lang;
    return client.get('/kb/tree', { params }).then((res) => res.data);
  },

  /** Route-match a knowledge base path */
  matchRoute(
    routePath: string,
    product?: string,
    lang?: string,
  ): Promise<ApiResponse<KbRouteMatch | null>> {
    const params: Record<string, string> = { path: routePath };
    if (product) params.product = product;
    if (lang) params.lang = lang;
    return client.get('/kb/route-match', { params }).then((res) => res.data);
  },

  /** Full-text search */
  search(query: string, product?: string, lang?: string): Promise<ApiResponse<KbSearchResult[]>> {
    const params: Record<string, string> = { q: query };
    if (product) params.product = product;
    if (lang) params.lang = lang;
    return client.get('/kb/search', { params }).then((res) => res.data);
  },

  /** Get a single article */
  getArticle(id: string, product?: string, lang?: string): Promise<ApiResponse<KbArticle>> {
    const params: Record<string, string> = {};
    if (product) params.product = product;
    if (lang) params.lang = lang;
    return client
      .get(`/kb/article/${encodeURIComponent(id)}`, { params })
      .then((res) => res.data);
  },

  /** Update article content (admin, lang required) */
  updateArticle(
    id: string,
    content: string,
    lang: string,
    product?: string,
  ): Promise<ApiResponse<KbArticle>> {
    const body: { content: string; lang: string; product?: string } = { content, lang };
    if (product) body.product = product;
    return client
      .put(`/kb/article/${encodeURIComponent(id)}`, body)
      .then((res) => res.data);
  },

  /** Upload an image (admin, base64) */
  uploadImage(
    filename: string,
    base64: string,
    moduleId: string,
    lang: string,
    product?: string,
  ): Promise<ApiResponse<KbUploadImageResult>> {
    const body: {
      filename: string;
      base64: string;
      moduleId: string;
      lang: string;
      product?: string;
    } = { filename, base64, moduleId, lang };
    if (product) body.product = product;
    return client.post('/kb/upload-image', body).then((res) => res.data);
  },

  /**
     * Construct the image access URL (backend GET /kb/image endpoint)
     * @param relativePath The relative path returned by uploadImage, e.g. "03-device/images/foo.png"
     * @param lang Language
     * @param product Product ID
     */
  buildImageUrl(relativePath: string, lang: string, product?: string): string {
    let url = `${client.defaults.baseURL}/kb/image?path=${encodeURIComponent(relativePath)}&lang=${encodeURIComponent(lang)}`;
    if (product) url += `&product=${encodeURIComponent(product)}`;
    return url;
  },
};
