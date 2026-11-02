// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Code Block Parser — shared by P1-T05/P1-T06
 *
 * Extracts code blocks from LLM responses (Markdown), identifies file names, and outputs a structured file list.
 *
 * Recognition rules:
 *   1. Fenced code blocks ```lang\n...\n``` → extract language and code
 *   2. File directive line // file: path/to/file.ts → sets the file name for subsequent code blocks
 *   3. Auto-infer the file name when absent (.ts/.js/.vue suffixes etc.)
 *
 * Usage:
 *   const result = parseCodeBlocks(llmResponse);
 *   // result.files → [{ path, lang, code }]
 *   // result.text  → plain text of non-code parts
 */

export interface ParsedFile {
  /** File path (e.g. 'src/index.ts') */
  path: string;
  /** Programming language */
  lang: string;
  /** Code content */
  code: string;
}

export interface ParsedResult {
  /** Extracted file list */
  files: ParsedFile[];
  /** Plain text of non-code parts (Markdown format preserved) */
  text: string;
}

/** File-name recognition regex */
const FILE_DIRECTIVE_RE = /^\s*(?:\/\/|#|<!--)\s*file:\s*(.+?)(?:\s*-->)?\s*$/im;

/** Language → extension mapping */
const LANG_EXT: Record<string, string> = {
  typescript: '.ts',
  ts: '.ts',
  tsx: '.tsx',
  javascript: '.js',
  js: '.js',
  jsx: '.jsx',
  vue: '.vue',
  json: '.json',
  css: '.css',
  html: '.html',
  markdown: '.md',
  md: '.md',
  yaml: '.yml',
  yml: '.yml',
  sql: '.sql',
  sh: '.sh',
  bash: '.sh',
  python: '.py',
  py: '.py',
};

/**
 * Parse code blocks in an LLM response
 */
export function parseCodeBlocks(content: string): ParsedResult {
  const files: ParsedFile[] = [];
  const textParts: string[] = [];
  let lastIndex = 0;

  // Match fenced code blocks ```lang\ncode\n```
  const fenceRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let currentFileName = '';

  while ((match = fenceRegex.exec(content)) !== null) {
    const lang = match[1] || '';
    const code = match[2] || '';

    // Accumulate text before the code block
    if (match.index > lastIndex) {
      textParts.push(content.slice(lastIndex, match.index));
    }
    lastIndex = fenceRegex.lastIndex;

    // Check whether the first line is a file directive
    const lines = code.split('\n');
    const firstLine = lines[0] || '';
    const fileMatch = firstLine.match(FILE_DIRECTIVE_RE);

    let fileName = '';
    let codeContent = code;

    if (fileMatch) {
      fileName = fileMatch[1].trim();
      // Remove the file directive line
      codeContent = lines.slice(1).join('\n');
      currentFileName = fileName;
    } else if (currentFileName) {
      fileName = currentFileName;
      // The same file name applies only to the first unnamed code block
      currentFileName = '';
    }

    // Auto-infer the file name
    if (!fileName) {
      const ext = LANG_EXT[lang] || '.txt';
      fileName = `unnamed-${files.length + 1}${ext}`;
    }

    files.push({
      path: fileName,
      lang,
      code: codeContent,
    });
  }

  // Content after the last code block
  if (lastIndex < content.length) {
    textParts.push(content.slice(lastIndex));
  }

  const text = textParts.join('').replace(/\n{3,}/g, '\n\n').trim();

  return { files, text };
}

/**
 * Extract a single code segment from the response (no file structure)
 */
export function extractCodeBlocks(content: string): Array<{ lang: string; code: string }> {
  const results: Array<{ lang: string; code: string }> = [];
  const fenceRegex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    const lang = match[1] || '';
    let code = match[2] || '';

    // Remove the file directive line
    const lines = code.split('\n');
    if (lines[0] && FILE_DIRECTIVE_RE.test(lines[0])) {
      code = lines.slice(1).join('\n');
    }

    results.push({ lang, code });
  }

  return results;
}
