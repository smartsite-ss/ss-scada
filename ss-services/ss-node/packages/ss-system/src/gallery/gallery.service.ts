// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GalleryFormat, GalleryCategory, GalleryImage } from './gallery.types';

/** Image extensions supported by the gallery */
const IMAGE_EXTENSIONS = new Set(['.png', '.svg', '.gif', '.jpg', '.jpeg', '.webp']);

/**
 * Gallery service — pure-file approach
 *
 * Storage model:
 *   - File system: ${IMAGES_DIR}/{format}/{category}/{file} (widget PNG/SVG/GIF image resources)
 *
 * No database dependency; manually added/removed files take effect automatically.
 * Image access goes through the unified GET /gallery/image endpoint (res.sendFile), consistent with knowledge-base image access.
 */
@Injectable()
export class GalleryService implements OnModuleInit {
  private readonly logger = new Logger(GalleryService.name);
  private readonly imagesRoot: string;

  constructor(
    private readonly config: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {
    this.imagesRoot = this.resolveImagesRoot();
  }

  private resolveImagesRoot(): string {
    const dataDir = this.config.get<string>('DATA_DIR') || '../../data';
    const absoluteDataDir = this.pathResolver.resolve(dataDir);
    const configured = this.config.get<string>('IMAGES_DIR');
    if (configured) {
      const expanded = configured.replace(/\$\{DATA_DIR\}/g, absoluteDataDir);
      return this.pathResolver.resolve(expanded);
    }
    return path.resolve(absoluteDataDir, 'images');
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.imagesRoot, { recursive: true });
    this.logger.log(`Gallery initialized at ${this.imagesRoot}`);
  }

  getImagesRoot(): string {
    return this.imagesRoot;
  }

  /** List all format directories (first level) */
  async listFormats(): Promise<GalleryFormat[]> {
    const entries = await this.readDirSafe(this.imagesRoot);
    const formats: GalleryFormat[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const formatDir = path.join(this.imagesRoot, entry.name);
      formats.push({
        id: entry.name,
        name: entry.name,
        imageCount: await this.countImages(formatDir),
      });
    }
    return formats;
  }

  /** List category directories under a given format (second level) */
  async listCategories(format: string): Promise<GalleryCategory[]> {
    this.assertSafeName(format);
    const formatDir = path.join(this.imagesRoot, format);
    const entries = await this.readDirSafe(formatDir);
    const categories: GalleryCategory[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const categoryDir = path.join(formatDir, entry.name);
      categories.push({
        id: entry.name,
        name: entry.name,
        imageCount: await this.countImages(categoryDir),
      });
    }
    return categories;
  }

  /** List image files under a given category (third level) */
  async listImages(format: string, category: string): Promise<GalleryImage[]> {
    this.assertSafeName(format);
    this.assertSafeName(category);
    const categoryDir = path.join(this.imagesRoot, format, category);
    const entries = await this.readDirSafe(categoryDir);
    const images: GalleryImage[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(path.join(categoryDir, entry.name));
      images.push({
        fileName: entry.name,
        url: this.buildImageUrl(format, category, entry.name),
        size: stat.size,
      });
    }
    return images;
  }

  /** Upload an image to the given format/category, returning the file name */
  async uploadImage(
    buffer: Buffer,
    fileName: string,
    format: string,
    category: string,
  ): Promise<string> {
    this.assertSafeName(format);
    this.assertSafeName(category);
    const safeName = this.sanitizeFileName(fileName);
    if (!safeName) throw new BadRequestException('Invalid file name');
    this.assertImageExtension(safeName);
    const categoryDir = path.join(this.imagesRoot, format, category);
    await fs.mkdir(categoryDir, { recursive: true });
    await fs.writeFile(path.join(categoryDir, safeName), buffer);
    this.logger.log(`Image uploaded: ${format}/${category}/${safeName}`);
    return safeName;
  }

  /** Delete a given image */
  async deleteImage(format: string, category: string, fileName: string): Promise<void> {
    this.assertSafeName(format);
    this.assertSafeName(category);
    const safeName = path.basename(fileName);
    if (!safeName || safeName !== fileName) throw new BadRequestException('Invalid file name');
    const filePath = this.resolveImagePath(format, category, safeName);
    await fs.unlink(filePath);
    this.logger.log(`Image deleted: ${format}/${category}/${safeName}`);
  }

  /** Resolve an image's absolute path (for the controller's res.sendFile), with path-traversal protection */
  resolveImagePath(format: string, category: string, fileName: string): string {
    this.assertSafeName(format);
    this.assertSafeName(category);
    const safeName = path.basename(fileName);
    if (!safeName || safeName !== fileName) throw new BadRequestException('Invalid file name');
    const abs = path.join(this.imagesRoot, format, category, safeName);
    // Double check: ensure the resolved path is still under the gallery root
    const rootWithSep = this.imagesRoot.endsWith(path.sep)
      ? this.imagesRoot
      : this.imagesRoot + path.sep;
    if (!abs.startsWith(rootWithSep) && abs !== this.imagesRoot) {
      throw new BadRequestException('Image path escapes images root');
    }
    return abs;
  }

  // ==================== Private methods ====================

  private buildImageUrl(format: string, category: string, fileName: string): string {
    const params = new URLSearchParams({ format, category, fileName });
    return `/api/v1/gallery/image?${params.toString()}`;
  }

  private async readDirSafe(dir: string): Promise<import('fs').Dirent[]> {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async countImages(dir: string): Promise<number> {
    const entries = await this.readDirSafe(dir);
    return entries.filter(
      (e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()),
    ).length;
  }

  /** Validate that format/category names contain no path separators or traversal characters */
  private assertSafeName(name: string): void {
    if (
      !name ||
      name.includes('/') ||
      name.includes('\\') ||
      name === '.' ||
      name === '..'
    ) {
      throw new BadRequestException(`Invalid name: ${name}`);
    }
  }

  /** Uploaded file name sanitization: keeps only CJK/alphanumeric characters, dots, underscores and hyphens */
  private sanitizeFileName(fileName: string): string {
    const base = path.basename(fileName);
    return base.replace(/[^\u4e00-\u9fa5a-zA-Z0-9._-]/g, '_');
  }

  private assertImageExtension(fileName: string): void {
    const ext = path.extname(fileName).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`Unsupported image extension: ${ext}`);
    }
  }
}
