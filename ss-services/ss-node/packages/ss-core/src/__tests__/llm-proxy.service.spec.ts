// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * LLMProxyService unit tests - P1-T03
 *
 * Verified:
 *   1. task routing policy (codegen->deepseek, chat->zhipu, embedding->zhipu)
 *   2. fallback to the alternate Provider when the primary fails
 *   3. error thrown when all Providers are unavailable
 *   4. Feature Flag (all calls disabled when AI_ENABLED=false)
 *   5. embedding tasks are always routed to Zhipu
 *   6. health-status caching
 */

import { LLMProxyService } from '../ai/llm-proxy.service';
import { ILLMProvider } from '../ai/llm-provider.interface';
import {
  ChatStreamChunk,
  DEFAULT_ROUTING,
  EmbeddingResponse,
  LLMProviderId,
  LLMRequest,
  LLMResponse,
  ProviderConfig,
  ProviderHealth,
} from '../ai/llm.types';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

// ---- Test helpers ----

function makeProviderConfig(id: LLMProviderId): ProviderConfig {
  return {
    providerId: id,
    apiKey: `key-${id}`,
    apiBase: `https://${id}.example.com/v1`,
    defaultModel: `${id}-default`,
    timeout: 5000,
    maxRetries: 1,
    embeddingModel: id === 'zhipu' ? 'embedding-3' : undefined,
    embeddingDim: id === 'zhipu' ? 1024 : undefined,
    liteModel: id === 'zhipu' ? 'glm-4-flash' : undefined,
    codegenModel: id === 'deepseek' ? 'deepseek-coder' : undefined,
  };
}

function makeLLMResponse(provider: LLMProviderId, content: string): LLMResponse {
  return {
    content,
    model: `${provider}-model`,
    role: 'assistant',
    usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    provider,
    finishReason: 'stop',
    latencyMs: 50,
  };
}

function makeEmbeddingResponse(): EmbeddingResponse {
  return {
    embeddings: [[0.1, 0.2, 0.3]],
    model: 'embedding-3',
    dimension: 3,
    usage: { promptTokens: 5, totalTokens: 5 },
    provider: 'zhipu',
  };
}

function makeHealth(id: LLMProviderId, healthy: boolean): ProviderHealth {
  return {
    providerId: id,
    healthy,
    lastCheckAt: Date.now(),
    avgLatencyMs: 30,
  };
}

/** Build a mock Provider */
function createMockProvider(
  id: LLMProviderId,
  opts: {
    ready?: boolean;
    generateImpl?: (req: LLMRequest) => Promise<LLMResponse>;
    generateError?: Error;
    streamChunks?: ChatStreamChunk[];
    streamError?: Error;
    embedImpl?: (req: any) => Promise<EmbeddingResponse>;
    embedError?: Error;
    health?: ProviderHealth;
  } = {},
): ILLMProvider {
  const ready = opts.ready !== false;
  const config = makeProviderConfig(id);

  // internal generator implementation
  async function* genImpl(): AsyncGenerator<ChatStreamChunk, void, unknown> {
    if (opts.streamError) throw opts.streamError;
    if (opts.streamChunks) {
      for (const c of opts.streamChunks) yield c;
      return;
    }
    yield { delta: `chunk-${id}`, done: false };
    yield { delta: '', done: true, finishReason: 'stop' };
  }

  // stream must be a jest.fn so it can be checked via expect().toHaveBeenCalled()
  const streamFn = jest.fn().mockImplementation(() => genImpl());

  return {
    providerId: id,
    initialize: jest.fn(),
    isReady: jest.fn().mockReturnValue(ready),
    generate: opts.generateError
      ? jest.fn().mockRejectedValue(opts.generateError)
      : opts.generateImpl
        ? jest.fn().mockImplementation(opts.generateImpl)
        : jest.fn().mockResolvedValue(makeLLMResponse(id, `response-from-${id}`)),
    stream: streamFn as any,
    embed: opts.embedError
      ? jest.fn().mockRejectedValue(opts.embedError)
      : jest.fn().mockResolvedValue(makeEmbeddingResponse()),
    checkHealth: jest.fn().mockResolvedValue(opts.health || makeHealth(id, true)),
    ...({ _config: config } as any),
  };
}

function createMockConfigService(env: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => env[key]) as any,
  } as any;
}

/**
 * Create a mock AiProviderConfigService
 *
 * After the source refactor, Provider config is loaded from the database (not env vars),
 * so the test injects this mock to simulate the enabled-Provider config list returned by the DB.
 */
function createMockProviderConfigService(configs?: ProviderConfig[]) {
  const defaultConfigs: ProviderConfig[] = configs || [
    {
      providerId: 'deepseek',
      apiKey: 'key-deepseek',
      apiBase: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      codegenModel: 'deepseek-coder',
      timeout: 5000,
      maxRetries: 1,
    },
    {
      providerId: 'zhipu',
      apiKey: 'key-zhipu',
      apiBase: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4',
      liteModel: 'glm-4-flash',
      embeddingModel: 'embedding-3',
      embeddingDim: 1024,
      timeout: 5000,
      maxRetries: 1,
    },
  ];
  return {
    ensureDefaultProviders: jest.fn().mockResolvedValue(undefined),
    getEnabledProviderConfigs: jest.fn().mockResolvedValue(defaultConfigs),
  };
}

describe('LLMProxyService', () => {
  let mockDeepseek: ReturnType<typeof createMockProvider>;
  let mockZhipu: ReturnType<typeof createMockProvider>;
  let mockConfig: ConfigService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    mockDeepseek = createMockProvider('deepseek');
    mockZhipu = createMockProvider('zhipu');
    mockConfig = createMockConfigService({
      AI_ENABLED: 'true',
      DEEPSEEK_API_KEY: 'key-deepseek',
      DEEPSEEK_API_BASE: 'https://api.deepseek.com/v1',
      DEEPSEEK_DEFAULT_MODEL: 'deepseek-chat',
      DEEPSEEK_CODEGEN_MODEL: 'deepseek-coder',
      DEEPSEEK_TIMEOUT: '5000',
      DEEPSEEK_MAX_RETRIES: '1',
      ZHIPU_API_KEY: 'key-zhipu',
      ZHIPU_API_BASE: 'https://open.bigmodel.cn/api/paas/v4',
      ZHIPU_DEFAULT_MODEL: 'glm-4',
      ZHIPU_LITE_MODEL: 'glm-4-flash',
      ZHIPU_EMBEDDING_MODEL: 'embedding-3',
      ZHIPU_EMBEDDING_DIM: '1024',
      ZHIPU_TIMEOUT: '5000',
      ZHIPU_MAX_RETRIES: '1',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(providers: ILLMProvider[] = [mockDeepseek, mockZhipu]) {
    // prevent the periodic health check
    const svc = new LLMProxyService(providers as any, mockConfig);
    // call onModuleInit to trigger initialization manually, but disable the health-check scheduler
    jest.spyOn(svc as any, 'startHealthCheck').mockImplementation(() => {});
    svc.onModuleInit();
    return svc;
  }

  // ============================================================
  // 1. routing policy
  // ============================================================
  describe('路由策略', () => {
    it('codegen 任务路由到 DeepSeek', async () => {
      const svc = createService();
      const req: LLMRequest = {
        messages: [{ role: 'user', content: '生成一段代码' }],
      };
      await svc.generate(req, 'codegen');
      expect(mockDeepseek.generate).toHaveBeenCalled();
      expect(mockZhipu.generate).not.toHaveBeenCalled();
    });

    it('chat 任务路由到智谱', async () => {
      const svc = createService();
      const req: LLMRequest = {
        messages: [{ role: 'user', content: '你好' }],
      };
      await svc.generate(req, 'chat');
      expect(mockZhipu.generate).toHaveBeenCalled();
      expect(mockDeepseek.generate).not.toHaveBeenCalled();
    });

    it('intent 任务路由到智谱', async () => {
      const svc = createService();
      await svc.generate({ messages: [{ role: 'user', content: '识别意图' }] }, 'intent');
      expect(mockZhipu.generate).toHaveBeenCalled();
      expect(mockDeepseek.generate).not.toHaveBeenCalled();
    });

    it('analysis 任务路由到智谱', async () => {
      const svc = createService();
      await svc.generate({ messages: [{ role: 'user', content: '分析数据' }] }, 'analysis');
      expect(mockZhipu.generate).toHaveBeenCalled();
      expect(mockDeepseek.generate).not.toHaveBeenCalled();
    });

    it('默认 taskType 为 chat', async () => {
      const svc = createService();
      await svc.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(mockZhipu.generate).toHaveBeenCalled();
    });

    it('getRouting 返回当前路由策略', () => {
      const svc = createService();
      const routing = svc.getRouting();
      expect(routing).toEqual(DEFAULT_ROUTING);
    });

    it('可根据数据库配置自动推断路由策略', async () => {
      // after the refactor the routing policy is inferred from the DB's enabled-Provider list, no longer read from env vars
      // simulate the DB returning: deepseek first (chat/intent/analysis/codegen -> deepseek),
      // zhipu supports embedding (embedding -> zhipu)
      const mockProviderConfigService = createMockProviderConfigService();
      const customConfig = createMockConfigService({
        AI_ENABLED: 'true',
      });
      const svc = new LLMProxyService(
        [mockDeepseek, mockZhipu] as any,
        customConfig,
        mockProviderConfigService as any,
      );
      jest.spyOn(svc as any, 'startHealthCheck').mockImplementation(() => {});
      svc.onModuleInit();
      // initializeProvidersAsync inside onModuleInit is fire-and-forget; we must await its completion
      await svc.reloadProviders();
      const routing = svc.getRouting();
      expect(routing.chat).toBe('deepseek'); // the first provider
      expect(routing.intent).toBe('deepseek');
      expect(routing.embedding).toBe('zhipu'); // provider supporting embedding
    });
  });

  // ============================================================
  // 2. fallback policy
  // ============================================================
  describe('降级策略', () => {
    it('主 Provider 抛错时降级到备选', async () => {
      mockZhipu = createMockProvider('zhipu', {
        generateError: new Error('zhipu down'),
      });
      const svc = createService();
      const result = await svc.generate({ messages: [{ role: 'user', content: 'hi' }] }, 'chat');
      // primary (zhipu) fails -> fall back to deepseek
      expect(mockZhipu.generate).toHaveBeenCalled();
      expect(mockDeepseek.generate).toHaveBeenCalled();
      expect(result.provider).toBe('deepseek');
    });

    it('所有 Provider 均失败时抛出错误', async () => {
      mockDeepseek = createMockProvider('deepseek', {
        generateError: new Error('deepseek down'),
      });
      mockZhipu = createMockProvider('zhipu', {
        generateError: new Error('zhipu down'),
      });
      const svc = createService();
      await expect(
        svc.generate({ messages: [{ role: 'user', content: 'hi' }] }, 'chat'),
      ).rejects.toThrow(/所有 Provider 均失败/);
    });

    it('Provider 不可用（isReady=false）时跳过', async () => {
      mockZhipu = createMockProvider('zhipu', { ready: false });
      const svc = createService();
      const result = await svc.generate({ messages: [{ role: 'user', content: 'hi' }] }, 'chat');
      // zhipu unavailable -> skip -> go to deepseek
      expect(mockZhipu.generate).not.toHaveBeenCalled();
      expect(result.provider).toBe('deepseek');
    });

    it('流式：主 Provider 失败时降级到备选', async () => {
      mockZhipu = createMockProvider('zhipu', {
        streamError: new Error('zhipu stream failed'),
      });
      const svc = createService();
      const chunks: ChatStreamChunk[] = [];
      for await (const c of svc.streamChat(
        { messages: [{ role: 'user', content: 'hi' }] },
        'chat',
      )) {
        chunks.push(c);
      }
      // zhipu stream fails -> fall back to deepseek
      expect(mockZhipu.stream).toHaveBeenCalled();
      expect(mockDeepseek.stream).toHaveBeenCalled();
      const deltas = chunks.filter((c) => !c.done).map((c) => c.delta);
      expect(deltas).toContain('chunk-deepseek');
    });

    it('流式：所有 Provider 均失败时抛出错误', async () => {
      mockDeepseek = createMockProvider('deepseek', {
        streamError: new Error('deepseek stream failed'),
      });
      mockZhipu = createMockProvider('zhipu', {
        streamError: new Error('zhipu stream failed'),
      });
      const svc = createService();
      await expect(
        (async () => {
          for await (const _ of svc.streamChat(
            { messages: [{ role: 'user', content: 'hi' }] },
            'chat',
          )) {
            // drain
          }
        })(),
      ).rejects.toThrow(/所有 Provider 流式生成均失败/);
    });
  });

  // ============================================================
  // 3. embedding
  // ============================================================
  describe('嵌入任务', () => {
    it('固定路由到智谱', async () => {
      const svc = createService();
      const result = await svc.embed({ inputs: ['hello'] });
      expect(mockZhipu.embed).toHaveBeenCalled();
      expect(mockDeepseek.embed).not.toHaveBeenCalled();
      expect(result.provider).toBe('zhipu');
    });

    it('智谱不可用时直接抛出（无降级）', async () => {
      mockZhipu = createMockProvider('zhipu', { ready: false });
      const svc = createService();
      await expect(svc.embed({ inputs: ['x'] })).rejects.toThrow(/不可用，无法降级/);
    });
  });

  // ============================================================
  // 4. Feature Flag
  // ============================================================
  describe('Feature Flag', () => {
    it('AI_ENABLED=false 时禁用所有调用', async () => {
      mockConfig = createMockConfigService({
        AI_ENABLED: 'false',
        DEEPSEEK_API_KEY: 'k',
        ZHIPU_API_KEY: 'k',
      });
      const svc = new LLMProxyService([mockDeepseek, mockZhipu] as any, mockConfig);
      svc.onModuleInit();
      expect(svc.isEnabled()).toBe(false);
      await expect(svc.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
        /未启用/,
      );
      await expect(
        (async () => {
          for await (const _ of svc.streamChat({
            messages: [{ role: 'user', content: 'hi' }],
          })) {
            // drain
          }
        })(),
      ).rejects.toThrow(/未启用/);
      await expect(svc.embed({ inputs: ['x'] })).rejects.toThrow(/未启用/);
    });

    it('AI_ENABLED=true 时启用', () => {
      const svc = createService();
      expect(svc.isEnabled()).toBe(true);
    });
  });

  // ============================================================
  // 5. health check
  // ============================================================
  describe('健康检查', () => {
    it('getHealth 调用所有 Provider 的 checkHealth', async () => {
      const svc = createService();
      const results = await svc.getHealth();
      expect(mockDeepseek.checkHealth).toHaveBeenCalled();
      expect(mockZhipu.checkHealth).toHaveBeenCalled();
      expect(results).toHaveLength(2);
      expect(results.find((r) => r.providerId === 'deepseek')?.healthy).toBe(true);
      expect(results.find((r) => r.providerId === 'zhipu')?.healthy).toBe(true);
    });

    it('getCachedHealth 返回缓存的健康状态', async () => {
      const svc = createService();
      await svc.getHealth(); // trigger one check
      const cached = svc.getCachedHealth();
      expect(cached).toHaveLength(2);
      expect(cached.map((c) => c.providerId).sort()).toEqual(['deepseek', 'zhipu']);
    });
  });

  // ============================================================
  // 6. initialization
  // ============================================================
  describe('Provider 初始化', () => {
    it('onModuleInit 调用各 Provider 的 initialize', async () => {
      // after the refactor onModuleInit asynchronously loads config from the DB and calls provider.initialize()
      // must inject the mock AiProviderConfigService and await async initialization
      const mockProviderConfigService = createMockProviderConfigService();
      const svc = new LLMProxyService(
        [mockDeepseek, mockZhipu] as any,
        mockConfig,
        mockProviderConfigService as any,
      );
      jest.spyOn(svc as any, 'startHealthCheck').mockImplementation(() => {});
      svc.onModuleInit();
      await svc.reloadProviders(); // wait for async initialization to finish
      expect(mockDeepseek.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'deepseek',
          apiKey: 'key-deepseek',
          defaultModel: 'deepseek-chat',
          codegenModel: 'deepseek-coder',
        }),
      );
      expect(mockZhipu.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'zhipu',
          apiKey: 'key-zhipu',
          defaultModel: 'glm-4',
          liteModel: 'glm-4-flash',
          embeddingModel: 'embedding-3',
          embeddingDim: 1024,
        }),
      );
    });
  });
});
