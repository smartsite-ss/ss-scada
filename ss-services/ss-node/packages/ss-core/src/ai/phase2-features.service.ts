// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Phase 2 intelligent features service - A004/A005/C002/C003/E003
 *
 * Backend implementation of five features:
 *   - A004 Smart data-binding recommendation: recommend candidate data tags based on widget property type + device association + tag semantics
 *   - A005 Smart layout optimization: auto-align, spacing, avoidance, and beautify page widgets
 *   - C002 Context-aware help: retrieve relevant help based on current context (selected widget/page/action)
 *   - C003 Smart search: semantic search across modules (pages/widgets/tags/alarms/docs)
 *   - E003 Natural-language commands: parse NL intent and map to specific command execution
 *
 * Design principles:
 *   - Each feature is an independent method, easy to unit-test
 *   - Does not directly depend on LLM (avoid network calls in tests); LLM-enhanced scenarios take LLM results passed in by the caller
 *   - Dependency injection uses @Optional() to avoid startup failure when a dependency is missing
 */

import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import { LLMProxyService } from './llm-proxy.service';
import { RAGQAService } from './rag-qa.service';

// ============================================================
// Type definitions
// ============================================================

/** Widget property description (for binding recommendation) */
export interface GraphicProperty {
  type: string;
  property: string;
  dataType: 'number' | 'string' | 'boolean' | 'enum';
  unit?: string;
  description?: string;
}

/** Data tag candidate (for binding recommendation) */
export interface DataTagCandidate {
  tagId: string;
  tagName: string;
  deviceId: string;
  deviceName?: string;
  dataType: string;
  unit?: string;
  description?: string;
  score: number;
  matchReasons: string[];
}

/** Binding recommendation request */
export interface BindingRecommendRequest {
  graphicType: string;
  graphicId?: string;
  properties: GraphicProperty[];
  deviceId?: string;
  /** Historical binding records, used to learn user preferences */
  historicalBindings?: Array<{ property: string; tagId: string }>;
  /** Optional tag pool (if not provided, the caller queries it) */
  candidateTags?: Array<{
    tagId: string;
    tagName: string;
    deviceId: string;
    deviceName?: string;
    dataType: string;
    unit?: string;
    description?: string;
  }>;
}

/** Binding recommendation response */
export interface BindingRecommendResponse {
  recommendations: Array<{
    property: string;
    candidates: DataTagCandidate[];
  }>;
  strategy: 'semantic' | 'unit-match' | 'device-priority' | 'historical';
}

/** Widget position (for layout optimization) */
export interface GraphicRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type?: string;
}

/** Layout optimization request */
export interface LayoutOptimizeRequest {
  graphics: GraphicRect[];
  canvasWidth: number;
  canvasHeight: number;
  strategy?: 'grid' | 'flow' | 'cluster' | 'align';
  padding?: number;
  gap?: number;
}

/** Layout optimization response */
export interface LayoutOptimizeResponse {
  graphics: GraphicRect[];
  changes: Array<{
    id: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    reason: string;
  }>;
  metrics: {
    aligned: number;
    spacingFixed: number;
    collisions: number;
  };
}

/** Context-aware help request */
export interface ContextHelpRequest {
  context: {
    pageId?: string;
    selectedGraphicType?: string;
    selectedGraphicId?: string;
    operation?: string;
    recentActions?: string[];
  };
  question?: string;
}

/** Context-aware help response */
export interface ContextHelpResponse {
  matchedDocs: Array<{
    title: string;
    content: string;
    score: number;
    source: string;
  }>;
  suggestions: string[];
  relatedOperations: string[];
}

/** Smart search request */
export interface SmartSearchRequest {
  query: string;
  scopes?: Array<'page' | 'graphic' | 'tag' | 'alarm' | 'device' | 'document'>;
  limit?: number;
}

/** Smart search response */
export interface SmartSearchResponse {
  results: Array<{
    scope: string;
    id: string;
    title: string;
    snippet: string;
    score: number;
    metadata?: Record<string, unknown>;
  }>;
  total: number;
  elapsed: number;
}

/** Natural-language command parse request */
export interface CommandParseRequest {
  input: string;
  context?: {
    currentPageId?: string;
    selectedGraphicId?: string;
  };
}

/** Command intent */
export type CommandIntent =
  | 'page.create'
  | 'page.switch'
  | 'graphic.add'
  | 'graphic.select'
  | 'graphic.delete'
  | 'graphic.update'
  | 'binding.set'
  | 'script.run'
  | 'search'
  | 'help'
  | 'unknown';

/** Natural-language command parse response */
export interface CommandParseResponse {
  intent: CommandIntent;
  confidence: number;
  params: Record<string, unknown>;
  alternatives?: Array<{ intent: CommandIntent; confidence: number }>;
  description: string;
}

// ============================================================
// Service implementation
// ============================================================

@Injectable()
export class Phase2FeaturesService {
  private readonly logger = new Logger(Phase2FeaturesService.name);

  constructor(
    @Optional() @Inject(LLMProxyService) private readonly proxy?: LLMProxyService,
    @Optional() @Inject(RAGQAService) private readonly ragQA?: RAGQAService,
  ) {}

  // ============================================================
  // A004 Smart data-binding recommendation
  // ============================================================

  /**
   * Recommend candidate data tags for a widget property
   *
   * Scoring strategy (weighted sum):
   *   - Data type match: +40
   *   - Unit match: +25
   *   - Same device priority: +20
   *   - Name semantic similarity: +15
   *   - Historical binding preference: +10
   */
  recommendBindings(req: BindingRecommendRequest): BindingRecommendResponse {
    const candidates = req.candidateTags || [];
    const historical = req.historicalBindings || [];
    const recommendations: BindingRecommendResponse['recommendations'] = [];

    for (const prop of req.properties) {
      const scored: DataTagCandidate[] = candidates.map((tag) => {
        const matchReasons: string[] = [];
        let score = 0;

        // Data type match
        if (this.matchDataType(prop.dataType, tag.dataType)) {
          score += 40;
          matchReasons.push('数据类型匹配');
        }

        // Unit match
        if (prop.unit && tag.unit && prop.unit.toLowerCase() === tag.unit.toLowerCase()) {
          score += 25;
          matchReasons.push('单位匹配');
        }

        // Same device priority
        if (req.deviceId && tag.deviceId === req.deviceId) {
          score += 20;
          matchReasons.push('同设备优先');
        }

        // Name semantic similarity (simplified: substring match)
        if (
          this.semanticMatch(
            prop.description || prop.property,
            tag.tagName + ' ' + (tag.description || ''),
          )
        ) {
          score += 15;
          matchReasons.push('名称语义相似');
        }

        // Historical binding preference
        const historicalHit = historical.some(
          (h) => h.property === prop.property && h.tagId === tag.tagId,
        );
        if (historicalHit) {
          score += 10;
          matchReasons.push('历史绑定偏好');
        }

        return {
          tagId: tag.tagId,
          tagName: tag.tagName,
          deviceId: tag.deviceId,
          deviceName: tag.deviceName,
          dataType: tag.dataType,
          unit: tag.unit,
          description: tag.description,
          score,
          matchReasons,
        };
      });

      // Sort descending, take top 5
      scored.sort((a, b) => b.score - a.score);
      recommendations.push({
        property: prop.property,
        candidates: scored.slice(0, 5).filter((c) => c.score > 0),
      });
    }

    // Strategy: device-priority > historical > unit-match > semantic
    const strategy: BindingRecommendResponse['strategy'] = req.deviceId
      ? 'device-priority'
      : historical.length > 0
        ? 'historical'
        : req.properties.some((p) => p.unit)
          ? 'unit-match'
          : 'semantic';

    return { recommendations, strategy };
  }

  private matchDataType(propType: GraphicProperty['dataType'], tagType: string): boolean {
    const tagLower = tagType.toLowerCase();
    if (propType === 'number')
      return (
        tagLower === 'number' ||
        tagLower === 'float' ||
        tagLower === 'int' ||
        tagLower === 'integer' ||
        tagLower === 'double'
      );
    if (propType === 'string') return tagLower === 'string' || tagLower === 'text';
    if (propType === 'boolean') return tagLower === 'boolean' || tagLower === 'bool';
    if (propType === 'enum') return true; // enum is compatible with everything
    return false;
  }

  private semanticMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    // Substring match
    if (aLower.includes(bLower) || bLower.includes(aLower)) return true;
    // Keyword match (split by space)
    const aWords = aLower.split(/\s+/).filter((w) => w.length >= 2);
    const bWords = bLower.split(/\s+/).filter((w) => w.length >= 2);
    return aWords.some((w) => bWords.some((bw) => bw.includes(w) || w.includes(bw)));
  }

  // ============================================================
  // A005 Smart layout optimization
  // ============================================================

  /**
   * Optimize the layout of page widgets
   *
   * Supported strategies:
   *   - grid: grid alignment (default)
   *   - flow: flow layout
   *   - cluster: cluster layout (group by widget type)
   *   - align: align only (keep size)
   */
  optimizeLayout(req: LayoutOptimizeRequest): LayoutOptimizeResponse {
    const strategy = req.strategy || 'grid';
    const padding = req.padding ?? 20;
    const gap = req.gap ?? 10;
    const changes: LayoutOptimizeResponse['changes'] = [];

    if (req.graphics.length === 0) {
      return { graphics: [], changes: [], metrics: { aligned: 0, spacingFixed: 0, collisions: 0 } };
    }

    let optimized: GraphicRect[];
    switch (strategy) {
      case 'flow':
        optimized = this.layoutFlow(req.graphics, req.canvasWidth, padding, gap);
        break;
      case 'cluster':
        optimized = this.layoutCluster(req.graphics, padding, gap);
        break;
      case 'align':
        optimized = this.layoutAlign(req.graphics);
        break;
      case 'grid':
      default:
        optimized = this.layoutGrid(req.graphics, req.canvasWidth, padding, gap);
        break;
    }

    // Record changes
    for (const g of optimized) {
      const original = req.graphics.find((og) => og.id === g.id);
      if (original && (original.x !== g.x || original.y !== g.y)) {
        changes.push({
          id: g.id,
          from: { x: original.x, y: original.y },
          to: { x: g.x, y: g.y },
          reason: strategy,
        });
      }
    }

    // Collision detection
    const collisions = this.detectCollisions(optimized);

    // Statistics
    const aligned = changes.filter(
      (c) => Math.abs(c.from.x - c.to.x) < 1 || Math.abs(c.from.y - c.to.y) < 1,
    ).length;
    const spacingFixed = changes.length - aligned;

    return {
      graphics: optimized,
      changes,
      metrics: { aligned, spacingFixed, collisions },
    };
  }

  /** Grid layout: arrange by row, auto-wrap */
  private layoutGrid(
    graphics: GraphicRect[],
    canvasWidth: number,
    padding: number,
    gap: number,
  ): GraphicRect[] {
    const sorted = [...graphics].sort((a, b) => a.y - a.y || a.x - b.x);
    let currentX = padding;
    let currentY = padding;
    let rowMaxHeight = 0;

    return sorted.map((g) => {
      if (currentX + g.width > canvasWidth - padding) {
        // Line wrap
        currentX = padding;
        currentY += rowMaxHeight + gap;
        rowMaxHeight = 0;
      }
      const result: GraphicRect = { ...g, x: currentX, y: currentY };
      currentX += g.width + gap;
      rowMaxHeight = Math.max(rowMaxHeight, g.height);
      return result;
    });
  }

  /** Flow layout: arrange left-to-right, top-to-bottom */
  private layoutFlow(
    graphics: GraphicRect[],
    canvasWidth: number,
    padding: number,
    gap: number,
  ): GraphicRect[] {
    return this.layoutGrid(graphics, canvasWidth, padding, gap);
  }

  /** Cluster layout: group by widget type */
  private layoutCluster(graphics: GraphicRect[], padding: number, gap: number): GraphicRect[] {
    const groups = new Map<string, GraphicRect[]>();
    for (const g of graphics) {
      const key = g.type || 'unknown';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(g);
    }

    const result: GraphicRect[] = [];
    let yOffset = padding;
    for (const [, group] of groups) {
      let xOffset = padding;
      let maxRowHeight = 0;
      for (const g of group) {
        result.push({ ...g, x: xOffset, y: yOffset });
        xOffset += g.width + gap;
        maxRowHeight = Math.max(maxRowHeight, g.height);
      }
      yOffset += maxRowHeight + gap * 2;
    }
    return result;
  }

  /** Align layout: align to grid by min X/Y */
  private layoutAlign(graphics: GraphicRect[]): GraphicRect[] {
    const gridSize = 5;
    return graphics.map((g) => ({
      ...g,
      x: Math.round(g.x / gridSize) * gridSize,
      y: Math.round(g.y / gridSize) * gridSize,
    }));
  }

  /** Detect collisions */
  private detectCollisions(graphics: GraphicRect[]): number {
    let count = 0;
    for (let i = 0; i < graphics.length; i++) {
      for (let j = i + 1; j < graphics.length; j++) {
        const a = graphics[i];
        const b = graphics[j];
        if (
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        ) {
          count++;
        }
      }
    }
    return count;
  }

  // ============================================================
  // C002 Context-aware help
  // ============================================================

  /**
   * Retrieve relevant help docs based on current editor context
   *
   * Priority:
   *   1. If there is a specific question, call RAG retrieval
   *   2. Otherwise match the built-in help library by context (selected widget type, action)
   */
  async getContextHelp(req: ContextHelpRequest): Promise<ContextHelpResponse> {
    const { context, question } = req;

    // Built-in help doc library (categorized by widget type)
    const builtinDocs = this.getBuiltinHelpDocs();
    const matchedDocs: ContextHelpResponse['matchedDocs'] = [];
    const suggestions: string[] = [];
    const relatedOperations: string[] = [];

    // If there is a specific question and RAG is available, use RAG retrieval
    if (question && this.ragQA) {
      try {
        const ragResult = await this.ragQA.ask({ question });
        if (ragResult.answer) {
          matchedDocs.push({
            title: 'RAG 检索结果',
            content: ragResult.answer,
            score: 0.95,
            source: 'rag-kb',
          });
        }
      } catch (err) {
        this.logger.warn(`RAG retrieval failed: ${(err as Error).message}`);
      }
    }

    // Match by selected widget type
    if (context.selectedGraphicType) {
      const docs = builtinDocs.filter((d) =>
        d.graphicTypes?.includes(context.selectedGraphicType!),
      );
      for (const doc of docs) {
        matchedDocs.push({
          title: doc.title,
          content: doc.content,
          score: doc.score,
          source: 'builtin',
        });
        suggestions.push(...doc.suggestions);
        relatedOperations.push(...doc.relatedSteps);
      }
    }

    // Match by action
    if (context.operation) {
      const opDocs = builtinDocs.filter((d) => d.matchOperations?.includes(context.operation!));
      for (const doc of opDocs) {
        if (!matchedDocs.find((m) => m.title === doc.title)) {
          matchedDocs.push({
            title: doc.title,
            content: doc.content,
            score: doc.score * 0.8,
            source: 'builtin',
          });
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const deduped = matchedDocs.filter((m) => {
      if (seen.has(m.title)) return false;
      seen.add(m.title);
      return true;
    });

    return {
      matchedDocs: deduped.slice(0, 5),
      suggestions: [...new Set(suggestions)].slice(0, 5),
      relatedOperations: [...new Set(relatedOperations)].slice(0, 5),
    };
  }

  private getBuiltinHelpDocs(): Array<{
    title: string;
    content: string;
    score: number;
    graphicTypes?: string[];
    matchOperations?: string[];
    suggestions: string[];
    relatedSteps: string[];
  }> {
    return [
      {
        title: '图元数据绑定',
        content:
          '选中图元后，在右侧属性面板找到"数据绑定"区域，点击绑定按钮选择数据标签。支持单向绑定（标签→图元属性）和双向绑定。',
        score: 0.9,
        graphicTypes: ['valve', 'pump', 'motor', 'tank', 'pipe'],
        matchOperations: ['bind', 'select'],
        suggestions: ['如何绑定数据标签？', '如何取消绑定？', '支持哪些数据类型？'],
        relatedSteps: ['打开属性面板', '点击数据绑定', '选择标签'],
      },
      {
        title: '图元事件配置',
        content:
          '双击图元或右键菜单选择"事件配置"，可配置点击、双击、长按等交互事件，支持跳转页面、执行脚本、弹窗提示等动作。',
        score: 0.85,
        matchOperations: ['event', 'doubleClick'],
        suggestions: ['如何配置点击事件？', '如何跳转页面？', '如何执行脚本？'],
        relatedSteps: ['右键菜单', '事件配置', '选择动作类型'],
      },
      {
        title: '页面管理',
        content: '在左侧页面列表可新增、复制、删除页面。支持拖拽排序、页面模板、页面参数传递。',
        score: 0.8,
        matchOperations: ['page.create', 'page.switch'],
        suggestions: ['如何新增页面？', '如何使用页面模板？', '如何传递页面参数？'],
        relatedSteps: ['左侧页面列表', '右键新增', '选择模板'],
      },
    ];
  }

  // ============================================================
  // C003 Smart search
  // ============================================================

  /**
   * Cross-module semantic search
   *
   * Current implementation is local matching (keyword + substring based).
   * Production can combine vector search (requires candidate data source injection).
   */
  smartSearch(req: SmartSearchRequest): SmartSearchResponse {
    const start = Date.now();
    const query = req.query.trim().toLowerCase();
    const limit = req.limit ?? 20;
    const scopes = req.scopes || ['page', 'graphic', 'tag', 'alarm', 'device', 'document'];

    if (!query) {
      return { results: [], total: 0, elapsed: 0 };
    }

    // Built-in searchable data (in real scenarios injected by caller or queried from DB)
    const corpus = this.getSearchableCorpus();
    const scored = corpus
      .filter((item) => scopes.includes(item.scope as any))
      .map((item) => {
        const score = this.scoreMatch(query, (item.title + ' ' + item.snippet).toLowerCase());
        return { ...item, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      results: scored,
      total: scored.length,
      elapsed: Date.now() - start,
    };
  }

  private scoreMatch(query: string, text: string): number {
    let score = 0;
    // Exact match
    if (text.includes(query)) score += 50;
    // Keyword match
    const words = query.split(/\s+/).filter((w) => w.length >= 2);
    for (const w of words) {
      if (text.includes(w)) score += 10;
    }
    // Prefix match
    if (text.startsWith(query)) score += 15;
    return score;
  }

  private getSearchableCorpus(): Array<{
    scope: string;
    id: string;
    title: string;
    snippet: string;
    metadata?: Record<string, unknown>;
  }> {
    // Real scenarios should query from DB; here return built-in sample data for tests and demos
    return [
      {
        scope: 'page',
        id: 'page-1',
        title: '泵站监控主页',
        snippet: '展示泵站运行状态、流量、压力',
      },
      { scope: 'page', id: 'page-2', title: '锅炉温度监控', snippet: '锅炉温度、压力实时监控' },
      { scope: 'graphic', id: 'graphic-valve', title: '阀门图元', snippet: '可配置开关状态、流量' },
      {
        scope: 'graphic',
        id: 'graphic-pump',
        title: '水泵图元',
        snippet: '可配置运行状态、转速、流量',
      },
      { scope: 'tag', id: 'tag-temp-1', title: '锅炉温度', snippet: '温度传感器 0-200℃' },
      { scope: 'tag', id: 'tag-pressure-1', title: '出水压力', snippet: '压力变送器 0-1.6MPa' },
      { scope: 'alarm', id: 'alarm-1', title: '高温报警', snippet: '温度超过 90℃ 触发' },
      { scope: 'device', id: 'device-1', title: '1#水泵', snippet: '设备状态：运行中' },
      { scope: 'document', id: 'doc-1', title: '使用手册', snippet: 'Smart-SCADA 用户手册' },
    ];
  }

  // ============================================================
  // E003 Natural-language command parsing
  // ============================================================

  /**
   * Parse natural-language command intent
   *
   * Uses rule matching (production can combine LLM enhancement):
   *   - "create/new/add page" -> page.create
   *   - "switch/open page" -> page.switch
   *   - "add/place valve/pump" -> graphic.add
   *   - "select" -> graphic.select
   *   - "delete/remove" -> graphic.delete
   *   - "modify/update property" -> graphic.update
   *   - "bind data" -> binding.set
   *   - "execute/run script" -> script.run
   *   - "search/find" -> search
   *   - "help/how" -> help
   */
  parseCommand(req: CommandParseRequest): CommandParseResponse {
    const input = req.input.trim().toLowerCase();

    if (!input) {
      return { intent: 'unknown', confidence: 0, params: {}, description: '空输入' };
    }

    // Rule matching table
    const rules: Array<{
      patterns: RegExp[];
      intent: CommandIntent;
      paramExtractor?: (m: RegExpMatchArray) => Record<string, unknown>;
      description: string;
    }> = [
      {
        patterns: [/(创建|新建|添加|新增|生成)\s*(一个)?\s*(新)?\s*页面/],
        intent: 'page.create',
        description: '创建新页面',
      },
      {
        patterns: [/(切换|打开|跳转|进入)\s*(到)?\s*页面/],
        intent: 'page.switch',
        description: '切换页面',
      },
      {
        patterns: [/(添加|放置|插入|画)\s*(一个)?\s*(阀门|水泵|泵|电机|水箱|管道|温度计|压力表)/],
        intent: 'graphic.add',
        paramExtractor: (m) => ({ graphicType: m[3] }),
        description: '添加图元',
      },
      {
        patterns: [/(选中|选择|点选)\s*(图元|元素)/],
        intent: 'graphic.select',
        description: '选中图元',
      },
      {
        patterns: [/(删除|移除|去掉|清除)\s*(图元|元素)/],
        intent: 'graphic.delete',
        description: '删除图元',
      },
      {
        patterns: [/(修改|更新|设置|调整)\s*(属性|位置|大小|颜色)/],
        intent: 'graphic.update',
        description: '修改图元属性',
      },
      {
        patterns: [/(绑定|关联)\s*(数据|标签)/],
        intent: 'binding.set',
        description: '设置数据绑定',
      },
      {
        patterns: [/(执行|运行|调用)\s*脚本/],
        intent: 'script.run',
        description: '运行脚本',
      },
      {
        patterns: [/(搜索|查找|找|查一下)/],
        intent: 'search',
        description: '搜索',
      },
      {
        patterns: [/(帮助|怎么|如何|说明|教程)/],
        intent: 'help',
        description: '获取帮助',
      },
    ];

    const alternatives: Array<{ intent: CommandIntent; confidence: number }> = [];

    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        const match = input.match(pattern);
        if (match) {
          // Simple confidence calc: match length / input length
          const confidence = Math.min(1, match[0].length / input.length + 0.3);
          const params = rule.paramExtractor ? rule.paramExtractor(match) : {};

          // Collect candidate intents
          for (const other of rules) {
            if (other.intent !== rule.intent) {
              for (const p of other.patterns) {
                if (input.match(p)) {
                  alternatives.push({
                    intent: other.intent,
                    confidence: Math.min(1, input.match(p)![0].length / input.length + 0.2),
                  });
                  break;
                }
              }
            }
          }

          return {
            intent: rule.intent,
            confidence,
            params,
            alternatives: alternatives.sort((a, b) => b.confidence - a.confidence).slice(0, 3),
            description: rule.description,
          };
        }
      }
    }

    return {
      intent: 'unknown',
      confidence: 0,
      params: {},
      description: '未识别意图',
    };
  }
}
