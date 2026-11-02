// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * WidgetTemplateService unit tests
 *
 * Verification points (aligned with CanvasTemplateService):
 * 1. Path resolution returns the correct system-level / project-level directories
 * 2. onModuleInit seeds built-in widget templates to disk
 * 3. createTemplate writes files (data + metadata) to the correct directory
 * 4. listTemplates reads metadata correctly, filtering by category/source
 * 5. readTemplate returns the complete data (including graphics + variables)
 * 6. updateTemplate / deleteTemplate work normally; built-in templates cannot be modified/deleted
 * 7. importTemplate / exportTemplate round-trip consistently
 * 8. promoteToSystem generates a new system-level widget template
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  WidgetTemplateService,
  WidgetTemplateData,
  WidgetTemplateVariable,
} from '../widget-template.service';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';

jest.mock('@ss-node/ss-core', () => {
  const actual = jest.requireActual('@ss-node/ss-core');
  return {
    ...actual,
    PathResolverService: class {
      resolve = jest.fn((p: string) => path.resolve(p));
    },
  };
});

function createMockWidgetTemplate(
  overrides: Partial<WidgetTemplateData> = {},
): WidgetTemplateData {
  const variables: WidgetTemplateVariable[] = [
    { key: 'title', label: '标题', type: 'text', defaultValue: '储罐' },
    { key: 'level', label: '水位', type: 'number', defaultValue: 50 },
  ];
  return {
    id: `wt-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '测试组件',
    description: '单元测试',
    category: 'common',
    author: 'test-user',
    source: 'user',
    schemaVersion: 2,
    graphics: [
      {
        type: 'group',
        id: 'g',
        children: [{ type: 'text', id: 't', props: { text: '{{title}}' } }],
      },
    ],
    variables,
    tags: ['test'],
    ...overrides,
  };
}

describe('WidgetTemplateService', () => {
  let service: WidgetTemplateService;
  let systemDir: string;
  let projectDir: string;
  let mockConfigService: ConfigService;

  beforeEach(() => {
    systemDir = path.join(
      os.tmpdir(),
      `widget-system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    projectDir = path.join(
      os.tmpdir(),
      `widget-projects-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    mockConfigService = {
      get: jest.fn((key: string) =>
        key === 'WIDGET_TEMPLATES_DIR' ? systemDir : projectDir,
      ),
    } as unknown as ConfigService;

    service = new WidgetTemplateService(
      mockConfigService,
      new PathResolverService() as any,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    for (const dir of [systemDir, projectDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe('Seeded built-in template', () => {
    it('onModuleInit should materialize built-in component templates into the system directory', () => {
      const dir = path.join(systemDir, 'widget-templates');
      expect(fs.existsSync(dir)).toBe(true);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('_meta.json'));
      expect(files.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('createTemplate', () => {
    it('Should write data and metadata files into the system directory', () => {
      const tpl = createMockWidgetTemplate();
      const res = service.createTemplate(tpl);
      expect(res.success).toBe(true);
      expect(res.data.id).toBe(tpl.id);
      expect(fs.existsSync(path.join(systemDir, 'widget-templates', `${tpl.id}.json`))).toBe(true);
      expect(fs.existsSync(path.join(systemDir, 'widget-templates', `${tpl.id}_meta.json`))).toBe(true);
    });

    it('Missing name should throw', () => {
      expect(() => service.createTemplate({} as any)).toThrow();
    });
  });

  describe('listTemplates', () => {
    it('Should list built-in templates', () => {
      const res = service.listTemplates();
      expect(res.success).toBe(true);
      expect(res.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.every((t) => t.source === 'builtin')).toBe(true);
    });

    it('Should filter by category', () => {
      const tpl = createMockWidgetTemplate({ category: 'industry' });
      service.createTemplate(tpl);
      const res = service.listTemplates('industry');
      // All returned items should be industry, and include the new item (built-in templates of the same category count too)
      expect(res.data.every((t) => t.category === 'industry')).toBe(true);
      expect(res.data.some((t) => t.id === tpl.id)).toBe(true);
    });

    it('Should filter by source', () => {
      service.createTemplate(createMockWidgetTemplate());
      const res = service.listTemplates(undefined, 'user');
      expect(res.data.every((t) => t.source === 'user')).toBe(true);
    });
  });

  describe('readTemplate', () => {
    it('Should return complete data including graphics and variables', () => {
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl);
      const res = service.readTemplate(tpl.id);
      expect(res.success).toBe(true);
      expect(res.data.graphics.length).toBe(1);
      expect(res.data.variables.length).toBe(2);
    });

    it('Should throw NotFoundException when not found', () => {
      expect(() => service.readTemplate('nope')).toThrow();
    });
  });

  describe('updateTemplate', () => {
    it('Should update the user template', () => {
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl);
      const res = service.updateTemplate(tpl.id, { name: 'Rename' });
      expect(res.success).toBe(true);
      expect(service.readTemplate(tpl.id).data.name).toBe('Rename');
    });

    it('Built-in templates cannot be updated', () => {
      const builtins = service.listTemplates().data;
      expect(() => service.updateTemplate(builtins[0].id, { name: 'x' })).toThrow();
    });
  });

  describe('deleteTemplate', () => {
    it('Should delete the user template', () => {
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl);
      const res = service.deleteTemplate(tpl.id);
      expect(res.success).toBe(true);
      expect(fs.existsSync(path.join(systemDir, 'widget-templates', `${tpl.id}.json`))).toBe(false);
    });

    it('内置模板不可删除', () => {
      const builtins = service.listTemplates().data;
      expect(() => service.deleteTemplate(builtins[0].id)).toThrow();
    });
  });

  describe('import / export', () => {
    it('Export then import should stay consistent', () => {
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl);
      const json = service.exportTemplate(tpl.id);
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(tpl.id);

      const importRes = service.importTemplate(json);
      expect(importRes.success).toBe(true);
    });
  });

  describe('promoteToSystem', () => {
    it('Promoting a project-level template to system level should generate a new id', () => {
      const projectId = 'proj-1';
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl, projectId);
      const res = service.promoteToSystem(projectId, tpl.id);
      expect(res.success).toBe(true);
      expect(res.data.source).toBe('builtin');
      expect(res.data.id).not.toBe(tpl.id);
      // The system-level directory should contain the new file
      const files = fs
        .readdirSync(path.join(systemDir, 'widget-templates'))
        .filter((f) => f.endsWith('_meta.json'));
      expect(files.some((f) => f.startsWith(res.data.id))).toBe(true);
    });
  });

  describe('Project-level isolation', () => {
    it('Project-level templates should be written to projects/{id}/canvas/widget-templates', () => {
      const projectId = 'proj-iso';
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl, projectId);
      const projPath = path.join(
        projectDir,
        projectId,
        'canvas',
        'widget-templates',
        `${tpl.id}.json`,
      );
      expect(fs.existsSync(projPath)).toBe(true);
      // The system level should not have this template
      const sysPath = path.join(systemDir, 'widget-templates', `${tpl.id}.json`);
      expect(fs.existsSync(sysPath)).toBe(false);
    });
  });
});
