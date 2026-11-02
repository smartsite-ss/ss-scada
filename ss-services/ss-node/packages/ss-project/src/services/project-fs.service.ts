// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type AdmZip from 'adm-zip';

/**
 * Project file-system common utility service
 *
 * Consolidates the duplicated file-system basics across the six services in the ss-project package:
 * - Atomic write (temp file + same-partition rename), eliminating "mid-write crash corrupting JSON"
 * - Path-safety assertions (assertPathWithin / assertSafeSegment), rejecting path traversal
 * - ZIP safe extraction (per-entry validation), eliminating Zip Slip arbitrary file writes
 *
 * See the ss-project code-quality analysis and optimization plan doc (P0-1 / P0-2).
 */
@Injectable()
export class ProjectFsService {
  /** Ensure a directory exists (recursive creation) */
  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Atomic file write (text or binary).
   *
   * Writes a temp file in the same directory first, then renames it over the target:
   * - rename within the same partition is atomic; at any moment the on-disk target holds either the old complete content or the new complete content;
   * - the temp file is placed in the same directory (same partition), ensuring rename does not degrade to a cross-partition copy;
   * - on write/replace failure the temp file is cleaned up and the original error is thrown, leaving the target with its old content untouched.
   */
  atomicWriteFileSync(filePath: string, content: string | Buffer): void {
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    const tmpPath = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      fs.writeFileSync(tmpPath, content);
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.rmSync(tmpPath, { force: true });
        }
      } catch {
        // Temp-file cleanup failure does not affect throwing the original error
      }
      throw error;
    }
  }

  /** Atomic JSON write (2-space indent by default, consistent with the existing on-disk format) */
  atomicWriteJson(filePath: string, data: unknown, space = 2): void {
    this.atomicWriteFileSync(filePath, JSON.stringify(data, null, space));
  }

  /**
   * Assert that candidate's resolved absolute path lies within baseDir.
   *
   * Used at every call site where a user-controlled string participates in path.join before write/delete, as defense in depth:
   * even if upstream skipped segment-level validation (assertSafeSegment), this blocks `..`,
   * absolute paths, drive-letter prefixes, and anything else escaping baseDir.
   */
  assertPathWithin(baseDir: string, candidate: string): void {
    const resolvedBase = path.resolve(baseDir);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedBase, resolvedCandidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException(
        `非法路径（越出基准目录）: ${candidate}`,
      );
    }
  }

  /**
   * Validate path segments that directly join into file paths (projectId / templateId / page names etc.).
   *
   * Rejects: empty values, path separators (/ \), `..`, drive-letter prefixes, control characters, leading/trailing whitespace.
   * Chinese/uppercase and other legal characters are intentionally allowed: legacy projects contain GUIDs and Chinese directory names,
   * so a strict kebab-case check is not possible (the create flow already uses generateProjectId to keep new projects canonical).
   */
  assertSafeSegment(segment: string, label: string): void {
    if (
      !segment ||
      typeof segment !== 'string' ||
      /[/\\]/.test(segment) ||
      segment.includes('..') ||
      /^[a-zA-Z]:/.test(segment) ||
      /[\x00-\x1f]/.test(segment) ||
      segment !== segment.trim()
    ) {
      throw new BadRequestException(`非法的${label}: ${String(segment)}`);
    }
  }

  /**
   * Safely extract a ZIP into the target directory (replacing adm-zip's extractAllTo).
   *
   * Processes entries one by one, validating that the extraction target always stays inside targetDir:
   * - rejects absolute-path / drive-letter entries;
   * - double-checks with assertPathWithin after path.resolve, intercepting `../` traversal entries (Zip Slip);
   * - directory entries create directories; file entries are extracted via getData() then written;
   * - never creates symbolic links (symlink entries are written as ordinary file content).
   */
  extractZipSafely(zip: AdmZip, targetDir: string): void {
    const resolvedTargetDir = path.resolve(targetDir);
    this.ensureDir(resolvedTargetDir);

    for (const entry of zip.getEntries()) {
      const entryName = entry.entryName.replace(/\\/g, '/');
      if (path.isAbsolute(entryName) || /^[a-zA-Z]:/.test(entryName)) {
        throw new BadRequestException(`ZIP 条目含非法路径: ${entry.entryName}`);
      }

      const destPath = path.resolve(resolvedTargetDir, entryName);
      this.assertPathWithin(resolvedTargetDir, destPath);

      if (entry.isDirectory) {
        this.ensureDir(destPath);
      } else {
        this.ensureDir(path.dirname(destPath));
        this.atomicWriteFileSync(destPath, entry.getData());
      }
    }
  }
}
