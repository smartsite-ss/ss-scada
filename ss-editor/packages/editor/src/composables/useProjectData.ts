// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { usePageStore, BasePage, type ProjectData } from '@scada-editor/core';

export function useProjectData() {
  const pageStore = usePageStore();

  const collectProjectData = (): ProjectData | null => {
    const currentPage = pageStore.currentPage;
    if (!currentPage) {
      return null;
    }

    // Save the current page ID to localStorage for restoration on next open
    try {
      localStorage.setItem('scada-last-page-id', currentPage.id);
    } catch { /* ignore */ }

    const groupNames: Record<string, string> = {};
    for (const group of pageStore.pageGroups) {
      groupNames[group.id] = group.name;
    }

    return {
      version: '1.0',
      savedAt: Date.now(),
      currentPageId: currentPage.id,
      pages: pageStore.pages.map(page => page.toJSON()),
      pageGroups: { ...pageStore.pageGroupMap },
      groupNames,
    } as any;
  };

  /**
   * Restore pages from ProjectData into the Store
   * @returns Array of page names that need lazy loading (pages marked with _lazy)
   */
  const restorePagesToStore = (projectData: ProjectData | null): string[] => {
    if (!projectData?.pages?.length) {
      return [];
    }

    const lazyPageNames: string[] = [];

    const restoredPages = projectData.pages.map((pageJson: any) => {
      const page = new BasePage();
      page.init({
        id: pageJson.id,
        name: pageJson.name,
        width: pageJson.width,
        height: pageJson.height,
        backgroundColor: pageJson.backgroundColor
      });

      // Keep the preview thumbnail URL from the outline
      if (pageJson.previewSmallUrl) {
        (page as any).previewSmallUrl = pageJson.previewSmallUrl;
      }

      // Keep the background image path from the outline (relative path, resolved to a full URL by the caller when loading page data)
      if (pageJson.backgroundImage) {
        (page as any).backgroundImage = pageJson.backgroundImage;
      }

      // If marked as lazy-loaded (from the outline), do not load graphics initially
      if (pageJson._lazy) {
        (page as any)._lazy = true; // write the _lazy flag onto the page instance so ensurePageDataLoaded can recognize it
        lazyPageNames.push(pageJson.name || pageJson.id);
      } else {
        // Load graphics with full data
        page.fromJSON(pageJson);
      }

      return page;
    });

    pageStore.pages = restoredPages;

    // Read the previously opened page ID from localStorage
    let lastPageId = projectData.currentPageId;
    try {
      const savedId = localStorage.getItem('scada-last-page-id');
      if (savedId && restoredPages.some(p => p.id === savedId)) {
        lastPageId = savedId;
      }
    } catch { /* ignore */ }

    if (lastPageId) {
      pageStore.currentPageId = lastPageId;
    }

    // Close all pages except the current one, avoiding opening all of them
    const openPageId = lastPageId || (restoredPages[0]?.id);
    if (openPageId) {
      pageStore.closedPageIds = restoredPages
        .filter(p => p.id !== openPageId)
        .map(p => p.id);
    }

    const savedPageGroups = (projectData as any).pageGroups as Record<string, string> | undefined;
    if (savedPageGroups) {
      pageStore.pageGroupMap = savedPageGroups;
    }

    const savedGroupNames = (projectData as any).groupNames as Record<string, string> | undefined;
    if (savedGroupNames) {
      pageStore.pageGroups = Object.entries(savedGroupNames).map(([id, name]) => ({
        id,
        name: name.replace(/^(p_|g_)/, ''), // safely strip the prefix
      }));
    }

    return lazyPageNames;
  };

  return {
    collectProjectData,
    restorePagesToStore,
  };
}