// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import type { GrayMatterFile } from 'gray-matter';
import {
  KbModule,
  KbProduct,
  KbRouteMapping,
  KbManifest,
  KbArticle,
  KbTreeNode,
  KbRouteMatch,
  KbSearchResult,
  KbLangStat,
  KbLangsResponse,
  KbProductListItem,
  KbProductsResponse,
} from './knowledge.types';
import { DEFAULT_MANIFEST, DEFAULT_PRODUCT_ID } from './knowledge.manifest';

/**
 * Knowledge base service — pure-file approach (v2.0 multi-product architecture)
 *
 * Storage model:
 *   - File system: ${KB_ROOT}/{lang}/{product}/{module}/*.md (Markdown body + frontmatter metadata)
 *   - manifest.json: multi-product list + per-product module list and route mappings (language-independent, globally unique)
 *   - Git: version history (no built-in version table; managed by Git)
 *
 * No database dependency; manual Markdown edits take effect automatically (manifest has a 1-minute cache).
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly kbRoot: string;
  private readonly defaultLang: string;
  private readonly supportedLangs: string[];
  private readonly defaultProduct: string;
  private manifestCache: KbManifest | null = null;
  private manifestLoadedAt = 0;
  /** manifest.json cache TTL (milliseconds) */
  private readonly MANIFEST_TTL_MS = 60_000;

  constructor(
    private readonly config: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {
    this.kbRoot = this.resolveKbRoot();
    this.defaultLang = this.config.get<string>('KB_DEFAULT_LANG') || 'zh-CN';
    this.supportedLangs = (this.config.get<string>('KB_SUPPORTED_LANGS') || 'zh-CN')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.defaultProduct = DEFAULT_PRODUCT_ID;
  }

  private resolveKbRoot(): string {
    const dataDir = this.config.get<string>('DATA_DIR') || '../../data';
    const absoluteDataDir = this.resolvePath(dataDir);
    const configured = this.config.get<string>('KB_ROOT');
    if (configured) {
      const expanded = configured.replace(/\$\{DATA_DIR\}/g, absoluteDataDir);
      return this.resolvePath(expanded);
    }
    return path.resolve(absoluteDataDir, 'faq');
  }

  /**
   * Resolve a relative path to an absolute path
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node (this file lives in packages/ss-system/dist/knowledge/)
   *   DATA_DIR / KB_ROOT in .env.dev resolve against ss-services/ss-node
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *   relative paths in .env resolve against that directory
   *
   * Kept consistent with app.module.ts getDatabaseConfig() and backup.service.ts getProjectRoot().
   */
  private resolvePath(p: string): string {
    return this.pathResolver.resolve(p);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureKbRoot();
    await this.loadManifest(true);
    this.logger.log(
      `Knowledge base initialized at ${this.kbRoot} (default=${this.defaultLang}, langs=[${this.supportedLangs.join(', ')}], product=${this.defaultProduct})`,
    );
  }

  // ==================== Public API ====================

  /** Get the full product list */
  async getProducts(): Promise<KbProductsResponse> {
    const manifest = await this.loadManifest();
    const products: KbProductListItem[] = manifest.products.map((p) => ({
      id: p.id,
      name: p.name,
      nameI18n: p.nameI18n,
      icon: p.icon,
      order: p.order,
      moduleCount: p.modules.length,
    }));
    products.sort((a, b) => a.order - b.order);
    return {
      products,
      defaultProduct: this.defaultProduct,
    };
  }

  /** Get the supported language list + statistics (per product) */
  async getLangs(product?: string): Promise<KbLangsResponse> {
    const resolvedProduct = this.resolveProduct(product);
    const stats: KbLangStat[] = [];
    for (const lang of this.supportedLangs) {
      const langDir = path.join(this.kbRoot, lang);
      const { articleCount, moduleCount } = await this.scanLangStats(langDir, resolvedProduct);
      stats.push({
        lang,
        products: [{ product: resolvedProduct, articleCount, moduleCount }],
        articleCount,
        moduleCount,
      });
    }
    return {
      defaultLang: this.defaultLang,
      supportedLangs: [...this.supportedLangs],
      stats,
    };
  }

  /** Get the directory tree (missing languages automatically fall back to the default language, nodes marked fallback:true) */
  async getTree(product?: string, lang?: string): Promise<KbTreeNode[]> {
    const resolvedProduct = this.resolveProduct(product);
    const resolvedLang = this.resolveLang(lang);
    const productManifest = await this.loadProductManifest(resolvedProduct);
    if (!productManifest) return [];
    const tree: KbTreeNode[] = [];
    for (const mod of productManifest.modules) {
      const node = await this.buildModuleNode(mod, resolvedProduct, resolvedLang);
      if (node) tree.push(node);
    }
    return tree;
  }

  /** Read an article (falls back to the default language when the requested language does not exist) */
  async getArticle(id: string, product?: string, lang?: string): Promise<KbArticle> {
    this.assertSafeId(id);
    const resolvedProduct = this.resolveProduct(product);
    const resolvedLang = this.resolveLang(lang);
    const article = await this.tryReadArticle(id, resolvedProduct, resolvedLang);
    if (article) return article;

    if (resolvedLang !== this.defaultLang) {
      const fallback = await this.tryReadArticle(id, resolvedProduct, this.defaultLang);
      if (fallback) {
        return { ...fallback, fallback: true, requestedLang: resolvedLang };
      }
    }
    throw new NotFoundException(`Article not found: ${id} (product=${resolvedProduct})`);
  }

  /** Update an article (language must be specified; frontmatter is updated on write) */
  async updateArticle(
    id: string,
    content: string,
    userId: string,
    lang: string,
    product?: string,
  ): Promise<KbArticle> {
    this.assertSafeId(id);
    const resolvedProduct = this.resolveProduct(product);
    if (!lang || !this.supportedLangs.includes(lang)) {
      throw new BadRequestException(`Invalid lang: ${lang}`);
    }
    const filePath = await this.resolveArticlePath(id, resolvedProduct, lang, true);
    // Parse the new content and merge frontmatter
    const parsed = matter(content);
    const frontmatter = {
      ...parsed.data,
      id,
      lang,
      product: resolvedProduct,
      updatedAt: new Date().toISOString().slice(0, 10),
      updatedBy: userId,
    };
    const newContent = matter.stringify(parsed.content, frontmatter);
    await fs.writeFile(filePath, newContent, 'utf-8');
    this.logger.log(
      `Article updated: ${id} (product=${resolvedProduct}, lang=${lang}, user=${userId})`,
    );
    return this.readArticleFile(filePath, resolvedProduct, lang, false);
  }

  /** Route matching (route mappings are language-independent; only article content is looked up per language) */
  async matchRoute(
    routePath: string,
    product?: string,
    lang?: string,
  ): Promise<KbRouteMatch | null> {
    const resolvedProduct = this.resolveProduct(product);
    const resolvedLang = this.resolveLang(lang);
    const productManifest = await this.loadProductManifest(resolvedProduct);
    if (!productManifest) return null;
    const mapping = this.findRouteMapping(productManifest.routeMap, routePath);
    if (!mapping) return null;

    const hasArticle = await this.articleExists(
      mapping.knowledgePath,
      resolvedProduct,
      resolvedLang,
    );
    if (hasArticle) {
      return {
        knowledgePath: mapping.knowledgePath,
        hintTextKey: mapping.hintTextKey,
        lang: resolvedLang,
        product: resolvedProduct,
        fallback: false,
      };
    }

    if (resolvedLang !== this.defaultLang) {
      const hasDefault = await this.articleExists(
        mapping.knowledgePath,
        resolvedProduct,
        this.defaultLang,
      );
      if (hasDefault) {
        return {
          knowledgePath: mapping.knowledgePath,
          hintTextKey: mapping.hintTextKey,
          lang: this.defaultLang,
          product: resolvedProduct,
          fallback: true,
          requestedLang: resolvedLang,
        };
      }
    }
    return {
      knowledgePath: mapping.knowledgePath,
      hintTextKey: mapping.hintTextKey,
      lang: resolvedLang,
      product: resolvedProduct,
      fallback: false,
    };
  }

  /** Full-text search (searches only within the specified language+product directory, no cross-language fallback) */
  async search(query: string, product?: string, lang?: string): Promise<KbSearchResult[]> {
    if (!query || !query.trim()) return [];
    const resolvedProduct = this.resolveProduct(product);
    const resolvedLang = this.resolveLang(lang);
    const productDir = path.join(this.kbRoot, resolvedLang, resolvedProduct);
    const results: KbSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    await this.scanMarkdownFiles(productDir, async (filePath, parsed) => {
      const content = (parsed.content as string).toLowerCase();
      const index = content.indexOf(lowerQuery);
      if (index >= 0) {
        const start = Math.max(0, index - 50);
        const snippet = parsed.content.slice(start, index + query.length + 100);
        const relPath = path.relative(productDir, filePath).replace(/\\/g, '/');
        const id = (parsed.data.id as string) || this.pathToId(relPath);
        results.push({
          id,
          title: (parsed.data.title as string) || id,
          module: (parsed.data.module as string) || id.split('/')[0] || '',
          product: resolvedProduct,
          filePath: relPath,
          snippet: snippet.replace(/\s+/g, ' ').trim(),
          lang: resolvedLang,
        });
      }
    });

    return results;
  }

  /** Upload an image (images are stored isolated by language+product+module directory) */
  async uploadImage(
    buffer: Buffer,
    filename: string,
    moduleId: string,
    lang: string,
    product?: string,
  ): Promise<string> {
    if (!lang || !this.supportedLangs.includes(lang)) {
      throw new BadRequestException(`Invalid lang: ${lang}`);
    }
    const resolvedProduct = this.resolveProduct(product);
    this.assertSafeId(moduleId);
    const imageDir = path.join(this.kbRoot, lang, resolvedProduct, moduleId, 'images');
    await fs.mkdir(imageDir, { recursive: true });
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName) throw new BadRequestException('Invalid filename');
    const filePath = path.join(imageDir, safeName);
    await fs.writeFile(filePath, buffer);
    return `${moduleId}/images/${safeName}`;
  }

  getKbRoot(): string {
    return this.kbRoot;
  }
  getDefaultLang(): string {
    return this.defaultLang;
  }
  getSupportedLangs(): string[] {
    return [...this.supportedLangs];
  }
  getDefaultProduct(): string {
    return this.defaultProduct;
  }

  /**
   * Resolve an image's relative path to an absolute path (for the controller's res.sendFile)
   * @param relPath the relative path returned by uploadImage, e.g. "03-device/images/foo.png"
   * @param lang language
   * @param product product ID
   */
  async resolveImagePath(relPath: string, lang?: string, product?: string): Promise<string> {
    const resolvedLang = this.resolveLang(lang);
    const resolvedProduct = this.resolveProduct(product);
    // Prevent path traversal: strip any .. segments
    const safe = relPath
      .split('/')
      .filter((seg) => seg && seg !== '..' && seg !== '.')
      .join(path.sep);
    if (!safe) throw new BadRequestException('Invalid image path');
    const abs = path.join(this.kbRoot, resolvedLang, resolvedProduct, safe);
    // Double check: ensure the resolved path is still under kbRoot/lang/product
    const productRoot = path.join(this.kbRoot, resolvedLang, resolvedProduct);
    if (!abs.startsWith(productRoot + path.sep) && abs !== productRoot) {
      throw new BadRequestException('Image path escapes product root');
    }
    return abs;
  }

  // ==================== Private methods ====================

  private resolveLang(lang?: string): string {
    if (lang && this.supportedLangs.includes(lang)) return lang;
    return this.defaultLang;
  }

  private resolveProduct(product?: string): string {
    if (product) return product;
    return this.defaultProduct;
  }

  /** Validate that an article ID contains no path-traversal attack characters */
  private assertSafeId(id: string): void {
    if (!id || /[/\\]\.\.[/\\]/.test(id) || id.startsWith('..') || path.isAbsolute(id)) {
      throw new BadRequestException(`Invalid article id: ${id}`);
    }
  }

  private async ensureKbRoot(): Promise<void> {
    await fs.mkdir(this.kbRoot, { recursive: true });
    const manifest = await this.loadManifest(true);
    // Create product directories for each language
    for (const lang of this.supportedLangs) {
      for (const product of manifest.products) {
        await fs.mkdir(path.join(this.kbRoot, lang, product.id), { recursive: true });
      }
    }
    // Create the default manifest.json (if missing)
    const manifestPath = path.join(this.kbRoot, 'manifest.json');
    try {
      await fs.access(manifestPath);
    } catch {
      await fs.writeFile(manifestPath, JSON.stringify(DEFAULT_MANIFEST, null, 2), 'utf-8');
      this.logger.log('Created default manifest.json');
    }
  }

  private async loadManifest(force = false): Promise<KbManifest> {
    const now = Date.now();
    if (!force && this.manifestCache && now - this.manifestLoadedAt < this.MANIFEST_TTL_MS) {
      return this.manifestCache;
    }
    const manifestPath = path.join(this.kbRoot, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as KbManifest;
      // Compatibility with v1.0 manifests (no products field; modules/routeMap as top-level fields)
      if (!parsed.products && (parsed as any).modules) {
        this.logger.warn('Detected v1.0 manifest, migrating to v2.0 multi-product structure');
        const migrated: KbManifest = {
          version: '2.0',
          products: [
            {
              id: this.defaultProduct,
              name: this.defaultProduct,
              order: 10,
              modules: (parsed as any).modules || [],
              routeMap: (parsed as any).routeMap || [],
            },
          ],
        };
        this.manifestCache = migrated;
        this.manifestLoadedAt = now;
        return migrated;
      }
      this.manifestCache = parsed;
      this.manifestLoadedAt = now;
      return this.manifestCache;
    } catch {
      this.logger.warn('manifest.json not found or invalid, using default');
      this.manifestCache = DEFAULT_MANIFEST;
      this.manifestLoadedAt = now;
      return DEFAULT_MANIFEST;
    }
  }

  /** Load a given product's manifest */
  private async loadProductManifest(productId: string): Promise<KbProduct | null> {
    const manifest = await this.loadManifest();
    return manifest.products.find((p) => p.id === productId) || null;
  }

  private async buildModuleNode(
    mod: KbModule,
    product: string,
    lang: string,
  ): Promise<KbTreeNode | null> {
    const modDir = path.join(this.kbRoot, lang, product, mod.id);
    try {
      const stat = await fs.stat(modDir);
      if (!stat.isDirectory()) return null;
    } catch {
      // Module directory missing under this language → build the subtree from the default language, marked fallback
      if (lang !== this.defaultLang) {
        const fallbackNode = await this.buildModuleNode(mod, product, this.defaultLang);
        if (fallbackNode) {
          return {
            ...fallbackNode,
            lang: this.defaultLang,
            fallback: true,
            children: fallbackNode.children?.map((c) => ({
              ...c,
              fallback: true,
              lang: this.defaultLang,
            })),
          };
        }
      }
      return null;
    }
    const children = await this.buildDirTree(modDir, lang, product, mod.id);
    const title = mod.nameI18n?.[lang] || mod.nameI18n?.[this.defaultLang] || mod.name;
    return {
      id: mod.id,
      title,
      type: 'folder',
      lang,
      product,
      isGlobal: mod.isGlobal,
      globalType: mod.globalType,
      fallback: false,
      order: mod.order,
      children,
    };
  }

  private async buildDirTree(
    dirPath: string,
    lang: string,
    product: string,
    moduleId: string,
  ): Promise<KbTreeNode[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: KbTreeNode[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'images') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const children = await this.buildDirTree(fullPath, lang, product, moduleId);
        if (children.length > 0) {
          nodes.push({
            id: `${moduleId}/${entry.name}`,
            title: entry.name,
            type: 'folder',
            lang,
            product,
            fallback: false,
            children,
          });
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const raw = await fs.readFile(fullPath, 'utf-8');
          const parsed = matter(raw);
          const relPath = path
            .relative(path.join(this.kbRoot, lang, product), fullPath)
            .replace(/\\/g, '/');
          const id = (parsed.data.id as string) || this.pathToId(relPath);
          nodes.push({
            id,
            title: (parsed.data.title as string) || entry.name.replace(/\.md$/, ''),
            type: 'article',
            lang,
            product,
            fallback: false,
            order: parsed.data.order as number | undefined,
            updatedAt: parsed.data.updatedAt as string | undefined,
          });
        } catch (e) {
          this.logger.warn(`Failed to parse ${fullPath}: ${(e as Error).message}`);
        }
      }
    }
    nodes.sort((a, b) => {
      const ao = a.order ?? 999;
      const bo = b.order ?? 999;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });
    return nodes;
  }

  private async tryReadArticle(
    id: string,
    product: string,
    lang: string,
  ): Promise<KbArticle | null> {
    const filePath = await this.resolveArticlePath(id, product, lang, false);
    if (!filePath) return null;
    return this.readArticleFile(filePath, product, lang, false);
  }

  /**
   * Resolve an article file path
   * @param id article ID, e.g. "03-device/getting-started" or "03-device"
   * @param product product ID
   * @param lang language code
   * @param createIfMissing when true, create the path if the file is missing (for writing)
   */
  private async resolveArticlePath(
    id: string,
    product: string,
    lang: string,
    createIfMissing: boolean,
  ): Promise<string | null> {
    const productDir = path.join(this.kbRoot, lang, product);
    const candidates = [
      path.join(productDir, `${id}.md`),
      path.join(productDir, id, 'README.md'),
      path.join(productDir, id, 'index.md'),
    ];
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        /* try next */
      }
    }
    if (createIfMissing) {
      const target = path.join(productDir, `${id}.md`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      return target;
    }
    return null;
  }

  private async readArticleFile(
    filePath: string,
    product: string,
    lang: string,
    fallback: boolean,
  ): Promise<KbArticle> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);
    const relPath = path
      .relative(path.join(this.kbRoot, lang, product), filePath)
      .replace(/\\/g, '/');
    const id = (parsed.data.id as string) || this.pathToId(relPath);
    return {
      id,
      title: (parsed.data.title as string) || path.basename(filePath, '.md'),
      lang,
      product: (parsed.data.product as string) || product,
      module: (parsed.data.module as string) || id.split('/')[0] || '',
      category: (parsed.data.category as string) || 'general',
      order: (parsed.data.order as number) ?? 0,
      tags: Array.isArray(parsed.data.tags) ? (parsed.data.tags as string[]) : [],
      updatedAt: (parsed.data.updatedAt as string) || '',
      updatedBy: parsed.data.updatedBy as string | undefined,
      status: (parsed.data.status as string) || 'published',
      content: parsed.content,
      filePath: relPath,
      fallback,
    };
  }

  private async articleExists(id: string, product: string, lang: string): Promise<boolean> {
    const p = await this.resolveArticlePath(id, product, lang, false);
    return !!p;
  }

  private findRouteMapping(routeMap: KbRouteMapping[], routePath: string): KbRouteMapping | null {
    // 1. Exact match
    const exact = routeMap.find((r) => r.routePattern === routePath);
    if (exact) return exact;
    // 2. Wildcard match (e.g. /system/devices/:deviceId)
    for (const r of routeMap) {
      if (r.routePattern.includes(':')) {
        const regex = new RegExp(
          '^' + r.routePattern.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$',
        );
        if (regex.test(routePath)) return r;
      }
    }
    return null;
  }

  private async scanLangStats(
    langDir: string,
    product: string,
  ): Promise<{ articleCount: number; moduleCount: number }> {
    const productManifest = await this.loadProductManifest(product);
    if (!productManifest) return { articleCount: 0, moduleCount: 0 };
    let articleCount = 0;
    let moduleCount = 0;
    for (const mod of productManifest.modules) {
      const modDir = path.join(langDir, product, mod.id);
      try {
        const stat = await fs.stat(modDir);
        if (stat.isDirectory()) {
          moduleCount++;
          articleCount += await this.countMarkdownFiles(modDir);
        }
      } catch {
        /* module not present in this lang */
      }
    }
    return { articleCount, moduleCount };
  }

  private async countMarkdownFiles(dir: string): Promise<number> {
    let count = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'images') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += await this.countMarkdownFiles(full);
      } else if (entry.name.endsWith('.md')) {
        count++;
      }
    }
    return count;
  }

  private async scanMarkdownFiles(
    dir: string,
    cb: (filePath: string, parsed: GrayMatterFile<string>) => Promise<void>,
  ): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Directory does not exist
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'images') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanMarkdownFiles(full, cb);
      } else if (entry.name.endsWith('.md')) {
        try {
          const raw = await fs.readFile(full, 'utf-8');
          const parsed = matter(raw);
          await cb(full, parsed);
        } catch {
          /* skip invalid file */
        }
      }
    }
  }

  private pathToId(relPath: string): string {
    // 03-device/getting-started.md → 03-device/getting-started
    // 03-device/README.md → 03-device
    return relPath
      .replace(/\\/g, '/')
      .replace(/\.md$/, '')
      .replace(/\/README$/, '')
      .replace(/\/index$/, '');
  }
}
