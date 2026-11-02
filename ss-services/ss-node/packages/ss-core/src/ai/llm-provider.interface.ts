// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * LLM Provider abstraction interface - P1-T01 LLM API access configuration
 *
 * All LLM providers (DeepSeek, Zhipu, etc.) implement this interface.
 * The backend LLM proxy service (LLMProxyService) calls the underlying provider API through this
 * interface, achieving multi-provider routing, fallback, and a unified contract.
 *
 * Related decisions:
 *   - D-001 cloud API first (DeepSeek + Zhipu)
 *   - D-002 LLM model selection (DeepSeek + Zhipu GLM)
 *   - D-009 SSE streaming output
 *   - D-010 multi-provider routing + fallback
 */

import { ProviderConfig, ProviderHealth } from './llm.types';
import {
  LLMRequest,
  LLMResponse,
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
} from './llm.types';

/**
 * LLM Provider interface
 *
 * Implementations are responsible for:
 *   1. Calling the specific provider API (DeepSeek / Zhipu / ...)
 *   2. Converting the provider response into a unified format (LLMResponse / ChatStreamChunk)
 *   3. Handling retries, timeouts, error fallbacks
 *   4. Reporting their own health status
 */
export interface ILLMProvider {
  /** Provider ID (extensible: deepseek/zhipu/qwen/moonshot/ernie/openai/claude/gemini/mistral/custom, etc.) */
  readonly providerId: string;

  /** Initialize the provider (inject config) */
  initialize(config: ProviderConfig): void;

  /** Whether initialized (apiKey etc. config ready) */
  isReady(): boolean;

  /**
   * Synchronous generation (non-streaming)
   * @throws Error when API call fails, times out, or all retries fail
   */
  generate(req: LLMRequest): Promise<LLMResponse>;

  /**
   * Streaming generation (AsyncGenerator)
   *
   * Yields one ChatStreamChunk each time; the last chunk has done=true.
   * Implementations must handle network disconnects, timeouts, etc. internally and interrupt
   * the stream via throw on exceptions.
   */
  stream(req: LLMRequest): AsyncGenerator<ChatStreamChunk, void, unknown>;

  /**
   * Embedding (vector generation)
   *
   * Used for RAG document/query vectorization (D-006 / D-007).
   * The DeepSeek provider may not implement this method (throw NotImplemented);
   * embedding tasks are routed to Zhipu via DEFAULT_ROUTING.embedding = 'zhipu'.
   */
  embed(req: EmbeddingRequest): Promise<EmbeddingResponse>;

  /** Health check (ping provider API, returns ProviderHealth) */
  checkHealth(): Promise<ProviderHealth>;
}

/**
 * LLM Provider Token (NestJS DI injection identifier)
 *
 * Used in LLMProxyService to inject all provider instances via @Inject(LLM_PROVIDERS).
 */
export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
