// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { usePageStore } from '../store/page.store';
import { ExportError, ImportError, errorService } from '../utils/core/errors';

/**
 * Unified page export format
 */
export interface PageExportData {
  version: string;
  page: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
    backgroundImage?: string;
    backgroundApplicationType?: string;
    backgroundFitMode?: string;
  };
  graphics: any[];
  timers: any[];
  groups: any[];
  dataSource?: any;
}

/**
 * Unified page export service
 * Provides three export modes:
 * 1. Export single page - only the currently selected page
 * 2. Export scene - export all pages
 * 3. Export panel - the format used inside the JSON editor
 */
export class PageExportService {
  /**
   * Export a single page (full format)
   * @param pageId Page ID; if omitted, exports the current page
   */
  static exportPage(pageId?: string): PageExportData {
    try {
      const pageStore = usePageStore();
      const page = pageId
        ? pageStore.pages.find((p) => p.id === pageId)
        : pageStore.currentPage;

      if (!page) {
        throw new ExportError('JSON', 'Page not found');
      }

      const pageData = page.toJSON();

      return {
        version: '1.0',
        page: {
          id: pageData.id,
          name: pageData.name,
          width: pageData.width,
          height: pageData.height,
          backgroundColor: pageData.backgroundColor,
          backgroundImage: pageData.backgroundImage || '',
          backgroundApplicationType: (page as any).backgroundApplicationType || 'applicationColor',
          backgroundFitMode: (page as any).backgroundFitMode || 'stretch',
        },
        graphics: pageData.graphics,
        timers: pageData.timers,
        groups: pageData.groups,
        dataSource: pageData.dataSource,
      };
    } catch (error) {
      if (error instanceof ExportError) {
        throw error;
      }
      const err = new ExportError('JSON', error instanceof Error ? error.message : 'Unknown error');
      errorService.record(err, 'PageExportService.exportPage');
      throw err;
    }
  }

  /**
   * Export a scene (all pages)
   */
  static exportScene(): {
    version: string;
    pages: PageExportData[];
  } {
    try {
      const pageStore = usePageStore();
      const pages = pageStore.pages;

      return {
        version: '1.0',
        pages: pages.map(p => {
          const pageData = p.toJSON();
          return {
            version: '1.0',
            page: {
              id: pageData.id,
              name: pageData.name,
              width: pageData.width,
              height: pageData.height,
              backgroundColor: pageData.backgroundColor,
              backgroundImage: pageData.backgroundImage || '',
              backgroundApplicationType: (p as any).backgroundApplicationType || 'applicationColor',
              backgroundFitMode: (p as any).backgroundFitMode || 'stretch',
            },
            graphics: pageData.graphics,
            timers: pageData.timers,
            groups: pageData.groups,
            dataSource: pageData.dataSource,
          };
        }),
      };
    } catch (error) {
      const err = new ExportError('JSON', error instanceof Error ? error.message : 'Unknown error');
      errorService.record(err, 'PageExportService.exportScene');
      throw err;
    }
  }

  /**
   * Export a single page (BasePage.toJSON format)
   */
  static exportPageRaw(pageId?: string): any {
    try {
      const pageStore = usePageStore();
      const page = pageId
        ? pageStore.pages.find((p) => p.id === pageId)
        : pageStore.currentPage;

      if (!page) {
        throw new ExportError('JSON', 'Page not found');
      }

      return page.toJSON();
    } catch (error) {
      if (error instanceof ExportError) {
        throw error;
      }
      const err = new ExportError('JSON', error instanceof Error ? error.message : 'Unknown error');
      errorService.record(err, 'PageExportService.exportPageRaw');
      throw err;
    }
  }

  /**
   * Download a JSON file
   */
  static downloadJSON(data: any, filename: string): void {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      const err = new ExportError('JSON', error instanceof Error ? error.message : 'Download failed');
      errorService.record(err, 'PageExportService.downloadJSON');
      throw err;
    }
  }

  /**
   * Import a page from a JSON string
   */
  static importPage(jsonString: string): void {
    try {
      const data = JSON.parse(jsonString);
      const pageStore = usePageStore();
      const currentPage = pageStore.currentPage;

      if (!currentPage) {
        throw new ImportError('No current page found');
      }

      // Detect data format: supports two formats
      // 1. JSON panel format: { version, page, graphics, timers, groups }
      // 2. Direct toJSON format: { id, name, graphics, groups, timers, ... }
      let pageData = data;
      let graphicsData = data.graphics;
      let timersData = data.timers;
      let groupsData = data.groups;
      let dataSourceData = data.dataSource;

      // If it is the JSON panel format, extract the data
      if (data.version && data.page) {
        pageData = data.page;
        graphicsData = data.graphics;
        timersData = data.timers;
        groupsData = data.groups;
        dataSourceData = data.dataSource;
      }

      if (!Array.isArray(graphicsData)) {
        throw new ImportError('Invalid JSON format: graphics array is required');
      }

      // Update page properties
      pageStore.updatePage(currentPage.id, {
        name: pageData.name,
        width: pageData.width,
        height: pageData.height,
        backgroundColor: pageData.backgroundColor,
        backgroundImage: pageData.backgroundImage,
      } as any);

      // Use the page's importGraphics method
      currentPage.importGraphics(graphicsData);

      // Import timers
      if (timersData && Array.isArray(timersData)) {
        const timerManager = (currentPage as any).timerManager;
        if (timerManager && timerManager.fromJSON) {
          timerManager.fromJSON(timersData);
        }
      }

      // Import groups
      if (groupsData && Array.isArray(groupsData)) {
        const groupManager = (currentPage as any).getGroupManager?.();
        if (groupManager && groupManager.fromJSON) {
          groupManager.fromJSON(groupsData);
          let graphics: any[];
          if ('value' in currentPage.graphics) {
            graphics = (currentPage.graphics as any).value;
          } else {
            graphics = currentPage.graphics as any[];
          }
          const graphicMap = new Map(graphics.map((g: any) => [g.id, g]));
          groupManager.updateReferences?.(graphics, graphicMap);
        }
      }

      if (dataSourceData) {
        (currentPage as any).dataSource = dataSourceData;
      }
    } catch (error) {
      if (error instanceof ImportError) {
        errorService.record(error, 'PageExportService.importPage');
        throw error;
      }
      const err = new ImportError(
        error instanceof Error ? error.message : 'Unknown error',
        { originalError: error }
      );
      errorService.record(err, 'PageExportService.importPage');
      throw err;
    }
  }
}
