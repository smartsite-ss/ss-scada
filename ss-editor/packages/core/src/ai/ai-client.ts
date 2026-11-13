// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI client — P1-T04 frontend AI assistant panel
 *
 * Provides communication with the backend AI service gateway (/api/v1/ai/*):
 *   - chat()       non-streaming chat
 *   - streamChat() streaming chat (based on fetch ReadableStream, supports POST + Bearer Token)
 *   - embed()      text embedding
 *   - getStatus()  AI feature flags
 *   - getHealth()  provider health status
 *
 * Design notes:
 *   - No axios dependency (avoids interceptors interfering with streaming responses); uses the fetch API directly
 *   - Token is read from localStorage (consistent with system/src/api/client.ts)
 *   - SSE parsing: reads the ReadableStream chunk by chunk, splitting events on \n\n
 *
 * Related decisions:
 *   - D-009 SSE streaming output
 *   - D-010 multi-provider routing (taskType specified by the caller)
 */

// ============================================================
// Type definitions (aligned with the backend llm.types.ts)
// ============================================================

export type LLMProviderId = 'deepseek' | 'zhipu';
export type TaskType = 'codegen' | 'chat' | 'intent' | 'analysis' | 'embedding' | 'plugin-dev' | 'script-dev';
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  taskType?: TaskType;
  /** Specify a provider (overrides task-type routing; this provider takes precedence) */
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: any;
  stop?: string[];
  user?: string;
  /** Session ID (auto-created by the backend when omitted) */
  conversationId?: string;
  /** Project ID (used when creating a new session) */
  projectId?: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  role: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: LLMProviderId;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  latencyMs?: number;
  /** Session ID this conversation belongs to */
  conversationId?: string;
}

export interface ChatStreamChunk {
  delta: string;
  done: boolean;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Carried when done=true, identifying the session this conversation belongs to */
  conversationId?: string;
}

export interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimension: number;
  usage?: { promptTokens: number; totalTokens: number };
  provider: LLMProviderId;
}

export interface ProviderHealth {
  providerId: LLMProviderId;
  healthy: boolean;
  lastCheckAt: number;
  lastError?: string;
  avgLatencyMs?: number;
}

/**
 * AI feature status (D-015 offline degradation contract)
 *   - enabled      normally available
 *   - disabled     not enabled (AI_ENABLED=false or no available provider)
 *   - unauthorized authentication failed (401/403, re-login required)
 *   - unreachable  service unreachable (network error/5xx)
 */
export type AiStatusState = 'enabled' | 'disabled' | 'unauthorized' | 'unreachable';

export interface AiStatus {
  state: AiStatusState;
  /** Reason returned by the backend (e.g. no_available_provider); may exist only when disabled */
  reason?: string;
}

// ============================================================
// AI client implementation
// ============================================================

const TOKEN_KEY = 'scada_access_token';
const API_BASE = '/api/v1/ai';

/**
 * S-C03: the Token is transmitted via HttpOnly Cookie and cannot be read by JS.
 * getToken() always returns null; authentication relies on fetch's credentials: 'include'.
 * authHeaders() is kept as an empty object for compatibility with existing call sites.
 */
function getToken(): string | null {
  // S-C03: the token is no longer stored in localStorage; it is transmitted automatically via HttpOnly Cookie
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * S-C03: common options for all fetch calls (carrying Cookie credentials)
 */
const FETCH_CREDENTIALS: RequestInit = { credentials: 'include' };

/**
 * Unwraps the backend TransformInterceptor's standard response { code, data, message, timestamp }
 * Extracts the inner data field; compatible with unwrapped direct responses
 */
function unwrap<T>(resp: any): T {
  // Backend TransformInterceptor wrapper format: { code, data, message, timestamp }
  if (resp && typeof resp === 'object' && 'code' in resp && 'data' in resp) {
    return resp.data as T;
  }
  // Compatible with unwrapped direct responses
  return resp as T;
}

/**
 * AI feature status detection (D-015)
 *
 * Never throws: network/auth errors map to the corresponding status; callers must distinguish
 * disabled (not enabled) from unreachable/unauthorized (faults); silently swallowing errors is forbidden.
 */
export async function getAiStatus(): Promise<AiStatus> {
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/status`, {
      ...FETCH_CREDENTIALS,
      headers: { ...authHeaders() },
    });
  } catch {
    // Network-level failure (backend not started / offline)
    return { state: 'unreachable' };
  }
  if (resp.status === 401 || resp.status === 403) {
    return { state: 'unauthorized' };
  }
  if (!resp.ok) {
    return { state: 'unreachable' };
  }
  const body = await resp.json().catch(() => null);
  const data = unwrap<{ enabled: boolean; reason?: string } | null>(body);
  if (data?.enabled === true) {
    return { state: 'enabled' };
  }
  return { state: 'disabled', reason: data?.reason };
}

/** Get provider health status */
export async function getAiHealth(): Promise<ProviderHealth[]> {
  const resp = await fetch(`${API_BASE}/health`, {
    ...FETCH_CREDENTIALS,
    headers: { ...authHeaders() },
  });
  if (!resp.ok) throw new Error(`健康检查失败: ${resp.status}`);
  const body = await resp.json();
  const data = unwrap<{ providers: ProviderHealth[] }>(body);
  return data?.providers || [];
}

/** Model options of enabled providers (for the AI assistant panel dropdown) */
export interface EnabledProviderOption {
  providerId: string;
  name: string;
  defaultModel: string;
  models: string[];
}

/**
 * Get configured and enabled providers with their model lists
 *
 * Used by the AI assistant chat panel's model selector: users can only pick models from this list.
 * Returns an empty array on failure (does not throw, to avoid blocking panel initialization).
 */
export async function getEnabledProviders(): Promise<EnabledProviderOption[]> {
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/providers`, {
      ...FETCH_CREDENTIALS,
      headers: { ...authHeaders() },
    });
  } catch {
    return [];
  }
  if (!resp.ok) return [];
  const body = await resp.json().catch(() => null);
  const data = unwrap<{ providers: Array<{ enabled: boolean; providerId: string; name: string; defaultModel: string; models: string[] }> } | null>(body);
  if (!data?.providers) return [];
  return data.providers
    .filter((p) => p.enabled && p.models?.length > 0)
    .map((p) => ({
      providerId: p.providerId,
      name: p.name,
      defaultModel: p.defaultModel,
      models: p.models,
    }));
}

/** Non-streaming chat */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const resp = await fetch(`${API_BASE}/chat`, {
    ...FETCH_CREDENTIALS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI chat 请求失败 (${resp.status}): ${text}`);
  }
  const body = await resp.json();
  return unwrap<ChatResponse>(body);
}

/**
 * Streaming chat (SSE)
 *
 * Implemented with fetch + ReadableStream; supports POST requests and Bearer Token.
 * Returns an AsyncGenerator that yields ChatStreamChunk chunk by chunk.
 *
 * Usage:
 *   for await (const chunk of streamChat(req)) {
 *     if (chunk.delta) appendToUI(chunk.delta);
 *     if (chunk.done) break;
 *   }
 */
export async function* streamChat(
  req: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  const resp = await fetch(`${API_BASE}/chat/stream`, {
    ...FETCH_CREDENTIALS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...authHeaders(),
    },
    body: JSON.stringify(req),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI stream 请求失败 (${resp.status}): ${text}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error('ReadableStream 不可用（浏览器不支持或响应无 body）');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split SSE events on double newlines
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        // Extract the data: field
        const dataLine = rawEvent
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n')
          .trim();

        if (!dataLine) continue;
        if (dataLine === '[DONE]') return;

        try {
          const chunk = JSON.parse(dataLine) as ChatStreamChunk;
          yield chunk;
        } catch {
          // Skip unparseable lines
          console.warn('[AI] Failed to parse SSE, skipping:', dataLine.slice(0, 200));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Text embedding */
export async function embed(
  inputs: string[],
  model?: string,
): Promise<EmbedResponse> {
  const resp = await fetch(`${API_BASE}/embed`, {
    ...FETCH_CREDENTIALS,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ inputs, model }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI embed 请求失败 (${resp.status}): ${text}`);
  }
  const body = await resp.json();
  return unwrap<EmbedResponse>(body);
}

// ============================================================
// Session management APIs (P2-T08 conversation persistence)
// ============================================================

export interface ConversationSummary {
  id: string;
  title: string;
  projectId: string;
  userId: string;
  taskType: string;
  model: string | null;
  messageCount: number;
  totalTokens: number;
  archived: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string | null;
  toolCalls: string | null;
  toolCallId: string | null;
  toolName: string | null;
  tokens: number;
  seq: number;
  createdAt: string;
}

export interface UsageStats {
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
  successRate: number;
  byProvider: Record<string, { tokens: number; cost: number; calls: number }>;
  byTaskType: Record<string, { tokens: number; cost: number; calls: number }>;
}

export interface BudgetStatus {
  budgetLimit: number;
  currentSpent: number;
  remaining: number;
  usageRate: number;
  isBlocked: boolean;
  shouldWarn: boolean;
}

export interface PromptTemplate {
  id: string;
  key: string;
  name: string;
  taskType: string;
  description: string | null;
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: string;
  status: 'draft' | 'active' | 'archived';
  systemPrompt: string;
  variables: string | null;
  llmConfig: string | null;
  changelog: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Generic JSON request wrapper (reuses fetch + unwrap logic) */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...FETCH_CREDENTIALS,
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`AI API 请求失败 (${resp.status}) ${url}: ${text}`);
  }
  const body = await resp.json();
  return unwrap<T>(body);
}

/** Get the user's session list */
export async function listConversations(projectId?: string): Promise<ConversationSummary[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const data = await requestJson<ConversationSummary[] | { conversations?: ConversationSummary[] }>(
    `${API_BASE}/conversations${query}`,
  );
  return Array.isArray(data) ? data : (data.conversations || []);
}

/** Get session details */
export async function getConversation(id: string): Promise<ConversationSummary> {
  return requestJson<ConversationSummary>(`${API_BASE}/conversations/${id}`);
}

/** Get the session's message list */
export async function getConversationMessages(id: string): Promise<ConversationMessage[]> {
  const data = await requestJson<{ messages: ConversationMessage[] }>(
    `${API_BASE}/conversations/${id}/messages`,
  );
  return data.messages;
}

/** Update the session title */
export async function updateConversationTitle(id: string, title: string): Promise<void> {
  await requestJson(`${API_BASE}/conversations/${id}/title`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

/** Archive/unarchive a session */
export async function archiveConversation(id: string, archived: boolean): Promise<void> {
  await requestJson(`${API_BASE}/conversations/${id}/archive`, {
    method: 'PUT',
    body: JSON.stringify({ archived }),
  });
}

/** Delete a session */
export async function deleteConversation(id: string): Promise<void> {
  await requestJson(`${API_BASE}/conversations/${id}`, { method: 'DELETE' });
}

/** Get usage statistics */
export async function getUsageStats(params?: {
  startDate?: string;
  endDate?: string;
  providerId?: string;
  taskType?: string;
}): Promise<UsageStats> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set('startDate', params.startDate);
  if (params?.endDate) qs.set('endDate', params.endDate);
  if (params?.providerId) qs.set('providerId', params.providerId);
  if (params?.taskType) qs.set('taskType', params.taskType);
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return requestJson<UsageStats>(`${API_BASE}/usage/stats${query}`);
}

/** Get the monthly budget status */
export async function getUsageBudget(): Promise<BudgetStatus> {
  return requestJson<BudgetStatus>(`${API_BASE}/usage/budget`);
}

/** Get the Prompt template list */
export async function listPrompts(): Promise<PromptTemplate[]> {
  const data = await requestJson<{ prompts: PromptTemplate[] }>(`${API_BASE}/prompts`);
  return data.prompts;
}

/** Create a Prompt template */
export async function createPrompt(dto: {
  key: string;
  name: string;
  taskType?: string;
  description?: string;
}): Promise<PromptTemplate> {
  return requestJson<PromptTemplate>(`${API_BASE}/prompts`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/** Update a Prompt template */
export async function updatePrompt(
  id: string,
  dto: Partial<{ name: string; description: string }>,
): Promise<void> {
  await requestJson(`${API_BASE}/prompts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

/** Get the Prompt version list */
export async function listPromptVersions(promptId: string): Promise<PromptVersion[]> {
  const data = await requestJson<{ versions: PromptVersion[] }>(
    `${API_BASE}/prompts/${promptId}/versions`,
  );
  return data.versions;
}

/** Create a new Prompt version */
export async function createPromptVersion(
  promptId: string,
  dto: {
    version: string;
    systemPrompt: string;
    variables?: string;
    llmConfig?: string;
    changelog?: string;
  },
): Promise<PromptVersion> {
  return requestJson<PromptVersion>(`${API_BASE}/prompts/${promptId}/versions`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/** Publish a Prompt version */
export async function publishPromptVersion(versionId: string): Promise<void> {
  await requestJson(`${API_BASE}/prompts/versions/${versionId}/publish`, { method: 'PUT' });
}

/** Archive a Prompt version */
export async function archivePromptVersion(versionId: string): Promise<void> {
  await requestJson(`${API_BASE}/prompts/versions/${versionId}/archive`, { method: 'PUT' });
}

/** Roll back a Prompt version */
export async function rollbackPromptVersion(versionId: string): Promise<void> {
  await requestJson(`${API_BASE}/prompts/versions/${versionId}/rollback`, { method: 'PUT' });
}

export const aiClient = {
  getStatus: getAiStatus,
  getHealth: getAiHealth,
  getEnabledProviders,
  chat,
  streamChat,
  embed,
  // P2-T08 session management
  listConversations,
  getConversation,
  getConversationMessages,
  updateConversationTitle,
  archiveConversation,
  deleteConversation,
  // P2-T08 usage statistics
  getUsageStats,
  getUsageBudget,
  // P2-T08 Prompt management
  listPrompts,
  createPrompt,
  updatePrompt,
  listPromptVersions,
  createPromptVersion,
  publishPromptVersion,
  archivePromptVersion,
  rollbackPromptVersion,
};
