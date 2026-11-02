// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { shallowRef, onMounted, onUnmounted, type Ref } from 'vue';
import loader from '@monaco-editor/loader';
import { themeManager } from '@scada-editor/core';
import { useKnowledgeBase } from './useKnowledgeBase';

// Configure Monaco to use a stable version, avoiding possible performance regressions in the latest release
// 0.52.0 is the last stable annotated version before the AMD build deprecation
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs',
  },
});

// ── Theme name mapping ──
// App theme names (kebab-case from themeManager / plugin-sdk)
const DARK_THEMES = new Set(['dark', 'tech-dark-blue', 'blue-dark', 'green-tech', 'high-contrast']);

function isDarkTheme(themeName: string): boolean {
  return DARK_THEMES.has(themeName);
}

// ── Dynamic color reading ──
// Read colors from CSS variables, keeping the Monaco editor fully consistent with the current app theme.
// When the user switches themes (e.g. dark → tech-dark-blue → green-tech), the CSS variables
// --background / --text / --surface etc. update synchronously, and Monaco colors follow.
function readCSSVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function buildMonacoThemeColors(isDark: boolean): Record<string, string> {
  if (isDark) {
    return {
      'editor.background': readCSSVar('--background', '#0f172a'),
      'editor.foreground': readCSSVar('--text', '#e2e8f0'),
      'editor.lineHighlightBackground': readCSSVar('--surface', '#1e293b'),
      'editor.selectionBackground': readCSSVar('--border-focus', '#1e3a5f'),
      'editorCursor.foreground': readCSSVar('--text', '#f1f5f9'),
      'editorLineNumber.foreground': readCSSVar('--text-tertiary', '#64748b'),
      'editorLineNumber.activeForeground': readCSSVar('--text-secondary', '#94a3b8'),
      'editorBracketMatch.background': readCSSVar('--surface', '#1e3a5f'),
      'editorBracketMatch.border': readCSSVar('--primary', '#3b82f6'),
      'editorSuggestWidget.background': readCSSVar('--elevated', '#1e293b'),
      'editorSuggestWidget.selectedBackground': readCSSVar('--border-focus', '#1e3a5f'),
    };
  }
  // Light theme
  return {
    'editor.background': readCSSVar('--background', '#ffffff'),
    'editor.foreground': readCSSVar('--text', '#333333'),
    'editor.lineHighlightBackground': readCSSVar('--surface', '#f0f0f0'),
    'editor.selectionBackground': readCSSVar('--border-focus', '#add6ff'),
    'editorCursor.foreground': readCSSVar('--text', '#000000'),
    'editorLineNumber.foreground': readCSSVar('--text-tertiary', '#999999'),
    'editorLineNumber.activeForeground': readCSSVar('--text-secondary', '#333333'),
    'editorBracketMatch.background': readCSSVar('--surface', '#e0e0e0'),
    'editorBracketMatch.border': readCSSVar('--primary', '#2196F3'),
    'editorSuggestWidget.background': readCSSVar('--elevated', '#ffffff'),
    'editorSuggestWidget.selectedBackground': readCSSVar('--surface', '#e8f0fe'),
  };
}

// ── Syntax highlighting rules (dark/light share the token → color mapping) ──
const jsSyntaxRulesDark = [
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

const jsSyntaxRulesLight = [
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
];

/** Register (or update) the Monaco dark/light themes, with colors read dynamically from CSS variables */
function defineMonacoThemes(monaco: any, isDark: boolean): void {
  if (isDark) {
    monaco.editor.defineTheme('scada-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: jsSyntaxRulesDark,
      colors: buildMonacoThemeColors(true),
    });
  } else {
    monaco.editor.defineTheme('scada-light', {
      base: 'vs',
      inherit: true,
      rules: jsSyntaxRulesLight,
      colors: buildMonacoThemeColors(false),
    });
  }
}

export function useMonacoSetup(
  containerRef: Ref<HTMLElement | null>,
  _mode: unknown,
  value: Ref<string>,
  options?: {
    readonly?: boolean;
    editorOverrides?: Record<string, any>;
  },
) {
  // Store the Monaco instance with shallowRef, preventing Vue3 deep reactive proxying
  // The Monaco editor / monaco objects are huge object trees; if deeply wrapped
  // as reactive Proxies by Vue3's ref(), it would cause:
  //   1. Walking the entire object tree to create Proxies at init → long main-thread blocking
  //   2. Every property access passing through Proxy getters triggering track() → drastic runtime performance degradation
  //   3. getValue()/setModelMarkers() calls inside the onDidChangeModelContent callback
  //      passing through Proxy layers repeatedly, compounding into a frozen browser tab
  const editorRef = shallowRef<any>(null);
  const monacoRef = shallowRef<any>(null);
  let disposeEditor: (() => void) | null = null;
  let disposeTheme: (() => void) | null = null;
  let disposed = false;

  async function initEditor() {
    if (!containerRef.value || disposed) return;

    // Load the knowledge base at init (if not yet loaded)
    const { loadKb } = useKnowledgeBase();
    await loadKb();

    const monaco = await loader.init();
    if (disposed) return;
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

    // Disable JavaScript semantic diagnostics, avoiding the built-in TS language service misreporting script APIs
    // (e.g. showGraphic, readTag and other custom APIs being flagged as "undefined")
    try {
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: true,
      });
    } catch {
      // monaco.languages.typescript may not be loaded (lazy loading); ignore
    }

    // Add global type declarations for Monaco's TS/JS language service so custom APIs are no longer flagged as "undefined"
    // This is the root fix for the "6 log entries" error: declare all script APIs as globals
    try {
      const scriptApiDeclarations = `
// 脚本引擎 API 类型声明 — 使 Monaco 不将自定义 API 误报为未定义
declare var api: {
  readTag(tagId: string): any;
  writeTag(tagId: string, value: any): void;
  getTagQuality(tagId: string): string;
  setGraphicProps(graphicId: string, props: Record<string, any>): void;
  showGraphic(graphicId: string): void;
  hideGraphic(graphicId: string): void;
  moveGraphic(graphicId: string, x: number, y: number): void;
  rotateGraphic(graphicId: string, angle: number): void;
  triggerAlarm(config: { tagId: string; level: string; message: string }): void;
  acknowledgeAlarm(alarmId: string): void;
  clearAlarm(alarmId: string): void;
  getActiveAlarms(): any[];
  switchPage(pageId: string): void;
  getCurrentPageId(): string;
  fetch(url: string, options?: any): Promise<any>;
  sleep(ms: number): Promise<void>;
  notify(message: string, level?: string): void;
  log(level: string, message: string): void;
  round(value: number, decimals?: number): number;
  clamp(value: number, min: number, max: number): number;
  mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  colorForValue(v: number, min?: number, max?: number): string;
  isAlarm(v: number, high: number, low?: number): boolean;
};

declare var event: {
  graphicId: string;
  x: number;
  y: number;
  type: string;
  timestamp: number;
};

declare var context: {
  graphicId: string;
  tagValues: Record<string, any>;
  triggerType: string;
  event: any;
};

declare var graphic: any;
declare var data: any;
`;
      monaco.languages.typescript.javascriptDefaults.addExtraLib(
        scriptApiDeclarations,
        'ts:scada-script-api.d.ts',
      );
    } catch {
      // monaco.languages.typescript may not be loaded (lazy loading); ignore
    }

    // Register both themes (scada-dark / scada-light), with colors read dynamically from CSS variables
    // See buildMonacoThemeColors / defineMonacoThemes at the top of this module
    defineMonacoThemes(monaco, true);
    defineMonacoThemes(monaco, false);

    // Pick the Monaco theme based on the current app theme
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

    // Clear the TS/JS language service's initial diagnostic markers right after editor creation
    // Cleared twice: once synchronously (catching already-completed diagnostics), once delayed (catching async diagnostics)
    const clearModel = editor.getModel();
    if (clearModel) {
      monaco.editor.setModelMarkers(clearModel, 'typescript', []);
      monaco.editor.setModelMarkers(clearModel, 'javascript', []);
    }
    setTimeout(() => {
      if (disposed) return;
      const m = editor.getModel();
      if (m) {
        monaco.editor.setModelMarkers(m, 'typescript', []);
        monaco.editor.setModelMarkers(m, 'javascript', []);
      }
    }, 200);

    // Subscribe to app theme changes and sync the Monaco editor theme
    // Each theme switch redefines the theme colors (since the CSS variables have updated),
    // ensuring the Monaco editor always matches the app theme colors
    disposeTheme = themeManager.subscribe((_theme) => {
      if (disposed) return;
      const isDark = isDarkTheme(themeManager.getCurrentThemeName());
      // Redefine the theme: read colors from the latest CSS variables
      defineMonacoThemes(monaco, isDark);
      // Apply the switch
      monaco.editor.setTheme(isDark ? 'scada-dark' : 'scada-light');
    });

    editor.onDidChangeModelContent(() => {
      if (disposed) return;
      // Use a microtask to defer getValue(), avoiding synchronously reading the entire model content
      // inside the model change event and blocking the main thread (especially for large scripts or complex tokens)
      Promise.resolve().then(() => {
        if (disposed) return;
        value.value = editor.getValue();
      });
    });

    // ── Copy support ──
    // Monaco Editor's clipboard module may not work correctly in some CDN environments or browsers,
    // making Ctrl+C / right-click copy unavailable. The following three-layer mechanism ensures copy works:
    //   1. Native copy event listener: capture the browser copy event and write the selected text
    //   2. Context-menu action: provide a reliable right-click copy entry
    //   3. execCommand fallback: the degradation plan when the Clipboard API is unavailable

    // Listen to the browser's native copy event and write Monaco's selected text to the clipboard
    const copyHandler = (e: ClipboardEvent) => {
      if (disposed) return;
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
        if (disposed) return;
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
        console.warn('[Monaco] copy fallback failed:', err);
      }
      document.body.removeChild(textarea);
    }

    editorRef.value = editor;
    disposeEditor = () => {
      disposed = true;
      containerRef.value?.removeEventListener('copy', copyHandler);
      editor.dispose();
    };
  }

  function updateValue(newValue: string) {
    if (disposed) return;
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
    disposed = true;
    disposeEditor?.();
    disposeTheme?.();
  });

  return { editorRef, monacoRef, updateValue };
}