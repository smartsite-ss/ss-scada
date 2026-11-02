// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ScriptEditorMode } from '../ScriptEditor.types';
import {
  API_REGISTRY,
  API_CATEGORY_LABELS,
  getApiByName,
  type ApiCategory,
  type ApiMethodDef,
} from '../rules/script-api-registry';

// ── API category grouping: generated from the rule registry ──

interface ApiGroupItem {
  /** Dropdown display text */
  label: string;
  /** Inserted code */
  code: string;
  /** Method name (used to look up details) */
  name: string;
  /** Category */
  category: ApiCategory;
}

interface ApiGroup {
  label: string;
  items: ApiGroupItem[];
}

/** Generate category groups from API_REGISTRY */
function getApiGroups(): ApiGroup[] {
  const categoryMap = new Map<ApiCategory, ApiGroupItem[]>();

  for (const api of API_REGISTRY) {
    if (!categoryMap.has(api.category)) {
      categoryMap.set(api.category, []);
    }
    categoryMap.get(api.category)!.push({
      label: `${api.signature} — ${api.summary}`,
      code: api.insertText,
      name: api.name,
      category: api.category,
    });
  }

  return Array.from(categoryMap.entries()).map(([cat, items]) => ({
    label: API_CATEGORY_LABELS[cat],
    items,
  }));
}

/** Get API details (from the rule registry) */
function getApiDetail(name: string): ApiMethodDef | undefined {
  return getApiByName(name);
}

/** Get API list by category (with full details) */
function getApisByCategory(): Array<{ category: string; label: string; apis: ApiMethodDef[] }> {
  const categoryMap = new Map<ApiCategory, ApiMethodDef[]>();
  for (const api of API_REGISTRY) {
    if (!categoryMap.has(api.category)) {
      categoryMap.set(api.category, []);
    }
    categoryMap.get(api.category)!.push(api);
  }
  return Array.from(categoryMap.entries()).map(([cat, apis]) => ({
    category: cat,
    label: API_CATEGORY_LABELS[cat],
    apis,
  }));
}

/** Get all APIs (with full details) */
function getAllApis(): ApiMethodDef[] {
  return API_REGISTRY;
}

// ── Basic templates ──

const templates: Record<string, string> = {
  // filter mode template
  'filter:basic': `// 数据过滤脚本
// 可用变量：data（当前数据点）
// 示例：当数值大于阈值时改变颜色
if (data.number > 80) {
  data.color = '#ff0000';
} else {
  data.color = '#18a058';
}
return data;`,

  // driver mode template
  'driver:basic': `// 图元驱动脚本
// 可用变量：api（图元操作API）、data（数据点）、context（上下文）
api.setText(data.number + data.unit);
api.setBackground(data.color);

if (data.number > 80) {
  api.triggerAlarm({ tagId: context.graphicId, level: 'warning', message: '数值过高' });
}`,

  // interaction mode template
  'interaction:basic': `// 图元交互脚本
// 可用变量：api（图元操作API）、event（事件数据）、graphic（图元信息）
api.showGraphic('popup-' + event.graphicId);
api.setGraphicProps('popup-' + event.graphicId, {
  x: event.x + 10,
  y: event.y - 50,
  visible: true,
});`,

  // timer mode template
  'timer:basic': `// 页面定时器脚本
// 可用变量：page（页面API）、utils（工具函数）、data（数据）、timer（定时器信息）
const allGraphics = page.getGraphics();
for (const graphic of allGraphics) {
  const tagValue = data.readTag(graphic.tagId);
  if (tagValue !== null) {
    api.setGraphicProps(graphic.id, { text: String(tagValue) });
  }
}`,
};

export function useScriptTemplates(mode: ScriptEditorMode) {
  function getDefaultTemplate(): string {
    const key = `${mode}:basic`;
    return templates[key] ?? '// 在此编写脚本代码';
  }

  function getApiGroupsFromDefs(): ApiGroup[] {
    return getApiGroups();
  }

  /** Get API details (for displaying full documentation) */
  function getApiDetailFromRegistry(name: string): ApiMethodDef | undefined {
    return getApiDetail(name);
  }

  /** Get API list by category (with full details, for the API reference panel) */
  function getApiCategoriesFromRegistry(): Array<{ category: string; label: string; apis: ApiMethodDef[] }> {
    return getApisByCategory();
  }

  /** Get all APIs (with full details) */
  function getAllApisFromRegistry(): ApiMethodDef[] {
    return getAllApis();
  }

  function getQuickSnippets(): Array<{ label: string; code: string }> {
    const snippets: Array<{ label: string; code: string }> = [];

    if (mode === 'driver') {
      snippets.push(
        { label: '设置文本', code: 'api.setText(data.number + data.unit);' },
        { label: '设置背景色', code: 'api.setBackground("#ff0000");' },
        { label: '条件设置', code: 'if (data.number > 80) { api.setBackground("#ff0000"); } else { api.setBackground("#18a058"); }' },
        { label: '触发告警', code: 'api.triggerAlarm({ tagId: context.graphicId, level: "warning", message: "数值异常" });' },
        { label: '颜色映射', code: 'api.setBackground(api.colorForValue(data.number, 0, 100));' },
      );
    } else if (mode === 'filter') {
      snippets.push(
        { label: '阈值过滤', code: 'if (data.number > 80) { data.color = "#ff0000"; }\nreturn data;' },
        { label: '四舍五入', code: 'data.number = api.round(data.number, 2);\nreturn data;' },
      );
    }

    return snippets;
  }

  return {
    getDefaultTemplate,
    getQuickSnippets,
    getApiGroups: getApiGroupsFromDefs,
    // Added: rich API data from the rule registry
    getApiDetail: getApiDetailFromRegistry,
    getApiCategories: getApiCategoriesFromRegistry,
    getAllApis: getAllApisFromRegistry,
  };
}