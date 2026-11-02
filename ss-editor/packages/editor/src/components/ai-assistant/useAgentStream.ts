// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * useAgentStream — P1-T04 Agent SSE stream + frontend tool execution Composable
 *
 * Consumes the SSE stream of the backend ReAct orchestration and automatically handles frontend tool delegation:
 *   1. POST /api/v1/ai/agent/execute → start the SSE stream
 *   2. Parse AgentStep chunks (thought / action / observation / pending / answer / error)
 *   3. On a delegateToFrontend action: call ToolExecutor to run the real tool
 *   4. On pending: POST the tool result back to /api/v1/ai/agent/execute (sessionId + toolResultPayload)
 *   5. Loop until answer or error
 *
 * Usage:
 *   const { execute, abort } = useAgentStream({
 *     onThought: (step) => { ... },
 *     onAnswer: (step) => { ... },
 *     onError: (step) => { ... },
 *   });
 *   await execute('Help me create a pump station page');
 */

import { ref, readonly } from 'vue';
import {
  type ChatMessage,
} from '@scada-editor/core';
import { toolExecutor } from '@scada-editor/core';

const TOKEN_KEY = 'scada_access_token';
const API_BASE = '/api/v1/ai';

/**
 * S-C03: the Token is transmitted via HttpOnly Cookie; getToken() is only for compatibility fallback.
 * Authentication relies on fetch's credentials: 'include' (see the fetch call in execute()).
 */
function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Agent execution steps (corresponding to the backend AgentStep)
export interface AgentStreamStep {
  type: 'thought' | 'action' | 'observation' | 'answer' | 'error' | 'pending';
  content: string;
  step: number;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: string;
  delegateToFrontend?: boolean;
  sessionId?: string;
  timestamp: number;
  /** Conversation persistence session ID (injected by the backend in answer/error steps) */
  conversationId?: string;
}

export interface AgentStreamCallbacks {
  onThought?: (step: AgentStreamStep) => void;
  onAction?: (step: AgentStreamStep) => void;
  onObservation?: (step: AgentStreamStep) => void;
  onPending?: (step: AgentStreamStep) => void;
  onAnswer?: (step: AgentStreamStep) => void;
  onError?: (step: AgentStreamStep) => void;
}

export interface AgentStreamOptions extends AgentStreamCallbacks {
  /** Max tool execution rounds (default 30) */
  maxRoundtrips?: number;
}

/** Agent execution request body */
interface AgentExecuteBody {
  userInput: string;
  context?: string;
  intent?: string;
  complexity?: 'simple' | 'complex';
  history?: ChatMessage[];
  sessionId?: string;
  toolResultPayload?: { toolName: string; result: string };
  /** Conversation persistence session ID (auto-created by the backend when omitted) */
  conversationId?: string;
  /** Project ID (used when creating a new session) */
  projectId?: string;
}

export function useAgentStream(callbacks: AgentStreamCallbacks = {}) {
  const isStreaming = ref(false);
  const error = ref<string | null>(null);
  const currentStep = ref(0);

  let abortController: AbortController | null = null;

  /**
   * Execute the Agent orchestration (including the automatic tool result loop)
   *
   * Persistence strategy (P2-T08):
   *   - On first execution, pass conversationId (if any) + projectId; the backend creates/reuses the session accordingly
   *   - The backend injects conversationId in answer/error steps; the frontend updates currentConversationId accordingly
   *   - Continued execution (tool result round trips) also carries conversationId, ensuring the backend does not duplicate sessions
   *
   * @param userInput user input
   * @param intent intent type
   * @param context editor context
   * @param conversationId conversation persistence session ID (auto-created by the backend when omitted)
   * @param projectId project ID (used when creating a new session)
   * @returns the final AgentStep (answer or error, with conversationId)
   */
  async function execute(
    userInput: string,
    intent?: string,
    context?: string,
    conversationId?: string,
    projectId?: string,
  ): Promise<AgentStreamStep> {
    if (isStreaming.value) {
      throw new Error('Agent is already running');
    }

    error.value = null;
    isStreaming.value = true;
    currentStep.value = 0;
    abortController = new AbortController();

    let body: AgentExecuteBody = {
      userInput,
      intent,
      complexity: 'complex',
      context,
      conversationId,
      projectId,
    };

    let roundtrip = 0;
    const maxRoundtrips = 30;

    try {
      // Loop: each time a pending step appears, execute the tool on the frontend and send back the result
      while (roundtrip < maxRoundtrips) {
        roundtrip++;

        // Call the backend agent/execute
        // S-C03: the Token is transmitted automatically via HttpOnly Cookie (credentials: 'include')
        const token = getToken();
        if (!token) {
          console.debug('[useAgentStream] Token not in localStorage (using HttpOnly Cookie auth)');
        }

        const resp = await fetch(
          `${API_BASE}/agent/execute`,
          {
            method: 'POST',
            // S-C03: carry HttpOnly Cookie credentials
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              ...authHeaders(),
            },
            body: JSON.stringify(body),
            signal: abortController.signal,
          },
        );

        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'Unknown error');
          console.error(`[useAgentStream] Agent request failed: ${resp.status} ${resp.statusText}`, errText);
          throw new Error(`Agent 请求失败 (${resp.status}): ${errText.substring(0, 200)}`);
        }

        // Parse the SSE stream
        const reader = resp.body?.getReader();
        if (!reader) {
          throw new Error('SSE response body is not readable');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let nextBody: AgentExecuteBody | null = null;
        let currentEvent = ''; // track the SSE event: line

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          console.log(`[useAgentStream] Raw chunk (${chunk.length} chars):`, chunk.substring(0, 500));
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // keep the incomplete line

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
              currentEvent = ''; // blank line marks the end of an SSE event, reset event
              continue;
            }
            if (trimmed === 'data: [DONE]') {
              console.log('[useAgentStream] Received [DONE]');
              continue;
            }

            // Track the event: line
            if (trimmed.startsWith('event: ')) {
              currentEvent = trimmed.slice(7).trim();
              console.log(`[useAgentStream] SSE event type: "${currentEvent}"`);
              continue;
            }

            // SSE comment line (e.g. heartbeat), skip
            if (trimmed.startsWith(':')) continue;

            if (!trimmed.startsWith('data: ')) continue;

            // Handle the backend-sent event: error
            if (currentEvent === 'error') {
              try {
                const errData = JSON.parse(trimmed.slice(6));
                const errStep: AgentStreamStep = {
                  type: 'error',
                  content: errData.message || 'Unknown error',
                  step: currentStep.value + 1,
                  timestamp: Date.now(),
                };
                error.value = errStep.content;
                callbacks.onError?.(errStep);
                currentEvent = '';
                return errStep;
              } catch {
                // JSON parse failed; continue trying normal parsing
              }
            }

            currentEvent = '';

            try {
              const step: AgentStreamStep = JSON.parse(trimmed.slice(6));
              console.log(`[useAgentStream] Parsed step type="${step.type}" step=${step.step}`);
              currentStep.value = step.step;

              // Fire the callbacks
              switch (step.type) {
                case 'thought':
                  callbacks.onThought?.(step);
                  break;
                case 'action':
                  callbacks.onAction?.(step);
                  // If frontend delegation is marked, execute the real tool
                  if (step.delegateToFrontend && step.toolName && step.toolParams && step.sessionId) {
                    let resultText: string;
                    try {
                      const result = await toolExecutor.execute(step.toolName, step.toolParams);
                      resultText = result.success
                        ? JSON.stringify(result.data || { ok: true })
                        : `Error: ${result.error}`;
                    } catch (err) {
                      resultText = `工具执行错误: ${(err as Error).message}`;
                    }

                    // Prepare the result payload (carrying conversationId/projectId to ensure continued execution does not duplicate sessions)
                    nextBody = {
                      userInput,
                      intent,
                      sessionId: step.sessionId,
                      toolResultPayload: {
                        toolName: step.toolName,
                        result: resultText,
                      },
                      conversationId,
                      projectId,
                    };
                  }
                  break;
                case 'observation':
                  callbacks.onObservation?.(step);
                  break;
                case 'pending':
                  callbacks.onPending?.(step);
                  break;
                case 'answer':
                  callbacks.onAnswer?.(step);
                  return step;
                case 'error':
                  callbacks.onError?.(step);
                  return step;
              }
            } catch {
              // Ignore parse errors (invalid JSON lines)
            }
          }
        }

        // Handle the tool result round trip
        if (nextBody) {
          body = nextBody;
          continue;
        }

        // No pending → end
        return {
          type: 'error',
          content: 'Agent 流意外结束',
          step: currentStep.value,
          timestamp: Date.now(),
        };
      }

      // Max rounds reached
      return {
        type: 'error',
        content: `工具执行轮次达到上限 (${maxRoundtrips})`,
        step: currentStep.value,
        timestamp: Date.now(),
      };
    } catch (err) {
      // AbortError: user-initiated abort or component unmount; do not show as an error
      if (err instanceof DOMException && err.name === 'AbortError') {
        isStreaming.value = false;
        abortController = null;
        return {
          type: 'error',
          content: '',
          step: currentStep.value,
          timestamp: Date.now(),
        };
      }
      const errStep: AgentStreamStep = {
        type: 'error',
        content: err instanceof Error ? err.message : String(err),
        step: currentStep.value,
        timestamp: Date.now(),
      };
      error.value = errStep.content;
      callbacks.onError?.(errStep);
      return errStep;
    } finally {
      isStreaming.value = false;
      abortController = null;
    }
  }

  /** Abort the current stream */
  function abort(): void {
    if (abortController) {
      abortController.abort();
    }
  }

  return {
    isStreaming: readonly(isStreaming),
    error: readonly(error),
    currentStep: readonly(currentStep),
    execute,
    abort,
  };
}
