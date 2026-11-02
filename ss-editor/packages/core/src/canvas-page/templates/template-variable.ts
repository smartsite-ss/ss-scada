// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Template variable injection and resolution
 *
 * Component templates (WidgetTemplate) write `{{key}}` placeholders in graphic JSON;
 * they are replaced at instantiation time based on the variables definitions.
 *
 * Completely different from device template variables (DeviceTemplateVariable, ${expr} collection points):
 * this only does UI placeholder string/numeric replacement; it never creates DataTags or collects data.
 */

import type { WidgetTemplateVariable } from './widget-template.types';

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Extract all placeholder keys from a string */
export function extractPlaceholders(text: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE);
  while ((m = re.exec(text)) !== null) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

/** Replace placeholders in a single string with variable values */
export function resolveText(
  text: string,
  values: Record<string, string | number>,
): string {
  if (typeof text !== 'string') return text;
  return text.replace(PLACEHOLDER_RE, (_, key: string) => {
    const v = values[key];
    return v === undefined ? '' : String(v);
  });
}

/**
 * Deep-walk the graphics JSON and perform placeholder replacement on fields like props / text / fill.
 * Also handles precise injection via targetPath (overriding the default text replacement).
 */
export function applyVariables(
  graphics: any[],
  variables: WidgetTemplateVariable[],
  values: Record<string, string | number>,
): any[] {
  const merged: Record<string, string | number> = {};
  for (const v of variables) {
    merged[v.key] =
      values[v.key] !== undefined ? values[v.key] : v.defaultValue ?? '';
  }

  const clone = JSON.parse(JSON.stringify(graphics));

  // 1) Default: placeholder replacement on string fields
  deepResolve(clone, merged);

  // 2) Precise injection: targetPath explicitly specifies the path
  for (const v of variables) {
    if (v.targetPath) {
      setByPath(clone, v.targetPath, merged[v.key] ?? '');
    }
  }

  return clone;
}

function deepResolve(node: any, values: Record<string, string | number>): void {
  if (Array.isArray(node)) {
    node.forEach((n) => deepResolve(n, values));
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const val = node[k];
      if (typeof val === 'string') {
        if (val.includes('{{')) node[k] = resolveText(val, values);
      } else if (typeof val === 'object' && val !== null) {
        deepResolve(val, values);
      }
    }
  }
}

/** Set a value by path, e.g. "graphics[0].props.text" */
function setByPath(root: any, path: string, value: any): void {
  const segs = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur == null) return;
    cur = cur[segs[i]];
  }
  if (cur != null) cur[segs[segs.length - 1]] = value;
}
