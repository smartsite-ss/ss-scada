// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Intent Parser — P1-T03 frontend intent recognizer
 *
 * Lightweight keyword + rule based intent classifier (< 5KB).
 * Simple intents → executed directly by the frontend SingleStepAgent;
 * complex intents → sent to the backend ReAct orchestrator (/api/v1/ai/agent/execute).
 *
 * Related decision: D-005 (hybrid mode: frontend simple intents / backend complex intents)
 *
 * Usage:
 *   const parser = new IntentParser();
 *   const result = parser.parse(userInput);
 *   if (result.complexity === 'simple') { // execute on the frontend }
 */

/** Intent type */
export type IntentType =
  | 'page_create'
  | 'graphic_add'
  | 'layout_adjust'
  | 'data_bind'
  | 'script_gen'
  | 'plugin_gen'
  | 'chat'
  | 'alarm_query'
  | 'device_query'
  | 'kb_query'
  | 'unknown';

/** Intent complexity */
export type IntentComplexity = 'simple' | 'complex';

/** Intent parsing result */
export interface IntentResult {
  /** Recognized intent type */
  intent: IntentType;
  /** Complexity: simple = frontend execution, complex = backend ReAct */
  complexity: IntentComplexity;
  /** Confidence 0-1 */
  confidence: number;
  /** Extracted parameters */
  params: Record<string, string | number | boolean>;
  /** Tools to invoke */
  suggestedTools: string[];
  /** Raw input */
  rawInput: string;
}

/** Intent rule definition */
interface IntentRule {
  intent: IntentType;
  complexity: IntentComplexity;
  keywords: string[];
  toolHints: string[];
}

/** Intent rule table (weights decreasing) */
const INTENT_RULES: IntentRule[] = [
  {
    intent: 'page_create',
    complexity: 'complex',
    keywords: ['创建', '新建', '页面', '画面', '监控画面', '创建页面', '新建画面'],
    toolHints: ['scene_createPage', 'scene_setPageSize', 'scene_autoLayout'],
  },
  {
    intent: 'graphic_add',
    complexity: 'complex',
    keywords: ['添加', '增加', '放入', '图元', '元件', '组件', '水泵', '阀门', '仪表', '液位计', '趋势图', '图表', '管道', '按钮', '文本框'],
    toolHints: ['scene_addGraphic', 'scene_setBinding'],
  },
  {
    intent: 'layout_adjust',
    complexity: 'complex',
    keywords: ['布局', '排列', '对齐', '调整位置', '自动布局', '网格', '居中'],
    toolHints: ['scene_autoLayout', 'scene_alignElements', 'scene_setPosition'],
  },
  {
    intent: 'data_bind',
    complexity: 'complex',
    keywords: ['绑定', '关联', '数据绑定', '标签', '数据标签', '数据点', '绑定数据', '关联数据'],
    toolHints: ['scene_setBinding', 'datatag_search', 'datatag_getTagList'],
  },
  {
    intent: 'script_gen',
    complexity: 'complex',
    keywords: ['脚本', '生成脚本', '写脚本', '编写脚本', '脚本代码', '逻辑脚本'],
    toolHints: ['script.generate', 'script.validate'],
  },
  {
    intent: 'plugin_gen',
    complexity: 'complex',
    keywords: ['插件', '生成插件', '写插件', '创建插件', '开发插件', '自定义图元'],
    toolHints: ['plugin.generate', 'plugin.validate', 'plugin.install'],
  },
  {
    intent: 'alarm_query',
    complexity: 'simple',
    keywords: ['报警', '告警', '报警记录', '当前报警', '报警历史', '报警查询'],
    toolHints: ['alarm.getCurrentAlarms', 'alarm.getHistory'],
  },
  {
    intent: 'device_query',
    complexity: 'simple',
    keywords: ['设备', '设备列表', '设备状态', '设备信息', '在线设备', '设备详情'],
    toolHints: ['device.getDeviceList', 'device.getDeviceStatus'],
  },
  {
    intent: 'kb_query',
    complexity: 'simple',
    keywords: ['如何', '怎么', '怎样', '文档', '帮助', '说明', '什么是', '配置', '教程'],
    toolHints: ['kb.search', 'kb.askQuestion'],
  },
  {
    intent: 'chat',
    complexity: 'simple',
    keywords: [],
    toolHints: ['chat'],
  },
];

export class IntentParser {
  /**
   * Parse user input and recognize the intent
   */
  parse(input: string): IntentResult {
    const normalized = input.trim().toLowerCase();
    let bestMatch: IntentRule | null = null;
    let bestScore = 0;

    for (const rule of INTENT_RULES) {
      if (rule.keywords.length === 0) continue;
      let score = 0;
      for (const kw of rule.keywords) {
        if (normalized.includes(kw.toLowerCase())) {
          score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = rule;
      }
    }

    // Fallback: chat
    if (!bestMatch || bestScore === 0) {
      return {
        intent: 'chat',
        complexity: 'simple',
        confidence: 0.5,
        params: {},
        suggestedTools: ['chat'],
        rawInput: input,
      };
    }

    const confidence = Math.min(bestScore / bestMatch.keywords.length, 0.95);

    // Multi-intent keyword detection → force complex
    if (this.isMultiStep(normalized)) {
      return {
        intent: bestMatch.intent,
        complexity: 'complex',
        confidence,
        params: this.extractParams(normalized, bestMatch.intent),
        suggestedTools: bestMatch.toolHints,
        rawInput: input,
      };
    }

    return {
      intent: bestMatch.intent,
      complexity: bestMatch.complexity,
      confidence,
      params: this.extractParams(normalized, bestMatch.intent),
      suggestedTools: bestMatch.toolHints,
      rawInput: input,
    };
  }

  /**
   * Detect whether the input contains multi-step instruction keywords
   */
  private isMultiStep(input: string): boolean {
    const multiStepKeywords = ['然后', '接着', '之后', '再', '并且', '同时', '还有', '以及'];
    return multiStepKeywords.filter((kw) => input.includes(kw)).length >= 1;
  }

  /**
   * Extract parameters from the input
   */
  private extractParams(input: string, _intent: IntentType): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {};

    // Extract quantity
    const numMatch = input.match(/(\d+)\s*(个|台|只|张|条)/);
    if (numMatch) {
      params.count = parseInt(numMatch[1], 10);
    }

    // Extract the page name
    const nameMatch = input.match(/叫[「「](.+?)[」」]/) || input.match(/名为[「「](.+?)[」」]/);
    if (nameMatch) {
      params.name = nameMatch[1];
    }

    // Extract dimensions
    const sizeMatch = input.match(/(\d+)\s*[x×X]\s*(\d+)/);
    if (sizeMatch) {
      params.width = parseInt(sizeMatch[1], 10);
      params.height = parseInt(sizeMatch[2], 10);
    }

    return params;
  }
}

/** Singleton */
export const intentParser = new IntentParser();
