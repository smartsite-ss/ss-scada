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

/** Menu i18n entry */
export interface MenuI18nItem {
  labelKey: string;
  label: string;
  sortOrder: number;
  description: string;
}

/** Menu i18n table definition (modeled on DictTable) */
export interface MenuI18nTable {
  menuId: string;
  menuName: string;
  category: string;
  description: string;
  version: string;
  sortOrder: number;
  items: MenuI18nItem[];
}

@Injectable()
export class MenuI18nService implements OnModuleInit {
  private readonly logger = new Logger(MenuI18nService.name);
  private menuBasePath: string;

  /** locale → (menuId → MenuI18nTable) */
  private cache = new Map<string, Map<string, MenuI18nTable>>();
  /** Supported language list */
  private supportedLocales: string[] = [];

  constructor(
    configService: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {
    const dataDir = configService.get<string>('DATA_DIR') || '../../ss-run/ss/data';
    const projectRoot = this.pathResolver.getProjectRoot();
    this.menuBasePath = path.resolve(projectRoot, dataDir, 'menu');
    this.logger.log(`菜单国际化数据目录: ${this.menuBasePath}`);
  }

  async onModuleInit() {
    await this.reloadAll();
  }

  /**
   * Reload all menu i18n data for all languages
   */
  async reloadAll(): Promise<void> {
    this.cache.clear();

    if (!fs.existsSync(this.menuBasePath)) {
      this.logger.warn(`菜单国际化目录不存在: ${this.menuBasePath}，将自动创建`);
      fs.mkdirSync(this.menuBasePath, { recursive: true });
      return;
    }

    this.supportedLocales = fs
      .readdirSync(this.menuBasePath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .filter((name) => LOCALE_PATTERN.test(name))
      .sort();

    if (this.supportedLocales.length === 0) {
      this.logger.warn(`未找到语言目录 (zh-CN, en-US 等): ${this.menuBasePath}`);
      return;
    }

    for (const locale of this.supportedLocales) {
      await this.reloadLocale(locale);
    }

    this.logger.log(
      `菜单国际化数据加载完成: 支持 ${this.supportedLocales.length} 种语言 [${this.supportedLocales.join(', ')}]`,
    );
  }

  /**
   * Reload the menu data for a given language
   */
  async reloadLocale(locale: string): Promise<void> {
    const localePath = path.join(this.menuBasePath, locale);

    if (!fs.existsSync(localePath)) {
      this.logger.warn(`语言目录不存在: ${localePath}`);
      return;
    }

    const localeCache = new Map<string, MenuI18nTable>();

    const jsonFiles = fs
      .readdirSync(localePath)
      .filter((f) => f.endsWith('.json'))
      .sort();

    for (const file of jsonFiles) {
      const filePath = path.join(localePath, file);
      try {
        let content = fs.readFileSync(filePath, 'utf-8');
        if (content.charCodeAt(0) === 0xfeff) {
          content = content.slice(1);
        }
        const table = JSON.parse(content) as MenuI18nTable;
        if (table.menuId && table.menuName && Array.isArray(table.items)) {
          localeCache.set(table.menuId, table);
        } else {
          this.logger.warn(`菜单国际化文件格式无效: ${filePath}`);
        }
      } catch (e: any) {
        this.logger.error(`加载菜单国际化文件失败: ${filePath}`, e.message);
      }
    }

    this.cache.set(locale, localeCache);
    this.logger.log(`语言 ${locale} 菜单数据加载完成: ${localeCache.size} 个菜单`);
  }

  /**
   * Get the i18n data for a given menu
   */
  getMenuI18n(menuId: string, locale: string = DEFAULT_LOCALE): MenuI18nTable | undefined {
    const localeCache = this.cache.get(locale);
    if (!localeCache) {
      const defaultCache = this.cache.get(DEFAULT_LOCALE);
      return defaultCache?.get(menuId);
    }
    return localeCache.get(menuId);
  }

  /**
   * Get all menu i18n data
   */
  getAllMenuI18n(locale: string = DEFAULT_LOCALE): MenuI18nTable[] {
    const localeCache = this.cache.get(locale) || this.cache.get(DEFAULT_LOCALE);
    return localeCache ? Array.from(localeCache.values()) : [];
  }

  /**
   * Get a single translation text by labelKey
   */
  getLabel(labelKey: string, locale: string = DEFAULT_LOCALE): string | undefined {
    const localeCache = this.cache.get(locale) || this.cache.get(DEFAULT_LOCALE);
    if (!localeCache) return undefined;
    for (const table of localeCache.values()) {
      const item = table.items.find((i) => i.labelKey === labelKey);
      if (item) return item.label;
    }
    return undefined;
  }

  /**
   * Get the supported language list
   */
  getSupportedLocales(): string[] {
    return [...this.supportedLocales];
  }

  /**
   * Get the base path of the menu data
   */
  getBasePath(): string {
    return this.menuBasePath;
  }

  // ==================== Write operations ====================

  /** Get a menu table file's path */
  private getTablePath(locale: string, menuId: string): string {
    const fileName = menuId.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    return path.join(this.menuBasePath, locale, `${fileName}.json`);
  }

  /**
   * Update menu i18n data (overwrites the JSON file)
   */
  updateMenuI18n(locale: string, menuId: string, table: Partial<MenuI18nTable>): void {
    const localeDir = path.join(this.menuBasePath, locale);
    if (!fs.existsSync(localeDir)) {
      fs.mkdirSync(localeDir, { recursive: true });
    }

    const filePath = this.getTablePath(locale, menuId);

    let merged: MenuI18nTable;
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      const existing = JSON.parse(content) as MenuI18nTable;
      merged = { ...existing, ...table, menuId };
    } else {
      merged = {
        menuId,
        menuName: table.menuName || '',
        category: table.category || 'system',
        description: table.description || '',
        version: table.version || '1.0',
        sortOrder: table.sortOrder ?? 1,
        items: table.items || [],
      };
    }

    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    this.logger.log(`更新菜单国际化数据: ${locale}/${menuId}`);

    // Reload the current language's cache
    this.reloadLocale(locale);
  }

  /**
   * Batch update menu entries (only updates items, keeping other fields unchanged)
   */
  updateMenuItems(locale: string, menuId: string, items: MenuI18nItem[]): void {
    const localeDir = path.join(this.menuBasePath, locale);
    if (!fs.existsSync(localeDir)) {
      fs.mkdirSync(localeDir, { recursive: true });
    }

    const filePath = this.getTablePath(locale, menuId);

    let merged: MenuI18nTable;
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      merged = JSON.parse(content) as MenuI18nTable;
      merged.items = items;
    } else {
      merged = {
        menuId,
        menuName: menuId,
        category: 'system',
        description: '',
        version: '1.0',
        sortOrder: 1,
        items,
      };
    }

    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
    this.logger.log(`更新菜单条目: ${locale}/${menuId} (${items.length} 条)`);

    // Reload the current language's cache
    this.reloadLocale(locale);
  }

  /**
   * Sync menu i18n data into the vue-i18n locale JSON files
   * Writes all labelKey → label mappings under data/menu/{locale}
   * into ss-editor/packages/system/src/locales/{locale}.json
   */
  syncToLocaleFiles(locale: string): { synced: number; errors: string[] } {
    const allTables = this.getAllMenuI18n(locale);
    if (allTables.length === 0) {
      return { synced: 0, errors: ['没有可同步的菜单国际化数据'] };
    }

    const errors: string[] = [];
    let synced = 0;

    // Determine the locale file path
    const projectRoot = this.pathResolver.getProjectRoot();
    const localeFilePath = path.resolve(
      projectRoot,
      '..',
      'ss-editor',
      'packages',
      'system',
      'src',
      'locales',
      `${locale}.json`,
    );

    if (!fs.existsSync(localeFilePath)) {
      errors.push(`locale 文件不存在: ${localeFilePath}`);
      return { synced: 0, errors };
    }

    try {
      let content = fs.readFileSync(localeFilePath, 'utf-8');
      if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
      const localeData = JSON.parse(content);

      // Ensure the system.nav path exists
      if (!localeData.system) localeData.system = {};
      if (!localeData.system.nav) localeData.system.nav = {};
      if (!localeData.system.settings) localeData.system.settings = {};
      if (!localeData.system.routes) localeData.system.routes = {};

      // Walk all menu tables' items and write them to the corresponding paths
      for (const table of allTables) {
        for (const item of table.items) {
          const keys = item.labelKey.split('.');
          let current = localeData;
          for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) current[keys[i]] = {};
            current = current[keys[i]];
          }
          const lastKey = keys[keys.length - 1];
          if (current[lastKey] !== item.label) {
            current[lastKey] = item.label;
            synced++;
          }
        }
      }

      fs.writeFileSync(localeFilePath, JSON.stringify(localeData, null, 2), 'utf-8');
      this.logger.log(`同步 ${synced} 个菜单名称到 ${localeFilePath}`);
    } catch (e: any) {
      errors.push(`同步失败: ${e.message}`);
      this.logger.error(`同步菜单国际化到 locale 文件失败: ${e.message}`);
    }

    return { synced, errors };
  }
}
