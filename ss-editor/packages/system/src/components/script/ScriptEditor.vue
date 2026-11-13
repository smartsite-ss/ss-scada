<template>
  <div
    class="script-editor"
    :style="{ height: normalizedHeight }"
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
 * Uses requestAnimationFrame + setTimeout double delay
 * to ensure the browser fully processes the click event before operating the editor, avoiding main-thread deadlock.
 */
function deferEditorOp(fn: () => void, delayMs: number = 30) {
  requestAnimationFrame(() => {
    setTimeout(fn, delayMs);
  });
}

function insertSnippet(snippet: string): void {
  const editor = editorRef.value;
  if (!editor) return;

  const selection = editor.getSelection();
  editor.executeEdits('snippet', [{
    range: selection,
    text: snippet,
  }]);
  // Use double delay to focus the editor, ensuring the native dropdown is fully closed before focusing,
  // Avoid a focus race with the select dropdown's close operation that freezes the browser
  deferEditorOp(() => {
    editor.focus();
  });
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

function handleTestReset(): void {
  debug.testResult.value = null;
  debug.error.value = null;
}

function handleSave(): void {
  emit('save', getValue());
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
}

.knowledge-side-panel {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
}

.debug-side-panel {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  overflow-y: auto;
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