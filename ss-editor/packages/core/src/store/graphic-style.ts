// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { usePageStore } from './page.store';
import { GRAPHIC_DEFAULT_STYLES } from './graphic-defaults';

/** Store state subset required for style operations */
export interface StyleStoreState {
  styleClipboard: Record<string, any> | null;
}

/** Style management - apply style */
export function applyStyleHelper(graphicId: string, style: Record<string, any>) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic) {
    Object.assign(graphic.config.customProps, style);
    currentPage.markDirty?.();
  }
}

/** Style management - copy style */
export function copyStyleHelper(store: StyleStoreState, sourceGraphicId: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return false;

  const sourceGraphic = currentPage.graphics.find(
    (g) => g.id === sourceGraphicId
  );
  if (sourceGraphic) {
    store.styleClipboard = { ...sourceGraphic.config.customProps };
    return true;
  }
  return false;
}

/** Style management - paste style */
export function pasteStyleHelper(store: StyleStoreState, targetGraphicId: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return false;

  if (store.styleClipboard) {
    const targetGraphic = currentPage.graphics.find(
      (g) => g.id === targetGraphicId
    );
    if (targetGraphic) {
      Object.assign(
        targetGraphic.config.customProps,
        store.styleClipboard
      );
      currentPage.markDirty?.();
      return true;
    }
  }
  return false;
}

/** Style management - reset style */
export function resetStyleHelper(graphicId: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return false;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (graphic) {
    const defaultStyle = GRAPHIC_DEFAULT_STYLES[graphic.type];
    if (defaultStyle) {
      graphic.config.customProps = { ...defaultStyle };
      currentPage.updateGraphic(graphic.id, { config: { ...graphic.config } });
    }
  }
}

/** Apply a property to a graphic */
export function applyPropertyHelper(graphicId: string, propertyPath: string, value: any) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (!graphic) return;

  // propertyPath is like 'config.customProps.text', but target already starts at graphic.config,
  // so strip the 'config.' prefix to avoid an extra nesting level (writing graphic.config.config.customProps.text)
  const normalizedPath = propertyPath.startsWith('config.')
    ? propertyPath.substring('config.'.length)
    : propertyPath;

  const parts = normalizedPath.split('.');
  let target: any = graphic.config;
  if (!target) return;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;

  currentPage.updateGraphic(graphicId, { config: { ...graphic.config } });
}

/** Apply quality indicator */
export function applyQualityIndicatorHelper(graphicId: string, quality: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return;

  const graphic = currentPage.graphics.find((g) => g.id === graphicId);
  if (!graphic) return;

  const qualityColors: Record<string, string> = {
    good: '#18a058',
    uncertain: '#f0a020',
    bad: '#d03050',
    stale: '#999',
    disconnected: '#ccc',
  };

  const indicatorColor = qualityColors[quality] || '#e0e0e0';
  const style = graphic.config?.style || {};
  style.borderColor = indicatorColor;
  style.boxShadow = `0 0 4px ${indicatorColor}`;

  currentPage.updateGraphic(graphicId, {
    config: { ...graphic.config, style },
  });
}
