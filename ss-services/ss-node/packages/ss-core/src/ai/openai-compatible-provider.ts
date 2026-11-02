// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * OpenAI-compatible Provider - uniformly handles all LLM providers with OpenAI-compatible API formats
 *
 * Supported providers (distinguished by providerId):
 *   Domestic: DeepSeek, Zhipu GLM, Tongyi Qianwen Qwen, Kimi (Moonshot), Wenxin Yiyan ERNIE
 *   International: OpenAI, Anthropic Claude, Google Gemini, Mistral AI
 *   Custom: any OpenAI-compatible endpoint
 *
 * All the above providers support the OpenAI-compatible API format:
 *   - Chat endpoint: POST {apiBase}/chat/completions
 *   - Embeddings endpoint: POST {apiBase}/embeddings
 *   - Auth: Bearer Token
 *   - Streaming output: SSE (Server-Sent Events)
 *
 * Related decisions:
 *   - D-001 cloud API first (unified multi-provider access)
 *   - D-002 LLM model selection (common domestic/international models)
 *   - D-009 SSE streaming output
 *   - D-010 multi-provider routing + fallback
 */

import { Injectable, Logger } from '@nestjs/common';
import { ILLMProvider } from './llm-provider.interface';
import {
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  LLMRequest,
  LLMResponse,
  ProviderConfig,
  ProviderHealth,
  ToolCall,
} from './llm.types';
import {
  HttpError,
  HttpTimeoutError,
  httpRequest,
  httpStream,
  parseSSEStream,
} from './http-client.util';

/** OpenAI-compatible Chat response format */
interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** OpenAI-compatible streaming chunk */
interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** OpenAI-compatible Embedding response format */
interface OpenAIEmbeddingResponse {
  model: string;
  data: Array<{ index: number; embedding: number[]; object: string }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Unified OpenAI-compatible Provider implementation
 *
 * Distinguished by providerId; one instance per provider.
 * Created as separate instances for each preset provider via a factory in the AI Module.
 */
@Injectable()
export class OpenAICompatibleProvider implements ILLMProvider {
  private readonly logger: Logger;
  readonly providerId: string;

  private config: ProviderConfig | null = null;
  private health: ProviderHealth;
  private latencyHistory: number[] = [];

  constructor(providerId: string) {
    this.providerId = providerId;
    this.logger = new Logger(`OpenAIProvider:${providerId}`);
    this.health = {
      providerId: providerId as any,
      healthy: false,
      lastCheckAt: 0,
    };
  }

  initialize(config: ProviderConfig): void {
    if (config.providerId !== this.providerId) {
      throw new Error(
        `OpenAICompatibleProvider(${this.providerId}) 收到不匹配的配置: ${config.providerId}`,
      );
    }
    this.config = config;
    this.logger.log(
      `Provider 已初始化: apiBase=${config.apiBase}, model=${config.defaultModel}` +
        (config.codegenModel ? `, codegen=${config.codegenModel}` : '') +
        (config.liteModel ? `, lite=${config.liteModel}` : '') +
        (config.embeddingModel ? `, embedding=${config.embeddingModel}` : ''),
    );
  }

  isReady(): boolean {
    return this.config != null && this.config.apiKey.length > 0;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    if (!this.isReady()) {
      throw new Error(`Provider ${this.providerId} 未初始化或缺少 API Key`);
    }
    const activeConfig = this.config!;
    const model = req.model || activeConfig.defaultModel;
    const body = this.buildRequestBody(req, model, false);
    const url = `${activeConfig.apiBase}/chat/completions`;

    const startTs = Date.now();
    const resp = await this.callWithRetry(() =>
      httpRequest({
        method: 'POST',
        url,
        headers: { Authorization: `Bearer ${activeConfig.apiKey}` },
        body,
        timeoutMs: activeConfig.timeout,
      }),
    );
    const latencyMs = Date.now() - startTs;
    this.recordLatency(latencyMs);

    const parsed = JSON.parse(resp.body) as OpenAIChatResponse;
    const choice = parsed.choices[0];
    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));

    return {
      content: choice.message.content,
      model: parsed.model,
      role: 'assistant',
      toolCalls,
      usage: {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      },
      provider: this.providerId as any,
      finishReason: this.mapFinishReason(choice.finish_reason),
      latencyMs,
    };
  }

  async *stream(req: LLMRequest): AsyncGenerator<ChatStreamChunk, void, unknown> {
    if (!this.isReady()) {
      throw new Error(`Provider ${this.providerId} 未初始化或缺少 API Key`);
    }
    const activeConfig = this.config!;
    const model = req.model || activeConfig.defaultModel;
    const body = this.buildRequestBody(req, model, true);
    const url = `${activeConfig.apiBase}/chat/completions`;

    const startTs = Date.now();
    let lastUsage:
      { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
    let lastFinish: string | null = null;

    try {
      const rawStream = httpStream({
        method: 'POST',
        url,
        headers: { Authorization: `Bearer ${activeConfig.apiKey}` },
        body,
        timeoutMs: activeConfig.timeout,
      });
      const sseStream = parseSSEStream(rawStream);

      for await (const data of sseStream) {
        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          this.logger.warn(`流式响应解析失败，跳过：${data.slice(0, 200)}`);
          continue;
        }
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta?.content || '';
        if (chunk.usage) {
          lastUsage = chunk.usage;
        }
        if (choice.finish_reason) {
          lastFinish = choice.finish_reason;
        }

        if (delta) {
          yield { delta, done: false };
        }
      }

      this.recordLatency(Date.now() - startTs);
      yield {
        delta: '',
        done: true,
        finishReason: this.mapFinishReason(lastFinish || 'stop'),
        usage: lastUsage
          ? {
              promptTokens: lastUsage.prompt_tokens,
              completionTokens: lastUsage.completion_tokens,
              totalTokens: lastUsage.total_tokens,
            }
          : undefined,
      };
    } catch (err) {
      this.markUnhealthy(err);
      throw err;
    }
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.isReady()) {
      throw new Error(`Provider ${this.providerId} 未初始化或缺少 API Key`);
    }
    const activeConfig = this.config!;
    if (!activeConfig.embeddingModel) {
      throw new Error(`Provider ${this.providerId} 不支持嵌入任务（未配置 embeddingModel）`);
    }
    const url = `${activeConfig.apiBase}/embeddings`;

    const startTs = Date.now();
    const resp = await this.callWithRetry(() =>
      httpRequest({
        method: 'POST',
        url,
        headers: { Authorization: `Bearer ${activeConfig.apiKey}` },
        body: {
          model: req.model || activeConfig.embeddingModel,
          input: req.inputs,
        },
        timeoutMs: activeConfig.timeout,
      }),
    );
    this.recordLatency(Date.now() - startTs);

    const parsed = JSON.parse(resp.body) as OpenAIEmbeddingResponse;
    const embeddings = parsed.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);

    return {
      embeddings,
      model: parsed.model,
      dimension: activeConfig.embeddingDim || embeddings[0]?.length || 0,
      usage: {
        promptTokens: parsed.usage.prompt_tokens,
        totalTokens: parsed.usage.total_tokens,
      },
      provider: this.providerId as any,
    };
  }

  async checkHealth(): Promise<ProviderHealth> {
    if (!this.isReady()) {
      this.health = {
        providerId: this.providerId as any,
        healthy: false,
        lastCheckAt: Date.now(),
        lastError: 'Provider 未初始化或缺少 API Key',
      };
      return this.health;
    }

    const activeConfig = this.config!;
    const startTs = Date.now();
    try {
      // Probe availability with one minimal chat request (use lite model to reduce cost)
      await httpRequest({
        method: 'POST',
        url: `${activeConfig.apiBase}/chat/completions`,
        headers: { Authorization: `Bearer ${activeConfig.apiKey}` },
        body: {
          model: activeConfig.liteModel || activeConfig.defaultModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
          stream: false,
        },
        timeoutMs: Math.min(activeConfig.timeout, 15000),
      });
      const latency = Date.now() - startTs;
      this.recordLatency(latency);
      this.health = {
        providerId: this.providerId as any,
        healthy: true,
        lastCheckAt: Date.now(),
        avgLatencyMs: this.getAvgLatency(),
      };
    } catch (err) {
      this.markUnhealthy(err);
    }
    return this.health;
  }

  // -------- Private methods --------

  private buildRequestBody(req: LLMRequest, model: string, stream: boolean): Record<string, any> {
    const body: Record<string, any> = {
      model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      stream,
    };
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.maxTokens != null) body.max_tokens = req.maxTokens;
    if (req.stop != null) body.stop = req.stop;
    if (req.user != null) body.user = req.user;
    if (req.tools != null) {
      body.tools = req.tools;
      if (req.toolChoice != null) {
        body.tool_choice = req.toolChoice;
      }
    }
    return body;
  }

  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    const max = this.config?.maxRetries ?? 3;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (err instanceof HttpTimeoutError) {
          this.logger.warn(`请求超时（第 ${attempt}/${max} 次重试）`);
        } else if (err instanceof HttpError) {
          // 4xx client errors are not retried
          if (err.statusCode >= 400 && err.statusCode < 500) {
            throw err;
          }
          this.logger.warn(
            `${err.statusCode}（第 ${attempt}/${max} 次重试）：${err.body.slice(0, 200)}`,
          );
        } else {
          this.logger.warn(`请求异常（第 ${attempt}/${max} 次重试）：${(err as Error).message}`);
        }
        if (attempt < max) {
          await sleep(500 * attempt);
        }
      }
    }
    throw lastErr;
  }

  private recordLatency(ms: number): void {
    this.latencyHistory.push(ms);
    if (this.latencyHistory.length > 20) {
      this.latencyHistory.shift();
    }
  }

  private getAvgLatency(): number | undefined {
    if (this.latencyHistory.length === 0) return undefined;
    return Math.round(this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length);
  }

  private markUnhealthy(err: unknown): void {
    this.health = {
      providerId: this.providerId as any,
      healthy: false,
      lastCheckAt: Date.now(),
      lastError: err instanceof Error ? err.message : String(err),
      avgLatencyMs: this.getAvgLatency(),
    };
  }

  private mapFinishReason(reason: string): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
