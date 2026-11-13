// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ISaveService, ProjectData } from '@scada-editor/core';
import { pageApi } from '@scada-editor/system';

async function urlToBlob(url: string): Promise<Blob> {
  if (url.startsWith('data:')) {
    const arr = url.split(',');
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed with status ${response.status}`);
    }
    return await response.blob();
  } catch (err) {
    throw new Error(`Failed to fetch blob from URL (${url.slice(0, 80)}...): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isDataOrBlobUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('data:') || url.startsWith('blob:');
}

function isRelativePath(url: string | undefined): boolean {
  if (!url) return false;
  return !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/');
}

function isAbsoluteApiPath(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('/api/') || url.startsWith('http://') || url.startsWith('https://');
}

function buildResourceUrl(projectId: string, pageName: string, fileName: string, groupName?: string): string {
  const params = groupName ? `?group=${encodeURIComponent(groupName)}` : '';
  return `/api/v1/projects/${projectId}/pages/${encodeURIComponent(pageName)}/${encodeURIComponent(fileName)}${params}`;
}

//─── Lazy Loading: Save the mapping of page names to group names ───
//pageName → groupName (used to know from which group to load page data when loading on demand)
const pageGroupMapping = new Map<string, string | undefined>();

/**
 * Get the mapping from page name to group name*/
export function getPageGroupMapping(): Map<string, string | undefined> {
  return pageGroupMapping;
}

/**
 * Load the complete data (including graphics) of a single page on demand
 * Called by EditorView when the user opens the page
 * @param pageId Unique ID (UUID) of the page, used to look up the group from the mapping table. If pageId has a value, it will be used first; otherwise, pageName will be used.
 *               Pages with the same name in different groups have different pageIds. Using the pageId ensures that the correct group is found.*/
export async function loadPageData(
  projectId: string,
  pageName: string,
  pageId?: string,
): Promise<any | null> {
  try {
    //Prioritize the use of pageId to find group mappings to ensure that pages with the same name can be loaded correctly in different groups.
    const mappingKey = pageId || pageName;
    const groupName = pageGroupMapping.get(mappingKey);
    const res = await pageApi.readPage(projectId, pageName, groupName);
    const result = res.data || (res as any);
    if (!result?.success || !result?.data) return null;
    const pageData = result.data;
    //Parse Background Image URL
    if (isRelativePath(pageData.backgroundImage)) {
      pageData.backgroundImage = buildResourceUrl(projectId, pageName, pageData.backgroundImage, groupName);
    }
    return pageData;
  } catch (err) {
    console.error(`[projectSaveService] Failed to load page data for "${pageName}":`, err);
    return null;
  }
}

/**
 * Load multiple page data on demand (in bulk, used to populate the current page data when opened for the first time)*/
export async function loadPagesData(
  projectId: string,
  pageNames: string[],
): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  await Promise.allSettled(
    pageNames.map(async (name) => {
      const data = await loadPageData(projectId, name);
      if (data) results.set(name, data);
    }),
  );
  return results;
}

async function uploadBackgroundForPage(projectId: string, page: any, groupName?: string): Promise<void> {
  const bgImage: string | undefined = page.backgroundImage;
  if (!bgImage) return;

  //Already a relative path (e.g., "bg.png"), no processing required
  if (isRelativePath(bgImage)) return;

  //Absolute API path already uploaded → Simply extract the file name; no need to re-upload
  if (isAbsoluteApiPath(bgImage)) {
    const fileName = bgImage.split('/').pop() || 'bg.png';
    page.backgroundImage = fileName;
    return;
  }

  if (!isDataOrBlobUrl(bgImage)) return;

  const pageName = page.name || page.id;
  try {
    const blob = await urlToBlob(page.backgroundImage);
    //The backend uploadPageBackground uniformly saves the background image as bg.png.
    //Therefore, after uploading from the front end, backgroundImage must also be set to bg.png to ensure that the path in page.json matches the actual file.
    const fileName = 'bg.png';
    const file = new File([blob], fileName, { type: blob.type });
    await pageApi.uploadBackground(projectId, pageName, file, groupName);
    page.backgroundImage = fileName;
  } catch (err) {
    console.warn(`[projectSaveService] Failed to upload background for page ${pageName}:`, err);
    //Do not clear backgroundImage when the upload fails, and retain the original data/blob URL for the next retry
  }
}

async function processPagesBackgrounds(projectId: string, pages: any[], groupName?: string): Promise<void> {
  for (const page of pages) {
    await uploadBackgroundForPage(projectId, page, groupName);
  }
}

export function createProjectSaveService(projectId: string): ISaveService {
  //Instance-level load lock: Prevents duplicate requests caused by concurrent calls to load()
  let loadPromise: Promise<ProjectData | null> | null = null;

  return {
    async save(data: ProjectData): Promise<void> {
      //Preview of the current page (injected into data by the caller)
      const previews = (data as any).previews as
        | { previewPageName?: string; previewPageId?: string; preview?: File | Blob; previewSmall?: File | Blob }
        | undefined;
      const previewPageName = previews?.previewPageName;
      const previewPageId = previews?.previewPageId;
      const previewOptions = (groupName?: string) => ({
        groupName,
        previewPageName,
        previewPageId,
        preview: previews?.preview,
        previewSmall: previews?.previewSmall,
      });

      const pageGroups = (data as any).pageGroups as Record<string, string> | undefined;
      const pages = data.pages || [];

      if (pages.length === 0) {
        console.warn('[projectSaveService] save: pages is empty');
        throw new Error('没有页面数据可保存，请先创建页面');
      }

      //── Determine the scope of saving based on the __saveAll flag ──
      //Project Save (__saveAll=true): Save all loaded (non-_lazy) pages
      //Ctrl+S (__saveAll=false or not set): Only save the currently edited page (identified by previewPageName)
      const saveAll = (data as any).__saveAll === true;
      let pagesToSave: any[];

      if (saveAll) {
        //Save all loaded pages (filter out _lazy placeholders to avoid overwriting existing server-side data)
        pagesToSave = pages.filter(page => !page._lazy);
        if (pagesToSave.length === 0) {
          console.warn('[projectSaveService] saveAll: no loaded pages to save');
          throw new Error('没有已加载的页面数据可保存，请先打开需要保存的页面');
        }
      } else if (previewPageName) {
        //Ctrl+S: Save only the currently edited page
        pagesToSave = pages.filter(page => (page.name || page.id) === previewPageName);
        if (pagesToSave.length === 0) {
          console.warn('[projectSaveService] save: no matching page found for previewPageName:', previewPageName);
          throw new Error('未找到当前编辑页面的数据，请确认页面已打开');
        }
      } else {
        //Save all pages when there is no previewPageName (compatible with old calls)
        pagesToSave = pages;
      }

      //Verify that pages data can be serialized
      try {
        JSON.stringify(pagesToSave);
      } catch (serializeErr) {
        console.error('[projectSaveService] save: failed to serialize pages', serializeErr);
        throw new Error(`页面数据序列化失败: ${(serializeErr as Error).message}`);
      }

      if (pageGroups && Object.keys(pageGroups).length > 0) {
        const groupedPages = new Map<string, any[]>();
        const ungroupedPages: any[] = [];

        for (const page of pagesToSave) {
          const groupId = pageGroups[page.id];
          if (groupId) {
            if (!groupedPages.has(groupId)) {
              groupedPages.set(groupId, []);
            }
            groupedPages.get(groupId)!.push(page);
          } else {
            ungroupedPages.push(page);
          }
        }

        for (const [groupId, groupPages] of groupedPages) {
          const groupName = (data as any).groupNames?.[groupId] || groupId;
          await processPagesBackgrounds(projectId, groupPages, groupName);
          await pageApi.saveAllPages(projectId, groupPages, previewOptions(groupName));
        }

        if (ungroupedPages.length > 0) {
          await processPagesBackgrounds(projectId, ungroupedPages);
          await pageApi.saveAllPages(projectId, ungroupedPages, previewOptions(undefined));
        }
      } else {
        await processPagesBackgrounds(projectId, pagesToSave);
        await pageApi.saveAllPages(projectId, pagesToSave, previewOptions(undefined));
      }
    },

    async load(): Promise<ProjectData | null> {
      //If there is already an ongoing load(), directly reuse its Promise
      if (loadPromise) {
        return loadPromise;
      }

      loadPromise = (async () => {
        try {
          //── Load on Demand: Load the outline first (lightweight, only the directory structure, without page.json data) ──
          const outlineRes = await pageApi.getProjectOutline(projectId);
          const outline = outlineRes.data || (outlineRes as any);
          if (!outline?.success || outline.totalPageCount === 0) return null;

          //Clear old mappings
          pageGroupMapping.clear();

          const allPages: any[] = [];
          const pageGroups: Record<string, string> = {};
          const groupNames: Record<string, string> = {};

          /** Add pages from the outline to the page list*/
          const addPageFromOutline = (
            pageName: string,
            pageId: string | undefined,
            groupName?: string,
            previewSmallUrl?: string,
            backgroundColor?: string,
            backgroundImage?: string,
            width?: number,
            height?: number,
          ) => {
            //Preferably use the ID returned by outline (the unique ID in page.json); if not available, fall back to pageName.
            const id = pageId || pageName;
            allPages.push({
              id,
              name: pageName,
              width: width ?? 1920,
              height: height ?? 1080,
              backgroundColor: backgroundColor || '#1e1e2e',
              ...(backgroundImage ? { backgroundImage } : {}),
              graphics: [], //Empty graphics, load on demand
              _lazy: true,  //Marked for lazy loading
              ...(previewSmallUrl ? { previewSmallUrl } : {}),
            });
            if (groupName) {
              pageGroups[id] = groupName;
              groupNames[groupName] = groupName;
            }
            //Use pageId (or pageName as a fallback) as the key to ensure that pages with the same name can be correctly found in different groups.
            pageGroupMapping.set(pageId || pageName, groupName);
          }

          //Load the root directory page first
          for (const page of outline.rootPages || []) {
            addPageFromOutline(page.name, page.id, undefined, page.previewSmallUrl, page.backgroundColor, page.backgroundImage, page.width, page.height);
          }
          //Reload pages within the group
          for (const group of outline.groups || []) {
            for (const page of group.pages || []) {
              addPageFromOutline(page.name, page.id, group.name, page.previewSmallUrl, page.backgroundColor, page.backgroundImage, page.width, page.height);
            }
          }

          return {
            version: '1.0',
            savedAt: Date.now(),
            currentPageId: allPages[0]?.id || '',
            pages: allPages,
            ...(Object.keys(pageGroups).length > 0 ? { pageGroups, groupNames } : {}),
          } as ProjectData;
        } catch (err) {
          console.error('[projectSaveService] load failed:', err);
          return null;
        } finally {
          //Clear Load Lock
          loadPromise = null;
        }
      })();

      return loadPromise;
    },

    async delete(): Promise<void> {
      try {
        const groupsRes = await pageApi.listGroups(projectId);
        const groupsResult = groupsRes.data || (groupsRes as any);
        const groups = groupsResult?.groups || [];

        for (const group of groups) {
          const listRes = await pageApi.listPages(projectId, group.name);
          const result = listRes.data || (listRes as any);
          const pageFiles = result?.pages || [];
          for (const info of pageFiles) {
            await pageApi.deletePage(projectId, info.name, group.name).catch(() => {});
          }
          await pageApi.deleteGroup(projectId, group.name).catch(() => {});
        }

        const listRes = await pageApi.listPages(projectId);
        const result = listRes.data || (listRes as any);
        const pageFiles = result?.pages || [];
        await Promise.all(
          pageFiles.map((info: { name: string }) =>
            pageApi.deletePage(projectId, info.name).catch(() => {})
          )
        );
      } catch {
        // ignore
      }
    },

    async hasSavedData(): Promise<boolean> {
      try {
        const listRes = await pageApi.listPages(projectId);
        const result = listRes.data || (listRes as any);
        if ((result?.pages || []).length > 0) return true;

        const groupsRes = await pageApi.listGroups(projectId);
        const groupsResult = groupsRes.data || (groupsRes as any);
        return (groupsResult?.groups || []).length > 0;
      } catch {
        return false;
      }
    },
  };
}