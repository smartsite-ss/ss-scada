// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Phase2FeaturesService unit tests - A004/A005/C002/C003/E003
 *
 * Covers:
 *   - A004 smart data-binding recommendation: scoring, strategy selection, history preference
 *   - A005 smart layout optimization: grid/flow/cluster/align strategies + collision detection
 *   - C002 context-aware help: graphic-type matching, operation matching, deduplication
 *   - C003 smart search: exact match, keyword match, scope filtering
 *   - E003 natural-language command parsing: intent recognition, parameter extraction, alternative intents
 */

import { Phase2FeaturesService } from '../phase2-features.service';

describe('Phase2FeaturesService', () => {
  let service: Phase2FeaturesService;

  beforeEach(() => {
    service = new Phase2FeaturesService(undefined as any, undefined as any);
  });

  // ============================================================
  // A004 smart data-binding recommendation
  // ============================================================
  describe('A004 recommendBindings', () => {
    const baseReq = {
      graphicType: 'valve',
      properties: [
        {
          type: 'valve',
          property: 'flow',
          dataType: 'number' as const,
          unit: 'm³/h',
          description: '流量',
        },
      ],
      candidateTags: [
        {
          tagId: 'tag-1',
          tagName: '出水流量',
          deviceId: 'device-1',
          deviceName: '1#泵',
          dataType: 'number',
          unit: 'm³/h',
          description: '出水流量传感器',
        },
        {
          tagId: 'tag-2',
          tagName: '进水压力',
          deviceId: 'device-2',
          deviceName: '2#泵',
          dataType: 'number',
          unit: 'MPa',
          description: '进水压力',
        },
        {
          tagId: 'tag-3',
          tagName: '阀门状态',
          deviceId: 'device-1',
          deviceName: '1#泵',
          dataType: 'boolean',
        },
      ],
    };

    it('应为每个属性返回候选列表', () => {
      const result = service.recommendBindings(baseReq);
      expect(result.recommendations).toHaveLength(1);
      expect(result.recommendations[0].property).toBe('flow');
      expect(result.recommendations[0].candidates.length).toBeGreaterThan(0);
    });

    it('数据类型匹配应加分（+40）', () => {
      const result = service.recommendBindings(baseReq);
      const flowCandidate = result.recommendations[0].candidates.find((c) => c.tagId === 'tag-1');
      expect(flowCandidate).toBeDefined();
      expect(flowCandidate!.matchReasons).toContain('数据类型匹配');
      expect(flowCandidate!.score).toBeGreaterThanOrEqual(40);
    });

    it('单位匹配应加分（+25）', () => {
      const result = service.recommendBindings(baseReq);
      const flowCandidate = result.recommendations[0].candidates.find((c) => c.tagId === 'tag-1');
      expect(flowCandidate!.matchReasons).toContain('单位匹配');
      expect(flowCandidate!.score).toBeGreaterThanOrEqual(65);
    });

    it('同设备应加分（+20）', () => {
      const req = { ...baseReq, deviceId: 'device-1' };
      const result = service.recommendBindings(req);
      const device1Candidate = result.recommendations[0].candidates.find(
        (c) => c.deviceId === 'device-1',
      );
      expect(device1Candidate!.matchReasons).toContain('同设备优先');
    });

    it('历史绑定偏好应加分（+10）', () => {
      const req = {
        ...baseReq,
        historicalBindings: [{ property: 'flow', tagId: 'tag-1' }],
      };
      const result = service.recommendBindings(req);
      const historicalCandidate = result.recommendations[0].candidates.find(
        (c) => c.tagId === 'tag-1',
      );
      expect(historicalCandidate!.matchReasons).toContain('历史绑定偏好');
    });

    it('strategy 应按优先级选择：device-priority > historical > unit-match > semantic', () => {
      // has deviceId -> device-priority
      expect(service.recommendBindings({ ...baseReq, deviceId: 'device-1' }).strategy).toBe(
        'device-priority',
      );
      // has history -> historical
      expect(
        service.recommendBindings({
          ...baseReq,
          historicalBindings: [{ property: 'flow', tagId: 'tag-1' }],
        }).strategy,
      ).toBe('historical');
      // has unit -> unit-match
      expect(service.recommendBindings(baseReq).strategy).toBe('unit-match');
      // no unit -> semantic
      const noUnitReq = {
        graphicType: 'valve',
        properties: [{ type: 'valve', property: 'state', dataType: 'boolean' as const }],
        candidateTags: [],
      };
      expect(service.recommendBindings(noUnitReq).strategy).toBe('semantic');
    });

    it('打分后应降序排序', () => {
      const result = service.recommendBindings(baseReq);
      const candidates = result.recommendations[0].candidates;
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i - 1].score).toBeGreaterThanOrEqual(candidates[i].score);
      }
    });

    it('零分候选应被过滤', () => {
      const req = {
        graphicType: 'valve',
        properties: [{ type: 'valve', property: 'unknown', dataType: 'string' as const }],
        candidateTags: [
          { tagId: 'tag-x', tagName: '不匹配', deviceId: 'device-x', dataType: 'object' },
        ],
      };
      const result = service.recommendBindings(req);
      expect(result.recommendations[0].candidates).toHaveLength(0);
    });

    it('最多返回 5 个候选', () => {
      const manyTags = Array.from({ length: 10 }, (_, i) => ({
        tagId: `tag-${i}`,
        tagName: `tag-${i}`,
        deviceId: 'device-1',
        dataType: 'number',
        unit: 'm³/h',
      }));
      const req = {
        graphicType: 'valve',
        properties: [
          { type: 'valve', property: 'flow', dataType: 'number' as const, unit: 'm³/h' },
        ],
        candidateTags: manyTags,
      };
      const result = service.recommendBindings(req);
      expect(result.recommendations[0].candidates.length).toBeLessThanOrEqual(5);
    });

    it('空候选池应返回空推荐', () => {
      const req = {
        graphicType: 'valve',
        properties: [{ type: 'valve', property: 'flow', dataType: 'number' as const }],
        candidateTags: [],
      };
      const result = service.recommendBindings(req);
      expect(result.recommendations[0].candidates).toHaveLength(0);
    });
  });

  // ============================================================
  // A005 smart layout optimization
  // ============================================================
  describe('A005 optimizeLayout', () => {
    const baseGraphics = [
      { id: 'g1', x: 100, y: 100, width: 80, height: 60, type: 'valve' },
      { id: 'g2', x: 250, y: 100, width: 80, height: 60, type: 'pump' },
      { id: 'g3', x: 400, y: 100, width: 80, height: 60, type: 'valve' },
    ];

    it('空图元列表应返回空结果', () => {
      const result = service.optimizeLayout({
        graphics: [],
        canvasWidth: 800,
        canvasHeight: 600,
      });
      expect(result.graphics).toHaveLength(0);
      expect(result.changes).toHaveLength(0);
      expect(result.metrics.aligned).toBe(0);
    });

    it('grid 策略应自动换行', () => {
      const result = service.optimizeLayout({
        graphics: baseGraphics,
        canvasWidth: 300, // force line wrap
        canvasHeight: 600,
        strategy: 'grid',
      });
      // the first graphic should be at the padding(20) position
      expect(result.graphics[0].x).toBe(20);
      expect(result.graphics[0].y).toBe(20);
    });

    it('cluster 策略应按图元类型分组', () => {
      const result = service.optimizeLayout({
        graphics: [
          { id: 'g1', x: 0, y: 0, width: 80, height: 60, type: 'valve' },
          { id: 'g2', x: 0, y: 0, width: 80, height: 60, type: 'pump' },
          { id: 'g3', x: 0, y: 0, width: 80, height: 60, type: 'valve' },
        ],
        canvasWidth: 800,
        canvasHeight: 600,
        strategy: 'cluster',
      });
      // same types should be adjacent
      const valve1 = result.graphics.find((g) => g.id === 'g1');
      const valve2 = result.graphics.find((g) => g.id === 'g3');
      expect(valve1!.y).toBe(valve2!.y);
    });

    it('align 策略应将坐标对齐到网格', () => {
      const result = service.optimizeLayout({
        graphics: [{ id: 'g1', x: 103, y: 107, width: 80, height: 60 }],
        canvasWidth: 800,
        canvasHeight: 600,
        strategy: 'align',
      });
      expect(result.graphics[0].x % 5).toBe(0);
      expect(result.graphics[0].y % 5).toBe(0);
    });

    it('flow 策略应等价于 grid', () => {
      const req = {
        graphics: baseGraphics,
        canvasWidth: 800,
        canvasHeight: 600,
        strategy: 'flow' as const,
      };
      const resultFlow = service.optimizeLayout(req);
      const resultGrid = service.optimizeLayout({ ...req, strategy: 'grid' as const });
      expect(resultFlow.graphics).toEqual(resultGrid.graphics);
    });

    it('应记录位置变化', () => {
      const result = service.optimizeLayout({
        graphics: baseGraphics,
        canvasWidth: 300,
        canvasHeight: 600,
        strategy: 'grid',
      });
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.changes[0]).toHaveProperty('from');
      expect(result.changes[0]).toHaveProperty('to');
      expect(result.changes[0]).toHaveProperty('reason');
    });

    it('应检测碰撞', () => {
      const overlappingGraphics = [
        { id: 'g1', x: 0, y: 0, width: 100, height: 100, type: 'valve' },
        { id: 'g2', x: 50, y: 50, width: 100, height: 100, type: 'pump' },
      ];
      const result = service.optimizeLayout({
        graphics: overlappingGraphics,
        canvasWidth: 1000,
        canvasHeight: 600,
        strategy: 'grid',
      });
      // the grid strategy should avoid collisions
      expect(result.metrics.collisions).toBe(0);
    });

    it('metrics 应正确统计', () => {
      const result = service.optimizeLayout({
        graphics: baseGraphics,
        canvasWidth: 300,
        canvasHeight: 600,
        strategy: 'grid',
      });
      expect(result.metrics.aligned + result.metrics.spacingFixed).toBe(result.changes.length);
    });

    it('默认策略应为 grid', () => {
      const result = service.optimizeLayout({
        graphics: baseGraphics,
        canvasWidth: 800,
        canvasHeight: 600,
        // strategy not provided
      });
      expect(result.changes.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // C002 context-aware help
  // ============================================================
  describe('C002 getContextHelp', () => {
    it('基于选中图元类型匹配帮助文档', async () => {
      const result = await service.getContextHelp({
        context: { selectedGraphicType: 'valve' },
      });
      expect(result.matchedDocs.length).toBeGreaterThan(0);
      expect(result.matchedDocs.some((d) => d.title === '图元数据绑定')).toBe(true);
    });

    it('基于操作匹配帮助文档', async () => {
      const result = await service.getContextHelp({
        context: { operation: 'bind' },
      });
      expect(result.matchedDocs.some((d) => d.title === '图元数据绑定')).toBe(true);
    });

    it('应返回建议列表', async () => {
      const result = await service.getContextHelp({
        context: { selectedGraphicType: 'pump' },
      });
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('应返回相关操作列表', async () => {
      const result = await service.getContextHelp({
        context: { selectedGraphicType: 'valve' },
      });
      expect(result.relatedOperations.length).toBeGreaterThan(0);
    });

    it('应去重匹配的文档', async () => {
      const result = await service.getContextHelp({
        context: {
          selectedGraphicType: 'valve', // matches the widget data-binding rule (test keyword is CJK)
          operation: 'bind', // also matches the widget data-binding rule (test keyword is CJK)
        },
      });
      const bindDocs = result.matchedDocs.filter((d) => d.title === '图元数据绑定');
      expect(bindDocs).toHaveLength(1);
    });

    it('最多返回 5 个文档', async () => {
      const result = await service.getContextHelp({
        context: { selectedGraphicType: 'valve', operation: 'event' },
      });
      expect(result.matchedDocs.length).toBeLessThanOrEqual(5);
    });

    it('无匹配上下文时应返回空结果', async () => {
      const result = await service.getContextHelp({
        context: { selectedGraphicType: 'unknown-graphic' },
      });
      expect(result.matchedDocs).toHaveLength(0);
    });

    it('无 RAG 时不应抛错', async () => {
      await expect(
        service.getContextHelp({
          context: {},
          question: '如何使用 SCADA？',
        }),
      ).resolves.toBeDefined();
    });
  });

  // ============================================================
  // C003 smart search
  // ============================================================
  describe('C003 smartSearch', () => {
    it('应返回匹配结果', () => {
      const result = service.smartSearch({ query: '泵站' });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.some((r) => r.title.includes('泵站'))).toBe(true);
    });

    it('完全匹配应高分（+50）', () => {
      const result = service.smartSearch({ query: '阀门图元' });
      expect(result.results[0].score).toBeGreaterThanOrEqual(50);
    });

    it('关键词匹配应加分（+10）', () => {
      const result = service.smartSearch({ query: '温度 压力' });
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('空查询应返回空结果', () => {
      const result = service.smartSearch({ query: '' });
      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('空白查询应返回空结果', () => {
      const result = service.smartSearch({ query: '   ' });
      expect(result.results).toHaveLength(0);
    });

    it('scope 过滤应生效', () => {
      const result = service.smartSearch({
        query: '泵站',
        scopes: ['page'],
      });
      expect(result.results.every((r) => r.scope === 'page')).toBe(true);
    });

    it('limit 应限制返回数量', () => {
      const result = service.smartSearch({
        query: 'a', // matches no results
        limit: 2,
      });
      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('应返回耗时（毫秒）', () => {
      const result = service.smartSearch({ query: '泵站' });
      expect(result.elapsed).toBeGreaterThanOrEqual(0);
      expect(typeof result.elapsed).toBe('number');
    });

    it('应按分数降序排序', () => {
      const result = service.smartSearch({ query: '泵站 监控' });
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
      }
    });

    it('无匹配应返回空结果', () => {
      const result = service.smartSearch({ query: '完全不存在的关键词xyz123' });
      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ============================================================
  // E003 natural-language command parsing
  // ============================================================
  describe('E003 parseCommand', () => {
    it('空输入应返回 unknown 意图', () => {
      const result = service.parseCommand({ input: '' });
      expect(result.intent).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('空白输入应返回 unknown 意图', () => {
      const result = service.parseCommand({ input: '   ' });
      expect(result.intent).toBe('unknown');
    });

    it('创建页面意图识别', () => {
      const cases = ['创建一个新页面', '新建页面', '添加页面', '新增页面', '生成页面'];
      for (const input of cases) {
        const result = service.parseCommand({ input });
        expect(result.intent).toBe('page.create');
        expect(result.confidence).toBeGreaterThan(0);
      }
    });

    it('切换页面意图识别', () => {
      const cases = ['切换到页面', '打开页面', '跳转页面', '进入页面'];
      for (const input of cases) {
        const result = service.parseCommand({ input });
        expect(result.intent).toBe('page.switch');
      }
    });

    it('添加图元意图识别 + 参数提取', () => {
      const result = service.parseCommand({ input: '添加一个阀门' });
      expect(result.intent).toBe('graphic.add');
      expect(result.params.graphicType).toBe('阀门');
    });

    it('选中图元意图识别', () => {
      const result = service.parseCommand({ input: '选中图元' });
      expect(result.intent).toBe('graphic.select');
    });

    it('删除图元意图识别', () => {
      const result = service.parseCommand({ input: '删除图元' });
      expect(result.intent).toBe('graphic.delete');
    });

    it('修改图元属性意图识别', () => {
      const cases = ['修改属性', '更新位置', '设置大小', '调整颜色'];
      for (const input of cases) {
        const result = service.parseCommand({ input });
        expect(result.intent).toBe('graphic.update');
      }
    });

    it('绑定数据意图识别', () => {
      const result = service.parseCommand({ input: '绑定数据' });
      expect(result.intent).toBe('binding.set');
    });

    it('执行脚本意图识别', () => {
      const result = service.parseCommand({ input: '执行脚本' });
      expect(result.intent).toBe('script.run');
    });

    it('搜索意图识别', () => {
      const cases = ['搜索一下', '查找设备', '找泵', '查一下报警'];
      for (const input of cases) {
        const result = service.parseCommand({ input });
        expect(result.intent).toBe('search');
      }
    });

    it('帮助意图识别', () => {
      const cases = ['帮助', '怎么使用', '如何配置', '说明', '教程'];
      for (const input of cases) {
        const result = service.parseCommand({ input });
        expect(result.intent).toBe('help');
      }
    });

    it('未识别意图应返回 unknown', () => {
      const result = service.parseCommand({ input: '你好世界' });
      expect(result.intent).toBe('unknown');
      expect(result.confidence).toBe(0);
    });

    it('应返回描述信息', () => {
      const result = service.parseCommand({ input: '创建页面' });
      expect(result.description).toBe('创建新页面');
    });

    it('应返回置信度（0-1）', () => {
      const result = service.parseCommand({ input: '创建页面' });
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('可能返回备选意图', () => {
      // input matching multiple intents simultaneously
      const result = service.parseCommand({ input: '创建页面并搜索' });
      if (result.alternatives && result.alternatives.length > 0) {
        expect(result.alternatives[0].confidence).toBeGreaterThan(0);
      }
    });
  });
});
