// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';

// ===== Tree index types (matching the directory structure) =====

export interface TemplateEntry {
  type: 'template';
  id: string;
  name: string;
  fileName: string;
  relativePath: string;
  deviceType: string;
  deviceModel: string;
  version: string;
  status: string;
  isDefault: boolean;
  variableCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryNode {
  type: 'category';
  name: string;
  path: string;
  templateCount: number;
  templates: TemplateEntry[];
}

export interface IndustryNode {
  type: 'industry';
  name: string;
  path: string;
  templateCount: number;
  categories: CategoryNode[];
}

export interface TemplateTreeIndex {
  schemaVersion: string;
  lastUpdated: string;
  totalTemplates: number;
  totalIndustries: number;
  totalCategories: number;
  description: string;
  rootPath: string;
  industries: IndustryNode[];
}

// ===== Directory structure operation DTOs =====

export interface CreateCategoryDto {
  industryName: string;
  categoryName: string;
}

export interface RenameCategoryDto {
  industryName: string;
  oldCategoryName: string;
  newCategoryName: string;
}

export interface DeleteCategoryDto {
  industryName: string;
  categoryName: string;
}

@Injectable()
export class TemplateIndexService {
  private readonly logger = new Logger(TemplateIndexService.name);
  private templatesBasePath: string;

  constructor(
    configService: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {
    const templatesDir = configService.get<string>('TEMPLATES_DIR') || '../../data/templates';
    this.templatesBasePath = this.resolvePath(templatesDir);
    this.logger.log(`设备模板目录: ${this.templatesBasePath}`);
  }

  /**
   * Resolve a relative path to an absolute path
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node (this file lives in packages/ss-system/dist/template/)
   *   TEMPLATES_DIR in .env.dev resolves against ss-services/ss-node
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *   TEMPLATES_DIR=../../data/templates in .env resolves against that directory
   *
   * Kept consistent with app.module.ts getDatabaseConfig() and backup.service.ts getProjectRoot().
   */
  private resolvePath(p: string): string {
    return this.pathResolver.resolve(p);
  }

  getBasePath(): string {
    return this.templatesBasePath;
  }

  /**
   * Rebuild index.json from the directory structure
   * Walks the templates/ directory and builds a tree index
   * ✨ Also rebuilds each BCP 47 language subdirectory's (zh-CN, en-US etc.) own index.json
   */
  rebuildIndex(): TemplateTreeIndex {
    if (!fs.existsSync(this.templatesBasePath)) {
      this.logger.warn(`模板目录不存在: ${this.templatesBasePath}`);
      return this.createEmptyIndex();
    }

    // 1. Rebuild the root index.json (backward compatible)
    const index = this.rebuildIndexAtPath(this.templatesBasePath, '根目录');
    const indexPath = path.join(this.templatesBasePath, 'index.json');
    this.writeIndexFile(indexPath, index);

    // 2. ✨ Walk BCP 47 language subdirectories and rebuild each language's index.json
    const dirEntries = fs.readdirSync(this.templatesBasePath, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.isDirectory() && /^[a-z]{2}-[A-Z]{2}$/.test(entry.name)) {
        const localePath = path.join(this.templatesBasePath, entry.name);
        const localeIndex = this.rebuildIndexAtPath(localePath, entry.name);
        const localeIndexPath = path.join(localePath, 'index.json');
        this.writeIndexFile(localeIndexPath, localeIndex);
        this.logger.log(
          `[${entry.name}] index.json 重建完成: ${localeIndex.totalTemplates} 个模板, ${localeIndex.totalIndustries} 个行业`,
        );
      }
    }

    return index;
  }

  /**
   * Scan the directory structure under the given path and build the index object (without writing files)
   */
  private rebuildIndexAtPath(basePath: string, label: string): TemplateTreeIndex {
    const industries = this.scanDirectory(basePath);

    const totalTemplates = industries.reduce(
      (sum, ind) => sum + ind.categories.reduce((s, cat) => s + cat.templates.length, 0),
      0,
    );

    return {
      schemaVersion: '2.0',
      lastUpdated: new Date().toISOString(),
      totalTemplates,
      totalIndustries: industries.length,
      totalCategories: industries.reduce((sum, ind) => sum + ind.categories.length, 0),
      description: 'Smart SCADA 设备模板库树形索引 - 按行业/设备类型双级目录组织',
      rootPath: basePath,
      industries,
    };
  }

  /**
   * Read the current index.json
   */
  loadIndex(): TemplateTreeIndex | null {
    const indexPath = path.join(this.templatesBasePath, 'index.json');
    console.log('smart-data device template path: ', indexPath);
    if (!fs.existsSync(indexPath)) return null;

    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      return JSON.parse(content) as TemplateTreeIndex;
    } catch (err: any) {
      this.logger.error(`读取 index.json 失败: ${err.message}`);
      return null;
    }
  }

  /**
   * Create an empty index
   */
  private createEmptyIndex(): TemplateTreeIndex {
    return {
      schemaVersion: '2.0',
      lastUpdated: new Date().toISOString(),
      totalTemplates: 0,
      totalIndustries: 0,
      totalCategories: 0,
      description: 'Smart SCADA 设备模板库树形索引',
      rootPath: this.templatesBasePath,
      industries: [],
    };
  }

  /**
   * Recursively scan the template directory and build the industry tree
   * @param basePath root path to scan, defaults to templatesBasePath
   */
  private scanDirectory(basePath?: string): IndustryNode[] {
    const scanPath = basePath ?? this.templatesBasePath;
    const isRootScan = scanPath === this.templatesBasePath;
    const entries = fs.readdirSync(scanPath, { withFileTypes: true });
    const industries: IndustryNode[] = [];

    for (const entry of entries) {
      // Skip non-directories and hidden directories
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      // Skip BCP 47 language directories (e.g. zh-CN, en-US) only when scanning the root directory
      // Do not skip when scanning inside a language subdirectory (otherwise industry directories would be missed)
      if (isRootScan && /^[a-z]{2}-[A-Z]{2}$/.test(entry.name)) continue;

      const industryPath = path.join(scanPath, entry.name);
      const categories = this.scanIndustryDirectory(industryPath, entry.name);

      const templateCount = categories.reduce((sum, cat) => sum + cat.templates.length, 0);

      industries.push({
        type: 'industry',
        name: entry.name,
        path: entry.name,
        templateCount,
        categories,
      });
    }

    // Sort by name
    industries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return industries;
  }

  /**
   * Scan all category subdirectories under an industry directory
   */
  private scanIndustryDirectory(dirPath: string, industryName: string): CategoryNode[] {
    if (!fs.statSync(dirPath).isDirectory()) return [];

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const categories: CategoryNode[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const categoryPath = path.join(dirPath, entry.name);
      const templates = this.scanCategoryDirectory(categoryPath, industryName, entry.name);

      categories.push({
        type: 'category',
        name: entry.name,
        path: path.join(industryName, entry.name).replace(/\\/g, '/'),
        templateCount: templates.length,
        templates,
      });
    }

    categories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return categories;
  }

  /**
   * Scan all template JSON files under a category directory
   */
  private scanCategoryDirectory(
    dirPath: string,
    industryName: string,
    categoryName: string,
  ): TemplateEntry[] {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const templates: TemplateEntry[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const filePath = path.join(dirPath, entry.name);
      const relativePath = path.join(industryName, categoryName, entry.name).replace(/\\/g, '/');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);
        const stat = fs.statSync(filePath);

        templates.push({
          type: 'template',
          id: json.id || '',
          name: json.name || entry.name,
          fileName: entry.name,
          relativePath,
          deviceType: json.deviceType || '',
          deviceModel: json.deviceModel || '',
          version: json.version || '0.0.0',
          status: json.status || 'published',
          isDefault: json.isDefault ?? false,
          variableCount: Array.isArray(json.variables) ? json.variables.length : 0,
          tags: json.tags || [],
          createdAt: json.metadata?.createdAt || json.createdAt || '',
          updatedAt: json.metadata?.updatedAt || json.updatedAt || stat.mtime.toISOString(),
        });
      } catch (err: any) {
        this.logger.warn(`解析模板文件失败: ${filePath} - ${err.message}`);
      }
    }

    templates.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return templates;
  }

  /**
   * Write the index file
   */
  private writeIndexFile(indexPath: string, index: TemplateTreeIndex): void {
    const dir = path.dirname(indexPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write: temp file first, then rename
    const tmpPath = indexPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
    fs.renameSync(tmpPath, indexPath);
  }

  // ===== Directory structure management operations =====

  /**
   * Create a category directory (a subdirectory under an industry)
   */
  async createCategory(dto: CreateCategoryDto): Promise<{ success: boolean; path: string }> {
    const dirPath = path.join(this.templatesBasePath, dto.industryName, dto.categoryName);

    if (fs.existsSync(dirPath)) {
      throw new Error(`分类目录已存在: ${dto.categoryName}`);
    }

    // Ensure the industry directory exists
    const industryPath = path.join(this.templatesBasePath, dto.industryName);
    if (!fs.existsSync(industryPath)) {
      fs.mkdirSync(industryPath, { recursive: true });
    }

    fs.mkdirSync(dirPath, { recursive: true });

    // Rebuild the index
    this.rebuildIndex();

    return {
      success: true,
      path: path.join(dto.industryName, dto.categoryName).replace(/\\/g, '/'),
    };
  }

  /**
   * Rename a category directory
   */
  async renameCategory(
    dto: RenameCategoryDto,
  ): Promise<{ success: boolean; oldPath: string; newPath: string }> {
    const oldPath = path.join(this.templatesBasePath, dto.industryName, dto.oldCategoryName);
    const newPath = path.join(this.templatesBasePath, dto.industryName, dto.newCategoryName);

    if (!fs.existsSync(oldPath)) {
      throw new Error(`分类目录不存在: ${dto.oldCategoryName}`);
    }

    if (fs.existsSync(newPath)) {
      throw new Error(`目标分类目录已存在: ${dto.newCategoryName}`);
    }

    // If the directory contains template files, their industry/category fields need updating
    this.updateTemplateFilesMetadata(oldPath, dto.industryName, dto.newCategoryName);

    fs.renameSync(oldPath, newPath);

    // Rebuild the index
    this.rebuildIndex();

    return {
      success: true,
      oldPath: path.join(dto.industryName, dto.oldCategoryName).replace(/\\/g, '/'),
      newPath: path.join(dto.industryName, dto.newCategoryName).replace(/\\/g, '/'),
    };
  }

  /**
   * Delete a category directory
   */
  async deleteCategory(dto: DeleteCategoryDto): Promise<{ success: boolean }> {
    const dirPath = path.join(this.templatesBasePath, dto.industryName, dto.categoryName);

    if (!fs.existsSync(dirPath)) {
      throw new Error(`分类目录不存在: ${dto.categoryName}`);
    }

    // Check whether the directory contains template files
    const files = fs.readdirSync(dirPath);
    const templateFiles = files.filter((f) => f.endsWith('.json'));
    if (templateFiles.length > 0) {
      throw new Error(`分类目录下存在 ${templateFiles.length} 个模板文件，请先删除模板文件`);
    }

    fs.rmdirSync(dirPath);

    // Rebuild the index
    this.rebuildIndex();

    return { success: true };
  }

  /**
   * Update the industry/category metadata of all template files under a directory
   */
  private updateTemplateFilesMetadata(
    dirPath: string,
    industryName: string,
    newCategoryName: string,
  ): void {
    if (!fs.existsSync(dirPath)) return;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const filePath = path.join(dirPath, entry.name);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);

        json.industry = industryName;
        json.category = newCategoryName;
        json.metadata = json.metadata || {};
        json.metadata.updatedAt = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
      } catch (err: any) {
        this.logger.warn(`更新模板文件元数据失败: ${filePath} - ${err.message}`);
      }
    }
  }

  /**
   * Get the directory structure (usable for UI display)
   */
  getDirectoryStructure(): IndustryNode[] {
    const index = this.loadIndex();
    if (!index) {
      // If index.json is missing, try rebuilding
      return this.rebuildIndex().industries;
    }
    return index.industries;
  }
}
