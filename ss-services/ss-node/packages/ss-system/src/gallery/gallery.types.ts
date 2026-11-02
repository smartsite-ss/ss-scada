// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Gallery type definitions — pure-file approach
 *
 * Storage model:
 *   - File system: ${IMAGES_DIR}/{format}/{category}/{file} (widget PNG/SVG/GIF image resources)
 *
 * No database dependency; manually added/removed files take effect automatically.
 */

/** Gallery format directory (first level: widget GIF/widget PNG/widget SVG) */
export interface GalleryFormat {
  /** Format directory name, e.g. 'widget PNG' (original data is the Chinese name) */
  id: string;
  /** Display name, defaults to the id */
  name: string;
  /** Total image count under this format (excluding subcategory directories) */
  imageCount: number;
}

/** Gallery category directory (second level: traffic/instrument/switch etc.) */
export interface GalleryCategory {
  /** Category directory name, e.g. 'traffic' (original data is the Chinese name) */
  id: string;
  /** Display name, defaults to the id */
  name: string;
  /** Total image count under this category */
  imageCount: number;
}

/** Gallery image file (third level) */
export interface GalleryImage {
  /** File name, e.g. '1.png' */
  fileName: string;
  /** Image access URL */
  url: string;
  /** File size (bytes) */
  size: number;
}
