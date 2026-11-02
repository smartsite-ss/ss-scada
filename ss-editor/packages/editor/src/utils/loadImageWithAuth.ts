// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { resolveAssetPath } from '@scada-editor/core';

const TOKEN_KEY = 'scada_access_token';

/**
 * S-C03: Tokens are transported via HttpOnly Cookie; getToken() is kept only for compatibility fallback.
 * Authentication primarily relies on fetch's credentials: 'include'.
 */
function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Load an image resource with an auth token (unified solution for 401 authorization issues)
 *
 * S-C03: Carries HttpOnly Cookie authentication via credentials: 'include',
 * while keeping the Bearer header as a compatibility fallback.
 *
 * @param src - Original image path (relative path / API path / blob URL / data URL)
 * @returns A fully loaded HTMLImageElement; rejects on load failure
 */
export async function loadImageWithAuth(src: string): Promise<HTMLImageElement> {
  const resolvedSrc = resolveAssetPath(src);

  // blob / data URLs need no authentication, load directly
  if (resolvedSrc.startsWith('blob:') || resolvedSrc.startsWith('data:')) {
    return loadImageFromUrl(resolvedSrc);
  }

  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // S-C03: carry HttpOnly Cookie credentials
  const response = await fetch(resolvedSrc, { credentials: 'include', headers });
  if (!response.ok) {
    throw new Error(`Failed to load image (${response.status}): ${resolvedSrc}`);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error(`Failed to decode image blob: ${resolvedSrc}`));
    };
    img.crossOrigin = 'anonymous';
    img.src = blobUrl;
  });
}

/**
 * Load an image from a URL (used for blob/data URLs, no authentication needed)
 */
function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}