// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_LOCALE = 'zh-CN';
const LOCALE_PATTERN = /^[a-z]{2}-[A-Z]{2}$/;

/** Dictionary entry */
export interface DictItem {
  value: string;
  label: string;
  sortOrder: number;
  description: string;
}

/** Dictionary table definition */
export interface DictTable {
  dictId: string;
  dictName: string;
  category: string;
  description: string;
  version: string;
  sortOrder: number;
  items: DictItem[];
}

/** Dictionary category (first-level directory) */
export interface DictCategory {
  category: string;
  tables: DictTable[];
}

@Injectable()
export class DictionaryLoaderService implements OnModuleInit {
  private readonly logger = new Logger(DictionaryLoaderService.name);
  private dictsBasePath: string;

  /** locale → (dictId → DictTable) */
  private cache = new Map<string, Map<string, DictTable>>();
  /** locale → categories[] */
  private categoryCache = new Map<string, DictCategory[]>();
  /** Supported language list */
  private supportedLocales: string[] = [];

  constructor(
    configService: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {
    const dictsDir = configService.get<string>('DICTS_DIR') || '../../data/dicts';
    this.dictsBasePath = this.resolvePath(dictsDir);
    this.logger.log(`数据字典目录: ${this.dictsBasePath}`);
  }

  /**
   * Resolve a relative path to an absolute path
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node (this file lives in packages/ss-system/dist/dict/)
   *   DICTS_DIR in .env.dev resolves against ss-services/ss-node
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *   DICTS_DIR=../../data/dicts in .env resolves against that directory
   *
   * Kept consistent with app.module.ts getDatabaseConfig() and backup.service.ts getProjectRoot().
   */
  private resolvePath(p: string): string {
    return this.pathResolver.resolve(p);
  }

  async onModuleInit() {
    await this.reloadAll();
  }

  /**
   * Reload all dictionaries of all languages
   */
  async reloadAll(): Promise<void> {
    this.cache.clear();
    this.categoryCache.clear();

    if (!fs.existsSync(this.dictsBasePath)) {
      this.logger.warn(`字典目录不存在: ${this.dictsBasePath}`);
      return;
    }

    // Scan the root directory to identify locale subdirectories
    this.supportedLocales = fs
      .readdirSync(this.dictsBasePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .filter((name) => LOCALE_PATTERN.test(name))
      .sort();

    if (this.supportedLocales.length === 0) {
      this.logger.warn(`未找到语言目录 (zh-CN, en-US 等): ${this.dictsBasePath}`);
      return;
    }

    for (const locale of this.supportedLocales) {
      await this.reloadLocale(locale);
    }

    this.logger.log(
      `数据字典加载完成: 支持 ${this.supportedLocales.length} 种语言 [${this.supportedLocales.join(', ')}]`,
    );
  }

  /**
   * Reload a given language
   */
  async reloadLocale(locale: string): Promise<void> {
    const localePath = path.join(this.dictsBasePath, locale);

    if (!fs.existsSync(localePath)) {
      this.logger.warn(`语言目录不存在: ${localePath}`);
      return;
    }

    // Initialize the cache for this language
    const localeCache = new Map<string, DictTable>();
    const localeCategories: DictCategory[] = [];

    const categoryDirs = fs
      .readdirSync(localePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort();

    for (const category of categoryDirs) {
      const categoryDir = path.join(localePath, category);
      const tableFiles = fs
        .readdirSync(categoryDir)
        .filter((f) => f.endsWith('.json'))
        .sort();

      const tables: DictTable[] = [];
      for (const file of tableFiles) {
        const filePath = path.join(categoryDir, file);
        try {
          let content = fs.readFileSync(filePath, 'utf-8');
          // Strip the UTF-8 BOM (\uFEFF) to avoid JSON.parse failure
          if (content.charCodeAt(0) === 0xfeff) {
            content = content.slice(1);
          }
          const table = JSON.parse(content) as DictTable;
          if (table.dictId && table.dictName && Array.isArray(table.items)) {
            localeCache.set(table.dictId, table);
            tables.push(table);
          } else {
            this.logger.warn(`字典文件格式无效: ${filePath}`);
          }
        } catch (e: any) {
          this.logger.error(`加载字典文件失败: ${filePath}`, e.message);
        }
      }

      if (tables.length > 0) {
        localeCategories.push({ category, tables });
      }
    }

    this.cache.set(locale, localeCache);
    this.categoryCache.set(locale, localeCategories);

    this.logger.log(
      `语言 ${locale} 加载完成: ${localeCache.size} 个字典表, ${categoryDirs.length} 个分类`,
    );
  }

  /**
   * Get a dictionary table by dictId
   * @param dictId dictionary identifier
   * @param locale language, default zh-CN
   */
  getDict(dictId: string, locale: string = DEFAULT_LOCALE): DictTable | undefined {
    const localeCache = this.cache.get(locale);
    if (!localeCache) {
      // Fall back to the default language
      const defaultCache = this.cache.get(DEFAULT_LOCALE);
      return defaultCache?.get(dictId);
    }
    return localeCache.get(dictId);
  }

  /**
   * Get all dictionary categories (grouped by category)
   * @param locale language, default zh-CN
   */
  getAllCategories(locale: string = DEFAULT_LOCALE): DictCategory[] {
    return this.categoryCache.get(locale) || this.categoryCache.get(DEFAULT_LOCALE) || [];
  }

  /**
   * Get all dictionary tables (flat list)
   * @param locale language, default zh-CN
   */
  getAllDicts(locale: string = DEFAULT_LOCALE): DictTable[] {
    const localeCache = this.cache.get(locale) || this.cache.get(DEFAULT_LOCALE);
    return localeCache ? Array.from(localeCache.values()) : [];
  }

  /**
   * Get the supported language list
   */
  getSupportedLocales(): string[] {
    return [...this.supportedLocales];
  }

  /**
   * Get the base path of the dictionaries
   */
  getBasePath(): string {
    return this.dictsBasePath;
  }

  /**
   * Find and load a single dictionary table (scans the disk on cache miss)
   *
   * When a dictionary file is added after service startup, it is not in the cache.
   * This method scans all category directories under that locale, finds the matching file and loads it into the cache.
   *
   * @param dictId dictionary identifier
   * @param locale language
   * @returns the found dictionary table, or undefined
   */
  loadSingleDict(dictId: string, locale: string = DEFAULT_LOCALE): DictTable | undefined {
    // 1. Check the cache first
    const localeCache = this.cache.get(locale);
    if (localeCache?.has(dictId)) {
      return localeCache.get(dictId);
    }

    // 2. Cache miss; scan the disk
    const localePath = path.join(this.dictsBasePath, locale);
    if (!fs.existsSync(localePath)) {
      return undefined;
    }

    const categoryDirs = fs
      .readdirSync(localePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    for (const category of categoryDirs) {
      const categoryDir = path.join(localePath, category);
      const tableFiles = fs.readdirSync(categoryDir).filter((f) => f.endsWith('.json'));

      for (const file of tableFiles) {
        const filePath = path.join(categoryDir, file);
        try {
          let content = fs.readFileSync(filePath, 'utf-8');
          if (content.charCodeAt(0) === 0xfeff) {
            content = content.slice(1);
          }
          const table = JSON.parse(content) as DictTable;
          if (table.dictId === dictId && table.dictName && Array.isArray(table.items)) {
            // Load into the cache
            if (!localeCache) {
              const newCache = new Map<string, DictTable>();
              newCache.set(dictId, table);
              this.cache.set(locale, newCache);
            } else {
              localeCache.set(dictId, table);
            }
            // Also update categoryCache
            this.updateCategoryCache(locale, category, table);
            this.logger.log(`从磁盘加载单个字典: ${locale}/${category}/${file}`);
            return table;
          }
        } catch (e: any) {
          this.logger.warn(`扫描单个字典文件失败: ${filePath}`, e.message);
        }
      }
    }

    return undefined;
  }

  /** Append a single dictionary table to the category cache */
  private updateCategoryCache(locale: string, category: string, table: DictTable): void {
    let categories = this.categoryCache.get(locale);
    if (!categories) {
      categories = [];
      this.categoryCache.set(locale, categories);
    }
    let cat = categories.find((c) => c.category === category);
    if (!cat) {
      cat = { category, tables: [] };
      categories.push(cat);
    }
    if (!cat.tables.find((t) => t.dictId === table.dictId)) {
      cat.tables.push(table);
    }
  }

  // ==================== Write operations ====================

  /** camelCase → kebab-case, for file names */
  private toFileName(id: string): string {
    return id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /** Get the category directory path under a given locale */
  private getCategoryDir(locale: string, category: string): string {
    return path.join(this.dictsBasePath, locale, category);
  }

  /** Get a dictionary table's file path */
  private getTablePath(locale: string, category: string, dictId: string): string {
    return path.join(this.dictsBasePath, locale, category, `${this.toFileName(dictId)}.json`);
  }

  /**
   * Create a category (directory)
   */
  createCategory(locale: string, categoryName: string): void {
    const dir = this.getCategoryDir(locale, categoryName);
    if (fs.existsSync(dir)) {
      throw new Error(`分类 "${categoryName}" 已存在`);
    }
    fs.mkdirSync(dir, { recursive: true });
    // Update the cache so the frontend refresh picks up the new category
    let categories = this.categoryCache.get(locale);
    if (!categories) {
      categories = [];
      this.categoryCache.set(locale, categories);
    }
    if (!categories.find((c) => c.category === categoryName)) {
      categories.push({ category: categoryName, tables: [] });
    }
    this.logger.log(`创建分类: ${locale}/${categoryName}`);
  }

  /**
   * Rename a category (directory)
   */
  renameCategory(locale: string, oldName: string, newName: string): void {
    const oldDir = this.getCategoryDir(locale, oldName);
    const newDir = this.getCategoryDir(locale, newName);
    if (!fs.existsSync(oldDir)) {
      throw new Error(`分类 "${oldName}" 不存在`);
    }
    if (fs.existsSync(newDir)) {
      throw new Error(`分类 "${newName}" 已存在`);
    }
    fs.renameSync(oldDir, newDir);
    // Update the cache
    const categories = this.categoryCache.get(locale);
    if (categories) {
      const cat = categories.find((c) => c.category === oldName);
      if (cat) {
        cat.category = newName;
        cat.tables.forEach((t) => (t.category = newName));
      }
    }
    this.logger.log(`重命名分类: ${locale}/${oldName} → ${newName}`);
  }

  /**
   * Delete a category (directory and all dictionary files)
   */
  deleteCategory(locale: string, categoryName: string): void {
    const dir = this.getCategoryDir(locale, categoryName);
    if (!fs.existsSync(dir)) {
      throw new Error(`分类 "${categoryName}" 不存在`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    // Update the cache
    const categories = this.categoryCache.get(locale);
    if (categories) {
      const idx = categories.findIndex((c) => c.category === categoryName);
      if (idx >= 0) {
        categories.splice(idx, 1);
      }
    }
    this.logger.log(`删除分类: ${locale}/${categoryName}`);
  }

  /**
   * Create a dictionary table (JSON file)
   */
  createTable(locale: string, category: string, table: DictTable): void {
    const filePath = this.getTablePath(locale, category, table.dictId);
    if (fs.existsSync(filePath)) {
      throw new Error(`字典表 "${table.dictId}" 已存在`);
    }
    // Ensure the category directory exists
    const dir = this.getCategoryDir(locale, category);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(table, null, 2), 'utf-8');
    this.logger.log(`创建字典表: ${locale}/${category}/${table.dictId}`);
  }

  /**
   * Update a dictionary table (overwrites the JSON file)
   */
  updateTable(locale: string, category: string, dictId: string, table: Partial<DictTable>): void {
    const filePath = this.getTablePath(locale, category, dictId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`字典表 "${dictId}" 不存在`);
    }
    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    const existing = JSON.parse(content) as DictTable;
    const merged = { ...existing, ...table, dictId }; // keep dictId unchanged
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    this.logger.log(`更新字典表: ${locale}/${category}/${dictId}`);
  }

  /**
   * Delete a dictionary table (deletes the JSON file)
   */
  deleteTable(locale: string, category: string, dictId: string): void {
    const filePath = this.getTablePath(locale, category, dictId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`字典表 "${dictId}" 不存在`);
    }
    fs.unlinkSync(filePath);
    this.logger.log(`删除字典表: ${locale}/${category}/${dictId}`);
  }

  /**
   * Export a dictionary table (returns the raw JSON object)
   */
  exportTable(locale: string, category: string, dictId: string): DictTable {
    const filePath = this.getTablePath(locale, category, dictId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`字典表 "${dictId}" 不存在`);
    }
    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    return JSON.parse(content) as DictTable;
  }

  /**
   * Import a dictionary table (creates or overwrites the JSON file)
   */
  importTable(locale: string, category: string, dictId: string, table: DictTable): void {
    const dir = this.getCategoryDir(locale, category);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = this.getTablePath(locale, category, dictId);
    fs.writeFileSync(filePath, JSON.stringify(table, null, 2), 'utf-8');
    this.logger.log(`导入字典表: ${locale}/${category}/${dictId}`);
  }
}
