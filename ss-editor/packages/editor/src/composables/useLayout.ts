// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { usePageStore, useGraphicStore } from '@scada-editor/core';

// Layout-related composables
export function useLayout() {
  const pageStore = usePageStore();
  const graphicStore = useGraphicStore();

  // Apply layout
  const applyLayout = () => {
    const currentPage = pageStore.currentPage;
    if (currentPage) {
      currentPage.layout.applyLayout(graphicStore.graphics);
    }
  };

  // Set page layout
  const setPageLayout = (layoutType: string) => {
    const currentPage = pageStore.currentPage;
    if (currentPage) {
      pageStore.setPageLayout(currentPage.id, layoutType);
      applyLayout();
    }
  };

  // Update layout properties
  const updateLayoutProperties = (properties: Partial<Record<string, any>>) => {
    const currentPage = pageStore.currentPage;
    if (currentPage) {
      currentPage.layout.update(properties);
      applyLayout();
    }
  };

  return {
    currentLayout: pageStore.currentPage?.layout,
    applyLayout,
    setPageLayout,
    updateLayoutProperties,
  };
}
