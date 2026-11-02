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

  describe('种子内置模板', () => {
    it('onModuleInit 应落地内置组件模板到系统目录', () => {
      const dir = path.join(systemDir, 'widget-templates');
      expect(fs.existsSync(dir)).toBe(true);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('_meta.json'));
      expect(files.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('createTemplate', () => {
    it('应在系统目录写入数据文件与元数据文件', () => {
      const tpl = createMockWidgetTemplate();
      const res = service.createTemplate(tpl);
      expect(res.success).toBe(true);
      expect(res.data.id).toBe(tpl.id);
      expect(fs.existsSync(path.join(systemDir, 'widget-templates', `${tpl.id}.json`))).toBe(true);
      expect(fs.existsSync(path.join(systemDir, 'widget-templates', `${tpl.id}_meta.json`))).toBe(true);
    });

    it('缺失 name 应抛异常', () => {
      expect(() => service.createTemplate({} as any)).toThrow();
    });
  });

  describe('listTemplates', () => {
    it('应列出内置模板', () => {
      const res = service.listTemplates();
      expect(res.success).toBe(true);
      expect(res.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.every((t) => t.source === 'builtin')).toBe(true);
    });

    it('应按分类筛选', () => {
      const tpl = createMockWidgetTemplate({ category: 'industry' });
      service.createTemplate(tpl);
      const res = service.listTemplates('industry');
      // All returned items should be industry, and include the new item (built-in templates of the same category count too)
      expect(res.data.every((t) => t.category === 'industry')).toBe(true);
      expect(res.data.some((t) => t.id === tpl.id)).toBe(true);
    });

    it('应按来源筛选', () => {
      service.createTemplate(createMockWidgetTemplate());
      const res = service.listTemplates(undefined, 'user');
      expect(res.data.every((t) => t.source === 'user')).toBe(true);
    });
  });

  describe('readTemplate', () => {
    it('应返回完整数据含 graphics 与 variables', () => {
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl);
      const res = service.readTemplate(tpl.id);
      expect(res.success).toBe(true);
      expect(res.data.graphics.length).toBe(1);
      expect(res.data.variables.length).toBe(2);
    });

    it('不存在应抛 NotFoundException', () => {
      expect(() => service.readTemplate('nope')).toThrow();
    });
  });

  describe('updateTemplate', () => {
    it('应更新用户模板', () => {
      const tpl = createMockWidgetTemplate();
      service.createTemplate(tpl);
      const res = service.updateTemplate(tpl.id, { name: '改名' });
      expect(res.success).toBe(true);
      expect(service.readTemplate(tpl.id).data.name).toBe('改名');
    });

    it('内置模板不可更新', () => {
      const builtins = service.listTemplates().data;
      expect(() => service.updateTemplate(builtins[0].id, { name: 'x' })).toThrow();
    });
  });

  describe('deleteTemplate', () => {
    it('应删除用户模板', () => {
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
    it('导出再导入应保持一致', () => {
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
    it('项目级模板提升为系统级应生成新 id', () => {
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

  describe('项目级隔离', () => {
    it('项目级模板应写入 projects/{id}/canvas/widget-templates', () => {
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
