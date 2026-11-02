// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { resolveAssetPath as resolveAssetPathCore } from '@scada-editor/core';
import { getBaseURL } from '../api/client';

/**
 * Resolve a static asset path (system wrapper version, automatically injects the current API baseURL).
 *
 * @param path - Raw asset path
 * @returns The resolved path
 */
export function resolveAssetPath(path: string): string {
  return resolveAssetPathCore(path, getBaseURL());
}