// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ScriptEditorMode, EditorDiagnostic } from '../ScriptEditor.types';

export function useScriptLint(
  monacoRef: { value: any },
  editorRef: { value: any },
  mode: ScriptEditorMode,
) {
  function setupLinting() {
    if (!monacoRef.value || !editorRef.value) return;

    const monaco = monacoRef.value;
    const editor = editorRef.value;

    // Initially clear the TS language service's semantic diagnostic markers (setupLinting is called 500ms later in onMounted,
    // by which time the TS service has completed its first diagnostics and the false markers on the initial template code already exist)
    const initialModel = editor.getModel();
    if (initialModel) {
      monaco.editor.setModelMarkers(initialModel, 'typescript', []);
      monaco.editor.setModelMarkers(initialModel, 'javascript', []);
    }

    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;

      const markers: any[] = [];

      if (mode === 'filter') {
        const code = model.getValue();
        if (!/return\s+/.test(code)) {
          markers.push({
            severity: monaco.MarkerSeverity.Warning,
            message: 'filter 模式缺少 return 语句，建议添加: return data;',
            startLineNumber: model.getLineCount(),
            startColumn: 1,
            endLineNumber: model.getLineCount(),
            endColumn: model.getLineMaxColumn(model.getLineCount()),
            source: 'ScriptEngine',
          });
        }
      }

      monaco.editor.setModelMarkers(model, 'script-engine', markers);

      // Clear the semantic diagnostic markers of Monaco's built-in TS language service
      // (e.g. custom APIs like showGraphic and readTag being falsely reported as "undefined")
      // Use setTimeout to ensure the markers are cleared after the TS service finishes diagnosing
      setTimeout(() => {
        if (monacoRef.value && editorRef.value) {
          const m = editorRef.value.getModel();
          if (m) {
            const monacoInst = monacoRef.value;
            monacoInst.editor.setModelMarkers(m, 'typescript', []);
            monacoInst.editor.setModelMarkers(m, 'javascript', []);
          }
        }
      }, 50);
    });
  }

  function validate(): { valid: boolean; errors: EditorDiagnostic[] } {
    if (!monacoRef.value || !editorRef.value) {
      return { valid: true, errors: [] };
    }

    const monaco = monacoRef.value;
    const model = editorRef.value.getModel();
    if (!model) return { valid: true, errors: [] };

    const markers = monaco.editor.getModelMarkers({ owner: 'script-engine' });
    const errors: EditorDiagnostic[] = markers.map((m: any) => ({
      line: m.startLineNumber,
      column: m.startColumn,
      message: m.message,
      severity: m.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning',
    }));

    return { valid: errors.filter((e) => e.severity === 'error').length === 0, errors };
  }

  return { setupLinting, validate };
}