// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Resolve static asset paths, replacing hardcoded API version prefixes
 * with the current version.
 *
 * Background: saved backgroundImage paths may contain a fixed API version
 * prefix (e.g. /api/v1/...). When the backend API version is upgraded these
 * paths become invalid. This utility replaces the old version prefix in the
 * path with the currently configured baseURL, ensuring resources remain
 * accessible.
 *
 * @param path - Original asset path, which may be an absolute path (/api/v1/...),
 *               a relative path, or a blob URL
 * @param baseURL - Current API baseURL, defaults to '/api/v1'
 * @returns The resolved path using the current API baseURL
 */
export function resolveAssetPath(path: string, baseURL: string = '/api/v1'): string {
  if (!path) return path;

  // Leave blob URLs and data URLs unchanged
  if (path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }

  // Leave full HTTP(S) URLs unchanged
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  // Match paths in the form /api/v{digits}/... and replace with the current baseURL
  const apiVersionPrefixRegex = /^\/api\/v\d+\//;
  if (apiVersionPrefixRegex.test(path)) {
    return path.replace(apiVersionPrefixRegex, baseURL + '/');
  }

  // If it is a relative path (does not start with /), prepend the current baseURL
  if (!path.startsWith('/')) {
    return baseURL + '/' + path;
  }

  // If the path starts with / but does not match /api/v{digits}/, join directly
  if (path.startsWith('/')) {
    return baseURL + path;
  }

  return path;
}
