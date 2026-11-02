// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';

/**
 * Path-resolution service (global singleton)
 *
 * Unified wrapper for obtaining the project root and resolving relative paths,
 * eliminating the __dirname upward-traversal dependency across services under packages.
 *
 * The project root comes from process.env.SS_NODE_ROOT, set by initProjectRoot() in app.module.ts
 * at application startup (before ConfigModule.forRoot):
 *
 *   - dev mode: SS_NODE_ROOT = ss-services/ss-node/
 *   - prod mode: SS_NODE_ROOT = ss-run/ss/services/ss-node/
 *
 * Fallback: if SS_NODE_ROOT is not set (e.g. standalone scripts), fall back to process.cwd().
 *
 * Usage:
 *
 *   constructor(private readonly pathResolver: PathResolverService) {}
 *
 *   const dbPath = this.pathResolver.resolveEnv('DATABASE_PATH', './data/ss-node.db');
 *   const projectsDir = this.pathResolver.resolveEnv('PROJECTS_DIR', './data/projects');
 *   const templatesDir = this.pathResolver.resolveEnv('TEMPLATES_DIR', './data/templates');
 */
@Injectable()
export class PathResolverService {
  private readonly logger = new Logger(PathResolverService.name);
  private readonly projectRoot: string;

  constructor() {
    this.projectRoot = this.resolveProjectRoot();
    this.logger.log(`SS_NODE_ROOT resolved to: ${this.projectRoot}`);
  }

  /** Get the project-root absolute path */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Resolve a relative path to an absolute path (relative to the project root)
   * - Empty path returns the project root
   * - Absolute paths returned as-is
   * - Relative paths resolved against the project root
   */
  resolve(relativePath: string): string {
    if (!relativePath) return this.projectRoot;
    if (path.isAbsolute(relativePath)) return path.normalize(relativePath);
    return path.resolve(this.projectRoot, relativePath);
  }

  /**
   * Convenience method: resolve the path specified by an env var
   * @param envVar env var name (e.g. 'PROJECTS_DIR')
   * @param defaultValue default value (used when the env var is unset)
   */
  resolveEnv(envVar: string, defaultValue: string): string {
    const configured = process.env[envVar] || defaultValue;
    return this.resolve(configured);
  }

  private resolveProjectRoot(): string {
    if (process.env.SS_NODE_ROOT) {
      return path.normalize(process.env.SS_NODE_ROOT);
    }
    this.logger.warn(
      'SS_NODE_ROOT not set, falling back to process.cwd(). ' +
        'This may cause path resolution errors in dev mode.',
    );
    return path.normalize(process.cwd());
  }
}
