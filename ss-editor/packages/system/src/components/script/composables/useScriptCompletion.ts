// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { getCompletionsByMode } from '../utils/completionData';
import type { ScriptEditorMode } from '../ScriptEditor.types';

/**
 * Context-aware prefix mapping: filter completion items by input prefix
 * For example: typing `api.` shows only api.* methods
 */
const CONTEXT_PREFIXES: Record<string, string> = {
  'api.': 'api.',
  'data.': 'data',
  'context.': 'context',
  'event.': 'event',
  'page.': 'page',
  'timer.': 'timer',
  'utils.': 'utils',
};

export function useScriptCompletion(
  monacoRef: { value: any },
  editorRef: { value: any },
  mode: ScriptEditorMode,
) {
  let disposed = false;
  // Cache completion data to avoid recomputing on every input
  const completionItems = getCompletionsByMode(mode);

  function register() {
    if (!monacoRef.value || !editorRef.value) return;

    const monaco = monacoRef.value;

    const provider = monaco.languages.registerCompletionItemProvider('javascript', {
      triggerCharacters: ['.', '(', '"', "'"],

      provideCompletionItems(model: any, position: any) {
        if (disposed) return { suggestions: [] };

        const word = model.getWordUntilPosition(position);
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Context-aware filtering: show only relevant completion items based on the input prefix
        const filteredItems = filterByContext(completionItems, textBeforeCursor);

        const suggestions = filteredItems.map((item) => ({
          label: item.label,
          kind: getCompletionKind(monaco, item.kind),
          detail: item.detail,
          documentation: item.documentation,
          insertText: item.insertText,
          insertTextRules: item.kind === 'snippet'
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          range,
          sortText: item.sortText ?? 'z',
        }));

        return { suggestions };
      },
    });

    return provider;
  }

  /**
   * Filter completion items by input context
   * - Typing `api.` → show only api.* methods
   * - Typing `data.` → show only data-related items
   * - Otherwise → show all
   */
  function filterByContext(items: any[], textBeforeCursor: string): any[] {
    for (const [suffix, prefix] of Object.entries(CONTEXT_PREFIXES)) {
      if (textBeforeCursor.endsWith(suffix)) {
        return items.filter((item) => item.label.startsWith(prefix));
      }
    }
    return items;
  }

  function getCompletionKind(monaco: any, kind: string): number {
    const Kind = monaco.languages.CompletionItemKind;
    const map: Record<string, number> = {
      function: Kind.Function,
      variable: Kind.Variable,
      snippet: Kind.Snippet,
      keyword: Kind.Keyword,
    };
    return map[kind] ?? Kind.Function;
  }

  function dispose() {
    disposed = true;
  }

  return { register, dispose };
}