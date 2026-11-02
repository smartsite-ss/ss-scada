// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';

/** Gallery format directory (level 1: graphic GIF/PNG/SVG) */
export interface GalleryFormat {
  id: string;
  name: string;
  imageCount: number;
}

/** Gallery category directory (level 2: transport/instrument/switch, etc.) */
export interface GalleryCategory {
  id: string;
  name: string;
  imageCount: number;
}

/** Gallery image file (level 3) */
export interface GalleryImage {
  fileName: string;
  url: string;
  size: number;
}

export const galleryApi = {
  /** List all format directories */
  listFormats(): Promise<ApiResponse<GalleryFormat[]>> {
    return client.get('/gallery/formats').then((res) => res.data);
  },

  /** List category directories under a specified format */
  listCategories(format: string): Promise<ApiResponse<GalleryCategory[]>> {
    return client
      .get('/gallery/categories', { params: { format } })
      .then((res) => res.data);
  },

  /** List image files under a specified category */
  listImages(format: string, category: string): Promise<ApiResponse<GalleryImage[]>> {
    return client
      .get('/gallery/images', { params: { format, category } })
      .then((res) => res.data);
  },

  /** Upload an image (base64, admin) */
  uploadImage(payload: {
    format: string;
    category: string;
    fileName: string;
    base64: string;
  }): Promise<ApiResponse<{ fileName: string }>> {
    return client.post('/gallery/upload', payload).then((res) => res.data);
  },

  /** Delete a specified image (admin) */
  deleteImage(format: string, category: string, fileName: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return client
      .delete('/gallery/images', { params: { format, category, fileName } })
      .then((res) => res.data);
  },

  /**
     * Construct the image access URL (backend GET /gallery/image endpoint)
     */
  buildImageUrl(format: string, category: string, fileName: string): string {
    const params = new URLSearchParams({ format, category, fileName });
    return `${client.defaults.baseURL}/gallery/image?${params.toString()}`;
  },
};
