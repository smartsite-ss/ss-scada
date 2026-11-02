// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Project data structure
 */
export interface ProjectData {
  version: string;
  savedAt: number;
  currentPageId: string;
  pages: PageData[];
  /** Page ID → group name map (used for on-demand loading) */
  pageGroups?: Record<string, string>;
  /** Group name → group display name map */
  groupNames?: Record<string, string>;
}

/**
 * Page data structure
 */
export interface PageData {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  graphics: any[];
  /** Page background image */
  backgroundImage?: string;
  /** Marked as lazily loaded (only outline info; graphics empty) */
  _lazy?: boolean;
  /** Template reference ID (reference mode) */
  templateId?: string;
  /** Template apply mode */
  templateMode?: 'reference' | 'copy';
}

/**
 * Save service interface
 * Different implementations (localStorage/mock/server) must implement this interface
 */
export interface ISaveService {
  /**
   * Save project data
   */
  save(data: ProjectData): Promise<void>;

  /**
   * Load project data
   */
  load(): Promise<ProjectData | null>;

  /**
   * Delete project data
   */
  delete(): Promise<void>;

  /**
   * Check whether saved data exists
   */
  hasSavedData(): Promise<boolean>;
}

/**
 * Save service config
 */
export interface SaveServiceConfig {
  /**
   * Service type: local/mock/server
   */
  type: 'local' | 'mock' | 'server';

  /**
   * API base path (server mode only)
   */
  apiBaseUrl?: string;
}

/**
 * Save status
 */
export type SaveStatus = 'idle' | 'saving' | 'success' | 'error';
