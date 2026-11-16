// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { TemplateVariable } from '../entities/device-tag-template.entity';
import { TemplateIndexService, TemplateTreeIndex } from './template-index.service';

export interface LoadedTemplate {
  id: string;
  name: string;
  description?: string;
  deviceType: string;
  deviceModel: string;
  industry: string;
  category: string;
  version: string;
  status: string;
  isDefault: boolean;
  variableCount: number;
  variables: TemplateVariable[];
  tags: string[];
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TemplateLoaderService implements OnModuleInit {
  private readonly logger = new Logger(TemplateLoaderService.name);

  // ✨ Changed from a single-level cache to a locale → (id → LoadedTemplate) two-level cache
  private readonly localeCaches = new Map<string, Map<string, LoadedTemplate>>();
  // ✨ Changed from a single index to locale → index
  private readonly localeIndexes = new Map<string, TemplateTreeIndex>();
  // ✨ List of recognized languages
  private supportedLocales: string[] = [];

  private templatesBasePath: string;

  constructor(private readonly indexService: TemplateIndexService) {
    this.templatesBasePath = this.indexService.getBasePath();
  }

  async onModuleInit(): Promise<void> {
    await this.loadAllLocales();
  }

  // ============ ✨ Multi-language entry points ============

  /** Scan the first-level directories under templates/, recognize BCP 47 language codes and load them all */
  async loadAllLocales(): Promise<void> {
    this.supportedLocales = [];
    this.localeCaches.clear();
    this.localeIndexes.clear();

    // Scan the root directory to recognize BCP 47 language directories (e.g. zh-CN, en-US, ja-JP)
    if (fs.existsSync(this.templatesBasePath)) {
      const entries = fs.readdirSync(this.templatesBasePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^[a-z]{2}-[A-Z]{2}$/.test(entry.name)) {
          this.supportedLocales.push(entry.name);
        }
      }
    }

    // Load language by language
    for (const locale of this.supportedLocales) {
      await this.loadLocale(locale);
    }

    this.logger.log(
      `Multilingual template library loaded: ${this.supportedLocales.length} locales [${this.supportedLocales.join(', ')}]`,
    );
  }

  /** Load templates for a given language (all languages use the templates/{locale}/ subdirectory) */
  async loadLocale(locale: string): Promise<void> {
    const localePath = path.join(this.templatesBasePath, locale);

    if (!fs.existsSync(localePath)) {
      this.logger.warn(`Locale directory does not exist: ${localePath}, falling back to zh-CN`);
      return;
    }

    // Load that language's index.json
    const index = this.loadLocaleIndex(localePath, locale);
    this.localeIndexes.set(locale, index);

    const cache = new Map<string, LoadedTemplate>();
    if (index?.industries) {
      let loadedCount = 0;
      for (const industry of index.industries) {
        for (const category of industry.categories) {
          for (const entry of category.templates) {
            const relativePath = entry.relativePath || (entry as any).filePath || '';
            if (!relativePath) continue;

            const filePath = path.join(localePath, relativePath);
            try {
              const template = this.loadTemplateFile(filePath, entry, industry.name, category.name);
              if (template) {
                cache.set(template.id, template);
                loadedCount++;
              }
            } catch (err: any) {
              this.logger.warn(`[${locale}] Failed to load template: ${relativePath} - ${err.message}`);
            }
          }
        }
      }
      this.logger.log(`[${locale}] Templates loaded: ${loadedCount}`);
    }

    this.localeCaches.set(locale, cache);
  }

  /** Read the index.json under the given path */
  private loadLocaleIndex(localePath: string, locale: string): TemplateTreeIndex {
    const indexPath = path.join(localePath, 'index.json');
    if (!fs.existsSync(indexPath)) {
      this.logger.warn(`[${locale}] index.json missing: ${indexPath}`);
      // Fallback: use zh-CN's index
      if (locale !== 'zh-CN') {
        const zhIndex = this.localeIndexes.get('zh-CN');
        if (zhIndex) {
          this.logger.warn(`[${locale}] Falling back to zh-CN index`);
          return zhIndex;
        }
      }
      // Try rebuilding from the directory structure
      return this.createEmptyIndex(locale);
    }
    const content = fs.readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(content) as TemplateTreeIndex;
    // Inject the locale marker
    (index as any)._locale = locale;
    return index;
  }

  private createEmptyIndex(locale: string): TemplateTreeIndex {
    return {
      schemaVersion: '2.0',
      lastUpdated: new Date().toISOString(),
      totalTemplates: 0,
      totalIndustries: 0,
      totalCategories: 0,
      description: `Template index (${locale})`,
      rootPath: '',
      industries: [],
    } as TemplateTreeIndex;
  }

  // ============ ✨ Language-aware query methods ============

  /** Get the default language */
  getDefaultLocale(): string {
    return 'zh-CN';
  }

  /** Get the supported language list */
  getSupportedLocales(): string[] {
    return [...this.supportedLocales];
  }

  /** Resolve a locale: validate and fall back */
  resolveLocale(locale?: string): string {
    if (locale && this.supportedLocales.includes(locale)) return locale;
    return this.getDefaultLocale();
  }

  /**
   * Fallback chain of a locale: itself first, then English (translation baseline).
   * zh-CN and en-US are complete locales, so they never fall back to another language.
   */
  private getFallbackChain(lang: string): string[] {
    const chain = [lang];
    if (lang !== 'zh-CN' && lang !== 'en-US') chain.push('en-US');
    return chain.filter((l) => this.localeCaches.has(l) || this.localeIndexes.has(l));
  }

  /** Get a template for a given language (with fallback) */
  getTemplate(id: string, locale?: string): LoadedTemplate | undefined {
    const lang = this.resolveLocale(locale);
    for (const candidate of this.getFallbackChain(lang)) {
      const tpl = this.localeCaches.get(candidate)?.get(id);
      if (tpl) return tpl;
    }
    return undefined;
  }

  /** Get all templates for a given language (current locale first, English fills the gaps) */
  getAllTemplates(locale?: string): LoadedTemplate[] {
    const lang = this.resolveLocale(locale);
    const chain = this.getFallbackChain(lang);
    if (chain.length <= 1) {
      const cache = this.localeCaches.get(lang);
      return cache ? Array.from(cache.values()) : [];
    }

    // Iterate from the weakest to the strongest locale so that the current locale wins
    const merged = new Map<string, LoadedTemplate>();
    for (const candidate of [...chain].reverse()) {
      this.localeCaches.get(candidate)?.forEach((tpl, id) => merged.set(id, tpl));
    }
    return Array.from(merged.values());
  }

  /** Get the index for a given language (merged with the English baseline for untranslated entries) */
  getIndex(locale?: string): TemplateTreeIndex | null {
    const lang = this.resolveLocale(locale);
    const chain = this.getFallbackChain(lang);
    let merged: TemplateTreeIndex | null = null;
    for (const candidate of [...chain].reverse()) {
      const index = this.localeIndexes.get(candidate);
      if (!index) continue;
      merged = merged ? this.mergeIndexes(merged, index) : index;
    }
    return merged;
  }

  /**
   * Merge an overlay index onto a base index.
   * Industries/categories are matched by name, templates by id; overlay entries win.
   */
  private mergeIndexes(base: TemplateTreeIndex, overlay: TemplateTreeIndex): TemplateTreeIndex {
    const result: TemplateTreeIndex = JSON.parse(JSON.stringify(base));

    for (const overlayIndustry of overlay.industries || []) {
      let industry = result.industries.find((i) => i.name === overlayIndustry.name);
      if (!industry) {
        industry = JSON.parse(JSON.stringify(overlayIndustry));
        result.industries.push(industry);
        continue;
      }

      for (const overlayCategory of overlayIndustry.categories || []) {
        let category = industry.categories.find((c) => c.name === overlayCategory.name);
        if (!category) {
          category = JSON.parse(JSON.stringify(overlayCategory));
          industry.categories.push(category);
          continue;
        }

        for (const overlayTemplate of overlayCategory.templates || []) {
          const existing = category.templates.findIndex((t) => t.id === overlayTemplate.id);
          if (existing >= 0) category.templates[existing] = { ...overlayTemplate };
          else category.templates.push({ ...overlayTemplate });
        }
        category.templateCount = category.templates.length;
      }
      industry.templateCount = industry.categories.reduce((sum, c) => sum + c.templates.length, 0);
    }

    result.totalIndustries = result.industries.length;
    result.totalCategories = result.industries.reduce((sum, i) => sum + i.categories.length, 0);
    result.totalTemplates = result.industries.reduce(
      (sum, i) => sum + i.categories.reduce((s, c) => s + c.templates.length, 0),
      0,
    );
    result.lastUpdated = new Date().toISOString();
    if ((overlay as any)._locale) (result as any)._locale = (overlay as any)._locale;
    return result;
  }

  /** Hot reload: rescan all language directories */
  async reload(): Promise<{ locales: string[]; count: number }> {
    await this.loadAllLocales();
    let total = 0;
    this.localeCaches.forEach((cache) => (total += cache.size));
    return { locales: [...this.supportedLocales], count: total };
  }

  /** Force-reload a given language's index and templates (from the existing index.json) */
  async rebuildAndReload(locale?: string): Promise<TemplateTreeIndex> {
    const lang = this.resolveLocale(locale);
    await this.loadLocale(lang);
    return this.localeIndexes.get(lang)!;
  }

  // ============ Legacy query methods (backward compatible, default zh-CN) ============

  getTemplatesByIndustry(industry: string, locale?: string): LoadedTemplate[] {
    return this.getAllTemplates(locale).filter((t) => t.industry === industry);
  }

  getTemplatesByDeviceType(deviceType: string, locale?: string): LoadedTemplate[] {
    return this.getAllTemplates(locale).filter((t) => t.deviceType === deviceType);
  }

  getTemplatesByProtocol(protocol: string, locale?: string): LoadedTemplate[] {
    return this.getAllTemplates(locale).filter((t) => t.deviceType === protocol);
  }

  searchTemplates(keyword: string, locale?: string): LoadedTemplate[] {
    const lower = keyword.toLowerCase();
    return this.getAllTemplates(locale).filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description?.toLowerCase().includes(lower) ||
        t.tags.some((tag) => tag.toLowerCase().includes(lower)),
    );
  }

  getCacheStats(locale?: string): { count: number; deviceTypes: string[]; industries: string[] } {
    const templates = this.getAllTemplates(locale);
    return {
      count: templates.length,
      deviceTypes: [...new Set(templates.map((t) => t.deviceType))],
      industries: [...new Set(templates.map((t) => t.industry))],
    };
  }

  // ============ Internal file loading (unchanged) ============

  private loadTemplateFile(
    filePath: string,
    indexEntry: any,
    industry: string,
    category: string,
  ): LoadedTemplate | null {
    if (!fs.existsSync(filePath)) {
      this.logger.warn(`Template file does not exist: ${filePath}`);
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);

    // ★ Forward compatibility: auto-generate GUIDs for variables missing them and write back to the JSON file
    let hasGeneratedGuid = false;
    const variables: TemplateVariable[] = (json.variables || []).map((v: any, index: number) => {
      let varGuid = v.guid;
      if (!varGuid) {
        varGuid = crypto.randomUUID();
        v.guid = varGuid;
        hasGeneratedGuid = true;
        this.logger.log(
          `Template variable missing guid, generated automatically: ${v.name || `[index=${index}]`} → ${varGuid}`,
        );
      }
      return {
        guid: varGuid,
        order: v.order ?? index,
        name: v.name || '',
        description: v.description,
        address: v.address || '',
        dataType: v.dataType || 'float32',
        direction: v.direction,
        byteOrder: v.byteOrder,
        registerCount: v.registerCount,
        scanRate: v.scanRate,
        timeout: v.timeout,
        retryCount: v.retryCount,
        priority: v.priority,
        enabled: v.enabled ?? true,
        scale: v.scale,
        offset: v.offset,
        conversionType: v.conversionType,
        conversionConfig: v.conversionConfig,
        unit: v.unit,
        displayFormat: v.displayFormat,
        minValue: v.minValue,
        maxValue: v.maxValue,
        engMinValue: v.engMinValue,
        engMaxValue: v.engMaxValue,
        deadbandMode: v.deadbandMode,
        deadbandValue: v.deadbandValue,
        deadbandPercent: v.deadbandPercent,
        deadbandTime: v.deadbandTime,
        alarmEnabled: v.alarmEnabled,
        alarmHighHigh: v.alarmHighHigh,
        alarmHigh: v.alarmHigh,
        alarmLow: v.alarmLow,
        alarmLowLow: v.alarmLowLow,
        alarmDeviation: v.alarmDeviation,
        qualityCheckEnabled: v.qualityCheckEnabled,
        maxAge: v.maxAge,
        archiveEnabled: v.archiveEnabled,
        archiveInterval: v.archiveInterval,
        retentionDays: v.retentionDays,
        category: v.category,
        tags: v.tags,
      };
    });

    // ★ Write the updated JSON back (GUIDs filled in)
    if (hasGeneratedGuid) {
      // Atomic write: temp file first, then rename
      const tmpPath = filePath + '.tmp-' + crypto.randomBytes(4).toString('hex');
      fs.writeFileSync(tmpPath, JSON.stringify(json, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);
      this.logger.log(`Template file guids backfilled and written: ${filePath}`);
    }

    return {
      id: indexEntry.id,
      name: json.name || indexEntry.name,
      description: json.description || indexEntry.name,
      deviceType: indexEntry.deviceType,
      deviceModel: indexEntry.deviceModel,
      industry,
      category,
      version: indexEntry.version,
      status: indexEntry.status,
      isDefault: indexEntry.isDefault,
      variableCount: variables.length,
      variables,
      tags: indexEntry.tags,
      filePath,
      createdAt: indexEntry.createdAt,
      updatedAt: indexEntry.updatedAt,
    };
  }
}
