<template>
  <div
    class="script-editor"
    :style="{ height: normalizedHeight }"
    @keydown="handleKeydown"
  >
    <!-- Toolbar -->
    <ScriptToolbar
      v-if="showToolbar"
      :mode="mode"
      :show-knowledge="showKnowledgePanel"
      @format="formatCode"
      @toggle-comment="toggleComment"
      @insert-snippet="insertSnippet"
      @save="handleSave"
      @toggle-knowledge="showKnowledgePanel = !showKnowledgePanel"
    />

    <!-- Main editing area: editor + debug panel (left-right layout) -->
    <div
      class="script-editor-body"
      :class="{ 'has-toolbar': showToolbar }"
    >
      <!-- Editor container -->
      <div
        ref="editorContainerRef"
        class="editor-container"
      />

      <!-- API reference panel -->
      <ScriptApiPanel
        v-if="showApiPanel"
        :mode="mode"
        class="api-side-panel"
        @insert="insertSnippet"
      />

      <!-- Knowledge-base panel -->
      <ScriptKnowledgePanel
        v-if="showKnowledgePanel"
        class="knowledge-side-panel"
        @insert-snippet="insertSnippet"
      />

      <!-- Debug panel (right) -->
      <ScriptDebugPanel
        v-if="debugPanelVisible"
        class="debug-side-panel"
        :valid="lintValid"
        :errors="lintErrors"
        :is-running="isRunning"
        :result="testResult"
        @close="debugPanelVisible = false"
        @run-test="handleTestRun"
        @reset="handleTestReset"
      />
    </div>

    <!-- Placeholder override -->
    <div
      v-if="placeholder && !modelValue"
      class="editor-placeholder"
    >
      {{ placeholder }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import type { ScriptEditorProps, ScriptEditorEmits, ScriptEditorExpose, TestRunResult, EditorDiagnostic } from './ScriptEditor.types';
import { useMonacoSetup } from './composables/useMonacoSetup';
import { useScriptCompletion } from './composables/useScriptCompletion';
import { useScriptLint } from './composables/useScriptLint';
import { useScriptDebug } from './composables/useScriptDebug';
import { useScriptTemplates } from './composables/useScriptTemplates';
import ScriptToolbar from './panels/ScriptToolbar.vue';
import ScriptApiPanel from './panels/ScriptApiPanel.vue';
import ScriptKnowledgePanel from './panels/ScriptKnowledgePanel.vue';
import ScriptDebugPanel from './panels/ScriptDebugPanel.vue';

const props = withDefaults(defineProps<ScriptEditorProps>(), {
  height: '300px',
  readonly: false,
  showToolbar: true,
  showDebugPanel: true,
  showApiPanel: false,
  mockData: () => ({}),
  mockContext: () => ({}),
  engine: 'monaco',
  extraCompletions: () => [],
  editorOverrides: () => ({}),
});

const emit = defineEmits<ScriptEditorEmits>();

const editorContainerRef = ref<HTMLElement | null>(null);
const modelValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const normalizedHeight = computed(() => {
  if (typeof props.height === 'number') return `${props.height}px`;
  return props.height;
});

// Composable instance
const valueRef = ref(props.modelValue);
watch(() => props.modelValue, (v) => { valueRef.value = v; });

const { editorRef, monacoRef, updateValue } = useMonacoSetup(
  editorContainerRef,
  props.mode,
  valueRef,
  { readonly: props.readonly, editorOverrides: props.editorOverrides },
);

const completion = useScriptCompletion(monacoRef, editorRef, props.mode);
const lint = useScriptLint(monacoRef, editorRef, props.mode);
const debug = useScriptDebug(props.mode);
const _templates = useScriptTemplates(props.mode);

const lintValid = ref(true);
const lintErrors = ref<EditorDiagnostic[]>([]);
const debugPanelVisible = ref(props.showDebugPanel);
const showKnowledgePanel = ref(false);
const isRunning = computed(() => debug.isRunning.value);
const testResult = computed(() => debug.testResult.value);

let completionDisposer: any = null;

onMounted(() => {
  // Defer registration until Monaco is ready
  setTimeout(() => {
    if (monacoRef.value) {
      completionDisposer = completion.register();
      lint.setupLinting();
    }
  }, 500);
});

onUnmounted(() => {
  completion.dispose();
  completionDisposer?.dispose?.();
});

// ═══ Exposed methods ═══

function getValue(): string {
  return editorRef.value?.getValue() ?? valueRef.value;
}

function setValue(val: string): void {
  valueRef.value = val;
  updateValue(val);
  emit('update:modelValue', val);
}

function formatCode(): void {
  editorRef.value?.getAction('editor.action.formatDocument')?.run();
}

/**
 * Safely defer editor operations.
 * Uses setTimeout delay to ensure the browser fully processes the click event before operating the editor.
 * Note: requestAnimationFrame is not used because rAF may be blocked while the native select dropdown is closing.
 */
function deferEditorOp(fn: () => void, delayMs: number = 100) {
  setTimeout(fn, delayMs);
}

function insertSnippet(snippet: string): void {
  // Operate Monaco's underlying text model (ITextModel) directly, fully bypassing the editor pipeline.
  // executeEdits / trigger('type') / setPosition all go through the editor pipeline,
  // Involves: syntax re-parse → view reflow → scroll calculation → decorator update → undo stack → Marker update
  // These steps, combined with the current component + lint + completion, cause the main thread to block.
  //
  // model.applyEdits() only triggers model changes and onDidChangeModelContent,
  // Does not trigger view update or move the cursor. Undo behavior is managed by applyEdits itself.
  const editor = editorRef.value;
  if (!editor) return;

  const model = editor.getModel();
  if (!model) return;

  const existingCode = model.getValue().trim();
  const snippetWithSemicolon = snippet.endsWith(';') ? snippet : snippet + ';';

  let textToInsert: string;
  let insertRange: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };

  if (existingCode.length > 0) {
    // Existing code: append ";" at the end of the last line, then insert the new code on a new line
    const lastLine = model.getLineCount();
    const lastColumn = model.getLineMaxColumn(lastLine);
    const lastLineContent = model.getLineContent(lastLine).trimEnd();
    const needsSemicolon = !lastLineContent.endsWith(';');

    textToInsert = (needsSemicolon ? ';' : '') + '\n' + snippetWithSemicolon;
    insertRange = {
      startLineNumber: lastLine,
      startColumn: lastColumn,
      endLineNumber: lastLine,
      endColumn: lastColumn,
    };
  } else {
    // Empty editor: insert directly
    textToInsert = snippetWithSemicolon;
    insertRange = {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    };
  }

  model.applyEdits([
    {
      range: insertRange,
      text: textToInsert,
    },
  ]);
}

function toggleComment(): void {
  editorRef.value?.getAction('editor.action.commentLine')?.run();
}

function undo(): void {
  editorRef.value?.trigger('keyboard', 'undo', null);
}

function redo(): void {
  editorRef.value?.trigger('keyboard', 'redo', null);
}

function focus(): void {
  editorRef.value?.focus();
}

function validate(): { valid: boolean; errors: EditorDiagnostic[] } {
  const result = lint.validate();
  lintValid.value = result.valid;
  lintErrors.value = result.errors;
  return result;
}

async function testRun(mockData?: Record<string, any>): Promise<TestRunResult> {
  const code = getValue();
  const data = mockData ?? props.mockData ?? {};
  const result = await debug.runTest(code, data, props.mockContext);
  emit('execute', result);
  return result;
}

function handleTestRun(testData: Record<string, any>): void {
  // Defer test execution to avoid synchronously operating Monaco Editor in the click handler and freezing the browser
  deferEditorOp(() => {
    testRun(testData);
  });
}

/**
 * Ctrl+S saves the script — prevents the browser's default "保存网页" dialog
 */
function handleKeydown(event: KeyboardEvent): void {
  const isCtrlS = (event.ctrlKey || event.metaKey) && event.key === 's';
  if (isCtrlS) {
    event.preventDefault();
    handleSave();
  }
}

function handleSave(): void {
  // Defer save execution to avoid synchronously calling getValue() in the click handler and freezing the browser
  deferEditorOp(() => {
    const value = getValue();
    emit('save', value);
  });
}

function handleTestReset(): void {
  debug.testResult.value = null;
  debug.error.value = null;
}

function getEditorInstance(): any {
  return editorRef.value;
}

defineExpose<ScriptEditorExpose>({
  getValue,
  setValue,
  formatCode,
  insertSnippet,
  undo,
  redo,
  focus,
  validate,
  testRun,
  getEditorInstance,
});
</script>

<style scoped>
.script-editor {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--background);
  min-height: 200px;
}

.script-editor-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.editor-container {
  flex: 1;
  min-width: 0;
}

.api-side-panel {
  width: 240px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  transition: width 0.15s;
}

.knowledge-side-panel {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  transition: width 0.15s;
}

.debug-side-panel {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  overflow-y: auto;
  transition: width 0.15s;
}

/* ── Responsive side panel ── */
@media (max-width: 1200px) {
  .api-side-panel {
    width: 180px;
  }
  .knowledge-side-panel {
    width: 260px;
  }
  .debug-side-panel {
    width: 220px;
  }
}

@media (max-width: 1000px) {
  .api-side-panel {
    width: 160px;
  }
  .knowledge-side-panel {
    width: 220px;
  }
  .debug-side-panel {
    width: 200px;
  }
}

@media (max-width: 700px) {
  .api-side-panel {
    display: none;
  }
  .knowledge-side-panel {
    display: none;
  }
  .debug-side-panel {
    width: 180px;
  }
}

.editor-placeholder {
  position: absolute;
  top: 48px;
  left: 68px;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  pointer-events: none;
  user-select: none;
}
</style>