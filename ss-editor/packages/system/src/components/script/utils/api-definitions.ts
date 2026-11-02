// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Script engine API static definitions
 *
 * Unified static file for all API method metadata (name, signature, description, category, code template).
 * completionData.ts and useScriptTemplates.ts both read from this file,
 * so later interface changes only need updating here.
 *
 * Update guide:
 * 1. Add an API: add an entry to the API_DEFINITIONS array
 * 2. Modify a signature: update the corresponding entry detail/insertText/signature fields
 * 3. Remove an API: delete the entry from the array
 * 4. Adjust a category: modify the category field
 */

export interface ApiMethodDefinition {
  /** Method name (with prefix) */
  label: string;
  /** Completion kind */
  kind: 'function',
  /** Signature display */
  detail: string;
  /** Chinese description */
  documentation: string;
  /** Completion insert text (supports Monaco snippet syntax, e.g. ${1:param}) */
  insertText: string;
  /** Sort weight */
  sortText: string;
  /** API category */
  category: ApiCategory;
  /** Full signature (for the template dropdown display) */
  signature: string;
}

export type ApiCategory =
  | 'data'       // data read/write
  | 'graphic'    // graphic operations
  | 'alarm'      // alarm operations
  | 'page'       // page operations
  | 'network'    // network requests
  | 'timer'      // timers
  | 'utility';   // utility functions

export const API_CATEGORY_LABELS: Record<ApiCategory, string> = {
  data: '数据读写',
  graphic: '图元操作',
  alarm: '告警操作',
  page: '页面操作',
  network: '网络请求',
  timer: '定时器',
  utility: '工具函数',
};

/** All API method definitions (26 entries) */
export const API_DEFINITIONS: ApiMethodDefinition[] = [
  // ─── Data read/write ───
  {
    label: 'api.readTag',
    kind: 'function',
    detail: '(tagId: string) => any | null',
    documentation: '读取标签当前值',
    insertText: 'readTag(${1:tagId})',
    sortText: 'a',
    category: 'data',
    signature: 'readTag(tagId)',
  },
  {
    label: 'api.writeTag',
    kind: 'function',
    detail: '(tagId: string, value: any) => void',
    documentation: '写入标签值',
    insertText: 'writeTag(${1:tagId}, ${2:value})',
    sortText: 'a',
    category: 'data',
    signature: 'writeTag(tagId, value)',
  },
  {
    label: 'api.getTagQuality',
    kind: 'function',
    detail: '(tagId: string) => string',
    documentation: '获取标签数据质量码',
    insertText: 'getTagQuality(${1:tagId})',
    sortText: 'a',
    category: 'data',
    signature: 'getTagQuality(tagId)',
  },

  // ─── Graphic operations ───
  {
    label: 'api.setGraphicProps',
    kind: 'function',
    detail: '(graphicId: string, props: Record<string, any>) => void',
    documentation: '批量设置图元属性',
    insertText: 'setGraphicProps(${1:graphicId}, { ${2:key}: ${3:value} })',
    sortText: 'b',
    category: 'graphic',
    signature: 'setGraphicProps(graphicId, props)',
  },
  {
    label: 'api.showGraphic',
    kind: 'function',
    detail: '(graphicId: string) => void',
    documentation: '显示图元',
    insertText: 'showGraphic(${1:graphicId})',
    sortText: 'b',
    category: 'graphic',
    signature: 'showGraphic(graphicId)',
  },
  {
    label: 'api.hideGraphic',
    kind: 'function',
    detail: '(graphicId: string) => void',
    documentation: '隐藏图元',
    insertText: 'hideGraphic(${1:graphicId})',
    sortText: 'b',
    category: 'graphic',
    signature: 'hideGraphic(graphicId)',
  },
  {
    label: 'api.moveGraphic',
    kind: 'function',
    detail: '(graphicId: string, x: number, y: number) => void',
    documentation: '移动图元到指定坐标',
    insertText: 'moveGraphic(${1:graphicId}, ${2:x}, ${3:y})',
    sortText: 'b',
    category: 'graphic',
    signature: 'moveGraphic(graphicId, x, y)',
  },
  {
    label: 'api.rotateGraphic',
    kind: 'function',
    detail: '(graphicId: string, angle: number) => void',
    documentation: '旋转图元到指定角度',
    insertText: 'rotateGraphic(${1:graphicId}, ${2:angle})',
    sortText: 'b',
    category: 'graphic',
    signature: 'rotateGraphic(graphicId, angle)',
  },

  // ─── Alarm operations ───
  {
    label: 'api.triggerAlarm',
    kind: 'function',
    detail: '(config: {tagId, level, message}) => void',
    documentation: '触发告警',
    insertText: 'triggerAlarm({ tagId: ${1:tagId}, level: "${2|info,warning,critical,emergency|}", message: "${3:message}" })',
    sortText: 'c',
    category: 'alarm',
    signature: 'triggerAlarm({tagId, level, message})',
  },
  {
    label: 'api.acknowledgeAlarm',
    kind: 'function',
    detail: '(alarmId: string) => void',
    documentation: '确认告警',
    insertText: 'acknowledgeAlarm(${1:alarmId})',
    sortText: 'c',
    category: 'alarm',
    signature: 'acknowledgeAlarm(alarmId)',
  },
  {
    label: 'api.clearAlarm',
    kind: 'function',
    detail: '(alarmId: string) => void',
    documentation: '清除告警',
    insertText: 'clearAlarm(${1:alarmId})',
    sortText: 'c',
    category: 'alarm',
    signature: 'clearAlarm(alarmId)',
  },
  {
    label: 'api.getActiveAlarms',
    kind: 'function',
    detail: '() => any[]',
    documentation: '获取当前活跃告警列表',
    insertText: 'getActiveAlarms()',
    sortText: 'c',
    category: 'alarm',
    signature: 'getActiveAlarms()',
  },

  // ─── Page operations ───
  {
    label: 'api.switchPage',
    kind: 'function',
    detail: '(pageId: string) => void',
    documentation: '切换到指定页面',
    insertText: 'switchPage(${1:pageId})',
    sortText: 'd',
    category: 'page',
    signature: 'switchPage(pageId)',
  },
  {
    label: 'api.getCurrentPageId',
    kind: 'function',
    detail: '() => string',
    documentation: '获取当前页面 ID',
    insertText: 'getCurrentPageId()',
    sortText: 'd',
    category: 'page',
    signature: 'getCurrentPageId()',
  },

  // ─── Network requests ───
  {
    label: 'api.fetch',
    kind: 'function',
    detail: '(url: string, options?: {method, headers, body}) => Promise<any>',
    documentation: 'HTTP 请求（GET/POST，自动解析 JSON）',
    insertText: 'await fetch(${1:url}${2:, { method: \'${3:GET}\' }})',
    sortText: 'e',
    category: 'network',
    signature: 'fetch(url, options?)',
  },

  // ─── Timers ───
  {
    label: 'api.setTimeout',
    kind: 'function',
    detail: '(callback: () => void, delay: number) => number',
    documentation: '延迟执行回调（ms），页面卸载时自动清理',
    insertText: 'setTimeout(() => { ${1} }, ${2:1000})',
    sortText: 'f',
    category: 'timer',
    signature: 'setTimeout(callback, delay)',
  },
  {
    label: 'api.setInterval',
    kind: 'function',
    detail: '(callback: () => void, interval: number) => number',
    documentation: '周期执行回调（ms），页面卸载时自动清理',
    insertText: 'setInterval(() => { ${1} }, ${2:5000})',
    sortText: 'f',
    category: 'timer',
    signature: 'setInterval(callback, interval)',
  },
  {
    label: 'api.clearTimeout',
    kind: 'function',
    detail: '(id: number) => void',
    documentation: '清除 setTimeout',
    insertText: 'clearTimeout(${1:timerId})',
    sortText: 'f',
    category: 'timer',
    signature: 'clearTimeout(id)',
  },
  {
    label: 'api.clearInterval',
    kind: 'function',
    detail: '(id: number) => void',
    documentation: '清除 setInterval',
    insertText: 'clearInterval(${1:timerId})',
    sortText: 'f',
    category: 'timer',
    signature: 'clearInterval(id)',
  },

  // ─── Utility functions ───
  {
    label: 'api.sleep',
    kind: 'function',
    detail: '(ms: number) => Promise<void>',
    documentation: '异步休眠（毫秒）',
    insertText: 'await sleep(${1:1000})',
    sortText: 'g',
    category: 'utility',
    signature: 'sleep(ms)',
  },
  {
    label: 'api.notify',
    kind: 'function',
    detail: '(message: string, level?: "info"|"warn"|"error") => void',
    documentation: '弹出通知消息',
    insertText: 'notify(${1:message}, ${2:"info"})',
    sortText: 'g',
    category: 'utility',
    signature: 'notify(message, level?)',
  },
  {
    label: 'api.log',
    kind: 'function',
    detail: '(level: "info"|"warn"|"error", message: string) => void',
    documentation: '记录日志',
    insertText: 'log("${1|info,warn,error|}", ${2:message})',
    sortText: 'g',
    category: 'utility',
    signature: 'log(level, message)',
  },
  {
    label: 'api.round',
    kind: 'function',
    detail: '(value: number, decimals?: number) => number',
    documentation: '数值四舍五入',
    insertText: 'round(${1:value}, ${2:2})',
    sortText: 'g',
    category: 'utility',
    signature: 'round(value, decimals?)',
  },
  {
    label: 'api.clamp',
    kind: 'function',
    detail: '(value: number, min: number, max: number) => number',
    documentation: '值域约束',
    insertText: 'clamp(${1:value}, ${2:min}, ${3:max})',
    sortText: 'g',
    category: 'utility',
    signature: 'clamp(value, min, max)',
  },
  {
    label: 'api.mapRange',
    kind: 'function',
    detail: '(v: number, inMin: number, inMax: number, outMin: number, outMax: number) => number',
    documentation: '线性映射',
    insertText: 'mapRange(${1:v}, ${2:inMin}, ${3:inMax}, ${4:outMin}, ${5:outMax})',
    sortText: 'g',
    category: 'utility',
    signature: 'mapRange(v, inMin, inMax, outMin, outMax)',
  },
  {
    label: 'api.colorForValue',
    kind: 'function',
    detail: '(v: number, min?: number, max?: number) => string',
    documentation: '值→颜色映射（红-黄-绿渐变）',
    insertText: 'colorForValue(${1:v}, ${2:0}, ${3:100})',
    sortText: 'g',
    category: 'utility',
    signature: 'colorForValue(v, min?, max?)',
  },
  {
    label: 'api.isAlarm',
    kind: 'function',
    detail: '(v: number, high: number, low?: number) => boolean',
    documentation: '告警判断（v >= high 或 v <= low）',
    insertText: 'isAlarm(${1:v}, ${2:high}, ${3:low})',
    sortText: 'g',
    category: 'utility',
    signature: 'isAlarm(v, high, low?)',
  },
];

/** Get API definitions grouped by category */
export function getApiDefinitionsByCategory(): Record<string, ApiMethodDefinition[]> {
  const groups: Record<string, ApiMethodDefinition[]> = {};
  for (const def of API_DEFINITIONS) {
    const catLabel = API_CATEGORY_LABELS[def.category];
    if (!groups[catLabel]) groups[catLabel] = [];
    groups[catLabel].push(def);
  }
  return groups;
}