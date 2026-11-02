// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * canvas-page template.store unit tests
 *
 * Key verification points:
 * 1. setCurrentProjectId correctly sets the project context
 * 2. saveAsTemplate decides the API path based on the project context + saveToSystem
 * 3. After a successful save the template is added to the correct list (systemTemplates / projectTemplates)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useTemplateStore } from '../../../canvas-page/templates/template.store';
import type { PageTemplate } from '../../../canvas-page/templates/types';

// ─── Test helpers ───

const mockPageConfig: PageTemplate['pageConfig'] = {
  width: 1920,
  height: 1080,
  backgroundColor: '#808080',
  layout: 'free',
};

const mockGraphics = [
  { type: 'rect', x: 100, y: 200, width: 300, height: 150 },
];

const mockTemplateInfo = {
  name: '测试模板',
  description: '单元测试模板',
  category: 'custom' as const,
  pageConfig: mockPageConfig,
  graphics: mockGraphics,
  tags: ['test'],
};

function mockFetchResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  } as Response);
}

function mockFetchError(message: string) {
  return Promise.resolve({
    ok: false,
    status: 500,
    text: () => Promise.resolve(message),
    json: () => Promise.reject(new Error(message)),
  } as Response);
}

// ─── Test suites ───

describe('canvas-page template.store', () => {
  let store: ReturnType<typeof useTemplateStore>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useTemplateStore();
    // Reset the module-level currentProjectId to prevent leakage between tests
    store.setCurrentProjectId(null);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Initial state ───

  describe('Initial state', () => {
    it('systemTemplates and projectTemplates are initially empty arrays', () => {
      expect(store.systemTemplates).toEqual([]);
      expect(store.projectTemplates).toEqual([]);
    });

    it('isLoading is initially false', () => {
      expect(store.isLoading).toBe(false);
    });
  });

  // ─── setCurrentProjectId ───

  describe('setCurrentProjectId', () => {
    it('After setting the project ID, saveAsTemplate uses the project-level API', async () => {
      store.setCurrentProjectId('demo-project');

      const savedTemplate = { success: true, data: { ...mockTemplateInfo, id: 'tpl-1', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(savedTemplate) as any);

      await store.saveAsTemplate(mockTemplateInfo);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('/api/v1/projects/demo-project/canvas-templates');
    });

    it('After setting null, saveAsTemplate uses the system-level API', async () => {
      store.setCurrentProjectId(null);

      const savedTemplate = { success: true, data: { ...mockTemplateInfo, id: 'tpl-2', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(savedTemplate) as any);

      await store.saveAsTemplate(mockTemplateInfo);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('/api/v1/canvas-templates');
      expect(url).not.toContain('/projects/');
    });
  });

  // ─── saveAsTemplate — API path dispatch ───

  describe('saveAsTemplate — API path dispatch', () => {
    it('saveToSystem=false + currentProjectId set → uses the project-level API', async () => {
      store.setCurrentProjectId('my-project');

      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-p1', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      await store.saveAsTemplate(mockTemplateInfo, false);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/v1/projects/my-project/canvas-templates');
      expect(options?.method).toBe('POST');
    });

    it('saveToSystem=true → always uses the system-level API, ignoring currentProjectId', async () => {
      store.setCurrentProjectId('my-project');

      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-s1', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      await store.saveAsTemplate(mockTemplateInfo, true);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/v1/canvas-templates');
    });

    it('With currentProjectId unset → falls back to the system-level API even when saveToSystem=false', async () => {
      // Do not call setCurrentProjectId, simulating the scenario where TemplateGallery was never opened

      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-fallback', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      await store.saveAsTemplate(mockTemplateInfo, false);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/v1/canvas-templates');
    });
  });

  // ─── saveAsTemplate — template categorization ───

  describe('saveAsTemplate — template classification', () => {
    it('Project-level save → added to projectTemplates', async () => {
      store.setCurrentProjectId('demo-project');

      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-proj-1', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      const result = await store.saveAsTemplate(mockTemplateInfo, false);

      expect(result).not.toBeNull();
      expect(store.projectTemplates).toHaveLength(1);
      expect(store.projectTemplates[0].id).toBe('tpl-proj-1');
      expect(store.systemTemplates).toHaveLength(0);
    });

    it('System-level save → added to systemTemplates', async () => {
      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-sys-1', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      const result = await store.saveAsTemplate(mockTemplateInfo, true);

      expect(result).not.toBeNull();
      expect(store.systemTemplates).toHaveLength(1);
      expect(store.systemTemplates[0].id).toBe('tpl-sys-1');
      expect(store.projectTemplates).toHaveLength(0);
    });

    it('Save with currentProjectId=null → added to systemTemplates (fallback behavior)', async () => {
      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-fb-1', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      await store.saveAsTemplate(mockTemplateInfo, false);

      expect(store.systemTemplates).toHaveLength(1);
      expect(store.projectTemplates).toHaveLength(0);
    });
  });

  // ─── saveAsTemplate — API failure degradation ───

  describe('saveAsTemplate — API failure degradation', () => {
    it('Should degrade to localStorage (systemTemplates) when the API fails', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchError('Server Error') as any);

      const result = await store.saveAsTemplate(mockTemplateInfo, true);

      // Still returns the template object when degrading to localStorage
      expect(result).not.toBeNull();
      expect(result!.name).toBe('测试模板');
      // During degradation the template is uniformly added to systemTemplates
      expect(store.systemTemplates).toHaveLength(1);
      expect(store.projectTemplates).toHaveLength(0);
    });

    it('Should degrade even when the API returns success=false', async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ success: false, message: 'error' }) as any);

      const result = await store.saveAsTemplate(mockTemplateInfo, false);

      expect(result).not.toBeNull();
      expect(store.systemTemplates).toHaveLength(1);
    });
  });

  // ─── Integration scenario: PageTabs → TemplateSaveDialog full flow ───

  describe('Integration scenario: saving as a template from the context menu', () => {
    it('PageTabs sets projectId first → then saves → correctly uses the project-level API', async () => {
      // Simulate the behavior of PageTabs.openSaveAsTemplateDialog:
      // templateStore.setCurrentProjectId(props.projectId || null);
      store.setCurrentProjectId('real-project');

      // Simulate the user saving in TemplateSaveDialog (saveToSystem=false is the default)
      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-integration-1', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      await store.saveAsTemplate(mockTemplateInfo, false);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/v1/projects/real-project/canvas-templates');
      expect(store.projectTemplates).toHaveLength(1);
    });

    it('Even when projectId is set, saving to system level by user choice works correctly', async () => {
      store.setCurrentProjectId('real-project');

      const saved = { success: true, data: { ...mockTemplateInfo, id: 'tpl-integration-2', source: 'user' } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(saved) as any);

      // The user selected "system level" in the TemplateSaveDialog dropdown
      await store.saveAsTemplate(mockTemplateInfo, true);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/v1/canvas-templates');
      expect(store.systemTemplates).toHaveLength(1);
    });
  });
});
