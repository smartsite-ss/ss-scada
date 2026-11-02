// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { shallowRef, onMounted, onUnmounted, type Ref } from 'vue';
import loader from '@monaco-editor/loader';
import type { ScriptEditorMode } from '../ScriptEditor.types';
import { themeManager } from '@scada-editor/core';

// Configure Monaco to use a stable version, avoiding possible performance regressions in the latest release
// 0.52.0 is the last stable annotated release before AMD builds were deprecated
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs',
  },
});

/** Determine whether an app theme name is dark or light */
function isDarkTheme(themeName: string): boolean {
  const darkThemes = new Set(['dark', 'techDarkBlue', 'blueDark', 'greenTech', 'highContrast']);
  return darkThemes.has(themeName);
}

export function useMonacoSetup(
  containerRef: Ref<HTMLElement | null>,
  _mode: ScriptEditorMode,
  value: Ref<string>,
  options?: {
    readonly?: boolean;
    editorOverrides?: Record<string, any>;
  },
) {
  // Store the Monaco instance in a shallowRef to prevent Vue3 deep reactive proxying
  // The Monaco editor / monaco objects are huge object trees; if wrapped by Vue3 ref() into
  // a reactive Proxy, it causes:
  //   1. Traversing the entire object tree to create Proxies at init → long main-thread blocking
  //   2. Every property access goes through Proxy getters triggering track() → severe runtime slowdown
  //   3. getValue()/setModelMarkers() calls inside the onDidChangeModelContent callback
  //      also pass through the Proxy layer, and the compounding effect can freeze the browser tab
  const editorRef = shallowRef<any>(null);
  const monacoRef = shallowRef<any>(null);
  let disposeEditor: (() => void) | null = null;
  let disposeTheme: (() => void) | null = null;

  const jsSyntaxRules = [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'comment.line', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'comment.block', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'keyword.control', foreground: 'C586C0' },
    { token: 'keyword.operator', foreground: 'D4D4D4' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'string.quote', foreground: 'CE9178' },
    { token: 'string.template', foreground: 'CE9178' },
    { token: 'string.escape', foreground: 'D7BA7D' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'number.hex', foreground: 'B5CEA8' },
    { token: 'number.float', foreground: 'B5CEA8' },
    { token: 'identifier', foreground: '9CDCFE' },
    { token: 'variable', foreground: '9CDCFE' },
    { token: 'variable.readonly', foreground: '4FC1FF' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'function', foreground: 'DCDCAA' },
    { token: 'method', foreground: 'DCDCAA' },
    { token: 'delimiter.parenthesis', foreground: 'FFD700' },
    { token: 'delimiter.bracket', foreground: 'FFD700' },
    { token: 'delimiter.brace', foreground: 'FFD700' },
    { token: 'delimiter.comma', foreground: 'D4D4D4' },
    { token: 'delimiter.period', foreground: 'D4D4D4' },
    { token: 'delimiter.semicolon', foreground: 'D4D4D4' },
    { token: 'regexp', foreground: 'D16969' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'keyword.boolean', foreground: '569CD6' },
    { token: 'keyword.null', foreground: '569CD6' },
    { token: 'api-keyword', foreground: '4FC1FF', fontStyle: 'bold' },
  ];

  async function initEditor() {
    if (!containerRef.value) return;

    const monaco = await loader.init();
    monacoRef.value = monaco;

    monaco.languages.setLanguageConfiguration('javascript', {
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '`', close: '`' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '`', close: '`' },
      ],
    });

    monaco.editor.defineTheme('scada-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: jsSyntaxRules,
      colors: {
        'editor.background': '#0f172a',
        'editor.foreground': '#e2e8f0',
        'editor.lineHighlightBackground': '#1e293b',
        'editor.selectionBackground': '#1e3a5f',
        'editorCursor.foreground': '#f1f5f9',
        'editorLineNumber.foreground': '#64748b',
        'editorLineNumber.activeForeground': '#94a3b8',
        'editorBracketMatch.background': '#1e3a5f',
        'editorBracketMatch.border': '#3b82f6',
        'editorSuggestWidget.background': '#1e293b',
        'editorSuggestWidget.selectedBackground': '#1e3a5f',
      },
    });

    monaco.editor.defineTheme('scada-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'comment.line', foreground: '008000', fontStyle: 'italic' },
        { token: 'comment.block', foreground: '008000', fontStyle: 'italic' },
        { token: 'keyword', foreground: '0000FF' },
        { token: 'keyword.control', foreground: 'AF00DB' },
        { token: 'keyword.operator', foreground: '000000' },
        { token: 'string', foreground: 'A31515' },
        { token: 'string.quote', foreground: 'A31515' },
        { token: 'string.template', foreground: 'A31515' },
        { token: 'string.escape', foreground: 'EE0000' },
        { token: 'number', foreground: '098658' },
        { token: 'number.hex', foreground: '098658' },
        { token: 'number.float', foreground: '098658' },
        { token: 'identifier', foreground: '001080' },
        { token: 'variable', foreground: '001080' },
        { token: 'variable.readonly', foreground: '0070C1' },
        { token: 'type.identifier', foreground: '267F99' },
        { token: 'function', foreground: '795E26' },
        { token: 'method', foreground: '795E26' },
        { token: 'delimiter.parenthesis', foreground: '000000' },
        { token: 'delimiter.bracket', foreground: '000000' },
        { token: 'delimiter.brace', foreground: '000000' },
        { token: 'delimiter.comma', foreground: '000000' },
        { token: 'delimiter.period', foreground: '000000' },
        { token: 'delimiter.semicolon', foreground: '000000' },
        { token: 'regexp', foreground: '811F3F' },
        { token: 'type', foreground: '267F99' },
        { token: 'keyword.boolean', foreground: '0000FF' },
        { token: 'keyword.null', foreground: '0000FF' },
        { token: 'api-keyword', foreground: '0070C1', fontStyle: 'bold' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#333333',
        'editor.lineHighlightBackground': '#f0f0f0',
        'editor.selectionBackground': '#add6ff',
        'editorCursor.foreground': '#000000',
        'editorLineNumber.foreground': '#999999',
        'editorLineNumber.activeForeground': '#333333',
        'editorBracketMatch.background': '#e0e0e0',
        'editorBracketMatch.border': '#2196F3',
        'editorSuggestWidget.background': '#ffffff',
        'editorSuggestWidget.selectedBackground': '#e8f0fe',
      },
    });

    // Choose the Monaco theme based on the current app theme
    const currentTheme = themeManager.getCurrentThemeName();
    const monacoTheme = isDarkTheme(currentTheme) ? 'scada-dark' : 'scada-light';

    const editor = monaco.editor.create(containerRef.value, {
      value: value.value,
      language: 'javascript',
      theme: monacoTheme,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontLigatures: true,
      minimap: { enabled: false },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on',
      bracketPairColorization: { enabled: true },
      matchBrackets: 'always',
      folding: true,
      foldingStrategy: 'indentation',
      renderWhitespace: 'selection',
      readOnly: options?.readonly ?? false,
      suggest: { showKeywords: true, showSnippets: true },
      ...options?.editorOverrides,
    });

    // Subscribe to app theme changes and keep the Monaco editor theme in sync
    disposeTheme = themeManager.subscribe((_theme) => {
      const newMonacoTheme = isDarkTheme(themeManager.getCurrentThemeName())
        ? 'scada-dark'
        : 'scada-light';
      monaco.editor.setTheme(newMonacoTheme);
    });

    editor.onDidChangeModelContent(() => {
      value.value = editor.getValue();
    });

    // ── Copy support ──
    // The Monaco Editor clipboard module may not work in some CDN environments or browsers,
    // breaking Ctrl+C / right-click copy. Three layers of mechanisms ensure copy works:
    //   1. Native copy event listener: capture the browser copy event and write the selected text
    //   2. Context-menu action: provide a reliable right-click copy entry
    //   3. execCommand fallback: degraded solution when the Clipboard API is unavailable

    // Listen to the native browser copy event and write the Monaco selected text to the clipboard
    const copyHandler = (e: ClipboardEvent) => {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        const text = editor.getModel()?.getValueInRange(selection);
        if (text) {
          e.clipboardData?.setData('text/plain', text);
          e.preventDefault();
        }
      }
    };
    containerRef.value.addEventListener('copy', copyHandler);

    // Context-menu copy command
    editor.addAction({
      id: 'scada-copy',
      label: 'Copy',
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 1,
      keybindings: [],
      run: (ed: any) => {
        copySelection(ed);
      },
    });

    function copySelection(ed: any) {
      const selection = ed.getSelection();
      if (selection && !selection.isEmpty()) {
        const text = ed.getModel()?.getValueInRange(selection);
        if (text) {
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
          } else {
            fallbackCopy(text);
          }
        }
      }
    }

    function fallbackCopy(text: string) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[Monaco] copy fallback failed:', err);
      }
      document.body.removeChild(textarea);
    }

    editorRef.value = editor;
    disposeEditor = () => {
      containerRef.value?.removeEventListener('copy', copyHandler);
      editor.dispose();
    };
  }

  function updateValue(newValue: string) {
    const editor = editorRef.value;
    if (editor && editor.getValue() !== newValue) {
      const position = editor.getPosition();
      editor.setValue(newValue);
      if (position) editor.setPosition(position);
    }
  }

  onMounted(() => {
    initEditor();
  });

  onUnmounted(() => {
    disposeEditor?.();
    disposeTheme?.();
  });

  return { editorRef, monacoRef, updateValue };
}