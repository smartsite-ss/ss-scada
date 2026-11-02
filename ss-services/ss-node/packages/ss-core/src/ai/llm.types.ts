// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * LLM type definitions - P1-T01 LLM API access configuration
 *
 * Defines common types for LLM Provider, messages, requests/responses, etc.
 * All provider implementations comply with the interface contract defined here.
 */

/**
 * Provider ID
 *
 * Uses a string type for extensibility (deepseek/zhipu/qwen/moonshot/ernie/openai/claude/gemini/mistral/custom, etc.).
 * Available providers see PROVIDER_PRESETS in provider-presets.ts.
 */
export type LLMProviderId = string;

/** Task type (for routing strategy D-010) */
export type TaskType = 'codegen' | 'chat' | 'intent' | 'analysis' | 'embedding';

/** Message role */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Chat message */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** tool role message's tool_call_id */
  toolCallId?: string;
  /** assistant message's tool calls */
  toolCalls?: ToolCall[];
}

/** Tool call */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Tool definition */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/** LLM request */
export interface LLMRequest {
  /** Message list */
  messages: ChatMessage[];
  /** Specified provider (overrides task-type routing; used first; falls back to routing on failure) */
  providerId?: LLMProviderId;
  /** Specified model (overrides default) */
  model?: string;
  /** Temperature (0-2, higher = more random) */
  temperature?: number;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Available tool list (Function Calling) */
  tools?: ToolDefinition[];
  /** Whether to force tool calls */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Stop sequence */
  stop?: string[];
  /** User identifier (for audit) */
  user?: string;
  /** Whether streaming output is enabled */
  stream?: boolean;
}

/** LLM response */
export interface LLMResponse {
  /** Generated content */
  content: string;
  /** Model name */
  model: string;
  /** Role (always assistant) */
  role: 'assistant';
  /** Tool calls (if any) */
  toolCalls?: ToolCall[];
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Provider ID */
  provider: LLMProviderId;
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  /** Response time (ms) */
  latencyMs: number;
}

/** Streaming chunk */
export interface ChatStreamChunk {
  /** Incremental content */
  delta: string;
  /** Whether finished */
  done: boolean;
  /** Statistics at completion */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Finish reason (when done=true) */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  /** Injected by Controller when done=true, identifies the session this conversation belongs to (provider impl should not fill this) */
  conversationId?: string;
}

/** Embedding request */
export interface EmbeddingRequest {
  /** Text list to embed */
  inputs: string[];
  /** Specified model (overrides default) */
  model?: string;
}

/** Embedding response */
export interface EmbeddingResponse {
  /** Embedding vector list (one-to-one with inputs) */
  embeddings: number[][];
  /** Model name */
  model: string;
  /** Dimension */
  dimension: number;
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
  /** Provider ID */
  provider: LLMProviderId;
}

/** Provider health status */
export interface ProviderHealth {
  providerId: LLMProviderId;
  /** Whether available */
  healthy: boolean;
  /** Last check time */
  lastCheckAt: number;
  /** Last error message */
  lastError?: string;
  /** Average response latency (ms) */
  avgLatencyMs?: number;
}

/** Provider config */
export interface ProviderConfig {
  providerId: LLMProviderId;
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  /** Code-generation model (DeepSeek only) */
  codegenModel?: string;
  /** Lightweight model (Zhipu only) */
  liteModel?: string;
  /** Embedding model */
  embeddingModel?: string;
  /** Embedding dimension */
  embeddingDim?: number;
  /** Request timeout (ms) */
  timeout: number;
  /** Max retry count */
  maxRetries: number;
}

/** Task routing config (D-010 multi-provider routing strategy) */
export interface RoutingConfig {
  codegen: LLMProviderId;
  chat: LLMProviderId;
  intent: LLMProviderId;
  analysis: LLMProviderId;
  /** Embedding tasks always use Zhipu */
  embedding: LLMProviderId;
}

/** Default routing strategy (consistent with D-010 table) */
export const DEFAULT_ROUTING: RoutingConfig = {
  codegen: 'deepseek',
  chat: 'zhipu',
  intent: 'zhipu',
  analysis: 'zhipu',
  embedding: 'zhipu',
};
