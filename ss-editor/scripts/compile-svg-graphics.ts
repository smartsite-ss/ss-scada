// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * compile-svg-graphics.ts —— SVG graphic vector instruction compiler (03 mini-program graphic rendering ADR §3)
 *
 * Responsibilities: scan XxxGraphic.vue in each directory under packages/plugins, compile the lightweight Vue components whose template root is <svg>
 * into vector instruction JSON interpretable by the mini-program (SvgDirective contract), and emit a compilation audit report.
 *
 * Usage (from ss-editor root):
 *   npx tsx scripts/compile-svg-graphics.ts                    # full compile
 *   npx tsx scripts/compile-svg-graphics.ts --audit-only       # audit only, no JSON output
 *   npx tsx scripts/compile-svg-graphics.ts --out <dir>        # custom output directory
 *
 * Authoritative contract: ss-wx/smart-site/src/utils/scada/svg-directive-types.ts
 * Consumer: ss-wx/smart-site/src/utils/scada/directive-registry.ts
 *
 * Dependency: @vue/compiler-sfc (resolved via .pnpm hoisted dir, not declared in root package.json)
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ─────────────────────────── Basic tools ─────────────────────────── */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_ROOT = path.resolve(SCRIPT_DIR, '..');
const PLUGINS_ROOT = path.join(EDITOR_ROOT, 'packages', 'plugins');
const DEFAULT_OUT_DIR = path.resolve(EDITOR_ROOT, '..', 'ss-wx', 'smart-site', 'src', 'utils', 'scada', 'directives');

/** Parse @vue/compiler-sfc: prefer normal resolution, fall back to the pnpm hoisted dir on failure */
function resolveCompilerSfc(): typeof import('@vue/compiler-sfc') {
  const attempts: Array<() => NodeRequire> = [
    () => createRequire(import.meta.url),
    () => createRequire(path.join(EDITOR_ROOT, 'package.json')),
    () => createRequire(path.join(EDITOR_ROOT, 'node_modules', '.pnpm', 'x.js')),
  ];
  for (const getRequire of attempts) {
    try {
      return getRequire()('@vue/compiler-sfc');
    } catch {
      /* Try the next parse path */
    }
  }
  throw new Error('无法解析 @vue/compiler-sfc（请在 ss-editor 安装依赖后重试）');
}

/** @vue/compiler-core NodeTypes (stable enum; local constant avoids type dependency) */
const NODE_ROOT = 0;
const NODE_ELEMENT = 1;
const NODE_TEXT = 2;
const NODE_INTERPOLATION = 5;
const NODE_ATTRIBUTE = 6;
const NODE_DIRECTIVE = 7;

interface AstNode {
  type: number;
  tag?: string;
  props?: AstProp[];
  children?: AstNode[];
  content?: unknown;
  name?: string;
  value?: { content?: string } | null;
  exp?: { content?: string } | null;
  arg?: { content?: string } | null;
}
type AstProp = AstNode;

/** Value shape in the directive JSON (aligned with svg-directive-types.ts contract) */
type SlotValue =
  | { const: string | number }
  | { slot: string }
  | { expr: string };

interface TransformOp {
  op: 'rotate' | 'translate' | 'scale' | 'matrix';
  [key: string]: unknown;
}

interface DirectiveNode {
  kind: 'rect' | 'circle' | 'ellipse' | 'line' | 'polygon' | 'polyline' | 'path' | 'text' | 'group';
  attrs?: Record<string, SlotValue | string | number>;
  transform?: TransformOp | TransformOp[];
  text?: string | SlotValue;
  switchBranches?: Array<{ when?: string; nodes: DirectiveNode[] }>;
  children?: DirectiveNode[];
  pathCommands?: Array<{ cmd: string; args: number[] }>;
}

interface GradientStop {
  offset: number;
  color: SlotValue;
  opacity?: number;
}

interface GradientDef {
  id: string;
  type: 'linear' | 'radial';
  /** Coordinate unit (SVG gradientUnits attribute, defaults to objectBoundingBox) */
  units: 'objectBoundingBox' | 'userSpaceOnUse';
  coords: Record<string, number | SlotValue>;
  stops: GradientStop[];
}

interface SvgDirective {
  type: string;
  viewBox: { x: number; y: number; width: number; height: number };
  gradients?: GradientDef[];
  elements: DirectiveNode[];
  degraded?: boolean;
  degradedReasons?: string[];
  audit?: Record<string, unknown>;
}

/** Single-file compilation result */
interface FileResult {
  category: string;
  type: string;
  file: string;
  status: 'compiled' | 'degraded' | 'skipped';
  reasons: string[];
  directive?: SvgDirective;
  audit: Record<string, unknown>;
}

/* ─────────────────────────── Static expression evaluator ─────────────────────────── */

/** Math whitelist (subset consistent between compile-time and runtime) */
const MATH_WHITELIST: Record<string, (...args: number[]) => number> = {
  cos: Math.cos, sin: Math.sin, tan: Math.tan, atan: Math.atan, atan2: Math.atan2,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, pow: Math.pow, sqrt: Math.sqrt,
};

interface StaticToken { kind: 'number' | 'string' | 'ident' | 'member' | 'math' | 'op'; value: string }

/** Lexical analysis: supports identifiers / array-literal subscript members (colors[0]) / Math.xx / strings / operators */
function tokenizeStatic(expression: string): StaticToken[] | null {
  const tokens: StaticToken[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(expression.slice(i));
      if (!m) return null;
      tokens.push({ kind: 'number', value: m[0] }); i += m[0].length; continue;
    }
    if (ch === "'" || ch === '"') {
      const close = expression.indexOf(ch, i + 1);
      if (close < 0) return null;
      tokens.push({ kind: 'string', value: expression.slice(i + 1, close) });
      i = close + 1; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(expression.slice(i))!;
      const name = m[0];
      i += m[0].length;
      // Math member functions (Math.cos / Math.PI)
      if (name === 'Math' && expression[i] === '.') {
        const mm = /^\.([A-Za-z_$][\w$]*)/.exec(expression.slice(i));
        if (!mm) return null;
        i += mm[0].length;
        tokens.push({ kind: 'math', value: mm[1] }); continue;
      }
      // Array-literal subscript chain: colors[0][1]
      let full = name;
      while (expression[i] === '[') {
        const close = expression.indexOf(']', i);
        if (close < 0) return null;
        const idx = expression.slice(i + 1, close).trim();
        if (!/^\d+$/.test(idx)) return null;
        full += `[${idx}]`;
        i = close + 1;
      }
      tokens.push({ kind: 'ident', value: full });
      // Boolean/literal normalization
      continue;
    }
    const two = expression.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ kind: 'op', value: two }); i += 2; continue;
    }
    if ('?:><+-*/%!(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch }); i += 1; continue;
    }
    return null;
  }
  return tokens;
}

/** Static-evaluation recursive descent: variables come only from v-for compile-time bindings */
class StaticEvaluator {
  private cursor = 0;
  constructor(private tokens: StaticToken[], private vars: Record<string, unknown>) {}

  evaluate(): unknown {
    const value = this.ternary();
    if (this.cursor < this.tokens.length) throw new Error('trailing tokens');
    return value;
  }

  private peek(): StaticToken | undefined { return this.tokens[this.cursor]; }

  private op(expected: string): boolean {
    const t = this.peek();
    if (t && t.kind === 'op' && t.value === expected) { this.cursor += 1; return true; }
    return false;
  }

  private ternary(): unknown {
    const cond = this.logicalOr();
    if (this.op('?')) {
      const yes = this.ternary();
      if (!this.op(':')) throw new Error('missing :');
      const no = this.ternary();
      return cond ? yes : no;
    }
    return cond;
  }

  private logicalOr(): unknown {
    let l = this.logicalAnd();
    while (this.op('||')) l = l || this.logicalAnd();
    return l;
  }

  private logicalAnd(): unknown {
    let l = this.equality();
    while (this.op('&&')) l = l && this.equality();
    return l;
  }

  private equality(): unknown {
    let l = this.comparison();
    for (;;) {
      if (this.op('==')) l = l === this.comparison();
      else if (this.op('!=')) l = l !== this.comparison();
      else return l;
    }
  }

  private comparison(): unknown {
    let l = this.additive();
    for (;;) {
      if (this.op('>')) l = (l as number) > (this.additive() as number);
      else if (this.op('>=')) l = (l as number) >= (this.additive() as number);
      else if (this.op('<')) l = (l as number) < (this.additive() as number);
      else if (this.op('<=')) l = (l as number) <= (this.additive() as number);
      else return l;
    }
  }

  private additive(): unknown {
    let l = this.multiplicative();
    for (;;) {
      if (this.op('+')) {
        const r = this.multiplicative();
        l = typeof l === 'string' || typeof r === 'string' ? `${l ?? ''}${r ?? ''}` : (l as number) + (r as number);
      } else if (this.op('-')) l = (l as number) - (this.multiplicative() as number);
      else return l;
    }
  }

  private multiplicative(): unknown {
    let l = this.unary();
    for (;;) {
      if (this.op('*')) l = (l as number) * (this.unary() as number);
      else if (this.op('/')) l = (l as number) / (this.unary() as number);
      else if (this.op('%')) l = (l as number) % (this.unary() as number);
      else return l;
    }
  }

  private unary(): unknown {
    if (this.op('-')) return -(this.unary() as number);
    if (this.op('!')) return !this.unary();
    return this.primary();
  }

  private primary(): unknown {
    const t = this.peek();
    if (!t) throw new Error('unexpected end');
    if (t.kind === 'number') { this.cursor += 1; return Number(t.value); }
    if (t.kind === 'string') { this.cursor += 1; return t.value; }
    if (t.kind === 'math') {
      this.cursor += 1;
      if (t.value === 'PI') return Math.PI;
      const fn = MATH_WHITELIST[t.value];
      if (!fn) throw new Error(`Math.${t.value} not whitelisted`);
      if (!this.op('(')) throw new Error('expected ( after Math fn');
      const args: number[] = [this.ternary() as number];
      while (this.op(',')) args.push(this.ternary() as number);
      if (!this.op(')')) throw new Error('missing )');
      return fn(...args);
    }
    if (t.kind === 'ident') {
      this.cursor += 1;
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      if (t.value === 'undefined') return undefined;
      if (!(t.value in this.vars)) throw new Error(`unbound identifier: ${t.value}`);
      return this.vars[t.value];
    }
    if (t.kind === 'member') { this.cursor += 1; return this.vars[t.value]; }
    if (t.kind === 'op' && t.value === '(') {
      this.cursor += 1;
      const v = this.ternary();
      if (!this.op(')')) throw new Error('missing )');
      return v;
    }
    throw new Error(`unexpected token: ${t.value}`);
  }
}

/** Compile-time static evaluation: returns null on failure (caller treats it as a dynamic expression) */
function evaluateStatic(expression: string, vars: Record<string, unknown>): unknown {
  const tokens = tokenizeStatic(expression);
  if (!tokens || tokens.length === 0) return null;
  try {
    const value = new StaticEvaluator(tokens, vars).evaluate();
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') return null;
    return value;
  } catch {
    return null;
  }
}

/** Determine whether an expression contains runtime slot identifiers (excluding v-for variables and Math) */
function containsRuntimeIdentifiers(expression: string, staticVars: Record<string, unknown>): boolean {
  const tokens = tokenizeStatic(expression);
  if (!tokens) return true; // Unanalyzable → conservatively treated as dynamic
  return tokens.some(t => (t.kind === 'ident' || t.kind === 'member') && !(t.value in staticVars));
}

/* ─────────────────────────── Expression classification (SlotValue) ─────────────────────────── */

/** Pure identifier/member path: 'state' / 'colors[0]' / 'colors[0][1]' */
const MEMBER_PATH_RE = /^[A-Za-z_$][\w$]*(\[\d+\])*$/;

/**
 * Expression → SlotValue classification:
 * 1. static evaluable with v-for variables → const (includes Math folding, e.g. gauge coordinates)
 * 2. pure identifier/member path → slot
 * 3. others containing runtime identifiers → expr (evaluated by runtime whitelist interpreter)
 * 4. unanalyzable (object literal/method call with runtime variables) → null (element-level skip)
 */
function classifyExpression(expression: string, staticVars: Record<string, unknown>): SlotValue | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;

  // Constant template literal `` `0 0 100 120` `` or pure constant
  const templateLiteral = /^`([^`]*)`$/.exec(trimmed);
  if (templateLiteral) return { const: templateLiteral[1] };

  // 静态可求值（含 v-for 变量与 Math 折叠）优先
  const staticValue = evaluateStatic(trimmed, staticVars);
  if (staticValue !== null) {
    return { const: staticValue as string | number | boolean as string | number };
  }

  // 纯成员路径 → slot
  if (MEMBER_PATH_RE.test(trimmed) && !['true', 'false', 'null', 'undefined'].includes(trimmed)) {
    return { slot: trimmed };
  }

  // 含运行时标识符的动态表达式：校验词法可解析（tokenize 成功即可，
  // 运行时解释器与静态求值器同文法，另支持成员路径变量）
  const tokens = tokenizeStatic(trimmed);
  if (tokens && containsRuntimeIdentifiers(trimmed, staticVars)) {
    const hasMath = tokens.some(t => t.kind === 'math');
    if (hasMath) return null; // 运行时 Math 调用首版不支持（03 文档 §5）
    return { expr: trimmed };
  }
  return null;
}

/* ─────────────────────────── SVG transform 解析 ─────────────────────────── */

/** 解析静态 transform 字符串："rotate(30 30 30) translate(2,3) scale(1.5)" */
function parseStaticTransform(transform: string): TransformOp[] | null {
  const ops: TransformOp[] = [];
  const re = /(rotate|translate|scale|matrix)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(transform))) {
    if (m.index !== consumed && transform.slice(consumed, m.index).trim()) return null;
    consumed = m.index + m[0].length;
    const args = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some(n => !Number.isFinite(n))) return null;
    if (m[1] === 'rotate') {
      if (args.length !== 1 && args.length !== 3) return null;
      ops.push({ op: 'rotate', angle: args[0], ...(args.length === 3 ? { cx: args[1], cy: args[2] } : {}) });
    } else if (m[1] === 'translate') {
      if (args.length !== 1 && args.length !== 2) return null;
      ops.push({ op: 'translate', tx: args[0], ty: args[1] ?? 0 });
    } else if (m[1] === 'scale') {
      if (args.length !== 1 && args.length !== 2) return null;
      ops.push({ op: 'scale', sx: args[0], sy: args[1] ?? args[0] });
    } else {
      if (args.length !== 6) return null;
      ops.push({ op: 'matrix', a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] });
    }
  }
  if (ops.length === 0) return null;
  if (consumed !== transform.length && transform.slice(consumed).trim()) return null;
  return ops;
}

/**
 * 解析动态 :transform 拼接表达式（51 文件统一模式）：
 * 'rotate(' + (roate) + ')' + ' scale(' + '1' + ')'
 * → 骨架 "rotate(§0) scale(1)" → 结构化变换（§0 为槽）
 */
function parseDynamicTransform(expression: string, staticVars: Record<string, unknown>): TransformOp[] | null {
  const trimmed = expression.trim();
  const templateLiteral = /^`([^`]*)`$/.exec(trimmed);
  if (templateLiteral) return parseStaticTransform(templateLiteral[1]);

  // Split with a unified tokenizer (string tokens are literals; the rest belong to the expression segment)
  const tokens = tokenizeStatic(trimmed);
  if (!tokens) return null;
  // Group by '+' operator
  const groups: StaticToken[][] = [[]];
  for (const t of tokens) {
    if (t.kind === 'op' && t.value === '+') groups.push([]);
    else groups[groups.length - 1].push(t);
  }
  if (groups.length === 1) return null; // No concatenation → not this mode

  // Rebuild the skeleton string (literal segments concatenated directly, expression segments replaced with placeholders)
  let skeleton = '';
  const exprSlots: string[] = [];
  for (const group of groups) {
    if (group.length === 1 && group[0].kind === 'string') {
      skeleton += group[0].value;
    } else if (group.length > 0) {
      const expr = group.map(t => t.value).join(' ');
      exprSlots.push(expr);
      skeleton += `\u0000${exprSlots.length - 1}\u0000`;
    } else {
      return null; // Empty segment (e.g. "a" + + "b") is invalid
    }
  }

  // After backfilling the skeleton placeholder with slot/const values, parse the SVG transform syntax
  const parseValue = (raw: string): SlotValue | number | null => {
    if (/^\u0000(\d+)\u0000$/.test(raw)) {
      const idx = Number(RegExp.$1);
      return classifyExpression(exprSlots[idx], staticVars);
    }
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  };

  const ops: TransformOp[] = [];
  const opRe = /(rotate|translate|scale|matrix)\s*\(([^)]*)\)/g;
  let consumed = 0;
  let m2: RegExpExecArray | null;
  while ((m2 = opRe.exec(skeleton))) {
    if (m2.index !== consumed && skeleton.slice(consumed, m2.index).trim()) return null;
    consumed = m2.index + m2[0].length;
    const rawArgs = m2[2].split(/[\s,]+/).filter(Boolean);
    const args: Array<SlotValue | number> = [];
    for (const raw of rawArgs) {
      const v = parseValue(raw);
      if (v === null) return null;
      args.push(v);
    }
    const allConst = args.every(a => typeof a === 'number' || 'const' in (a as object));
    const num = (a: SlotValue | number): number =>
      typeof a === 'number' ? a : 'const' in a ? Number((a as { const: unknown }).const) : Number.NaN;

    if (m2[1] === 'rotate') {
      if (args.length !== 1 && args.length !== 3) return null;
      ops.push({
        op: 'rotate',
        angle: args[0],
        ...(args.length === 3 ? { cx: args[1], cy: args[2] } : {}),
      });
    } else if (m2[1] === 'translate') {
      if (args.length !== 1 && args.length !== 2) return null;
      ops.push({ op: 'translate', tx: args[0], ty: args[1] ?? 0 });
    } else if (m2[1] === 'scale') {
      if (args.length !== 1 && args.length !== 2) return null;
      ops.push({ op: 'scale', sx: args[0], sy: args[1] ?? args[0] });
    } else {
      if (args.length !== 6) return null;
      if (!allConst) return null; // matrix only supports all-constant
      ops.push({ op: 'matrix', a: num(args[0]), b: num(args[1]), c: num(args[2]), d: num(args[3]), e: num(args[4]), f: num(args[5]) });
    }
  }
  if (ops.length === 0) return null;
  return ops;
}

/* ─────────────────────────── Element conversion ─────────────────────────── */

const SHAPE_KINDS = new Set(['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'text']);
/** Property whitelist to keep (others are ignored) */
const ATTR_WHITELIST = new Set([
  // Geometry
  'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'd',
  // Draw
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'stroke-opacity', 'fill-opacity', 'opacity', 'fill-rule',
  // Text
  'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing',
]);
/** Bound properties ignored unconditionally (metadata / CSS animation) */
const IGNORED_BIND_PROPS = new Set(['title', 'class', 'style', 'key', 'dur', 'id']);

interface CompileContext {
  staticVars: Record<string, unknown>;   // v-for expanded variables (known at compile time)
  audit: {
    elementCounts: Record<string, number>;
    animateCount: number;
    ignoredClassStyle: number;
    skippedElements: string[];
    skippedDynamic: Array<{ element: string; attr: string; expr: string }>;
    interpolations: number;
  };
}

/** Extract v-if/v-else-if/v-else directives on an element */
function getConditionDirective(props: AstProp[]): { name: string; exp: string } | null {
  for (const p of props) {
    if (p.type === NODE_DIRECTIVE && ['if', 'else-if', 'else'].includes(p.name ?? '')) {
      return { name: p.name!, exp: p.exp?.content ?? '' };
    }
  }
  return null;
}

/** Extract v-for directive: v-for="i in 11" → { varName: 'i', count: 11 } */
function getForDirective(props: AstProp[]): { varName: string; count: number } | null {
  for (const p of props) {
    if (p.type === NODE_DIRECTIVE && p.name === 'for') {
      const content = p.exp?.content ?? '';
      const m = /^\s*\(?(\w+)\)?\s+in\s+(\d+)\s*$/.exec(content);
      if (m) return { varName: m[1], count: Number(m[2]) };
      return null; // Non-fixed integer range: not supported in the first version
    }
  }
  return null;
}

/** Collect the condition chain: starting from the first v-if element, absorb subsequent v-else-if/v-else siblings */
function collectBranchChain(children: AstNode[], startIndex: number, ctx: CompileContext): { end: number; branches: Array<{ when?: string; nodes: DirectiveNode[] }> } {
  const branches: Array<{ when?: string; nodes: DirectiveNode[] }> = [];
  let i = startIndex;
  while (i < children.length) {
    const child = children[i];
    if (child.type !== NODE_ELEMENT) break;
    const cond = getConditionDirective(child.props ?? []);
    if (i === startIndex) {
      if (!cond || cond.name !== 'if') break;
    } else if (!cond || !['else-if', 'else'].includes(cond.name)) {
      break;
    }
    // Extract condition (v-else has no expression)
    const when = cond.name === 'else' ? undefined : cond.exp.trim() || undefined;
    // Compile this element (strip condition/loop directives)
    const stripped = stripDirectives(child, ['if', 'else-if', 'else', 'for']);
    const node = convertElement(stripped, ctx);
    if (node) branches.push({ when, nodes: [node] });
    else branches.push({ when, nodes: [] });
    i += 1;
    if (cond.name === 'else') break;
  }
  return { end: i, branches };
}

/** Clone an element after stripping the specified directive (without modifying the original AST) */
function stripDirectives(el: AstNode, names: string[]): AstNode {
  return {
    ...el,
    props: (el.props ?? []).filter(p => !(p.type === NODE_DIRECTIVE && names.includes(p.name ?? ''))),
  };
}

/** Convert a single element node → DirectiveNode (without condition-chain handling) */
function convertElement(el: AstNode, ctx: CompileContext): DirectiveNode | null {
  const tag = el.tag ?? '';
  const props = el.props ?? [];
  ctx.audit.elementCounts[tag] = (ctx.audit.elementCounts[tag] ?? 0) + 1;

  // SMIL animation: ignored (static first-frame strategy)
  if (tag === 'animate' || tag === 'animateTransform') {
    ctx.audit.animateCount += 1;
    return null;
  }
  // Metadata: ignored
  if (tag === 'desc' || tag === 'title' || tag === 'metadata') return null;
  // defs: gradients are handled separately at document level (collectGradients); skipped here
  if (tag === 'defs') return null;
  // clipPath/mask/filter: skipped at element level (visual approximation, doc 03 §5)
  if (tag === 'clipPath' || tag === 'mask' || tag === 'filter') {
    ctx.audit.skippedElements.push(tag);
    return null;
  }
  // Gradient defined outside defs (non-conforming template): skip and log
  if (tag === 'linearGradient' || tag === 'radialGradient' || tag === 'stop') {
    ctx.audit.skippedElements.push(`${tag}(out-of-defs)`);
    return null;
  }

  // Property conversion
  const attrs: Record<string, SlotValue | string | number> = {};
  let transform: TransformOp | TransformOp[] | undefined;
  let hasUnsupported = false;

  for (const p of props) {
    if (p.type === NODE_ATTRIBUTE) {
      const name = p.name ?? '';
      const value = p.value?.content ?? '';
      if (name === 'transform') {
        const ops = parseStaticTransform(value);
        if (ops) transform = ops.length === 1 ? ops[0] : ops;
        else ctx.audit.skippedElements.push(`${tag}[transform-unsupported]`);
        continue;
      }
      if (name === 'id' || name === 'class' || name === 'style') continue;
      if (name === 'gradientUnits') continue; // Gradient attributes are handled by the gradient collector
      if (ATTR_WHITELIST.has(name)) attrs[name] = value;
      continue;
    }
    if (p.type === NODE_DIRECTIVE) {
      const dName = p.name ?? '';
      const dArg = p.arg?.content ?? '';
      // v-if/else/for are handled at the upper level; v-show/v-html/on events are unsupported (ignored)
      if (['if', 'else-if', 'else', 'for', 'show', 'html', 'on'].includes(dName)) continue;
      if (dName !== 'bind') continue;
      if (IGNORED_BIND_PROPS.has(dArg)) {
        if (dArg === 'class' || dArg === 'style') ctx.audit.ignoredClassStyle += 1;
        continue;
      }
      if (dArg === 'viewBox') continue; // Root element handling
      const expr = p.exp?.content ?? '';
      if (dArg === 'transform') {
        const ops = parseDynamicTransform(expr, ctx.staticVars) ?? (() => {
          // Non-concatenation mode: try static evaluation then parse by SVG transform
          const v = evaluateStatic(expr, ctx.staticVars);
          return typeof v === 'string' ? parseStaticTransform(v) : null;
        })();
        if (ops) transform = ops.length === 1 ? ops[0] : ops;
        else {
          ctx.audit.skippedElements.push(`${tag}[transform-expr-unsupported]`);
        }
        continue;
      }
      if (!ATTR_WHITELIST.has(dArg)) continue; // Non-whitelist binding (e.g. obscure props other than :x) → ignore
      const classified = classifyExpression(expr, ctx.staticVars);
      if (classified) {
        attrs[dArg] = classified;
      } else {
        // Unsupported → property defaults (element-level downgrade flag)
        ctx.audit.skippedDynamic.push({ element: tag, attr: dArg, expr });
        hasUnsupported = true;
      }
      continue;
    }
  }

  // Basic shapes
  if (SHAPE_KINDS.has(tag)) {
    const node: DirectiveNode = { kind: tag as DirectiveNode['kind'], attrs };
    if (transform) node.transform = transform;
    // path: static d parsed into a command sequence at compile time
    if (tag === 'path') {
      const dValue = attrs.d;
      if (typeof dValue === 'string') {
        const commands = parsePathData(dValue);
        if (commands) {
          node.pathCommands = commands;
          delete attrs.d; // Already structured to avoid runtime re-parsing
        } else {
          ctx.audit.skippedDynamic.push({ element: tag, attr: 'd', expr: String(dValue).slice(0, 40) });
        }
      }
      // d is a SlotValue (dynamic) → cannot be resolved at runtime → element skipped (except cases where hasUnsupported already marked null at bind time,
      // here d being slot/expr is also treated as unsupported)
      if (dValue && typeof dValue === 'object') {
        ctx.audit.skippedDynamic.push({ element: tag, attr: 'd', expr: 'dynamic d' });
        return null;
      }
    }
    // text content: static text or interpolation
    if (tag === 'text') {
      const content = extractTextContent(el, ctx);
      if (content !== null) node.text = content;
    }
    if (hasUnsupported && Object.keys(attrs).length === 0 && !node.pathCommands) return null;
    return node;
  }

  // group
  if (tag === 'g' || tag === 'svg') {
    const children: DirectiveNode[] = [];
    convertChildren(el.children ?? [], ctx, children);
    const node: DirectiveNode = { kind: 'group', children };
    if (transform) node.transform = transform;
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
    return node;
  }

  // Unknown element: skip and log
  ctx.audit.skippedElements.push(tag);
  return null;
}

/** Extract text element content: static string / simple interpolation slot; complex interpolation → null (partially missing) */
function extractTextContent(el: AstNode, ctx: CompileContext): string | SlotValue | null {
  const children = el.children ?? [];
  if (children.length === 0) return '';
  if (children.length === 1 && children[0].type === NODE_TEXT) {
    return (children[0].content as string).trim();
  }
  if (children.length === 1 && children[0].type === NODE_INTERPOLATION) {
    ctx.audit.interpolations += 1;
    const expr = (children[0].content as { content?: string })?.content?.trim() ?? '';
    const classified = classifyExpression(expr, ctx.staticVars);
    return classified; // slot/const usable; complex interpolation → null
  }
  return null;
}

/** Traverse child elements (including condition-chain / v-for expansion) */
function convertChildren(children: AstNode[], ctx: CompileContext, out: DirectiveNode[]): void {
  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.type === NODE_TEXT || child.type === NODE_INTERPOLATION) { i += 1; continue; }
    if (child.type !== NODE_ELEMENT) { i += 1; continue; }

    const cond = getConditionDirective(child.props ?? []);
    if (cond && cond.name === 'if') {
      const { end, branches } = collectBranchChain(children, i, ctx);
      const valid = branches.filter(b => b.nodes.length > 0);
      if (valid.length > 0) {
        out.push({ kind: 'group', switchBranches: valid });
      }
      i = end;
      continue;
    }

    const forDirective = getForDirective(child.props ?? []);
    if (forDirective) {
      const stripped = stripDirectives(child, ['for']);
      for (let n = 1; n <= forDirective.count; n++) {
        const loopCtx: CompileContext = {
          ...ctx,
          staticVars: { ...ctx.staticVars, [forDirective.varName]: n },
          audit: ctx.audit,
        };
        const node = convertElement(stripped, loopCtx);
        if (node) out.push(node);
      }
      i += 1;
      continue;
    }

    const node = convertElement(child, ctx);
    if (node) out.push(node);
    i += 1;
  }
}

/** Static parsing of path d: M/L/H/V/C/S/Q/T/A/Z → command sequence */
function parsePathData(d: string): Array<{ cmd: string; args: number[] }> | null {
  const commands: Array<{ cmd: string; args: number[] }> = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])((?:[^MLHVCSQTAZmlhvcsqtaz])*)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(d))) {
    if (m.index !== consumed && d.slice(consumed, m.index).trim()) return null;
    consumed = m.index + m[0].length;
    const cmd = m[1];
    const argsRaw = m[2].trim();
    const args = argsRaw ? argsRaw.split(/[\s,]+/).map(Number) : [];
    if (args.some(n => !Number.isFinite(n))) return null;
    // Parameter count validation
    const expected: Record<string, number[]> = {
      M: [2], L: [2], H: [1], V: [1], C: [6], S: [4], Q: [4], T: [2], A: [7], Z: [0],
    };
    const upper = cmd.toUpperCase();
    const allowed = expected[upper];
    if (!allowed) return null;
    if (cmd === upper && allowed[0] > 0) {
      // Absolute-coordinate commands allow repeated parameter groups (implicit repeat) — split into multiple commands
      const unit = allowed[0];
      if (args.length === 0 || args.length % unit !== 0) return null;
      for (let k = 0; k < args.length; k += unit) {
        commands.push({ cmd, args: args.slice(k, k + unit) });
      }
    } else {
      if (allowed[0] === 0 && args.length > 0) return null;
      if (allowed[0] > 0 && args.length !== allowed[0]) return null;
      commands.push({ cmd, args });
    }
  }
  if (commands.length === 0) return null;
  return commands;
}

/** Collect gradient definitions inside defs */
function collectGradients(svgEl: AstNode, ctx: CompileContext, viewBox: SvgDirective['viewBox']): GradientDef[] {
  const gradients: GradientDef[] = [];
  const visit = (node: AstNode): void => {
    for (const child of node.children ?? []) {
      if (child.type !== NODE_ELEMENT) continue;
      const tag = child.tag ?? '';
      if (tag === 'linearGradient' || tag === 'radialGradient') {
        const def = buildGradient(child, tag === 'linearGradient' ? 'linear' : 'radial', ctx, viewBox);
        if (def) gradients.push(def);
      } else {
        visit(child);
      }
    }
  };
  visit(svgEl);
  return gradients;
}

/** Gradient coordinate-axis ownership (for percentage conversion) */
type GradientCoordAxis = 'x' | 'y' | 'r';

const GRADIENT_COORD_AXES: Record<string, GradientCoordAxis> = {
  x1: 'x', y1: 'y', x2: 'x', y2: 'y',
  cx: 'x', cy: 'y', r: 'r', fx: 'x', fy: 'y',
};

/** Parse offset value: '100%' / '1.0' → 0~1 fraction */
function parseOffsetValue(raw: string): number | undefined {
  const percentMatch = /^(-?[\d.]+)%$/.exec(raw.trim());
  const parsed = percentMatch ? Number(percentMatch[1]) / 100 : Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parse gradient coordinates: percentages converted by unit
 * - objectBoundingBox → 0~1 fraction (same semantics as the browser; out-of-range values preserved)
 * - userSpaceOnUse → viewBox absolute coordinates (r normalized by √((w²+h²)/2), SVG-spec approximation)
 */
function parseGradientCoord(
  raw: string,
  units: string,
  axis: GradientCoordAxis,
  viewBox: SvgDirective['viewBox'],
): number | undefined {
  const percentMatch = /^(-?[\d.]+)%$/.exec(raw.trim());
  if (percentMatch) {
    const fraction = Number(percentMatch[1]) / 100;
    if (units === 'userSpaceOnUse') {
      if (axis === 'x') return viewBox.x + fraction * viewBox.width;
      if (axis === 'y') return viewBox.y + fraction * viewBox.height;
      return fraction * Math.sqrt((viewBox.width ** 2 + viewBox.height ** 2) / 2);
    }
    return fraction;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildGradient(
  el: AstNode,
  type: 'linear' | 'radial',
  ctx: CompileContext,
  viewBox: SvgDirective['viewBox'],
): GradientDef | null {
  let id = '';
  const coords: Record<string, number | SlotValue> = {};
  let gradientUnits = 'objectBoundingBox';
  const stops: GradientStop[] = [];

  for (const p of el.props ?? []) {
    if (p.type === NODE_ATTRIBUTE) {
      const name = p.name ?? '';
      const value = p.value?.content ?? '';
      if (name === 'id') id = value;
      else if (name === 'gradientUnits') gradientUnits = value;
      else if (GRADIENT_COORD_AXES[name]) {
        const coord = parseGradientCoord(value, gradientUnits, GRADIENT_COORD_AXES[name], viewBox);
        if (coord !== undefined) coords[name] = coord;
      }
      continue;
    }
    if (p.type === NODE_DIRECTIVE && p.name === 'bind') {
      const arg = p.arg?.content ?? '';
      const expr = p.exp?.content ?? '';
      if (arg === 'id') continue; // Dynamic gradient id: rare in industrial; skip this gradient
      if (GRADIENT_COORD_AXES[arg]) {
        const classified = classifyExpression(expr, ctx.staticVars);
        if (classified) coords[arg] = classified;
      }
    }
  }

  if (!id) return null;

  for (const child of el.children ?? []) {
    if (child.type !== NODE_ELEMENT || child.tag !== 'stop') continue;
    let offset = 0;
    let color: SlotValue | null = null;
    let opacity: number | undefined;
    for (const p of child.props ?? []) {
      if (p.type === NODE_ATTRIBUTE) {
        const name = p.name ?? '';
        const value = p.value?.content ?? '';
        if (name === 'offset') {
          const parsed = parseOffsetValue(value);
          if (parsed !== undefined) offset = parsed;
        }
        else if (name === 'stop-color') color = { const: value };
        else if (name === 'stop-opacity') { const n = Number(value); if (Number.isFinite(n)) opacity = n; }
      } else if (p.type === NODE_DIRECTIVE && p.name === 'bind') {
        const arg = p.arg?.content ?? '';
        const expr = p.exp?.content ?? '';
        if (arg === 'stop-color' || arg === 'offset' || arg === 'stop-opacity') {
          const classified = classifyExpression(expr, ctx.staticVars);
          if (classified) {
            if (arg === 'stop-color') color = classified;
            else if (arg === 'offset' && 'const' in classified) {
              const parsed = typeof classified.const === 'string'
                ? parseOffsetValue(classified.const)
                : Number(classified.const);
              if (parsed !== undefined && Number.isFinite(parsed)) offset = parsed;
            }
            else if (arg === 'stop-opacity' && 'const' in classified) opacity = Number(classified.const);
          }
        }
      }
    }
    if (color) stops.push({ offset, color, ...(opacity !== undefined ? { opacity } : {}) });
  }

  return {
    id,
    type,
    units: gradientUnits === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox',
    coords,
    stops,
  };
}

/* ─────────────────────────── Document-level compilation ─────────────────────────── */

/** Parse the root svg viewBox (static or constant template literal) */
function parseViewBox(svgEl: AstNode, staticVars: Record<string, unknown>): SvgDirective['viewBox'] | null {
  for (const p of svgEl.props ?? []) {
    const content = p.type === NODE_ATTRIBUTE
      ? p.value?.content ?? ''
      : p.type === NODE_DIRECTIVE && p.name === 'bind' && p.arg?.content === 'viewBox'
        ? p.exp?.content ?? ''
        : null;
    if (content === null) continue;
    const value = (() => {
      const templateLiteral = /^`([^`]*)`$/.exec(content.trim());
      if (templateLiteral) return templateLiteral[1];
      const evaluated = evaluateStatic(content, staticVars);
      return typeof evaluated === 'string' ? evaluated : content;
    })();
    const parts = value.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  }
  return null;
}

/** 从 index.ts 提取 createPlugin({ type: 'xxx' }) 交叉核对 */
function readPluginType(dir: string, fallback: string): { type: string; matched: boolean } {
  const indexPath = path.join(dir, 'index.ts');
  try {
    const source = fs.readFileSync(indexPath, 'utf-8');
    const m = /type\s*:\s*['"]([\w-]+)['"]/.exec(source);
    if (m) return { type: m[1], matched: m[1] === fallback };
  } catch { /* index.ts 不存在 */ }
  return { type: fallback, matched: false };
}

function compileVueFile(filePath: string, category: string, typeFromDir: string): FileResult {
  const source = fs.readFileSync(filePath, 'utf-8');
  const { parse } = resolveCompilerSfcOnce();
  const { descriptor, errors } = parse(source, { filename: filePath });
  if (errors.length > 0) {
    return { category, type: typeFromDir, file: filePath, status: 'skipped', reasons: [`SFC 解析错误: ${errors[0].message}`], audit: {} };
  }
  if (!descriptor.template?.ast) {
    return { category, type: typeFromDir, file: filePath, status: 'skipped', reasons: ['无模板（纯 Canvas 命令式插件或配置组件）'], audit: {} };
  }

  const root = descriptor.template.ast;
  const svgEl = (root.children ?? []).find(c => c.type === NODE_ELEMENT && c.tag === 'svg');
  if (!svgEl) {
    return { category, type: typeFromDir, file: filePath, status: 'skipped', reasons: ['模板根不是 <svg>（DOM/CSS 类组件）'], audit: {} };
  }

  const ctx: CompileContext = {
    staticVars: {},
    audit: {
      elementCounts: {},
      animateCount: 0,
      ignoredClassStyle: 0,
      skippedElements: [],
      skippedDynamic: [],
      interpolations: 0,
    },
  };

  const viewBox = parseViewBox(svgEl, ctx.staticVars);
  if (!viewBox) {
    return { category, type: typeFromDir, file: filePath, status: 'skipped', reasons: ['viewBox 缺失或不可静态解析'], audit: ctx.audit };
  }

  const gradients = collectGradients(svgEl, ctx, viewBox);
  const elements: DirectiveNode[] = [];
  convertChildren(svgEl.children ?? [], ctx, elements);

  const reasons: string[] = [];
  // 元素全空（全部被跳过）→ 文件降级
  if (elements.length === 0) {
    reasons.push('无任何可渲染元素（全部被跳过）');
  }
  // 跳过的动态属性过多（>1/3 元素受影响）→ 文件降级
  const shapeCount = Object.entries(ctx.audit.elementCounts)
    .filter(([tag]) => SHAPE_KINDS.has(tag))
    .reduce((sum, [, n]) => sum + n, 0);
  if (shapeCount > 0 && ctx.audit.skippedDynamic.length > shapeCount / 3) {
    reasons.push(`动态属性不支持比例过高（${ctx.audit.skippedDynamic.length}/${shapeCount}）`);
  }

  const directive: SvgDirective = {
    type: typeFromDir,
    viewBox,
    ...(gradients.length > 0 ? { gradients } : {}),
    elements,
    ...(reasons.length > 0 ? { degraded: true, degradedReasons: reasons } : {}),
    audit: ctx.audit,
  };

  return {
    category,
    type: typeFromDir,
    file: filePath,
    status: reasons.length > 0 ? 'degraded' : 'compiled',
    reasons,
    directive,
    audit: ctx.audit,
  };
}

/* 编译器单例解析（避免每文件重复 require） */
let compilerSfcModule: typeof import('@vue/compiler-sfc') | null = null;
function resolveCompilerSfcOnce(): typeof import('@vue/compiler-sfc') {
  if (!compilerSfcModule) compilerSfcModule = resolveCompilerSfc();
  return compilerSfcModule;
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

function findGraphicFiles(): Array<{ file: string; category: string; type: string }> {
  const results: Array<{ file: string; category: string; type: string }> = [];
  if (!fs.existsSync(PLUGINS_ROOT)) return results;
  for (const category of fs.readdirSync(PLUGINS_ROOT, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = path.join(PLUGINS_ROOT, category.name);
    for (const entry of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(categoryDir, entry.name);
      const files = fs.readdirSync(pluginDir).filter(f => /Graphic\.vue$/.test(f));
      for (const f of files) {
        results.push({ file: path.join(pluginDir, f), category: category.name, type: entry.name });
      }
    }
  }
  return results.sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
}

function buildReport(results: FileResult[], durationMs: number): string {
  const lines: string[] = [];
  const compiled = results.filter(r => r.status === 'compiled');
  const degraded = results.filter(r => r.status === 'degraded');
  const skipped = results.filter(r => r.status === 'skipped');

  lines.push('# SVG 图元编译审计报告', '');
  lines.push(`**生成时间**：${new Date().toISOString()}`);
  lines.push(`**耗时**：${durationMs}ms`);
  lines.push('');
  lines.push(`## 总览`);
  lines.push('');
  lines.push(`| 状态 | 数量 |`);
  lines.push(`| ---- | :--: |`);
  lines.push(`| ✅ 完整编译 | ${compiled.length} |`);
  lines.push(`| ⚠️ 编译但降级（部分特性不支持） | ${degraded.length} |`);
  lines.push(`| ⏭️ 跳过（非 SVG 模板/无模板） | ${skipped.length} |`);
  lines.push(`| **合计** | **${results.length}** |`);
  lines.push('');

  // 特性聚合
  const totalAnimate = results.reduce((s, r) => s + (Number(r.audit.animateCount) || 0), 0);
  const totalIgnoredClass = results.reduce((s, r) => s + (Number(r.audit.ignoredClassStyle) || 0), 0);
  const skippedElementCounts = new Map<string, number>();
  for (const r of results) {
    for (const el of ((r.audit.skippedElements as string[]) ?? [])) {
      skippedElementCounts.set(el, (skippedElementCounts.get(el) ?? 0) + 1);
    }
  }
  lines.push(`## 特性统计（全量聚合）`);
  lines.push('');
  lines.push(`- SMIL 动画（静态化忽略）：${totalAnimate} 处`);
  lines.push(`- :class/:style CSS 动画（忽略）：${totalIgnoredClass} 处`);
  lines.push(`- 元素级跳过：${[...skippedElementCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('、') || '无'}`);
  lines.push('');

  lines.push(`## 跳过清单（非 SVG 模板）`);
  lines.push('');
  lines.push(`| 包 | type | 原因 |`);
  lines.push(`| ---- | ---- | ---- |`);
  for (const r of skipped) {
    lines.push(`| ${r.category} | ${r.type} | ${r.reasons[0] ?? ''} |`);
  }
  lines.push('');

  lines.push(`## 降级清单（编译产出但运行时回落占位）`);
  lines.push('');
  lines.push(`| 包 | type | 降级原因 |`);
  lines.push(`| ---- | ---- | ---- |`);
  for (const r of degraded) {
    lines.push(`| ${r.category} | ${r.type} | ${r.reasons.join('；')} |`);
  }
  lines.push('');

  lines.push(`## 完整编译清单`);
  lines.push('');
  lines.push(`| 包 | type | 元素数 | 渐变 | 动画(忽略) | 动态属性跳过 |`);
  lines.push(`| ---- | ---- | :--: | :--: | :--: | :--: |`);
  for (const r of compiled) {
    const a = r.audit as Record<string, unknown>;
    const ec = a.elementCounts as Record<string, number> ?? {};
    const elementTotal = Object.values(ec).reduce((s, n) => s + n, 0);
    const gradCount = (r.directive?.gradients?.length) ?? 0;
    const sd = (a.skippedDynamic as unknown[])?.length ?? 0;
    lines.push(`| ${r.category} | ${r.type} | ${elementTotal} | ${gradCount} | ${a.animateCount ?? 0} | ${sd} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const auditOnly = args.includes('--audit-only');
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 && args[outIndex + 1] ? path.resolve(args[outIndex + 1]) : DEFAULT_OUT_DIR;

  console.log(`[compile-svg-graphics] 扫描插件目录：${PLUGINS_ROOT}`);
  const files = findGraphicFiles();
  console.log(`[compile-svg-graphics] 发现 ${files.length} 个 *Graphic.vue`);

  const start = Date.now();
  const results: FileResult[] = [];
  const typeWarnings: string[] = [];

  for (const { file, category, type: typeFromDir } of files) {
    try {
      const { type, matched } = readPluginType(path.dirname(file), typeFromDir);
      if (!matched) typeWarnings.push(`${category}/${typeFromDir}: index.ts type='${type}' ≠ 目录名`);
      const result = compileVueFile(file, category, typeFromDir);
      if (result.directive) result.directive.type = typeFromDir; // 指令 type 以目录名为准（与页面 JSON type 对齐）
      results.push(result);
    } catch (error) {
      results.push({
        category, type: typeFromDir, file,
        status: 'skipped',
        reasons: [`编译异常：${error instanceof Error ? error.message : String(error)}`],
        audit: {},
      });
    }
  }

  // 输出目录先建（--audit-only 也写审计报告）
  fs.mkdirSync(outDir, { recursive: true });
  if (!auditOnly) {
    // 清理旧产物（仅删除本编译器管理的 *.json）
    for (const old of fs.readdirSync(outDir)) {
      if (old.endsWith('.json')) {
        try { fs.rmSync(path.join(outDir, old)); } catch { /* 忽略 */ }
      }
    }
    let written = 0;
    for (const r of results) {
      if (!r.directive || r.status === 'skipped') continue;
      // degraded 也产出（运行时按 degraded 标记回落占位）
      const json = JSON.stringify(r.directive, null, 1);
      fs.writeFileSync(path.join(outDir, `${r.type}.json`), json, 'utf-8');
      written += 1;
    }
    console.log(`[compile-svg-graphics] 已写出 ${written} 个指令 JSON → ${outDir}`);
  }

  const report = buildReport(results, Date.now() - start);
  fs.writeFileSync(path.join(outDir, 'compile-report.md'), report, 'utf-8');
  console.log(`[compile-svg-graphics] 审计报告 → ${path.join(outDir, 'compile-report.md')}`);

  const compiled = results.filter(r => r.status === 'compiled').length;
  const degraded = results.filter(r => r.status === 'degraded').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  console.log(`[compile-svg-graphics] 结果：完整 ${compiled} / 降级 ${degraded} / 跳过 ${skipped}（合计 ${results.length}）`);
  if (typeWarnings.length > 0) {
    console.warn(`[compile-svg-graphics] type 交叉核对警告 ${typeWarnings.length} 条（详见报告外控制台）`);
    for (const w of typeWarnings) console.warn(`  ⚠ ${w}`);
  }
  if (auditOnly) console.log('[compile-svg-graphics] --audit-only：未写出指令 JSON');
}

main();
