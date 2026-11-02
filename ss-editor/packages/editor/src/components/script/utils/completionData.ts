// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ScriptEditorMode, ScriptCompletionItem } from '../ScriptEditor.types';
import { API_REGISTRY, type ApiMethodDef } from '../rules/script-api-registry';
import type { KnowledgeBaseJson, GraphicFieldDef } from './knowledgeBaseLoader';

/**
 * Completion data definitions per mode
 * Core API data comes from the remote knowledge base JSON, falling back to the local script-api-registry.ts on load failure
 */

// ── Driver mode exclusive: direct graphic operation APIs (10) ──

const DRIVER_GRAPHIC_COMPLETIONS: ScriptCompletionItem[] = [
  { label: 'api.setText', kind: 'function', detail: '(text: string) => void', documentation: '设置图元文本内容', insertText: 'setText(${1:text})', sortText: 'a0' },
  { label: 'api.setBackground', kind: 'function', detail: '(color: string) => void', documentation: '设置图元背景色', insertText: 'setBackground(${1:color})', sortText: 'a0' },
  { label: 'api.setVisible', kind: 'function', detail: '(visible: boolean) => void', documentation: '设置图元显隐', insertText: 'setVisible(${1:true})', sortText: 'a0' },
  { label: 'api.setBorder', kind: 'function', detail: '(color: string, width?: number) => void', documentation: '设置边框', insertText: 'setBorder(${1:color}, ${2:width})', sortText: 'a0' },
  { label: 'api.setFontSize', kind: 'function', detail: '(size: number) => void', documentation: '设置文字大小', insertText: 'setFontSize(${1:14})', sortText: 'a0' },
  { label: 'api.setFontColor', kind: 'function', detail: '(color: string) => void', documentation: '设置文字颜色', insertText: 'setFontColor(${1:color})', sortText: 'a0' },
  { label: 'api.setRotation', kind: 'function', detail: '(degrees: number) => void', documentation: '设置旋转角度', insertText: 'setRotation(${1:0})', sortText: 'a0' },
  { label: 'api.setOpacity', kind: 'function', detail: '(opacity: number) => void', documentation: '设置不透明度(0-1)', insertText: 'setOpacity(${1:1})', sortText: 'a0' },
  { label: 'api.setPosition', kind: 'function', detail: '(x: number, y: number) => void', documentation: '设置坐标', insertText: 'setPosition(${1:x}, ${2:y})', sortText: 'a0' },
  { label: 'api.setSize', kind: 'function', detail: '(w: number, h: number) => void', documentation: '设置宽高', insertText: 'setSize(${1:w}, ${2:h})', sortText: 'a0' },
];

// ── Context variables ──

const COMMON_CONTEXT_COMPLETIONS: ScriptCompletionItem[] = [
  { label: 'data', kind: 'variable', detail: '{ number, unit, color, text, raw }', documentation: '当前数据点', insertText: 'data', sortText: 'y' },
  { label: 'context', kind: 'variable', detail: '{ graphicId, tagValues, triggerType }', documentation: '脚本上下文', insertText: 'context', sortText: 'y' },
];

/**
 * Convert an ApiMethodDef into a Monaco ScriptCompletionItem
 * Uses the rich fields from the rule registry: description/params/returns/notes/example
 */
function apiDefToCompletion(api: ApiMethodDef): ScriptCompletionItem {
  const docParts: string[] = [];

  if (api.description) {
    docParts.push(api.description);
  }

  if (api.params && api.params.length > 0) {
    docParts.push('');
    docParts.push('参数：');
    for (const p of api.params) {
      const required = p.required ? '(必填)' : '(可选)';
      const defaultVal = p.defaultValue ? ` 默认=${p.defaultValue}` : '';
      docParts.push(`  ${p.name}: ${p.type} ${required} — ${p.description}${defaultVal}`);
    }
  }

  if (api.returns) {
    docParts.push('');
    docParts.push(`返回值：${api.returns}`);
  }

  if (api.availableIn && api.availableIn.length > 0) {
    docParts.push('');
    docParts.push(`可用环境：${api.availableIn.join(' / ')}`);
  }

  if (api.notes) {
    docParts.push('');
    docParts.push(`注意：${api.notes}`);
  }

  if (api.example) {
    docParts.push('');
    docParts.push(`示例：`);
    docParts.push(api.example);
  }

  return {
    label: `api.${api.name}`,
    kind: 'function',
    detail: api.detail,
    documentation: docParts.join('\n'),
    insertText: api.insertText,
    sortText: api.sortText,
  };
}

/** Generate all API completion items from the knowledge base or the local registry */
function getCommonApiCompletions(kbData?: KnowledgeBaseJson | null): ScriptCompletionItem[] {
  const registry = kbData?.apiRegistry ?? API_REGISTRY;
  return registry.map(apiDefToCompletion);
}

// ═══════════════════════════════════════════════════════════════
// Graphic property IntelliSense (new)
// ═══════════════════════════════════════════════════════════════

/**
 * Convert a GraphicFieldDef into a completion item
 */
function graphicFieldToCompletion(field: GraphicFieldDef): ScriptCompletionItem {
  let typeDetail = field.type;
  if (field.options && field.options.length > 0) {
    typeDetail += ' | ' + field.options.map((o) => o.value).join(' | ');
  }

  const docParts = [`类型: ${field.type}`];
  if (field.defaultValue !== undefined) {
    docParts.push(`默认值: ${JSON.stringify(field.defaultValue)}`);
  }
  if (field.min !== undefined) docParts.push(`最小值: ${field.min}`);
  if (field.max !== undefined) docParts.push(`最大值: ${field.max}`);

  return {
    label: field.name,
    kind: 'variable',
    detail: typeDetail,
    documentation: docParts.join('\n'),
    insertText: `${field.name}: \${1:${field.defaultValue ?? ''}}`,
    sortText: 'b',
  };
}

/**
 * Get customProps completion items for a given graphic plugin type
 */
export function getGraphicPropCompletions(
  pluginType: string,
  kbData?: KnowledgeBaseJson | null
): ScriptCompletionItem[] {
  const schemas = kbData?.graphicSchemas ?? [];
  const schema = schemas.find((s) => s.pluginType === pluginType);
  if (!schema || !schema.fields.length) return [];

  return schema.fields.map(graphicFieldToCompletion);
}

/**
 * Get completion hints for all graphic types (for the graphicId parameter of setGraphicProps)
 */
export function getGraphicTypeCompletions(
  kbData?: KnowledgeBaseJson | null
): ScriptCompletionItem[] {
  const schemas = kbData?.graphicSchemas ?? [];
  return schemas.map((s) => ({
    label: s.pluginType,
    kind: 'keyword',
    detail: s.displayName,
    documentation: `${s.displayName} (${s.category})\n支持 ${s.fields.length} 个自定义属性`,
    insertText: s.pluginType,
    sortText: 'b',
  }));
}

// ═══════════════════════════════════════════════════════════════
// Mode completion exports
// ═══════════════════════════════════════════════════════════════

export function getCompletionsByMode(
  mode: ScriptEditorMode,
  kbData?: KnowledgeBaseJson | null,
  graphicPluginType?: string
): ScriptCompletionItem[] {
  switch (mode) {
    case 'filter':
      return getFilterCompletions(kbData);
    case 'driver':
      return getDriverCompletions(kbData, graphicPluginType);
    case 'interaction':
      return getInteractionCompletions(kbData);
    case 'timer':
      return getTimerCompletions(kbData);
    case 'expression':
      return [];
    default:
      return [];
  }
}

function getDriverCompletions(
  kbData?: KnowledgeBaseJson | null,
  graphicPluginType?: string
): ScriptCompletionItem[] {
  const completions: ScriptCompletionItem[] = [
    ...DRIVER_GRAPHIC_COMPLETIONS,
    ...getCommonApiCompletions(kbData),
    ...COMMON_CONTEXT_COMPLETIONS,
  ];

  // If a specific graphic type is given, append its customProps completions
  if (graphicPluginType) {
    completions.push(...getGraphicPropCompletions(graphicPluginType, kbData));
  }

  return completions;
}

function getFilterCompletions(kbData?: KnowledgeBaseJson | null): ScriptCompletionItem[] {
  return [
    ...getCommonApiCompletions(kbData),
    { label: 'data', kind: 'variable', detail: '{ number, unit, color, text, raw }', documentation: '数据对象', insertText: 'data', sortText: 'a' },
    { label: 'return', kind: 'keyword', detail: 'return statement', documentation: '返回数据', insertText: 'return ${1:data};', sortText: 'a' },
  ];
}

function getInteractionCompletions(kbData?: KnowledgeBaseJson | null): ScriptCompletionItem[] {
  return [
    ...getCommonApiCompletions(kbData),
    { label: 'event', kind: 'variable', detail: '{ graphicId, x, y, type }', documentation: '事件数据', insertText: 'event', sortText: 'y' },
    ...COMMON_CONTEXT_COMPLETIONS,
  ];
}

function getTimerCompletions(kbData?: KnowledgeBaseJson | null): ScriptCompletionItem[] {
  return [
    ...getCommonApiCompletions(kbData),
    { label: 'page', kind: 'variable', detail: '{ getGraphics, getCurrentPageId, switchPage }', documentation: '页面 API', insertText: 'page', sortText: 'y' },
    { label: 'timer', kind: 'variable', detail: '{ interval, count }', documentation: '定时器信息', insertText: 'timer', sortText: 'y' },
    ...COMMON_CONTEXT_COMPLETIONS,
  ];
}