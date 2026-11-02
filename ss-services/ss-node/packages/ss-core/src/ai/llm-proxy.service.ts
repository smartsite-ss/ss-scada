// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * LLM Proxy Service - backend AI service gateway
 *
 * Responsibilities:
 *   1. Route to the corresponding provider by task type (D-010 multi-provider routing)
 *   2. Fall back to an alternate provider when the primary fails
 *   3. Periodic health-check scheduling (OnModuleInit starts a 30s cycle)
 *   4. Load provider config from the database (no longer from env vars)
 *
 * Related decisions:
 *   - D-009 SSE streaming output (streamChat returns AsyncGenerator)
 *   - D-010 multi-provider routing + fallback
 *   - D-012 Feature Flag (AI_ENABLED controls; only this one stays in env vars)
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ILLMProvider, LLM_PROVIDERS } from './llm-provider.interface';
import { AiProviderConfigService } from './ai-provider-config.service';
import {
  ChatStreamChunk,
  DEFAULT_ROUTING,
  EmbeddingRequest,
  EmbeddingResponse,
  LLMProviderId,
  LLMRequest,
  LLMResponse,
  ProviderConfig,
  ProviderHealth,
  RoutingConfig,
  TaskType,
} from './llm.types';
import { findPreset } from './provider-presets';
import { LLMSafetyGuardService } from './llm-safety-guard.service';

const HEALTH_CHECK_INTERVAL_MS = 30_000;

@Injectable()
export class LLMProxyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LLMProxyService.name);
  private providers = new Map<string, ILLMProvider>();
  private routing: RoutingConfig = { ...DEFAULT_ROUTING };
  private enabled = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly healthMap = new Map<string, ProviderHealth>();

  constructor(
    @Inject(LLM_PROVIDERS) providerList: ILLMProvider[],
    private readonly configService: ConfigService,
    @Optional() private readonly providerConfigService?: AiProviderConfigService,
    @Optional() private readonly safetyGuard?: LLMSafetyGuardService,
  ) {
    for (const p of providerList) {
      this.providers.set(p.providerId, p);
    }
  }

  onModuleInit(): void {
    // AI_ENABLED remains in env vars as a startup-level Feature Flag
    this.enabled = this.configService.get<string>('AI_ENABLED') === 'true';
    if (!this.enabled) {
      this.logger.warn('AI 功能未启用（AI_ENABLED != true），LLMProxyService 处于禁用状态');
      return;
    }

    // Async init: load config from database
    this.initializeProvidersAsync().catch((err) => {
      this.logger.error(`Provider 异步初始化失败: ${err.message}`);
    });
    this.startHealthCheck();
    this.logger.log(`LLMProxyService 已启用，已注册 ${this.providers.size} 个 Provider 实例`);
  }

  /**
   * Reload provider config (called after a frontend config change)
   * Reads the latest config from the database and re-initializes all providers.
   */
  async reloadProviders(): Promise<void> {
    if (!this.providerConfigService) {
      this.logger.warn('AiProviderConfigService 未注入，无法从数据库重载配置');
      return;
    }
    await this.initializeProvidersAsync();
    this.logger.log('AI Provider 配置已从数据库重新加载');
  }

  /**
   * Async init providers: read config from the database
   *
   * Config flow:
   *   1. Call AiProviderConfigService.ensureDefaultProviders() to seed preset providers into DB
   *   2. Read all enabled provider configs
   *   3. For each config, find the matching provider instance and initialize it
   *   4. Auto-infer routing strategy (first embedding-capable provider as embedding route)
   */
  private async initializeProvidersAsync(): Promise<void> {
    if (!this.providerConfigService) {
      this.logger.warn('AiProviderConfigService 未注入，无法从数据库加载配置');
      return;
    }

    try {
      // Ensure preset providers are seeded into DB (auto-run on first startup)
      await this.providerConfigService.ensureDefaultProviders();

      const dbConfigs = await this.providerConfigService.getEnabledProviderConfigs();
      if (dbConfigs.length === 0) {
        this.logger.warn(
          '数据库中无已启用的 AI Provider 配置。请在系统设置 → AI 模型配置中添加供应商并填入 API Key',
        );
        return;
      }

      this.logger.log(`从数据库加载 ${dbConfigs.length} 个已启用的 AI Provider 配置`);
      let embeddingProvider: string | null = null;

      for (const cfg of dbConfigs) {
        const provider = this.providers.get(cfg.providerId);
        if (provider) {
          provider.initialize(cfg);
          this.logger.log(`Provider ${cfg.providerId} 已从数据库配置初始化`);

          // First embedding-capable provider is the embedding route
          if (!embeddingProvider) {
            const preset = findPreset(cfg.providerId);
            if (preset?.supportsEmbedding || cfg.embeddingModel) {
              embeddingProvider = cfg.providerId;
            }
          }
        } else {
          this.logger.warn(
            `数据库中有 Provider ${cfg.providerId} 配置，但无对应实现实例（可能未在 PROVIDER_PRESETS 中注册）`,
          );
        }
      }

      // Auto-infer routing strategy
      this.inferRouting(dbConfigs, embeddingProvider);
    } catch (err) {
      this.logger.error(`从数据库读取 Provider 配置失败: ${(err as Error).message}`);
    }
  }

  /**
   * Auto-infer routing strategy from the enabled provider list
   *
   * Strategy:
   *   - codegen: prefer a provider with codegenModel, otherwise the first one
   *   - chat/intent/analysis: the first enabled provider
   *   - embedding: the first embedding-capable provider
   */
  private inferRouting(configs: ProviderConfig[], embeddingProvider: string | null): void {
    if (configs.length === 0) return;

    const first = configs[0].providerId;
    const codegen = configs.find((c) => c.codegenModel)?.providerId || first;
    const embedding = embeddingProvider || first;

    this.routing = {
      codegen: codegen as LLMProviderId,
      chat: first as LLMProviderId,
      intent: first as LLMProviderId,
      analysis: first as LLMProviderId,
      embedding: embedding as LLMProviderId,
    };

    this.logger.log(`路由策略已自动推断: ${JSON.stringify(this.routing)}`);
  }

  onModuleDestroy(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /** Whether AI is enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Synchronous generation (route by task type + fallback)
   */
  async generate(req: LLMRequest, taskType: TaskType = 'chat'): Promise<LLMResponse> {
    this.assertEnabled();

    // P1-T09: safety filter - user input check
    if (this.safetyGuard) {
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')?.content;
      if (lastUserMsg) {
        const safetyResult = this.safetyGuard.filterInput(lastUserMsg);
        if (!safetyResult.passed) {
          throw new Error(`输入被安全过滤拦截：${safetyResult.reason}`);
        }
      }
    }

    const primary = this.routing[taskType];
    const fallback = this.getFallbackProvider(primary, taskType);

    const tried = new Set<LLMProviderId>();
    // User-specified provider takes priority (overrides task-type routing); fall back to routing queue if not ready
    // Build-time check of fallback queue: include only ready providers
    const queue = this.buildQueue(req.providerId, primary, fallback);

    let lastErr: unknown;
    for (const pid of queue) {
      if (tried.has(pid)) continue;
      tried.add(pid);
      const provider = this.providers.get(pid);
      if (!provider || !provider.isReady()) {
        const reason = pid === req.providerId ? '用户指定但未配置 API Key' : '不可用';
        this.logger.warn(`Provider ${pid} ${reason}，尝试下一个`);
        continue;
      }
      try {
        const response = await provider.generate(req);

        // P1-T09: safety filter - output sanitization
        if (this.safetyGuard && response?.content) {
          const safetyResult = this.safetyGuard.sanitizeOutput(response.content);
          if (safetyResult.content !== undefined) {
            response.content = safetyResult.content;
          }
        }

        return response;
      } catch (err) {
        lastErr = err;
        this.logger.warn(`Provider ${pid} 生成失败：${(err as Error).message}，尝试降级`);
      }
    }
    throw new Error(
      `所有 Provider 均失败，任务类型=${taskType}，最后错误：${(lastErr as Error)?.message || 'unknown'}`,
    );
  }

  /**
   * Streaming generation (route by task type + fallback)
   *
   * Note: streaming fallback happens before the first chunk; once yielding starts, no more fallback.
   */
  async *streamChat(
    req: LLMRequest,
    taskType: TaskType = 'chat',
  ): AsyncGenerator<ChatStreamChunk, void, unknown> {
    this.assertEnabled();

    // P1-T09: safety filter - user input check
    if (this.safetyGuard) {
      const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')?.content;
      if (lastUserMsg) {
        const safetyResult = this.safetyGuard.filterInput(lastUserMsg);
        if (!safetyResult.passed) {
          // Streaming errors are returned via the SSE error event
          yield {
            delta: `[ERROR] 输入被安全过滤拦截：${safetyResult.reason}`,
            done: true,
          };
          return;
        }
      }
    }

    const primary = this.routing[taskType];
    const fallback = this.getFallbackProvider(primary, taskType);

    const tried = new Set<LLMProviderId>();
    // User-specified provider takes priority (overrides task-type routing); fall back to routing queue if not ready
    const queue = this.buildQueue(req.providerId, primary, fallback);

    let lastErr: unknown;
    for (const pid of queue) {
      if (tried.has(pid)) continue;
      tried.add(pid);
      const provider = this.providers.get(pid);
      if (!provider || !provider.isReady()) {
        const reason = pid === req.providerId ? '用户指定但未配置 API Key' : '不可用';
        this.logger.warn(`Provider ${pid} ${reason}，尝试下一个`);
        continue;
      }
      try {
        // Streaming fallback: only attempted before the stream is established; no fallback once a chunk is yielded
        const generator = provider.stream(req);
        // Probe the first chunk
        const firstResult = await generator.next();
        if (firstResult.done) {
          // Empty response, continue fallback
          continue;
        }
        // Stream established, forward remaining chunks (with safety filter)
        const safeChunk = this.applySafetyToChunk(firstResult.value as ChatStreamChunk);
        yield safeChunk;
        for await (const chunk of generator) {
          yield this.applySafetyToChunk(chunk as ChatStreamChunk);
        }
        return;
      } catch (err) {
        lastErr = err;
        this.logger.warn(`Provider ${pid} 流式失败：${(err as Error).message}，尝试降级`);
      }
    }
    throw new Error(
      `所有 Provider 流式生成均失败，任务类型=${taskType}，最后错误：${(lastErr as Error)?.message || 'unknown'}`,
    );
  }

  /**
   * Embedding task (routed to the first embedding-capable provider)
   */
  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    this.assertEnabled();
    const providerId = this.routing.embedding;
    const provider = this.providers.get(providerId);
    if (!provider || !provider.isReady()) {
      throw new Error(`嵌入 Provider ${providerId} 不可用，无法降级`);
    }
    return provider.embed(req);
  }

  /** Get health status of all providers */
  async getHealth(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const [pid, provider] of this.providers) {
      const health = await provider.checkHealth();
      this.healthMap.set(pid, health);
      results.push(health);
    }
    return results;
  }

  /** Get cached health status (no new check triggered) */
  getCachedHealth(): ProviderHealth[] {
    return Array.from(this.healthMap.values());
  }

  /** Current routing strategy */
  getRouting(): RoutingConfig {
    return { ...this.routing };
  }

  // -------- Private methods --------

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error('AI 功能未启用（设置 AI_ENABLED=true 启用）');
    }
  }

  /** Get the alternate list besides the primary provider (only ready providers) */
  private getFallbackProvider(primary: LLMProviderId, _taskType: TaskType): LLMProviderId[] {
    const all: LLMProviderId[] = [];
    for (const [pid, provider] of this.providers) {
      if (pid !== primary && provider.isReady()) all.push(pid);
    }
    return all;
  }

  /** Build fallback queue: user-specified -> primary route -> ready alternates, deduplicated */
  private buildQueue(
    requestedProvider: LLMProviderId | undefined,
    primary: LLMProviderId,
    fallback: LLMProviderId[],
  ): LLMProviderId[] {
    const seen = new Set<LLMProviderId>();
    const queue: LLMProviderId[] = [];
    if (requestedProvider) {
      seen.add(requestedProvider);
      queue.push(requestedProvider);
    }
    if (!seen.has(primary)) {
      seen.add(primary);
      queue.push(primary);
    }
    for (const pid of fallback) {
      if (!seen.has(pid)) {
        seen.add(pid);
        queue.push(pid);
      }
    }
    return queue;
  }

  private startHealthCheck(): void {
    this.healthTimer = setInterval(() => {
      this.getHealth().catch((err) => {
        this.logger.error(`健康检查失败：${err.message}`);
      });
    }, HEALTH_CHECK_INTERVAL_MS);
    // Check once immediately after startup
    this.getHealth().catch(() => {
      /* Ignore first failure */
    });
  }

  /**
   * P1-T09: sanitize streaming chunks for safety
   */
  private applySafetyToChunk(chunk: ChatStreamChunk): ChatStreamChunk {
    if (!this.safetyGuard || !chunk?.delta) return chunk;
    const safetyResult = this.safetyGuard.sanitizeOutput(chunk.delta);
    if (safetyResult.content !== undefined) {
      return { ...chunk, delta: safetyResult.content };
    }
    return chunk;
  }
}
