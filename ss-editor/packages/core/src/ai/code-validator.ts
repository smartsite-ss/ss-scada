// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Code Validator — P1-T05/P1-T06 code validation utility
 *
 * Performs syntax validation and security checks on LLM-generated code:
 *   1. JS/TS syntax validation (Function constructor + regex pattern checks)
 *   2. Security checks (forbids window/document/eval and other globals)
 *   3. Common error detection (unbalanced brackets, unclosed strings, etc.)
 *
 * Usage:
 *   const result = validateCode(code, 'javascript');
 *   // result.valid → boolean
 *   // result.errors → ValidationError[]
 */

// ============================================================
// Type definitions
// ============================================================

export interface ValidationError {
  /** Error message */
  message: string;
  /** Error line number (1-based); -1 means unknown */
  line: number;
  /** Error column number (1-based); -1 means unknown */
  column: number;
  /** Error type */
  type: 'syntax' | 'security' | 'style';
  /** Severity */
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error/warning list */
  errors: ValidationError[];
  /** Warning list (severity === 'warning') */
  warnings: ValidationError[];
}

// ============================================================
// Security blacklist: global objects and functions forbidden in sandbox scripts
// ============================================================

const FORBIDDEN_GLOBALS = [
  { pattern: /\bwindow\b(?!\s*\])/g, message: '禁止使用 window 全局对象，请使用 api.* 或 context.*', type: 'security' as const },
  { pattern: /\bdocument\b(?!\s*\])/g, message: '禁止使用 document 对象（沙箱无 DOM）', type: 'security' as const },
  { pattern: /\beval\s*\(/g, message: '禁止使用 eval()', type: 'security' as const },
  { pattern: /\bFunction\s*\(/g, message: '禁止使用 Function 构造函数', type: 'security' as const },
  { pattern: /\blocalStorage\b/g, message: '禁止直接使用 localStorage', type: 'security' as const },
  { pattern: /\bsessionStorage\b/g, message: '禁止直接使用 sessionStorage', type: 'security' as const },
  { pattern: /\bXMLHttpRequest\b/g, message: '禁止直接使用 XMLHttpRequest，请用 api.fetch()', type: 'security' as const },
  { pattern: /\bWebSocket\b(?!\s*\])/g, message: '禁止直接使用 WebSocket', type: 'security' as const },
  { pattern: /\b__proto__\b/g, message: '禁止访问 __proto__', type: 'security' as const },
  { pattern: /\bconstructor\s*\[/g, message: '禁止访问 constructor[]', type: 'security' as const },
];

// ============================================================
// Common syntax error patterns
// ============================================================

const COMMON_SYNTAX_ISSUES = [
  { pattern: /{\s*\.{3}/g, message: '展开运算符不能在对象字面量外部使用', type: 'syntax' as const },
  { pattern: /const\s+\w+\s*:\s*\w+/g, message: 'JS/TS 中变量声明不需要类型注解（const x: number → 移除 : number）', type: 'syntax' as const, severity: 'warning' as const },
];

// ============================================================
// CodeValidator
// ============================================================

export class CodeValidator {
  /**
   * Validate code
   * @param code the code string
   * @param lang language identifier (javascript/typescript/js/ts)
   * @param options.sandboxMode sandbox mode (default true); detects forbidden APIs
   */
  validate(
    code: string,
    lang: string = 'javascript',
    options: { sandboxMode?: boolean } = {},
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const { sandboxMode = true } = options;

    // 1. Basic pattern checks (bracket matching etc.)
    this._checkBasicSyntax(code, errors);

    // 2. Function constructor syntax validation
    if (this._isJavaScript(lang)) {
      this._checkWithFunction(code, errors);
    }

    // 3. Security blacklist check (sandbox mode only)
    if (sandboxMode) {
      this._checkSecurity(code, errors);
    }

    // 4. Common pattern checks
    this._checkCommonPatterns(code, errors);

    const warnings = errors.filter((e) => e.severity === 'warning');
    const realErrors = errors.filter((e) => e.severity === 'error');
    const valid = realErrors.length === 0;

    return { valid, errors, warnings };
  }

  /**
   * Quick validation (returns only pass/fail)
   */
  isValid(code: string, lang: string = 'javascript'): boolean {
    return this.validate(code, lang).valid;
  }

  // ─── Private methods ───

  private _isJavaScript(lang: string): boolean {
    return ['javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx'].includes(lang.toLowerCase());
  }

  private _checkBasicSyntax(code: string, errors: ValidationError[]): void {
    // Bracket matching check
    const bracketPairs = [
      { open: '{', close: '}', name: '花括号' },
      { open: '[', close: ']', name: '方括号' },
      { open: '(', close: ')', name: '圆括号' },
    ];

    // Exclude brackets inside strings and comments
    const cleanCode = this._stripStringsAndComments(code);

    for (const pair of bracketPairs) {
      let depth = 0;
      let line = 1;
      let col = 1;

      for (let i = 0; i < cleanCode.length; i++) {
        const ch = cleanCode[i];
        if (ch === '\n') {
          line++;
          col = 1;
          continue;
        }
        col++;
        if (ch === pair.open) depth++;
        if (ch === pair.close) {
          depth--;
          if (depth < 0) {
            errors.push({
              message: `${pair.name}不匹配：多余的 "${pair.close}"`,
              line,
              column: col,
              type: 'syntax',
              severity: 'error',
            });
            depth = 0; // reset to continue checking
          }
        }
      }

      if (depth > 0) {
        errors.push({
          message: `${pair.name}未闭合：缺少 ${depth} 个 "${pair.close}"`,
          line: -1,
          column: -1,
          type: 'syntax',
          severity: 'error',
        });
      }
    }
  }

  private _checkWithFunction(code: string, errors: ValidationError[]): void {
    try {
      // Use the Function constructor for syntax checking
      // Note: compile only, never execute — safe
      new Function(code);
    } catch (e) {
      const message = e instanceof SyntaxError ? e.message : String(e);

      // Try to extract the line number
      let line = -1;
      let column = -1;
      const lineMatch = message.match(/at position (\d+)/i)
        || message.match(/Unexpected token.*at (\d+)/i)
        || message.match(/line (\d+)/i);

      if (lineMatch) {
        const pos = parseInt(lineMatch[1], 10);
        if (!isNaN(pos) && pos > 0) {
          // Compute line/column from the position
          const lines = code.substring(0, pos).split('\n');
          line = lines.length;
          column = lines[lines.length - 1].length + 1;
        }
      }

      errors.push({
        message: `语法错误: ${message}`,
        line,
        column,
        type: 'syntax',
        severity: 'error',
      });
    }
  }

  private _checkSecurity(code: string, errors: ValidationError[]): void {
    for (const rule of FORBIDDEN_GLOBALS) {
      // Reset the regex lastIndex
      rule.pattern.lastIndex = 0;
      const cleanCode = this._stripStringsAndComments(code);
      const match = rule.pattern.exec(cleanCode);
      if (match) {
        const lines = code.substring(0, match.index).split('\n');
        errors.push({
          message: rule.message,
          line: lines.length,
          column: lines[lines.length - 1].length + 1,
          type: rule.type,
          severity: 'error',
        });
      }
    }
  }

  private _checkCommonPatterns(code: string, errors: ValidationError[]): void {
    for (const rule of COMMON_SYNTAX_ISSUES) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(code);
      if (match) {
        const lines = code.substring(0, match.index).split('\n');
        errors.push({
          message: rule.message,
          line: lines.length,
          column: lines[lines.length - 1].length + 1,
          type: rule.type,
          severity: rule.severity || 'warning',
        });
      }
    }
  }

  /**
   * Remove string literals and comment content
   */
  private _stripStringsAndComments(code: string): string {
    // Remove single-line comments
    let result = code.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove template strings
    result = result.replace(/`(?:[^`\\]|\\.)*`/g, '``');
    // Remove single-quoted strings
    result = result.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    // Remove double-quoted strings
    result = result.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    return result;
  }
}

/** Singleton */
export const codeValidator = new CodeValidator();

/**
 * Convenience function: validate code
 */
export function validateCode(
  code: string,
  lang: string = 'javascript',
  options?: { sandboxMode?: boolean },
): ValidationResult {
  return codeValidator.validate(code, lang, options);
}

/**
 * Convenience function: validate and return formatted error messages
 */
export function validateCodeForDisplay(
  code: string,
  lang: string = 'javascript',
): { valid: boolean; summary: string } {
  const result = validateCode(code, lang);
  if (result.valid) {
    return { valid: true, summary: '校验通过' };
  }

  const errorMsgs = result.errors
    .filter((e) => e.severity === 'error')
    .map((e) => `[E${e.line > 0 ? ` L${e.line}` : ''}] ${e.message}`)
    .join('; ');

  const warnMsgs = result.warnings
    .map((e) => `[W${e.line > 0 ? ` L${e.line}` : ''}] ${e.message}`)
    .join('; ');

  const parts: string[] = [];
  if (errorMsgs) parts.push(errorMsgs);
  if (warnMsgs) parts.push(warnMsgs);

  return { valid: false, summary: parts.join(' | ') };
}
