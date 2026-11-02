// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { PathResolverService } from '@ss-node/ss-core';
import { ProjectFsService } from './services/project-fs.service';

export interface SavePageResult {
  pageId: string;
  pageName: string;
  path: string;
}

export interface SaveAllPagesResult {
  success: boolean;
  projectName: string;
  savedCount: number;
  pages: SavePageResult[];
}

export interface ProjectsDirInfo {
  projectsDir: string;
  exists: boolean;
}

export interface PageFileInfo {
  name: string;
  fileName: string;
  filePath: string;
  updatedAt: string;
}

export interface PageListResult {
  success: boolean;
  projectName: string;
  pages: PageFileInfo[];
}

export interface PageReadResult {
  success: boolean;
  data: Record<string, any> | null;
}

export interface PageWithData {
  name: string;
  data: Record<string, any> | null;
  groupName?: string;
}

export interface ReadAllPagesResult {
  success: boolean;
  projectName: string;
  pages: PageWithData[];
}

export interface BatchReadPagesResult {
  success: boolean;
  projectName: string;
  pages: PageWithData[];
}

// ── Outline-related types (loaded on demand) ──

export interface OutlinePageItem {
  /** The unique ID inside page.json (e.g. page-xxx), filled only when the file exists and contains an id field */
  id?: string;
  /** Page name (folder name without the p_ prefix) */
  name: string;
  updatedAt: string;
  /** Preview thumbnail relative URL (preview_small.png), filled only when the file exists */
  previewSmallUrl?: string;
  /** Page background color, read from page.json */
  backgroundColor?: string;
  /** Page background-image path (relative, e.g. bg.png), read from page.json */
  backgroundImage?: string;
  /** Page width, read from page.json */
  width?: number;
  /** Page height, read from page.json */
  height?: number;
}

export interface OutlineGroupItem {
  name: string;
  pages: OutlinePageItem[];
}

export interface ProjectOutlineResult {
  success: boolean;
  projectName: string;
  rootPages: OutlinePageItem[];
  groups: OutlineGroupItem[];
  totalPageCount: number;
}

export interface PageSaveResult {
  success: boolean;
  pageName: string;
  folderPath: string;
}

export interface PageDeleteResult {
  success: boolean;
  pageName: string;
}

export interface GroupInfo {
  name: string;
  path: string;
  pageCount: number;
  createdAt: string;
}

export interface GroupListResult {
  success: boolean;
  projectName: string;
  groups: GroupInfo[];
}

export interface GroupCreateResult {
  success: boolean;
  groupName: string;
  path: string;
}

export interface GroupDeleteResult {
  success: boolean;
  groupName: string;
}

export interface ResourceUploadResult {
  success: boolean;
  pageName: string;
  resourceType: string;
  filePath: string;
}

/**
 * Clean up legacy backgroundImage paths.
 * Legacy (< 7.0) stored background images under pages/<page>/resources/bg.jpg,
 * the new version stores them uniformly under pages/p_<page>/bg.png.
 * This function auto-corrects old paths when reading page.json, ensuring the frontend always uses the correct URL.
 */
function sanitizeBackgroundImage(bg: string | undefined): string | undefined {
  if (!bg) return undefined;
  // Legacy path: resources/bg.jpg -> bg.png (backend uploadPageBackground saves uniformly as bg.png)
  const resourcesMatch = bg.match(/resources\/(.+?)$/);
  if (resourcesMatch) {
    const fileName = resourcesMatch[1];
    const baseName = path.parse(fileName).name;
    return baseName === 'bg' ? 'bg.png' : fileName;
  }
  // Handle legacy full-path cases: /api/v1/projects/xxx/pages/xxx/resources/bg.jpg -> bg.png
  const fullPathMatch = bg.match(/\/resources\/(.+?)$/);
  if (fullPathMatch) {
    const fileName = fullPathMatch[1];
    const baseName = path.parse(fileName).name;
    return baseName === 'bg' ? 'bg.png' : fileName;
  }
  // Already a correctly-formatted relative path (bg.png etc.); return directly
  if (isRelativePath(bg)) return bg;
  // New/legacy absolute API paths (/api/v1/projects/.../bg.png) -> extract the file name
  return bg.split('/').pop() || 'bg.png';
}

/** Decide whether it is a relative resource file name (e.g. bg.png, preview.png) */
function isRelativePath(path: string): boolean {
  return !path.startsWith('/') && !path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('data:') && !path.startsWith('blob:');
}

@Injectable()
export class PageSaveService {
  private readonly logger = new Logger(PageSaveService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pathResolver: PathResolverService,
    private readonly projectFs: ProjectFsService,
  ) {}

  getProjectsDir(): string {
    const configuredDir = this.configService.get<string>('PROJECTS_DIR') || './data/projects';
    return this.pathResolver.resolve(configuredDir);
  }

  private getPagesDir(projectName: string): string {
    const projectsDir = this.getProjectsDir();
    return path.join(projectsDir, projectName, 'pages');
  }

  private getPageFolderPath(projectName: string, pageName: string, groupName?: string): string {
    const pagesDir = this.getPagesDir(projectName);
    const normalizedPageName = this.normalizePageName(pageName);
    // Safe prefix removal: ensure the input carries no p_/g_ prefix (idempotent)
    const cleanPageName = normalizedPageName.replace(/^(p_|g_)/, '');
    if (groupName) {
      const cleanGroupName = groupName.replace(/^(p_|g_)/, '');
      const normalizedGroupName = this.normalizePageName(cleanGroupName);
      return path.join(pagesDir, `g_${normalizedGroupName}`, `p_${cleanPageName}`);
    }
    return path.join(pagesDir, `p_${cleanPageName}`);
  }

  /**
   * Get the page preview-image file path (preview.png / preview_small.png), returning only when the file exists.
   * Used by the GET preview_small.png read endpoint; reuses getPageFolderPath's normalization and
   * p_/g_ prefix-cleanup logic to prevent directory traversal.
   */
  getPreviewImagePath(
    projectName: string,
    pageName: string,
    groupName: string | undefined,
    resourceType: 'preview' | 'preview_small',
  ): string | null {
    const folderPath = this.getPageFolderPath(projectName, pageName, groupName);
    const fileName = resourceType === 'preview' ? 'preview.png' : 'preview_small.png';
    const filePath = path.join(folderPath, fileName);
    return fs.existsSync(filePath) ? filePath : null;
  }

  private normalizePageName(name: string): string {
    // Normalize page/group names: trim spaces, remove illegal chars, merge consecutive -
    return (
      name
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unnamed'
    );
  }

  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private checkPageNameConflict(
    projectName: string,
    pageName: string,
    groupName?: string,
    excludePageName?: string,
  ): void {
    const targetDir = this.getPagesDir(projectName);
    const baseDir = groupName
      ? path.join(targetDir, `g_${this.normalizePageName(groupName)}`)
      : targetDir;

    const prefixedName = `p_${this.normalizePageName(pageName)}`;
    if (prefixedName === `p_${this.normalizePageName(excludePageName || '')}`) return;

    if (fs.existsSync(baseDir)) {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name === prefixedName) {
          throw new BadRequestException(`页面名称已存在: ${pageName}`);
        }
      }
    }
  }

  listGroups(projectName: string): GroupListResult {
    const pagesDir = this.getPagesDir(projectName);

    if (!fs.existsSync(pagesDir)) {
      return { success: true, projectName, groups: [] };
    }

    const entries = fs.readdirSync(pagesDir, { withFileTypes: true });
    const groups: GroupInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('g_')) continue;

      const groupPath = path.join(pagesDir, entry.name);
      const stat = fs.statSync(groupPath);
      const subEntries = fs.readdirSync(groupPath, { withFileTypes: true });
      const pageCount = subEntries.filter(
        (e) =>
          e.isDirectory() &&
          e.name.startsWith('p_') &&
          fs.existsSync(path.join(groupPath, e.name, 'page.json')),
      ).length;

      groups.push({
        name: entry.name.slice(2), // strip g_ prefix
        path: groupPath,
        pageCount,
        createdAt: stat.birthtime.toISOString(),
      });
    }

    return { success: true, projectName, groups };
  }

  createGroup(projectName: string, groupName: string): GroupCreateResult {
    const pagesDir = this.getPagesDir(projectName);
    const safeName = this.normalizePageName(groupName);

    this.ensureDir(pagesDir);

    const groupPath = path.join(pagesDir, `g_${safeName}`);
    if (fs.existsSync(groupPath)) {
      throw new BadRequestException(`分组已存在: ${safeName}`);
    }

    fs.mkdirSync(groupPath, { recursive: true });
    this.logger.log(`Group created: ${projectName}/pages/g_${safeName}`);

    return { success: true, groupName: safeName, path: groupPath };
  }

  deleteGroup(projectName: string, groupName: string): GroupDeleteResult {
    const pagesDir = this.getPagesDir(projectName);
    const safeName = this.normalizePageName(groupName);
    const groupPath = path.join(pagesDir, `g_${safeName}`);

    if (!fs.existsSync(groupPath)) {
      throw new NotFoundException(`分组不存在: ${projectName}/pages/g_${safeName}`);
    }

    fs.rmSync(groupPath, { recursive: true, force: true });
    this.logger.log(`Group deleted: ${projectName}/pages/g_${safeName}`);

    return { success: true, groupName: safeName };
  }

  listPages(projectName: string, groupName?: string): PageListResult {
    const pagesDir = groupName
      ? path.join(this.getPagesDir(projectName), `g_${this.normalizePageName(groupName)}`)
      : this.getPagesDir(projectName);

    if (!fs.existsSync(pagesDir)) {
      return { success: true, projectName, pages: [] };
    }

    const entries = fs.readdirSync(pagesDir, { withFileTypes: true });
    const pages: PageFileInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('p_')) continue;

      const pageJsonPath = path.join(pagesDir, entry.name, 'page.json');
      if (!fs.existsSync(pageJsonPath)) continue;

      const stat = fs.statSync(pageJsonPath);

      pages.push({
        name: entry.name.slice(2), // strip p_ prefix
        fileName: 'page.json',
        filePath: pageJsonPath,
        updatedAt: stat.mtime.toISOString(),
      });
    }

    pages.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return { success: true, projectName, pages };
  }

  /**
   * List all pages of a project (including the root and all groups), deduplicated by page name
   * Dedupe rule: keep the first occurrence (root takes priority over same-named pages in groups)
   */
  listAllPages(projectName: string): PageListResult {
    const seenNames = new Set<string>();
    const allPages: PageFileInfo[] = [];

    // 1. Collect root-directory pages first
    const rootResult = this.listPages(projectName);
    for (const page of rootResult.pages) {
      if (!seenNames.has(page.name)) {
        seenNames.add(page.name);
        allPages.push(page);
      }
    }

    // 2. Get all groups, collecting group pages one by one (skipping already-seen same-named pages)
    const groupsResult = this.listGroups(projectName);
    for (const group of groupsResult.groups) {
      const groupResult = this.listPages(projectName, group.name);
      for (const page of groupResult.pages) {
        if (!seenNames.has(page.name)) {
          seenNames.add(page.name);
          allPages.push(page);
        }
      }
    }

    return { success: true, projectName, pages: allPages };
  }

  /**
   * P4: Get the project outline (group + page structure), excluding page.json data.
   * Scans only the directory structure, returning groups with their page lists and the root-page list.
   * Supports the editor's "load outline first -> load page data on demand" lazy-loading strategy.
   */
  getProjectOutline(projectName: string): ProjectOutlineResult {
    const pagesDir = this.getPagesDir(projectName);

    if (!fs.existsSync(pagesDir)) {
      return { success: true, projectName, rootPages: [], groups: [], totalPageCount: 0 };
    }

    const entries = fs.readdirSync(pagesDir, { withFileTypes: true });
    const rootPages: OutlinePageItem[] = [];
    const groups: OutlineGroupItem[] = [];
    const seenIds = new Set<string>();

    // Read metadata fields from page.json
    function readPageMeta(pageJsonPath: string): {
      id?: string;
      backgroundColor?: string;
      backgroundImage?: string;
      width?: number;
      height?: number;
    } {
      try {
        const content = fs.readFileSync(pageJsonPath, 'utf-8');
        const data = JSON.parse(content);
        return {
          id: data.id || undefined,
          backgroundColor: data.backgroundColor || undefined,
          backgroundImage: sanitizeBackgroundImage(data.backgroundImage),
          width: data.width !== undefined ? Number(data.width) : undefined,
          height: data.height !== undefined ? Number(data.height) : undefined,
        };
      } catch {
        return {};
      }
    }

    // Build the OutlinePageItem
    function buildPageItem(
      pageJsonPath: string,
      pageName: string,
      groupName: string | undefined,
    ): OutlinePageItem | null {
      if (!fs.existsSync(pageJsonPath)) return null;

      const meta = readPageMeta(pageJsonPath);
      // Root and groups are independent; same-named pages may exist in different groups
      // But dedupe by id, preventing the same page from being added twice
      if (meta.id && seenIds.has(meta.id)) return null;
      if (meta.id) seenIds.add(meta.id);

      const stat = fs.statSync(pageJsonPath);
      const previewSmallPath = path.join(path.dirname(pageJsonPath), 'preview_small.png');
      const hasPreviewSmall = fs.existsSync(previewSmallPath);

      const item: OutlinePageItem = {
        ...(meta.id ? { id: meta.id } : {}),
        name: pageName,
        updatedAt: stat.mtime.toISOString(),
      };

      if (hasPreviewSmall) {
        const encodedName = encodeURIComponent(pageName);
        if (groupName) {
          const encodedGroup = encodeURIComponent(groupName);
          item.previewSmallUrl = `/api/v1/projects/${projectName}/pages/${encodedName}/preview_small.png?group=${encodedGroup}`;
        } else {
          item.previewSmallUrl = `/api/v1/projects/${projectName}/pages/${encodedName}/preview_small.png`;
        }
      }

      // Pass through the metadata from page.json
      if (meta.backgroundColor) item.backgroundColor = meta.backgroundColor;
      if (meta.backgroundImage) item.backgroundImage = meta.backgroundImage;
      if (meta.width !== undefined) item.width = meta.width;
      if (meta.height !== undefined) item.height = meta.height;

      return item;
    }

    // Handle root-directory pages (p_ prefix)
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('p_')) continue;

      const pageJsonPath = path.join(pagesDir, entry.name, 'page.json');
      const pageName = entry.name.slice(2);
      const item = buildPageItem(pageJsonPath, pageName, undefined);
      if (item) rootPages.push(item);
    }

    // Handle groups (g_ prefix)
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('g_')) continue;

      const groupPath = path.join(pagesDir, entry.name);
      const groupName = entry.name.slice(2);
      const groupPages: OutlinePageItem[] = [];

      const subEntries = fs.readdirSync(groupPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isDirectory() || !sub.name.startsWith('p_')) continue;

        const pageJsonPath = path.join(groupPath, sub.name, 'page.json');
        const pageName = sub.name.slice(2);
        const item = buildPageItem(pageJsonPath, pageName, groupName);
        if (item) groupPages.push(item);
      }

      groups.push({ name: groupName, pages: groupPages });
    }

    const totalPageCount = rootPages.length + groups.reduce((sum, g) => sum + g.pages.length, 0);

    return {
      success: true,
      projectName,
      rootPages,
      groups,
      totalPageCount,
    };
  }

  /**
   * P3: Get the full data of all pages in a project (including the root and all groups), deduplicated by page name.
   * One call returns all pages' complete page.json data, with no need for extra per-page readPage calls.
   */
  readAllPages(projectName: string): ReadAllPagesResult {
    const seenNames = new Set<string>();
    const pages: PageWithData[] = [];

    // 1. Root-directory pages
    const rootResult = this.listPages(projectName);
    for (const info of rootResult.pages) {
      if (!seenNames.has(info.name)) {
        seenNames.add(info.name);
        try {
          const pageResult = this.readPage(projectName, info.name);
          pages.push({ name: info.name, data: pageResult.data });
        } catch {
          pages.push({ name: info.name, data: null });
        }
      }
    }

    // 2. Group pages
    const groupsResult = this.listGroups(projectName);
    for (const group of groupsResult.groups) {
      const groupResult = this.listPages(projectName, group.name);
      for (const info of groupResult.pages) {
        if (!seenNames.has(info.name)) {
          seenNames.add(info.name);
          try {
            const pageResult = this.readPage(projectName, info.name, group.name);
            pages.push({ name: info.name, groupName: group.name, data: pageResult.data });
          } catch {
            pages.push({ name: info.name, groupName: group.name, data: null });
          }
        }
      }
    }

    return { success: true, projectName, pages };
  }

  /**
   * P2: Batch-read the full data of specified pages (within one group).
   * Replaces N serial readPage HTTP requests with 1.
   */
  batchReadPages(projectName: string, names: string[], groupName?: string): BatchReadPagesResult {
    const pages: PageWithData[] = [];
    for (const name of names) {
      try {
        const result = this.readPage(projectName, name, groupName);
        pages.push({ name, groupName, data: result.data });
      } catch {
        pages.push({ name, groupName, data: null });
      }
    }
    return { success: true, projectName, pages };
  }

  readPage(projectName: string, pageName: string, groupName?: string): PageReadResult {
    const folderPath = this.getPageFolderPath(projectName, pageName, groupName);
    const filePath = path.join(folderPath, 'page.json');

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`页面文件不存在: ${projectName}/pages/${pageName}/page.json`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Clean up legacy backgroundImage paths (the resources/ prefix)
    if (data.backgroundImage) {
      data.backgroundImage = sanitizeBackgroundImage(data.backgroundImage) || data.backgroundImage;
    }

    return { success: true, data };
  }

  savePage(
    projectName: string,
    pageName: string,
    pageData: Record<string, any>,
    groupName?: string,
    previewBuffer?: Buffer,
    previewSmallBuffer?: Buffer,
  ): PageSaveResult {
    if (!pageData) {
      throw new BadRequestException('缺少页面数据');
    }

    const safeName = this.normalizePageName(pageName);
    const folderPath = this.getPageFolderPath(projectName, pageName, groupName);
    this.ensureDir(folderPath);

    const filePath = path.join(folderPath, 'page.json');

    const dataToSave: Record<string, any> = {
      ...pageData,
      updatedAt: new Date().toISOString(),
    };

    // Keep the id from the original page.json, preventing the frontend from overwriting the real id with name when sending lazy page data
    if (fs.existsSync(filePath)) {
      try {
        const existingContent = fs.readFileSync(filePath, 'utf-8');
        const existingData = JSON.parse(existingContent);
        if (existingData.id && existingData.id !== pageData.id) {
          dataToSave.id = existingData.id;
        }
      } catch {
        // Read failure does not block the save flow
      }
    }

    // Atomic write: temp file + rename, avoiding a mid-write crash corrupting page.json (P0-1)
    this.projectFs.atomicWriteJson(filePath, dataToSave);
    this.logger.log(`Page saved: ${projectName}/pages/${safeName}/page.json`);

    if (previewBuffer) {
      const previewPath = path.join(folderPath, 'preview.png');
      fs.writeFileSync(previewPath, previewBuffer);
      this.logger.log(`Preview saved: ${projectName}/pages/${safeName}/preview.png`);
    }

    if (previewSmallBuffer) {
      const previewSmallPath = path.join(folderPath, 'preview_small.png');
      fs.writeFileSync(previewSmallPath, previewSmallBuffer);
      this.logger.log(`Preview small saved: ${projectName}/pages/${safeName}/preview_small.png`);
    }

    return { success: true, pageName, folderPath };
  }

  deletePage(projectName: string, pageName: string, groupName?: string): PageDeleteResult {
    const folderPath = this.getPageFolderPath(projectName, pageName, groupName);

    if (!fs.existsSync(folderPath)) {
      throw new NotFoundException(`页面文件夹不存在: ${projectName}/pages/${pageName}`);
    }

    fs.rmSync(folderPath, { recursive: true, force: true });
    this.logger.log(`Page deleted: ${projectName}/pages/${pageName}`);

    return { success: true, pageName };
  }

  async saveAllPages(
    projectName: string,
    pages: Array<Record<string, any>>,
    groupName?: string,
    // Optional preview images for the current page: keyed by pageName, values contain preview / previewSmall Buffers
    previews?: Record<string, { preview?: Buffer; previewSmall?: Buffer }>,
  ): Promise<SaveAllPagesResult> {
    if (!pages || !Array.isArray(pages)) {
      throw new BadRequestException('缺少 pages 数据');
    }

    const pagesDir = this.getPagesDir(projectName);
    this.ensureDir(pagesDir);

    const baseDir = groupName
      ? path.join(pagesDir, `g_${this.normalizePageName(groupName)}`)
      : pagesDir;

    this.ensureDir(baseDir);

    const results: SavePageResult[] = [];
    for (const page of pages) {
      const pageId = page.id;
      const pageName = page.name || pageId;
      const safeName = this.normalizePageName(pageName);
      const folderPath = path.join(baseDir, `p_${safeName}`);
      this.ensureDir(folderPath);

      const filePath = path.join(folderPath, 'page.json');

      const pageData: Record<string, any> = {
        ...page,
        updatedAt: new Date().toISOString(),
      };

      // Keep the id from the original page.json, preventing the frontend from overwriting the real id with name when sending lazy page data
      if (fs.existsSync(filePath)) {
        try {
          const existingContent = fs.readFileSync(filePath, 'utf-8');
          const existingData = JSON.parse(existingContent);
          if (existingData.id && existingData.id !== page.id) {
            pageData.id = existingData.id;
          }
        } catch {
          // Read failure does not block the save flow
        }
      }

      // Atomic write: temp file + rename, avoiding a mid-write crash corrupting page.json (P0-1)
      this.projectFs.atomicWriteJson(filePath, pageData);
      this.logger.log(`Page saved: ${projectName}/pages/${safeName}/page.json`);

      // Flush preview images to disk synchronously (if any)
      const pagePreviews = previews?.[pageName] || previews?.[pageId];
      if (pagePreviews?.preview) {
        const previewPath = path.join(folderPath, 'preview.png');
        fs.writeFileSync(previewPath, pagePreviews.preview);
        this.logger.log(`Preview saved: ${projectName}/pages/${safeName}/preview.png`);
      }
      if (pagePreviews?.previewSmall) {
        const previewSmallPath = path.join(folderPath, 'preview_small.png');
        fs.writeFileSync(previewSmallPath, pagePreviews.previewSmall);
        this.logger.log(`Preview small saved: ${projectName}/pages/${safeName}/preview_small.png`);
      }

      results.push({ pageId, pageName, path: folderPath });
    }

    return { success: true, projectName, savedCount: results.length, pages: results };
  }

  uploadPageBackground(
    projectName: string,
    pageName: string,
    buffer: Buffer,
    _originalName: string,
    groupName?: string,
  ): ResourceUploadResult {
    const folderPath = this.getPageFolderPath(projectName, pageName, groupName);
    this.ensureDir(folderPath);

    // Normalize the background image format to bg.png (regardless of the uploaded format)
    const fileName = 'bg.png';
    const filePath = path.join(folderPath, fileName);

    fs.writeFileSync(filePath, buffer);
    const displayName = pageName;
    this.logger.log(`Background saved: ${displayName}/${fileName}`);

    return { success: true, pageName, resourceType: 'background', filePath };
  }

  uploadPagePreview(
    projectName: string,
    pageName: string,
    buffer: Buffer,
    smallBuffer?: Buffer,
    groupName?: string,
  ): ResourceUploadResult {
    const folderPath = this.getPageFolderPath(projectName, pageName, groupName);
    this.ensureDir(folderPath);

    const filePath = path.join(folderPath, 'preview.png');
    fs.writeFileSync(filePath, buffer);
    this.logger.log(`Preview saved: ${projectName}/pages/${pageName}/preview.png`);

    if (smallBuffer) {
      const smallPath = path.join(folderPath, 'preview_small.png');
      fs.writeFileSync(smallPath, smallBuffer);
      this.logger.log(`Preview small saved: ${projectName}/pages/${pageName}/preview_small.png`);
    }

    return { success: true, pageName, resourceType: 'preview', filePath };
  }

  getResourceFilePath(
    projectName: string,
    pageName: string,
    fileName: string,
    groupName?: string,
  ): string | null {
    const folderPath = this.getPageFolderPath(projectName, pageName, groupName);
    const safeName = path.basename(fileName);
    const filePath = path.join(folderPath, safeName);

    if (fs.existsSync(filePath)) {
      return filePath;
    }

    // Fallback lookup: if groupName carries a g_ prefix causing a wrong path, retry without the prefix
    if (groupName && groupName.startsWith('g_')) {
      const altPath = this.getPageFolderPath(projectName, pageName, groupName.slice(2));
      const altFilePath = path.join(altPath, safeName);
      if (fs.existsSync(altFilePath)) return altFilePath;
    }

    // Fallback lookup: if pageName carries a p_/g_ prefix, retry without the prefix
    if (/^(p_|g_)/.test(pageName)) {
      const cleanName = pageName.replace(/^(p_|g_)/, '');
      const altPath = this.getPageFolderPath(projectName, cleanName, groupName);
      const altFilePath = path.join(altPath, safeName);
      if (fs.existsSync(altFilePath)) return altFilePath;
    }

    return null;
  }

  renamePage(
    projectName: string,
    oldPageName: string,
    newPageName: string,
    groupName?: string,
  ): PageSaveResult {
    const oldFolderPath = this.getPageFolderPath(projectName, oldPageName, groupName);

    if (!fs.existsSync(oldFolderPath)) {
      throw new NotFoundException(`页面文件夹不存在: ${projectName}/pages/${oldPageName}`);
    }

    this.checkPageNameConflict(projectName, newPageName, groupName, oldPageName);

    const newFolderPath = this.getPageFolderPath(projectName, newPageName, groupName);

    fs.renameSync(oldFolderPath, newFolderPath);
    this.logger.log(`Page renamed: ${oldPageName} -> ${newPageName}`);

    return { success: true, pageName: newPageName, folderPath: newFolderPath };
  }

  /**
   * Migrate legacy project data to the new prefix naming convention (p_ / g_)
   * Page directories: {pageName}/ -> p_{normalized}/
   * Group directories: {groupName}/ -> g_{normalized}/ with inner pages p_{normalized}/
   * Dedupe: same-named pages keep only the first occurrence (root takes priority over groups)
   */
  migrateProject(projectName: string): {
    migratedPages: number;
    migratedGroups: number;
    removedDuplicates: number;
  } {
    const pagesDir = this.getPagesDir(projectName);
    if (!fs.existsSync(pagesDir)) {
      return { migratedPages: 0, migratedGroups: 0, removedDuplicates: 0 };
    }

    let migratedPages = 0;
    let migratedGroups = 0;
    let removedDuplicates = 0;

    const entries = fs.readdirSync(pagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip already-migrated ones
      if (entry.name.startsWith('p_') || entry.name.startsWith('g_')) continue;

      const fullPath = path.join(pagesDir, entry.name);

      // Decide group vs page: a group directory has subdirectories containing page.json
      const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      const hasSubPages = subEntries.some(
        (e) => e.isDirectory() && fs.existsSync(path.join(fullPath, e.name, 'page.json')),
      );

      if (hasSubPages) {
        // This is a group -> rename to g_{name}
        const normalizedName = this.normalizePageName(entry.name);
        const newGroupName = `g_${normalizedName}`;
        const newGroupPath = path.join(pagesDir, newGroupName);

        if (entry.name !== newGroupName) {
          fs.renameSync(fullPath, newGroupPath);
          this.logger.log(`Migrate: group "${entry.name}" → "${newGroupName}"`);
        }
        migratedGroups++;

        // Migrate the pages inside the group
        const migrated = this.migratePagesInsideDir(newGroupPath);
        migratedPages += migrated.migratedPages;
        removedDuplicates += migrated.removedDuplicates;
      } else {
        // This is a page -> rename to p_{name} (normalized name)
        const normalizedName = this.normalizePageName(entry.name);
        const newPageName = `p_${normalizedName}`;
        const newPagePath = path.join(pagesDir, newPageName);

        if (fs.existsSync(newPagePath)) {
          // Target already exists (same-named page); delete the current duplicate
          fs.rmSync(fullPath, { recursive: true, force: true });
          removedDuplicates++;
          this.logger.warn(
            `Migrate: removed duplicate page "${entry.name}" (already exists as "${newPageName}")`,
          );
        } else {
          fs.renameSync(fullPath, newPagePath);
          migratedPages++;
          this.logger.log(`Migrate: page "${entry.name}" → "${newPageName}"`);
        }
      }
    }

    this.logger.log(
      `Migration completed: ${projectName} — ${migratedPages} pages, ${migratedGroups} groups, ${removedDuplicates} duplicates removed`,
    );
    return { migratedPages, migratedGroups, removedDuplicates };
  }

  private migratePagesInsideDir(dirPath: string): {
    migratedPages: number;
    removedDuplicates: number;
  } {
    let migratedPages = 0;
    let removedDuplicates = 0;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip already-migrated ones
      if (entry.name.startsWith('p_')) continue;

      const fullPath = path.join(dirPath, entry.name);
      if (!fs.existsSync(path.join(fullPath, 'page.json'))) continue;

      const normalizedName = this.normalizePageName(entry.name);
      const newPageName = `p_${normalizedName}`;
      const newPagePath = path.join(dirPath, newPageName);

      if (fs.existsSync(newPagePath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removedDuplicates++;
        this.logger.warn(
          `Migrate: removed duplicate page "${entry.name}" in group (already exists as "${newPageName}")`,
        );
      } else {
        fs.renameSync(fullPath, newPagePath);
        migratedPages++;
        this.logger.log(`Migrate: page "${entry.name}" → "${newPageName}"`);
      }
    }

    return { migratedPages, removedDuplicates };
  }

  movePage(
    projectName: string,
    pageName: string,
    fromGroupName: string | undefined,
    toGroupName: string | undefined,
  ): PageSaveResult {
    const oldFolderPath = this.getPageFolderPath(projectName, pageName, fromGroupName);

    if (!fs.existsSync(oldFolderPath)) {
      throw new NotFoundException(`页面文件夹不存在: ${projectName}/pages/${pageName}`);
    }

    this.checkPageNameConflict(projectName, pageName, toGroupName);

    const newFolderPath = this.getPageFolderPath(projectName, pageName, toGroupName);
    this.ensureDir(path.dirname(newFolderPath));

    fs.renameSync(oldFolderPath, newFolderPath);
    this.logger.log(
      `Page moved: ${pageName} ${fromGroupName || '(root)'} -> ${toGroupName || '(root)'}`,
    );

    return { success: true, pageName, folderPath: newFolderPath };
  }

  getProjectsDirInfo(): ProjectsDirInfo {
    const projectsDir = this.getProjectsDir();
    const exists = fs.existsSync(projectsDir);

    return { projectsDir, exists };
  }

  /**
   * Export all pages as a ZIP file
   * Packs the whole pages directory (including group subdirectories)
   */
  async exportPagesZip(projectName: string): Promise<{ filePath: string; fileName: string }> {
    const pagesDir = this.getPagesDir(projectName);

    if (!fs.existsSync(pagesDir)) {
      throw new NotFoundException(`项目 "${projectName}" 的 pages 目录不存在`);
    }

    const tmpDir = os.tmpdir();
    const zipFileName = `${projectName}_pages_${Date.now()}.zip`;
    const zipFilePath = path.join(tmpDir, zipFileName);

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        this.logger.log(
          `Pages exported: ${projectName} -> ${zipFileName} (${archive.pointer()} bytes)`,
        );
        resolve();
      });

      archive.on('error', (err: Error) => {
        reject(err);
      });

      archive.pipe(output);

      // Pack the pages directory, keeping the internal structure (group/page folders)
      archive.directory(pagesDir, 'pages');

      archive.finalize();
    });

    return { filePath: zipFilePath, fileName: zipFileName };
  }

  /**
   * Import pages from a ZIP file
   * Supports two formats:
   *   1. A ZIP containing a pages root directory (merged into the pages directory after extraction)
   *   2. A ZIP directly containing page folders/JSON files
   */
  async importPagesZip(
    projectName: string,
    zipBuffer: Buffer,
    options?: { overwrite?: boolean },
  ): Promise<{ importedCount: number; warnings: string[] }> {
    const warnings: string[] = [];
    const tmpDir = path.join(os.tmpdir(), `pages_import_${Date.now()}`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      if (entries.length === 0) {
        throw new BadRequestException('ZIP 文件为空');
      }

      // Safe extraction: validate each entry's target path stays inside the temp directory, eliminating Zip Slip (P0-2)
      this.projectFs.extractZipSafely(zip, tmpDir);

      const pagesDir = this.getPagesDir(projectName);
      this.ensureDir(pagesDir);

      // Detect the ZIP structure: whether it contains a "pages/" root directory
      const extractedRoot = path.join(tmpDir, 'pages');
      const sourceDir =
        fs.existsSync(extractedRoot) && fs.statSync(extractedRoot).isDirectory()
          ? extractedRoot
          : tmpDir;

      let importedCount = 0;

      // Recursively import page files
      const importFromDir = (srcDir: string, targetBaseDir: string) => {
        const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true });

        for (const entry of srcEntries) {
          const srcPath = path.join(srcDir, entry.name);
          const destPath = path.join(targetBaseDir, entry.name);

          if (entry.isDirectory()) {
            // Check whether it is a page folder (containing page.json)
            const pageJsonPath = path.join(srcPath, 'page.json');
            if (fs.existsSync(pageJsonPath)) {
              // This is a page folder
              if (fs.existsSync(destPath)) {
                if (options?.overwrite) {
                  fs.rmSync(destPath, { recursive: true, force: true });
                  warnings.push(`已覆盖页面: ${entry.name}`);
                } else {
                  warnings.push(`跳过已存在的页面: ${entry.name}`);
                  continue;
                }
              }
              this.copyDirSync(srcPath, destPath);
              importedCount++;
              this.logger.log(`Page imported: ${projectName}/pages/${entry.name}`);
            } else {
              // This is a group directory; process recursively
              this.ensureDir(destPath);
              importFromDir(srcPath, destPath);
            }
          } else if (entry.name.endsWith('.json')) {
            // Standalone JSON files are treated as page data
            const pageName = entry.name.replace('.json', '');
            const safeName = this.normalizePageName(pageName);
            const pageFolder = path.join(targetBaseDir, `p_${safeName}`);

            if (fs.existsSync(pageFolder)) {
              if (options?.overwrite) {
                fs.rmSync(pageFolder, { recursive: true, force: true });
                warnings.push(`已覆盖页面: ${pageName}`);
              } else {
                warnings.push(`跳过已存在的页面: ${pageName}`);
                continue;
              }
            }

            this.ensureDir(pageFolder);
            const content = fs.readFileSync(srcPath, 'utf-8');
            this.projectFs.atomicWriteFileSync(path.join(pageFolder, 'page.json'), content);
            importedCount++;
            this.logger.log(`Page imported from JSON: ${projectName}/pages/${safeName}`);
          }
        }
      };

      importFromDir(sourceDir, pagesDir);

      if (importedCount === 0 && warnings.length === 0) {
        warnings.push('ZIP 文件中没有找到有效的页面数据');
      }

      this.logger.log(`Pages import completed: ${projectName}, imported ${importedCount} pages`);
      return { importedCount, warnings };
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}
