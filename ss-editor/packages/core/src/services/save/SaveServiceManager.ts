// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ISaveService, SaveServiceConfig, ProjectData, SaveStatus } from './types';

/**
 * Save service manager
 * Manages different save-service implementations
 */
export class SaveServiceManager {
  private service: ISaveService | null = null;
  private status: SaveStatus = 'idle';
  private lastSavedTime: number | null = null;
  private statusListeners: Set<(status: SaveStatus) => void> = new Set();

  /**
   * Check whether the save service is initialized
   */
  isInitialized(): boolean {
    return this.service !== null;
  }

  /**
   * Get the current save status
   */
  getStatus(): SaveStatus {
    return this.status;
  }

  /**
   * Get the last saved time
   */
  getLastSavedTime(): number | null {
    return this.lastSavedTime;
  }

  /**
   * Register a save-status listener
   */
  onStatusChange(listener: (status: SaveStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Initialize the save service
   */
  init(config: SaveServiceConfig, customService?: ISaveService): void {
    if (customService) {
      this.service = customService;
      return;
    }

    switch (config.type) {
      case 'local':
        this.service = this.createLocalService();
        break;
      case 'mock':
        this.service = this.createMockService();
        break;
      case 'server':
        if (!config.apiBaseUrl) {
          throw new Error('server 模式需要配置 apiBaseUrl');
        }
        this.service = this.createServerService(config.apiBaseUrl);
        break;
      default:
        this.service = this.createLocalService();
    }
  }

  /**
   * Save the project
   */
  async save(data: ProjectData): Promise<void> {
    if (!this.service) {
      throw new Error('SaveService 未初始化，请先调用 init()');
    }

    try {
      this.updateStatus('saving');
      if (!data.pages || data.pages.length === 0) {
        console.warn('[SaveServiceManager] save: pages is empty, this may cause server 400 error');
      }
      await this.service.save(data);
      this.lastSavedTime = Date.now();
      this.updateStatus('success');
    } catch (error: any) {
      this.updateStatus('error');
      throw error;
    }
  }

  /**
   * Load the project
   */
  async load(): Promise<ProjectData | null> {
    if (!this.service) {
      throw new Error('SaveService 未初始化，请先调用 init()');
    }

    const data = await this.service.load();
    if (data) {
      this.lastSavedTime = data.savedAt;
    }
    return data;
  }

  /**
   * Delete saved data
   */
  async delete(): Promise<void> {
    if (!this.service) {
      throw new Error('SaveService 未初始化，请先调用 init()');
    }
    await this.service.delete();
    this.lastSavedTime = null;
  }

  /**
   * Check whether saved data exists
   */
  async hasSavedData(): Promise<boolean> {
    if (!this.service) {
      throw new Error('SaveService 未初始化，请先调用 init()');
    }
    return this.service.hasSavedData();
  }

  // ==================== Built-in service implementations ====================

  /**
   * Create the localStorage service
   */
  private createLocalService(): ISaveService {
    const STORAGE_KEY = 'scada-editor-project';

    return {
      async save(data: ProjectData): Promise<void> {
        const jsonString = JSON.stringify(data);
        localStorage.setItem(STORAGE_KEY, jsonString);
      },

      async load(): Promise<ProjectData | null> {
        const jsonString = localStorage.getItem(STORAGE_KEY);
        if (!jsonString) {
          return null;
        }
        return JSON.parse(jsonString);
      },

      async delete(): Promise<void> {
        localStorage.removeItem(STORAGE_KEY);
      },

      async hasSavedData(): Promise<boolean> {
        return !!localStorage.getItem(STORAGE_KEY);
      }
    };
  }

  /**
   * Create the mock service (demo only)
   */
  private createMockService(): ISaveService {
    let mockData: ProjectData | null = null;

    return {
      async save(data: ProjectData): Promise<void> {
        mockData = { ...data, savedAt: Date.now() };
        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, 500));
      },

      async load(): Promise<ProjectData | null> {
        await new Promise(resolve => setTimeout(resolve, 300));
        return mockData;
      },

      async delete(): Promise<void> {
        mockData = null;
      },

      async hasSavedData(): Promise<boolean> {
        return !!mockData;
      }
    };
  }

  /**
   * Create the server service (reserved interface)
   */
  private createServerService(apiBaseUrl: string): ISaveService {
    const createApiUrl = (path: string) => `${apiBaseUrl}${path}`;

    return {
      async save(data: ProjectData): Promise<void> {
        const response = await fetch(createApiUrl('/api/save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          throw new Error(`保存失败: ${response.status}`);
        }
      },

      async load(): Promise<ProjectData | null> {
        const response = await fetch(createApiUrl('/api/load'));
        if (!response.ok) {
          if (response.status === 404) {
            return null;
          }
          throw new Error(`加载失败: ${response.status}`);
        }
        return response.json();
      },

      async delete(): Promise<void> {
        const response = await fetch(createApiUrl('/api/delete'), {
          method: 'DELETE',
        });
        if (!response.ok) {
          throw new Error(`删除失败: ${response.status}`);
        }
      },

      async hasSavedData(): Promise<boolean> {
        try {
          const response = await fetch(createApiUrl('/api/exists'));
          return response.ok;
        } catch {
          return false;
        }
      }
    };
  }

  /**
   * Update status
   */
  private updateStatus(status: SaveStatus): void {
    this.status = status;
    this.statusListeners.forEach(listener => listener(status));
  }
}

/**
 * Global singleton
 */
export const saveServiceManager = new SaveServiceManager();
