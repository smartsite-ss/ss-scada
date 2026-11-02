// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '../types';
import { GraphicFactory } from '../graphic-editing/graphic/factory/GraphicFactory';
import { usePageStore } from './page.store';
import { stateService } from '../services/state.service';
import { graphicCache } from './graphic-defaults';
import { getNextGraphicName } from '../utils/graphic/graphicNameUtils';

/** Get a graphic by ID */
export function getGraphicById(id: string): IGraphic | undefined {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage) return undefined;
  const graphics =
    'value' in currentPage.graphics
      ? currentPage.graphics.value
      : (currentPage.graphics as IGraphic[]);
  return (graphics as IGraphic[]).find((g) => g.id === id);
}

/** Get the current page */
export function getCurrentPage() {
  const pageStore = usePageStore();
  return pageStore.currentPage;
}

/** Get the graphic list of the current page */
export function getCurrentPageGraphics(): IGraphic[] | undefined {
  const currentPage = getCurrentPage();
  if (!currentPage) return undefined;
  const graphics = currentPage.graphics;
  if (Array.isArray(graphics)) {
    return graphics;
  }
  return (graphics as { value: IGraphic[] }).value;
}

/** Find a graphic by ID */
export function findGraphicById(id: string): IGraphic | undefined {
  const currentPage = getCurrentPage();
  if (!currentPage) return undefined;
  const graphics =
    'value' in currentPage.graphics
      ? currentPage.graphics.value
      : (currentPage.graphics as IGraphic[]);
  return (
    (graphics as IGraphic[]).find((graphic: IGraphic) => graphic.id === id) || undefined
  );
}

/** Add a graphic */
export function addGraphic(
  type: string,
  x: number,
  y: number,
  width: number,
  height: number
): IGraphic | undefined {
  const currentPage = getCurrentPage();
  if (!currentPage || typeof currentPage.addGraphic !== 'function')
    return undefined;

  const graphic = GraphicFactory.createGraphic(
    type,
    x,
    y,
    width,
    height
  ) as IGraphic;
  if (!graphic) return undefined;

  // Name new graphic by incrementing the max code among same-type elements
  const existingGraphics = currentPage.graphics;
  const graphicsArr = Array.isArray(existingGraphics) ? existingGraphics : (existingGraphics as any).value || [];
  const newName = getNextGraphicName(type, graphicsArr as IGraphic[]);
  graphic.config.name = newName;

  // Add the graphic
  currentPage.addGraphic(graphic as IGraphic);

  currentPage.selectGraphic(graphic.id);

  // Invalidate the lookup cache
  graphicCache.invalidate();

  return graphic;
}

/** Remove a graphic */
export function removeGraphic(id: string) {
  const currentPage = getCurrentPage();
  if (!currentPage) return;
  currentPage.removeGraphic(id);

  // Invalidate the lookup cache
  graphicCache.invalidate();
}

/** Copy page graphics */
export function copyPageGraphics(sourcePageId: string, targetPageId: string) {
  const pageStore = usePageStore();
  const sourcePage = pageStore.pages.find((p) => p.id === sourcePageId);
  const targetPage = pageStore.pages.find((p) => p.id === targetPageId);
  if (!sourcePage || !targetPage) return;

  const sourceGraphics = sourcePage.graphics;
  const copiedGraphics = sourceGraphics.map((graphic) => {
    const newGraphic = GraphicFactory.createGraphicFromJSON(
      graphic.toJSON()
    );
    const { x, y } = newGraphic.getPosition();
    newGraphic.setPosition(x + 20, y + 20);
    return newGraphic;
  });

  // Append rather than replace, preserving the target page's existing elements
  for (const graphic of copiedGraphics) {
    targetPage.addGraphic(graphic);
  }
}

/** Remove page graphics */
export function removePageGraphics(pageId: string) {
  const pageStore = usePageStore();
  const page = pageStore.pages.find((p) => p.id === pageId);
  if (page) {
    const ids = page.getGraphics().map(g => g.id);
    for (const id of ids) {
      page.removeGraphic(id);
    }
  }
}

/** Toggle selection state */
export function toggleSelection(id: string) {
  const currentPage = getCurrentPage();
  if (!currentPage) return;
  if (currentPage.selectedGraphicIds.includes(id)) {
    currentPage.removeFromSelection(id);
  } else {
    currentPage.addToSelection(id);
  }
}

/** Adjust spacing */
export function adjustSpacing(spacing: number, direction: 'horizontal' | 'vertical') {
  const currentPage = getCurrentPage();
  if (!currentPage || typeof currentPage.adjustSpacing !== 'function')
    return;
  currentPage.adjustSpacing(spacing, direction);
}

/** Batch edit */
export function batchEdit(properties: Partial<IGraphic>) {
  const currentPage = getCurrentPage();
  if (!currentPage || typeof currentPage.batchEdit !== 'function') return;
  currentPage.batchEdit(properties);
}

/** Template editing - save as template */
export function saveAsTemplate(name: string) {
  return stateService.saveTemplate(name);
}

/** Template editing - apply template */
export function applyTemplate(templateIndex: number) {
  stateService.applyTemplate(templateIndex);
}
