// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Global, Module } from '@nestjs/common';
import { PathResolverService } from './path-resolver.service';

/**
 * Path-resolution global module
 *
 * Provides PathResolverService as a global singleton; services under packages inject it via DI
 * to resolve relative paths configured in env vars (PROJECTS_DIR, TEMPLATES_DIR, DICTS_DIR, etc.),
 * completely eliminating the __dirname upward-traversal dependency.
 *
 * Depends on the SS_NODE_ROOT env var (set by app.module.ts at startup) as the project root.
 */
@Global()
@Module({
  providers: [PathResolverService],
  exports: [PathResolverService],
})
export class PathModule {}
