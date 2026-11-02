// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { BasePage } from '../../../graphic-editing/graphic/base/BasePage';
import { usePageStore } from '../../../store/page.store';
import type { PageTemplate } from '../../../canvas-page/templates/types';

/** Mock template data */
const mockTemplate: PageTemplate = {
  id: 'builtin-dashboard',
  name: '仪表盘',
  description: '工业仪表盘模板',
  category: 'dashboard',
  source: 'builtin',
  version: '1.0.0',
  pageConfig: {
    width: 1920,
    height: 1080,
    backgroundColor: '#0a1a2e',
    layout: 'free',
  },
  graphics: [
    { type: 'rect', config: { geometry: { x: 0, y: 0, width: 100, height: 50 } } },
    { type: 'text', config: { text: '你好' } },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('Template reference — BasePage getter/setter', () => {
  let page: BasePage;

  beforeEach(() => {
    page = new BasePage();
    page.init({
      id: 'test-page-1',
      name: '测试页面',
      width: 1920,
      height: 1080,
      backgroundColor: '#808080',
    });
  });

  it('After setting templateId, it should be readable via the getter', () => {
    page.templateId = 'builtin-dashboard';
    expect(page.templateId).toBe('builtin-dashboard');
  });

  it('After setting templateMode, it should be readable via the getter', () => {
    page.templateMode = 'reference';
    expect(page.templateMode).toBe('reference');
  });

  it('Initial templateId/templateMode should be undefined', () => {
    expect(page.templateId).toBeUndefined();
    expect(page.templateMode).toBeUndefined();
  });

  it('Can be set to copy mode', () => {
    page.templateMode = 'copy';
    expect(page.templateMode).toBe('copy');
  });
});

describe('Template reference — toJSON serialization', () => {
  it('toJSON should include templateId and templateMode (after being set)', () => {
    const page = new BasePage();
    page.init({ id: 'p1', name: 'P1', width: 800, height: 600, backgroundColor: '#fff' });
    page.templateId = 'builtin-dashboard';
    page.templateMode = 'reference';

    const json = page.toJSON();
    expect(json).toHaveProperty('templateId', 'builtin-dashboard');
    expect(json).toHaveProperty('templateMode', 'reference');
  });

  it('toJSON\'s templateId should be undefined (when not set)', () => {
    const page = new BasePage();
    page.init({ id: 'p2', name: 'P2', width: 800, height: 600, backgroundColor: '#fff' });
    const json = page.toJSON();
    expect(json.templateId).toBeUndefined();
    expect(json.templateMode).toBeUndefined();
  });

  it('After JSON.stringify, the templateId field should be included', () => {
    const page = new BasePage();
    page.init({ id: 'p3', name: 'P3', width: 800, height: 600, backgroundColor: '#fff' });
    page.templateId = 'builtin-dashboard';
    page.templateMode = 'reference';

    const jsonString = JSON.stringify(page.toJSON());
    const parsed = JSON.parse(jsonString);
    expect(parsed.templateId).toBe('builtin-dashboard');
    expect(parsed.templateMode).toBe('reference');
  });

  it('toJSONAsync should include templateId', async () => {
    const page = new BasePage();
    page.init({ id: 'p4', name: 'P4', width: 800, height: 600, backgroundColor: '#fff' });
    page.templateId = 'builtin-dashboard';
    page.templateMode = 'reference';
    const json = await page.toJSONAsync();
    expect(json).toHaveProperty('templateId', 'builtin-dashboard');
    expect(json).toHaveProperty('templateMode', 'reference');
  });
});

describe('Template reference — fromJSON deserialization', () => {
  it('fromJSON should restore templateId/templateMode', () => {
    const page = new BasePage();
    page.fromJSON({
      id: 'page-x',
      name: 'Restore test',
      width: 1920,
      height: 1080,
      backgroundColor: '#000',
      templateId: 'builtin-dashboard',
      templateMode: 'reference',
    });
    expect(page.templateId).toBe('builtin-dashboard');
    expect(page.templateMode).toBe('reference');
  });

  it('templateId/templateMode stay consistent after a toJSON + fromJSON round trip', () => {
    const page = new BasePage();
    page.init({ id: 'roundtrip', name: 'Round trip', width: 800, height: 600, backgroundColor: '#fff' });
    page.templateId = 'builtin-dashboard';
    page.templateMode = 'reference';

    const json = page.toJSON();
    const restored = new BasePage();
    restored.fromJSON(json);

    expect(restored.templateId).toBe('builtin-dashboard');
    expect(restored.templateMode).toBe('reference');
    expect(restored.toJSON()).toMatchObject({
      templateId: 'builtin-dashboard',
      templateMode: 'reference',
    });
  });
});

describe('Template reference — simulating the full handleTemplateCreate code flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('✅ Created from template: addPage → set pageConfig → set templateId/templateMode → copy graphics', () => {
    const pageStore = usePageStore();
    pageStore.pages = [];

    // ── Fully simulate the code of PageTabs.handleTemplateCreate ──

    // Step 1: create the page
    const pageName = mockTemplate.name || '新页面';
    const newPage = pageStore.addPage(pageName);
    const page = newPage; // BasePage instance

    // Step 2: set page size and background color
    if (mockTemplate.pageConfig) {
      page.width = mockTemplate.pageConfig.width;
      page.height = mockTemplate.pageConfig.height;
      page.backgroundColor = mockTemplate.pageConfig.backgroundColor;
    }

    // Step 3: reference mode → record the template ID
    // Equivalent to: if (templateStore.configMode === 'reference') { ... }
    page.templateId = mockTemplate.id;
    page.templateMode = 'reference';

    // Step 4: copy graphics (via addGraphic; GraphicFactory omitted here)

    // ── Verification ──

    expect(page.width).toBe(1920);
    expect(page.height).toBe(1080);
    expect(page.backgroundColor).toBe('#0a1a2e');

    // ★ Core assertion: templateId/templateMode are set
    expect(page.templateId).toBe('builtin-dashboard');
    expect(page.templateMode).toBe('reference');

    // ★ The Proxy obtained via store.pages should also be correct
    const proxyPage = pageStore.pages[0];
    expect(proxyPage.templateId).toBe('builtin-dashboard');
    expect(proxyPage.templateMode).toBe('reference');

    // ★ toJSON output should contain both fields
    const json = proxyPage.toJSON();
    expect(json).toMatchObject({
      name: '仪表盘',
      width: 1920,
      height: 1080,
      backgroundColor: '#0a1a2e',
      templateId: 'builtin-dashboard',
      templateMode: 'reference',
    });
  });

  it('✅ Copy mode (configMode=copy): does not set templateId/templateMode', () => {
    const pageStore = usePageStore();
    pageStore.pages = [];

    const page = pageStore.addPage('Page1');

    // Copy mode: do not set templateId/templateMode
    const json = page.toJSON();
    expect(json.templateId).toBeUndefined();
    expect(json.templateMode).toBeUndefined();
  });

  it('✅ JSON.stringify output includes the templateId field (simulating page.json content)', () => {
    const pageStore = usePageStore();
    pageStore.pages = [];

    const page = pageStore.addPage('仪表盘');
    page.templateId = 'builtin-dashboard';
    page.templateMode = 'reference';

    const jsonStr = JSON.stringify(page.toJSON(), null, 2);

    expect(jsonStr).toContain('"templateId"');
    expect(jsonStr).toContain('"builtin-dashboard"');
    expect(jsonStr).toContain('"templateMode"');
    expect(jsonStr).toContain('"reference"');
  });

  it('✅ Multi-page isolation: their templateIds do not interfere with each other', () => {
    const pageStore = usePageStore();
    pageStore.pages = [];

    const p1 = pageStore.addPage('页面1');
    p1.templateId = 'tpl-a';
    p1.templateMode = 'reference';

    const p2 = pageStore.addPage('页面2');
    // page2 has no templateId

    expect(pageStore.pages[0].toJSON().templateId).toBe('tpl-a');
    expect(pageStore.pages[0].toJSON().templateMode).toBe('reference');
    expect(pageStore.pages[1].toJSON().templateId).toBeUndefined();
    expect(pageStore.pages[1].toJSON().templateMode).toBeUndefined();
  });

  it('✅ Full round trip: create → toJSON(save) → fromJSON(load) → templateId not lost', () => {
    const pageStore = usePageStore();
    pageStore.pages = [];

    const page = pageStore.addPage('大屏');
    page.templateId = 'builtin-dashboard';
    page.templateMode = 'reference';

    // Save
    const saveJson = page.toJSON();
    expect(saveJson.templateId).toBe('builtin-dashboard');

    // Load
    page.fromJSON(saveJson);
    expect(page.templateId).toBe('builtin-dashboard');
    expect(page.templateMode).toBe('reference');

    // Save again
    const resaveJson = page.toJSON();
    expect(resaveJson.templateId).toBe('builtin-dashboard');
    expect(resaveJson.templateMode).toBe('reference');
  });

  it('✅ collectProjectData simulation: all pages\' toJSON include templateId', () => {
    const pageStore = usePageStore();
    pageStore.pages = [];

    const p1 = pageStore.addPage('Dashboard');
    p1.templateId = 'builtin-dashboard';
    p1.templateMode = 'reference';

    const p2 = pageStore.addPage('Login');
    p2.templateId = 'builtin-login';
    p2.templateMode = 'reference';

    // Simulate collectProjectData: pageStore.pages.map(p => p.toJSON())
    const pagesJson = pageStore.pages.map(p => p.toJSON());

    expect(pagesJson[0].templateId).toBe('builtin-dashboard');
    expect(pagesJson[0].templateMode).toBe('reference');
    expect(pagesJson[1].templateId).toBe('builtin-login');
    expect(pagesJson[1].templateMode).toBe('reference');
  });

  it('✅ Pinia Proxy toJSON obtained via store.pages includes templateId', () => {
    const pageStore = usePageStore();
    pageStore.pages = [];

    pageStore.addPage('测试').templateId = 'tpl-test';
    const proxyPage = pageStore.pages[0];

    expect(proxyPage.templateId).toBe('tpl-test');
    expect(proxyPage.toJSON().templateId).toBe('tpl-test');
  });
});
