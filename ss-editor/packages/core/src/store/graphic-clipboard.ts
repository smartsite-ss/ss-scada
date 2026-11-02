// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '../types';
import { usePageStore } from './page.store';
import { eventBus, Events } from '../platform/event/EventBus';
import { ClipboardManager } from '../graphic-editing/managers/ClipboardManager';
import { InterpageTransferService } from '../services/InterpageTransferService';
import { graphicCache } from './graphic-defaults';
import { getNextGraphicName } from '../utils/graphic/graphicNameUtils';

/** Store state subset required for clipboard operations */
export interface ClipboardStoreState {
  clipboardManager: ClipboardManager;
  transferService: InterpageTransferService;
}

/** Copy selected graphics to clipboard */
export function copyHelper(store: ClipboardStoreState) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage || currentPage.selectedGraphicIds.length === 0) return;

  const selectedIds = [...currentPage.selectedGraphicIds];

  const selectedGraphics = currentPage.graphics.filter((g) =>
    selectedIds.includes(g.id)
  );

  const serializedData = store.transferService.serializeGraphics(selectedGraphics);
  store.clipboardManager.setData(serializedData, 'copy', currentPage.id);

  const groupManager = currentPage.getGroupManager();
  if (groupManager && selectedIds.length > 0) {
    const candidateGroup = groupManager.getGroupForGraphic(selectedIds[0]);
    const allInGroup = selectedIds.every((sid: string) => groupManager.isGraphicInGroup(sid));
    if (candidateGroup && allInGroup) {
      const metadata = {
        isGroupCopy: true,
        sourceGroupId: candidateGroup.id,
        groupName: candidateGroup.name,
      };
      store.clipboardManager.setGroupMetadata(metadata);
    }
  }
}

/** Cut selected graphics to clipboard */
export function cutHelper(store: ClipboardStoreState) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage || currentPage.selectedGraphicIds.length === 0) return;

  const selectedGraphics = currentPage.graphics.filter((g) =>
    currentPage.selectedGraphicIds.includes(g.id)
  );
  const serializedData = store.transferService.serializeGraphics(selectedGraphics);
  store.clipboardManager.setData(serializedData, 'cut', currentPage.id);

  // Use transactional batch deletion
  currentPage.deleteSelectedGraphics();
}

/** Paste graphics from clipboard to the current page */
export function pasteHelper(store: ClipboardStoreState, offsetX: number = 20, offsetY: number = 20): IGraphic[] {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage || store.clipboardManager.isEmpty()) return [];

  const clipboardData = store.clipboardManager.getData();
  const existingIds = currentPage.graphics.map((g) => g.id);
  const pasteCount = store.clipboardManager.getPasteCount();
  const clipboardMode = store.clipboardManager.getClipboardMode();
  const sourcePageId = store.clipboardManager.getSourcePageId();

  // Deserialize
  let graphics = store.transferService.deserializeGraphics(clipboardData);

  // Reassign IDs
  graphics = store.transferService.reassignIds(graphics, existingIds);

  // Name each pasted graphic by incrementing the max code among same-type elements (update before adding)
  for (const graphic of graphics) {
    const type = graphic.type;
    const newName = getNextGraphicName(
      type,
      currentPage.graphics.concat(
        graphics.filter(g => g.id !== graphic.id)
      )
    );
    graphic.config.name = newName;
  }

  // Compute the cumulative offset (each paste adds 20px)
  const totalOffsetX = offsetX * (pasteCount + 1);
  const totalOffsetY = offsetY * (pasteCount + 1);

  // Offset position
  graphics.forEach((graphic) => {
    store.transferService.transformCoordinates(graphic, totalOffsetX, totalOffsetY);
    // Add to the current page
    currentPage.addGraphic(graphic);
  });

  // Clear the original selection, then select the newly pasted graphics
  currentPage.clearSelection();
  const newIds = graphics.map((g) => g.id);
  currentPage.selectMultipleGraphics(newIds);

  // Detect whether the source came from a group; if so, rebuild the group structure
  const groupMetadata = store.clipboardManager.getGroupMetadata();
  if (groupMetadata?.isGroupCopy && newIds.length > 1) {
    const groupName = groupMetadata.groupName.includes('Copy')
      ? groupMetadata.groupName.replace(/ \(Copy \d+\)$/, '') + ` (Copy ${pasteCount + 1})`
      : `${groupMetadata.groupName} Copy`;
    const group = currentPage.createGroup(newIds, groupName);
    if (group) {
      store.clipboardManager.setGroupMetadata({
        ...groupMetadata,
        groupName,
        sourceGroupId: group.id,
      });
    }
  }

  // Increment the paste count
  store.clipboardManager.incrementPasteCount();

  // In cut mode, delete the source page's elements after pasting and clear the clipboard
  if (clipboardMode === 'cut' && sourcePageId) {
    const sourcePage = pageStore.pages.find((p) => p.id === sourcePageId);
    if (sourcePage && sourcePage.id !== currentPage.id) {
      // Remove the cut elements from the source page
      const clipboardGraphicIds = clipboardData.map((d: any) => d.originalId || d.id).filter(Boolean);
      clipboardGraphicIds.forEach((gid: string) => {
        sourcePage.removeGraphic(gid);
      });
    }
    store.clipboardManager.clearData();
  }

  return graphics;
}

/** Duplicate an entire group (createGroupCopy) */
export function duplicateGroupHelper(groupId: string): { groupId: string; memberIds: string[] } | null {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage || typeof currentPage.duplicateGroup !== 'function') {
    console.warn('[duplicateGroup] currentPage has no duplicateGroup method');
    return null;
  }

  const result = currentPage.duplicateGroup(groupId);

  if (result && result.groupId) {
    currentPage.clearSelection();
    currentPage.selectMultipleGraphics(result.memberIds);

    // Invalidate the lookup cache
    graphicCache.invalidate();

    // Emit group-created and page-updated events to notify the UI to refresh
    eventBus.emit(Events.GROUP_CREATED, { groupId: result.groupId, isDuplicate: true });
    eventBus.emit(Events.PAGE_UPDATED, { pageId: currentPage.id, change: 'group_duplicate' });
  } else if (result && !result.groupId) {
    console.warn('[duplicateGroup] group creation failed, members were created but not grouped');
  }
  return result;
}

/** Duplicate a graphic (supports single element and group) */
export function duplicateGraphicHelper(id: string) {
  const pageStore = usePageStore();
  const currentPage = pageStore.currentPage;
  if (!currentPage || typeof currentPage.duplicateGraphic !== 'function') {
    console.warn('[duplicateGraphic] currentPage invalid or missing duplicateGraphic method');
    return null;
  }

  // Smart detection: if a group member is selected → call duplicateGroup
  const groupManager = currentPage.getGroupManager?.();
  if (groupManager && currentPage.selectedGraphicIds.length > 0) {
    const selectedIds = currentPage.selectedGraphicIds;
    const candidateGroup = groupManager.getGroupForGraphic(selectedIds[0]);
    if (candidateGroup && selectedIds.every((sid: string) => groupManager.isGraphicInGroup(sid))) {
      const success = duplicateGroupHelper(candidateGroup.id);
      return success ? { id: candidateGroup.id, isGroup: true } : null;
    }
  }

  const newGraphic = currentPage.duplicateGraphic(id);
  if (newGraphic) {
    currentPage.clearSelection();
    currentPage.selectGraphic(newGraphic.id);
  }
  return newGraphic;
}
