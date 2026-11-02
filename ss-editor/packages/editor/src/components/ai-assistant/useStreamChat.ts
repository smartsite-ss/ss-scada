// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * useStreamChat — P1-T04 AI assistant streaming chat Composable
 *
 * Responsibilities:
 *   1. Manage the chat message list (user/assistant alternating)
 *   2. Call aiClient.streamChat() for streaming conversations
 *   3. Update the last assistant message content in real time
 *   4. Provide loading/error states and abort capability
 *   5. Support task type routing (codegen/chat/intent/analysis)
 *
 * Usage:
 *   const { messages, sendMessage, isStreaming, abort, error } = useStreamChat();
 *   await sendMessage('Help me create a button graphic', 'codegen');
 */

import { ref, readonly, computed, type Ref } from 'vue';
import {
  aiClient,
  i18n,
  type ChatMessage,
  type TaskType,
  type ChatStreamChunk,
  type AiStatusState,
  type ConversationSummary,
  type ConversationMessage,
} from '@scada-editor/core';

const { t } = i18n.global;

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Whether streaming reception is in progress */
  streaming?: boolean;
  /** Associated task type (for rendering specific action buttons) */
  taskType?: TaskType;
  /** Metadata */
  provider?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  /** Creation timestamp */
  createdAt: number;
}

let msgIdCounter = 0;
function genId(): string {
  msgIdCounter += 1;
  return `msg-${Date.now()}-${msgIdCounter}`;
}

export function useStreamChat() {
  const messages = ref<ChatMessageItem[]>([]) as Ref<ChatMessageItem[]>;
  const isStreaming = ref(false);
  const error = ref<string | null>(null);
  /** AI status tri-state (D-015): null = not checked; distinguishes disabled/unauthorized/unreachable */
  const aiStatus = ref<AiStatusState | null>(null);
  /** Compatibility boolean view: null = not checked, true = available, false = unavailable (including fault states) */
  const aiEnabled = computed<boolean | null>(() => {
    if (aiStatus.value === null) return null;
    return aiStatus.value === 'enabled';
  });

  // ============================================================
  // Session management state (P2-T08 conversation persistence)
  // ============================================================
  /** Current session ID (null = no associated session; the next send creates a new session) */
  const currentConversationId = ref<string | null>(null);
  /** Current project ID (passed when creating a new session) */
  const currentProjectId = ref<string | null>(null);
  /** Session list (shown in the sidebar) */
  const conversations = ref<ConversationSummary[]>([]) as Ref<ConversationSummary[]>;
  /** Session list loading */
  const conversationsLoading = ref(false);

  let abortController: AbortController | null = null;

  /** i18n hint key for the status */
  const STATUS_HINT_KEYS: Record<Exclude<AiStatusState, 'enabled'>, string> = {
    disabled: 'editor.aiAssistant.disabledHint',
    unauthorized: 'editor.aiAssistant.unauthorizedHint',
    unreachable: 'editor.aiAssistant.unreachableHint',
  };

  /** Check the AI feature status (getAiStatus never throws; errors map to a status) */
  async function checkStatus(): Promise<AiStatusState> {
    const status = await aiClient.getStatus();
    aiStatus.value = status.state;
    return status.state;
  }

  /**
   * Send a message and receive a streaming reply
   *
   * Persistence strategy (P2-T08):
   *   - When currentConversationId exists, only the current message + conversationId are sent;
   *     the server restores the full history from the database (avoiding the frontend accumulating and sending large contexts)
   *   - When currentConversationId is null, send the full local history and allow the server to create a new session
   *   - The server returns conversationId in the final done=true chunk; the frontend updates its state accordingly
   *
   * @param text user input text
   * @param taskType task type (determines backend routing)
   * @param systemPrompt optional system prompt
   * @param model optional model name (user-selected from the dropdown, overriding the routed default model)
   * @param providerId optional provider ID (passed together when the user picks a specific model, overriding task-type routing,
   *   ensuring the request goes to that model's provider rather than the routed default provider)
   */
  async function sendMessage(
    text: string,
    taskType: TaskType = 'chat',
    systemPrompt?: string,
    model?: string,
    providerId?: string,
  ): Promise<void> {
    if (isStreaming.value) return;
    if (!text.trim()) return;

    error.value = null;

    // Check the AI status (distinguishing not-enabled/auth-failed/service-unreachable)
    if (aiStatus.value === null) {
      await checkStatus();
    }
    if (aiStatus.value !== 'enabled') {
      const state = aiStatus.value ?? 'unreachable';
      error.value = t(STATUS_HINT_KEYS[state as Exclude<AiStatusState, 'enabled'>]);
      return;
    }

    // Build the message list:
    // - Existing session: send only the current user message; the server restores history from the DB
    // - No session: send the local history (including the system prompt), letting the server create a new session
    const hasExistingConversation = !!currentConversationId.value;
    const history: ChatMessage[] = hasExistingConversation
      ? [{ role: 'user', content: text }]
      : messages.value.map((m) => ({
          role: m.role,
          content: m.content,
        }));
    if (!hasExistingConversation && systemPrompt) {
      history.unshift({ role: 'system', content: systemPrompt });
    }
    if (!hasExistingConversation) {
      history.push({ role: 'user', content: text });
    }

    // Add the user message to the UI
    messages.value.push({
      id: genId(),
      role: 'user',
      content: text,
      taskType,
      createdAt: Date.now(),
    });

    // Add an empty assistant message (placeholder)
    const assistantMsg: ChatMessageItem = {
      id: genId(),
      role: 'assistant',
      content: '',
      streaming: true,
      taskType,
      createdAt: Date.now(),
    };
    messages.value.push(assistantMsg);

    isStreaming.value = true;
    abortController = new AbortController();

    try {
      const stream = aiClient.streamChat(
        {
          messages: history,
          taskType,
          model,
          providerId,
          conversationId: currentConversationId.value || undefined,
          projectId: currentProjectId.value || undefined,
        },
        abortController.signal,
      );

      for await (const chunk of stream as AsyncGenerator<ChatStreamChunk>) {
        if (chunk.delta) {
          assistantMsg.content += chunk.delta;
        }
        if (chunk.done) {
          assistantMsg.streaming = false;
          if (chunk.finishReason) {
            assistantMsg.finishReason = chunk.finishReason;
          }
          if (chunk.usage) {
            assistantMsg.usage = chunk.usage;
          }
          // The server returns conversationId in the done chunk; update the local state
          if (chunk.conversationId) {
            currentConversationId.value = chunk.conversationId;
          }
        }
      }

      // Ensure finished
      assistantMsg.streaming = false;
    } catch (err) {
      assistantMsg.streaming = false;
      if (err instanceof Error && err.name === 'AbortError') {
        // User-initiated abort, not an error
        if (assistantMsg.content === '') {
          // If nothing was received at abort time, remove the placeholder message
          messages.value = messages.value.filter((m) => m.id !== assistantMsg.id);
        }
      } else {
        error.value = err instanceof Error ? err.message : String(err);
        // If there is no content, remove the placeholder message
        if (assistantMsg.content === '') {
          messages.value = messages.value.filter((m) => m.id !== assistantMsg.id);
        }
      }
    } finally {
      isStreaming.value = false;
      abortController = null;
    }
  }

  /** Abort the current streaming request */
  function abort(): void {
    if (abortController) {
      abortController.abort();
    }
  }

  /** Clear the message list (frontend UI only; does not affect backend session records) */
  function clear(): void {
    messages.value = [];
    error.value = null;
    // Reset the session association: the next send creates a new session
    currentConversationId.value = null;
  }

  // ============================================================
  // Session management methods (P2-T08 conversation persistence)
  // ============================================================

  /**
   * Set the current project ID (call when switching projects; used when creating a new session)
   * Note: switching projects does not automatically clear the current session; call clearConversation explicitly
   */
  function setCurrentProject(projectId: string | null): void {
    currentProjectId.value = projectId;
  }

  /**
   * Refresh the session list (for sidebar display)
   * Filters by projectId; when projectId is not set, queries all of the current user's sessions
   */
  async function refreshConversations(): Promise<void> {
    conversationsLoading.value = true;
    try {
      conversations.value = await aiClient.listConversations(
        currentProjectId.value || undefined,
      );
    } catch (err) {
      // A list load failure should not block the main chat flow; only record it in error
      error.value = err instanceof Error ? err.message : String(err);
      conversations.value = [];
    } finally {
      conversationsLoading.value = false;
    }
  }

  /**
   * Load a given session into the current message list
   * Restores the full message history from the database and sets it as the current session
   * @param conversationId session ID
   */
  async function loadConversation(conversationId: string): Promise<void> {
    if (isStreaming.value) {
      error.value = t('editor.aiAssistant.cannotLoadWhileStreaming');
      return;
    }
    error.value = null;
    try {
      const history = await aiClient.getConversationMessages(conversationId);
      // Convert backend messages to frontend ChatMessageItem
      messages.value = history
        .filter((m: ConversationMessage) => m.role === 'user' || m.role === 'assistant')
        .map((m: ConversationMessage) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content || '',
          taskType: undefined,
          createdAt: new Date(m.createdAt).getTime(),
          ...(m.tokens > 0
            ? {
                usage: {
                  promptTokens: 0,
                  completionTokens: 0,
                  totalTokens: m.tokens,
                },
              }
            : {}),
        }));
      currentConversationId.value = conversationId;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Explicitly set the current session ID (used by external paths such as Agent mode to sync session state).
   * currentConversationId is externally readonly; it must be updated through this function.
   */
  function setCurrentConversationId(conversationId: string | null): void {
    currentConversationId.value = conversationId;
  }

  /**
   * Start a new session: clear the current message list and reset the session association
   * Does not delete old session records in the database
   */
  function clearConversation(): void {
    if (isStreaming.value) {
      error.value = t('editor.aiAssistant.cannotClearWhileStreaming');
      return;
    }
    messages.value = [];
    error.value = null;
    currentConversationId.value = null;
  }

  /**
   * Delete a given session (permanently removed from the database)
   * If the deleted session is the current one, the UI is cleared as well
   * @param conversationId session ID
   */
  async function deleteConversationById(conversationId: string): Promise<void> {
    try {
      await aiClient.deleteConversation(conversationId);
      // Remove from the local list
      conversations.value = conversations.value.filter((c) => c.id !== conversationId);
      // If the deleted session is the current one, clear the UI
      if (currentConversationId.value === conversationId) {
        clearConversation();
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Archive/unarchive a session
   * @param conversationId session ID
   * @param archived whether to archive
   */
  async function archiveConversationById(
    conversationId: string,
    archived: boolean,
  ): Promise<void> {
    try {
      await aiClient.archiveConversation(conversationId, archived);
      // Update the archived status in the local list
      conversations.value = conversations.value.map((c) =>
        c.id === conversationId ? { ...c, archived: archived ? 1 : 0 } : c,
      );
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Rename a session title
   * @param conversationId session ID
   * @param title new title
   */
  async function renameConversation(conversationId: string, title: string): Promise<void> {
    try {
      await aiClient.updateConversationTitle(conversationId, title);
      conversations.value = conversations.value.map((c) =>
        c.id === conversationId ? { ...c, title } : c,
      );
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Add a user message to the list (external call, e.g. Agent mode)
   */
  function addUserMessage(content: string, taskType?: TaskType): ChatMessageItem {
    const msg: ChatMessageItem = {
      id: genId(),
      role: 'user',
      content,
      taskType,
      createdAt: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  /**
   * Add an assistant message to the list (external call, e.g. Agent mode)
   */
  function addAssistantMessage(content: string, taskType?: TaskType): ChatMessageItem {
    const msg: ChatMessageItem = {
      id: genId(),
      role: 'assistant',
      content,
      taskType,
      createdAt: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  return {
    messages: readonly(messages) as Readonly<Ref<ChatMessageItem[]>>,
    isStreaming: readonly(isStreaming),
    error: readonly(error),
    aiStatus: readonly(aiStatus),
    aiEnabled,
    sendMessage,
    addUserMessage,
    addAssistantMessage,
    abort,
    clear,
    checkStatus,
    // P2-T08 session management
    currentConversationId: readonly(currentConversationId),
    currentProjectId: readonly(currentProjectId),
    conversations: readonly(conversations) as Readonly<Ref<ConversationSummary[]>>,
    conversationsLoading: readonly(conversationsLoading),
    setCurrentProject,
    setCurrentConversationId,
    refreshConversations,
    loadConversation,
    clearConversation,
    deleteConversationById,
    archiveConversationById,
    renameConversation,
  };
}
