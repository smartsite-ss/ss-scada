// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * CanvasTemplateService unit tests
 *
 * Core verification points:
 * 1. getTemplatesDir returns the correct project-level / system-level paths
 * 2. createTemplate writes files to the correct directory
 * 3. Files actually exist on disk
 * 4. Project-level and system-level template isolation
 * 5. listTemplates / readTemplate read correctly
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CanvasTemplateService, CanvasTemplateData } from '../canvas-template.service';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';

// ─── Mock PathResolverService ───

jest.mock('@ss-node/ss-core', () => {
  const actual = jest.requireActual('@ss-node/ss-core');
  return {
    ...actual,
    PathResolverService: class {
      resolve = jest.fn((p: string) => path.resolve(p));
    },
  };
});

// ─── Test helpers ───

function createMockTemplate(overrides: Partial<CanvasTemplateData> = {}): CanvasTemplateData {
  return {
    id: `tpl-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '测试模板',
    description: '单元测试',
    category: 'custom',
    icon: '📋',
    source: 'user',
    author: 'test-user',
    version: '1.0.0',
    pageConfig: { width: 1920, height: 1080, backgroundColor: '#808080', layout: 'free' },
    graphics: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100 }],
    tags: ['test'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── Test suites ───

describe('CanvasTemplateService', () => {
  let service: CanvasTemplateService;
  let tempDir: string;
  let mockConfigService: ConfigService;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `canvas-template-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    mockConfigService = {
      get: jest.fn().mockReturnValue(tempDir),
    } as unknown as ConfigService;

    service = new CanvasTemplateService(mockConfigService, new PathResolverService() as any);
  });

  afterEach(() => {
    // Clean up the project-level directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    // Clean up the system-level template directory (above tempDir, so tempDir's recursive delete does not cover it)
    const systemDir = path.join(path.dirname(tempDir), 'canvas-templates');
    if (fs.existsSync(systemDir)) {
      fs.rmSync(systemDir, { recursive: true, force: true });
    }
  });

  // ─── getTemplatesDir ───

  describe('getTemplatesDir', () => {
    it('System-level path → {PROJECTS_DIR}/../canvas-templates/pages/', () => {
      const dir = service.getTemplatesDir();
      expect(dir).toBe(path.join(path.dirname(tempDir), 'canvas-templates', 'pages'));
    });

    it('Project-level path → {PROJECTS_DIR}/{projectId}/canvas-templates/pages/', () => {
      const dir = service.getTemplatesDir('my-project');
      expect(dir).toBe(path.join(tempDir, 'my-project', 'canvas-templates', 'pages'));
    });

    it('Different projectIds return different project-level paths', () => {
      const dir1 = service.getTemplatesDir('project-a');
      const dir2 = service.getTemplatesDir('project-b');
      expect(dir1).toContain('project-a');
      expect(dir2).toContain('project-b');
      expect(dir1).not.toBe(dir2);
    });
  });

  // ─── createTemplate - actual file writes ───

  describe('createTemplate — file writing', () => {
    it('Project-level templates → written to {PROJECTS_DIR}/{projectId}/canvas-templates/pages/{id}.json', () => {
      const template = createMockTemplate({ id: 'tpl-proj-test' });
      const result = service.createTemplate(template, 'demo-project');

      expect(result.success).toBe(true);

      // Verify the file exists at the correct location
      const expectedPath = path.join(tempDir, 'demo-project', 'canvas-templates', 'pages', 'tpl-proj-test.json');
      expect(fs.existsSync(expectedPath)).toBe(true);

      // Verify the file content is readable
      const raw = fs.readFileSync(expectedPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe('tpl-proj-test');
      expect(parsed.name).toBe('测试模板');
      expect(parsed.source).toBe('user');
      expect(parsed.pageConfig.width).toBe(1920);
    });

    it('System-level templates → written to data/canvas-templates/pages/{id}.json', () => {
      const template = createMockTemplate({ id: 'tpl-sys-test' });
      const result = service.createTemplate(template);

      expect(result.success).toBe(true);

      // Verify the file exists at the correct location
      const expectedPath = path.join(path.dirname(tempDir), 'canvas-templates', 'pages', 'tpl-sys-test.json');
      expect(fs.existsSync(expectedPath)).toBe(true);

      const raw = fs.readFileSync(expectedPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe('tpl-sys-test');
    });

    it('Project-level templates → do not appear in the system-level directory', () => {
      const template = createMockTemplate({ id: 'tpl-proj-isolated' });
      service.createTemplate(template, 'demo-project');

      const systemDir = path.join(path.dirname(tempDir), 'canvas-templates', 'pages');
      // The system-level directory may not exist, or exist without this project's template
      if (fs.existsSync(systemDir)) {
        const files = fs.readdirSync(systemDir);
        expect(files).not.toContain('tpl-proj-isolated.json');
      }
    });

    it('System-level templates → do not appear in the project-level directory', () => {
      const template = createMockTemplate({ id: 'tpl-sys-isolated' });
      service.createTemplate(template);

      const projectDir = path.join(tempDir, 'demo-project', 'canvas-templates', 'pages');
      // If the project-level directory does not exist, isolation is correct
      if (fs.existsSync(projectDir)) {
        const files = fs.readdirSync(projectDir);
        expect(files).not.toContain('tpl-sys-isolated.json');
      }
    });

    it('Auto-generate id when not provided', () => {
      const template = createMockTemplate();
      delete (template as any).id;

      const result = service.createTemplate(template);
      expect(result.success).toBe(true);
      expect(result.data.id).toMatch(/^tpl-/);
      expect(result.data.id.length).toBeGreaterThan(4);
    });

    it('Duplicate ids throw an error', () => {
      const template = createMockTemplate({ id: 'tpl-dup' });
      service.createTemplate(template);

      expect(() => {
        service.createTemplate(createMockTemplate({ id: 'tpl-dup' }));
      }).toThrow('模板 ID 已存在');
    });
  });

  // ─── listTemplates - read the list ───

  describe('listTemplates — template list', () => {
    it('After creation, listTemplates can list project-level templates', () => {
      const template = createMockTemplate({ id: 'tpl-list-proj', name: '列表测试模板' });
      service.createTemplate(template, 'demo-project');

      const result = service.listTemplates(undefined, undefined, 'demo-project');
      expect(result.success).toBe(true);
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].id).toBe('tpl-list-proj');
      expect(result.templates[0].name).toBe('列表测试模板');
    });

    it('An empty directory returns an empty list', () => {
      // Query directly without creating any templates
      const result = service.listTemplates(undefined, undefined, 'empty-project');
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.templates).toEqual([]);
    });

    it('Filter by category', () => {
      service.createTemplate(createMockTemplate({ id: 'tpl-cat1', category: 'dashboard' }));
      service.createTemplate(createMockTemplate({ id: 'tpl-cat2', category: 'blank' }));

      const result = service.listTemplates('dashboard');
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].id).toBe('tpl-cat1');
    });

    it('Filter by source', () => {
      service.createTemplate(createMockTemplate({ id: 'tpl-src1', source: 'user' }));
      service.createTemplate(createMockTemplate({ id: 'tpl-src2', source: 'builtin' }));

      const userResult = service.listTemplates(undefined, 'user');
      expect(userResult.templates).toHaveLength(1);
      expect(userResult.templates[0].id).toBe('tpl-src1');

      const builtinResult = service.listTemplates(undefined, 'builtin');
      expect(builtinResult.templates).toHaveLength(1);
      expect(builtinResult.templates[0].id).toBe('tpl-src2');
    });
  });

  // ─── readTemplate - read a single one ───

  describe('readTemplate — read a single one', () => {
    it('Created project-level templates can be read', () => {
      const template = createMockTemplate({ id: 'tpl-read-proj', name: 'Read test' });
      service.createTemplate(template, 'demo-project');

      const result = service.readTemplate('tpl-read-proj', 'demo-project');
      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data!.name).toBe('Read test');
      expect(result.data!.pageConfig.width).toBe(1920);
    });

    it('Non-existent template returns success=false', () => {
      const result = service.readTemplate('nonexistent-template');
      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });
  });

  // ─── deleteTemplate - delete a template ───

  describe('deleteTemplate — delete', () => {
    it('File does not exist after template deletion', () => {
      const template = createMockTemplate({ id: 'tpl-del-proj' });
      service.createTemplate(template, 'demo-project');

      const filePath = path.join(tempDir, 'demo-project', 'canvas-templates', 'pages', 'tpl-del-proj.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const result = service.deleteTemplate('tpl-del-proj', 'demo-project');
      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('Deleting a non-existent template throws an error', () => {
      expect(() => {
        service.deleteTemplate('nonexistent');
      }).toThrow();
    });

    it('Deleting system-level built-in templates is forbidden', () => {
      // Create a system-level template with source=builtin
      const template = createMockTemplate({ id: 'builtin-test', source: 'builtin' });
      service.createTemplate(template);

      expect(() => {
        service.deleteTemplate('builtin-test');
      }).toThrow('不允许删除内置模板');
    });

    it('Allow deleting project-level templates (even with builtin source)', () => {
      const template = createMockTemplate({ id: 'tpl-proj-del-ok', source: 'builtin' });
      service.createTemplate(template, 'demo-project');

      const result = service.deleteTemplate('tpl-proj-del-ok', 'demo-project');
      expect(result.success).toBe(true);
    });
  });

  // ─── Integration scenario: full flow of saving a project page as a template ───

  describe('Integration scenario: saving project pages as templates', () => {
    it('Full flow: create → file exists → visible in list → reads correctly → delete cleans up', () => {
      const projectId = 'real-project';
      const templateId = 'tpl-integration';

      // 1. Create a project-level template
      const template = createMockTemplate({
        id: templateId,
        name: '集成测试模板',
        pageConfig: { width: 1920, height: 1080, backgroundColor: '#333', layout: 'free' },
        graphics: [{ type: 'rect', x: 10, y: 20, width: 200, height: 100 }],
      });
      const createResult = service.createTemplate(template, projectId);
      expect(createResult.success).toBe(true);

      // 2. Verify the file exists on disk
      const filePath = path.join(tempDir, projectId, 'canvas-templates', 'pages', `${templateId}.json`);
      expect(fs.existsSync(filePath)).toBe(true);

      // 3. Verify the file content is complete
      const raw = fs.readFileSync(filePath, 'utf-8');
      const diskData = JSON.parse(raw);
      expect(diskData.id).toBe(templateId);
      expect(diskData.name).toBe('集成测试模板');
      expect(diskData.pageConfig.backgroundColor).toBe('#333');
      expect(diskData.graphics).toHaveLength(1);
      expect(diskData.graphics[0].type).toBe('rect');

      // 4. Verify the list is queryable
      const listResult = service.listTemplates(undefined, undefined, projectId);
      expect(listResult.templates).toHaveLength(1);
      expect(listResult.templates[0].id).toBe(templateId);

      // 5. Verify single read
      const readResult = service.readTemplate(templateId, projectId);
      expect(readResult.success).toBe(true);
      expect(readResult.data!.name).toBe('集成测试模板');

      // 6. After deletion the file does not exist
      service.deleteTemplate(templateId, projectId);
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});
