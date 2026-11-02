// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref } from 'vue';
import type { ScriptEditorMode, TestRunResult } from '../ScriptEditor.types';
import { executeInWorker } from '../utils/scriptWorker';
import { usePageStore } from '@scada-editor/core';

export function useScriptDebug(mode: ScriptEditorMode) {
  const testResult = ref<TestRunResult | null>(null);
  const isRunning = ref(false);
  const error = ref<string | null>(null);
  const pageStore = usePageStore();

  async function runTest(
    code: string,
    mockData: Record<string, any> = {},
    mockContext: Record<string, any> = {},
  ): Promise<TestRunResult> {
    isRunning.value = true;
    error.value = null;

    // Use setTimeout(0) so the Vue reactive update renders to the DOM first,
    // ensuring the button switches to "Running..." before the script executes
    await new Promise<void>((r) => setTimeout(r, 0));

    const wrappedCode = wrapScript(code, mode);
    const startTime = performance.now();

    try {
      // Execute the script in a Web Worker background thread for true non-blocking execution
      // The Worker is terminated on timeout, so the main thread never hangs
      const workerResult = await executeInWorker(
        {
          script: wrappedCode,
          tagValues: mockData ?? {},
          graphicId: mockContext?.graphicId ?? 'test-graphic',
          event: mockContext?.event ?? undefined,
        },
        5000,
        // Real-time API callback: sync graphic operations from the Worker to the page
        (method, args) => {
          const page = pageStore.currentPage;
          if (!page) return;
          switch (method) {
            case 'moveGraphic':
              page.moveGraphic(args[0], args[1], args[2]);
              break;
            case 'setGraphicProps':
              page.updateGraphic(args[0], args[1]);
              break;
            case 'showGraphic':
              page.updateGraphic(args[0], { visible: true });
              break;
            case 'hideGraphic':
              page.updateGraphic(args[0], { visible: false });
              break;
          }
        },
      );

      const executionTime = workerResult.executionTime > 0
        ? workerResult.executionTime
        : performance.now() - startTime;

      const result: TestRunResult = {
        success: workerResult.success,
        output: workerResult.output,
        error: workerResult.error,
        executionTime,
        apiCalls: workerResult.apiCalls,
        timestamp: Date.now(),
      };

      testResult.value = result;
      if (!result.success) {
        error.value = result.error ?? null;
      }
      return result;
    } catch (e: any) {
      const result: TestRunResult = {
        success: false,
        error: e.message ?? String(e),
        apiCalls: [],
        executionTime: performance.now() - startTime,
        timestamp: Date.now(),
      };
      testResult.value = result;
      error.value = e.message;
      return result;
    } finally {
      isRunning.value = false;
    }
  }

  function wrapScript(code: string, editorMode: ScriptEditorMode): string {
    switch (editorMode) {
      case 'filter':
        return `function filter(data, res) {\n${code}\n}\nconst result = filter(context.tagValues, {});\nresult;`;
      case 'driver':
        return code;
      case 'interaction':
        return code;
      case 'timer':
        return code;
      case 'expression':
        return code;
      default:
        return code;
    }
  }

  return { testResult, isRunning, error, runTest };
}