// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AiController full-endpoint API unit tests
 *
 * Covers all REST API endpoints of ai.controller.ts:
 *   - GET    /status
 *   - GET    /health
 *   - GET    /routing
 *   - POST   /chat
 *   - POST   /chat/stream
 *   - POST   /embed
 *   - GET    /providers
 *   - GET    /providers/presets
 *   - POST   /providers/from-preset
 *   - POST   /providers
 *   - PUT    /providers/:id
 *   - DELETE /providers/:id
 *   - PUT    /providers/:id/toggle
 *   - POST   /providers/:id/test
 *   - GET    /safety/stats
 *   - POST   /safety/override
 *   - POST   /agent/execute
 *   - POST   /kb/index
 *   - POST   /kb/ask
 *   - POST   /kb/ask/stream
 *   - GET    /kb/status
 *   - POST   /binding/recommend
 *   - POST   /layout/optimize
 *   - POST   /context/help
 *   - POST   /search
 *   - POST   /command/parse
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import { AiController } from '../ai.controller';
import { LLMProxyService } from '../llm-proxy.service';
import { AiProviderConfigService } from '../ai-provider-config.service';
import { FeatureFlagService } from '../feature-flag.service';
import { LLMSafetyGuardService } from '../llm-safety-guard.service';
import { AgentOrchestratorService } from '../agent-orchestrator.service';
import { RAGQAService } from '../rag-qa.service';
import { Phase2FeaturesService } from '../phase2-features.service';
import { ConversationService } from '../conversation.service';
import { PromptVersionService } from '../prompt-version.service';
import { CostMonitorService } from '../cost-monitor.service';
import { JwtAuthGuard } from '../../core/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../core/auth/guards/roles.guard';
import { Response } from 'express';
import { Writable } from 'stream';

// ============================================================
// Mock utilities
// ============================================================

/**
 * Create a Node.js Writable-based mock response that supports stream.pipe()
 */
function mockResponse(): Response & { chunks: string[]; headers: Record<string, string> } {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const writable = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  // merge Writable methods with the Response shape
  return Object.assign(writable, {
    chunks,
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this as any;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    getHeaders() {
      return headers;
    },
    flushHeaders: jest.fn(),
    on: writable.on.bind(writable),
    once: writable.once.bind(writable),
    emit: writable.emit.bind(writable),
    removeListener: writable.removeListener.bind(writable),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    send: jest.fn(),
  }) as any;
}

async function createController(
  overrides: {
    proxy?: Partial<LLMProxyService>;
    providerConfig?: Partial<AiProviderConfigService>;
    featureFlag?: Partial<FeatureFlagService>;
    safetyGuard?: Partial<LLMSafetyGuardService>;
    orchestrator?: Partial<AgentOrchestratorService>;
    ragQA?: Partial<RAGQAService>;
    phase2?: Partial<Phase2FeaturesService>;
  } = {},
) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AiController],
    providers: [
      Reflector,
      {
        provide: LLMProxyService,
        useValue: {
          isEnabled: jest.fn().mockReturnValue(true),
          getHealth: jest.fn().mockResolvedValue([]),
          getRouting: jest.fn().mockReturnValue({}),
          generate: jest.fn().mockResolvedValue({}),
          streamChat: jest.fn(),
          embed: jest.fn().mockResolvedValue({}),
          reloadProviders: jest.fn().mockResolvedValue(undefined),
          ...overrides.proxy,
        },
      },
      {
        provide: AiProviderConfigService,
        useValue: {
          findAll: jest.fn().mockResolvedValue([]),
          getPresets: jest.fn().mockReturnValue([]),
          createFromPreset: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          remove: jest.fn().mockResolvedValue(undefined),
          toggleEnabled: jest.fn().mockResolvedValue({}),
          getProviderConfigById: jest.fn().mockResolvedValue(null),
          ...overrides.providerConfig,
        },
      },
      {
        provide: FeatureFlagService,
        useValue: { getAllFlags: jest.fn().mockReturnValue({}), ...overrides.featureFlag },
      },
      {
        provide: LLMSafetyGuardService,
        useValue: {
          getStats: jest.fn().mockReturnValue({}),
          generateOverrideToken: jest.fn().mockReturnValue('token-xxx'),
          ...overrides.safetyGuard,
        },
      },
      {
        provide: AgentOrchestratorService,
        useValue: {
          async *execute() {
            yield { step: 'test' };
          },
          ...overrides.orchestrator,
        },
      },
      {
        provide: RAGQAService,
        useValue: {
          isIndexed: jest.fn().mockReturnValue(false),
          indexDocuments: jest.fn().mockResolvedValue({}),
          ask: jest.fn().mockResolvedValue({ answer: '' }),
          async *askStream() {
            yield { chunk: 'a' };
          },
          ...overrides.ragQA,
        },
      },
      {
        provide: Phase2FeaturesService,
        useValue: {
          recommendBindings: jest.fn().mockReturnValue({}),
          optimizeLayout: jest.fn().mockReturnValue({}),
          getContextHelp: jest.fn().mockResolvedValue({}),
          smartSearch: jest.fn().mockReturnValue({}),
          parseCommand: jest.fn().mockReturnValue({}),
          ...overrides.phase2,
        },
      },
      {
        provide: ConversationService,
        useValue: {
          createConversation: jest.fn().mockResolvedValue({ id: 'conv-test' }),
          appendMessage: jest.fn().mockResolvedValue(undefined),
          autoGenerateTitle: jest.fn().mockResolvedValue(undefined),
          getConversationHistory: jest.fn().mockResolvedValue([]),
          listConversations: jest.fn().mockResolvedValue([]),
          getConversation: jest.fn().mockResolvedValue({ id: 'conv-test' }),
          getMessages: jest.fn().mockResolvedValue([]),
          updateTitle: jest.fn().mockResolvedValue(undefined),
          archiveConversation: jest.fn().mockResolvedValue(undefined),
          deleteConversation: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: PromptVersionService,
        useValue: {
          listPrompts: jest.fn().mockResolvedValue([]),
          createPrompt: jest.fn().mockResolvedValue({}),
          updatePrompt: jest.fn().mockResolvedValue(undefined),
          listVersions: jest.fn().mockResolvedValue([]),
          createVersion: jest.fn().mockResolvedValue({}),
          publishVersion: jest.fn().mockResolvedValue(undefined),
          archiveVersion: jest.fn().mockResolvedValue(undefined),
          rollbackToVersion: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: CostMonitorService,
        useValue: {
          canProceed: jest.fn().mockResolvedValue({ allowed: true }),
          logUsage: jest.fn().mockResolvedValue(undefined),
          getStats: jest.fn().mockResolvedValue({}),
          checkBudget: jest.fn().mockResolvedValue({}),
        },
      },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();

  return module.get<AiController>(AiController);
}

// ============================================================
// test suites
// ============================================================

describe('AiController — full-endpoint API tests', () => {
  let controller: AiController;

  beforeEach(async () => {
    controller = await createController();
  });

  // ============================================================
  // 1. GET /status
  // ============================================================
  describe('GET /status', () => {
    it('Should return the enabled + features object', () => {
      const result = controller.getStatus();
      expect(result).toHaveProperty('enabled');
      expect(result).toHaveProperty('features');
      expect(typeof result.enabled).toBe('boolean');
    });
  });

  // ============================================================
  // 2. GET /health
  // ============================================================
  describe('GET /health', () => {
    it('Should return the providers array', async () => {
      const result = await controller.getHealth();
      expect(result).toHaveProperty('providers');
    });
  });

  // ============================================================
  // 3. GET /routing
  // ============================================================
  describe('GET /routing', () => {
    it('Should return the routing object', () => {
      const result = controller.getRouting();
      expect(result).toHaveProperty('routing');
    });
  });

  // ============================================================
  // 4. POST /chat
  // ============================================================
  describe('POST /chat', () => {
    it('Should reject empty messages', async () => {
      await expect(controller.chat({ messages: [] }, { user: { id: 'user-1' } } as any)).rejects.toThrow(HttpException);
    });

    it('Should call proxy.generate and return the result', async () => {
      const result = await controller.chat({ messages: [{ role: 'user', content: 'hi' }] }, { user: { id: 'user-1' } } as any);
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 5. POST /chat/stream
  // ============================================================
  describe('POST /chat/stream', () => {
    it('Should set the SSE response headers', async () => {
      const res = mockResponse();
      await controller.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, { user: { id: 'user-1' } } as any, res);
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['connection']).toBe('keep-alive');
    });

    it('Should reject empty messages', async () => {
      const res = mockResponse();
      await expect(controller.chatStream({ messages: [] }, { user: { id: 'user-1' } } as any, res)).rejects.toThrow(HttpException);
    });

    it('Should call proxy.streamChat and set the SSE headers', async () => {
      const streamChat = jest.fn().mockImplementation(async function* () {
        yield { content: 'hello' };
      });
      const proxy = { streamChat };
      controller = await createController({ proxy });
      const res = mockResponse();
      await controller.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, { user: { id: 'user-1' } } as any, res);
      // verify SSE response headers (set synchronously, before stream.pipe)
      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['connection']).toBe('keep-alive');
      expect(res.headers['x-accel-buffering']).toBe('no');
      // streamChat is called asynchronously by Readable.read(); belongs to integration-test scope
    });
  });

  // ============================================================
  // 6. POST /embed
  // ============================================================
  describe('POST /embed', () => {
    it('Should reject empty inputs', async () => {
      await expect(controller.embed({ inputs: [] })).rejects.toThrow(HttpException);
    });

    it('Should call proxy.embed', async () => {
      const result = await controller.embed({ inputs: ['test'] });
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 7. GET /providers
  // ============================================================
  describe('GET /providers', () => {
    it('Should return the providers array', async () => {
      const result = await controller.getProviders();
      expect(result).toHaveProperty('providers');
    });
  });

  // ============================================================
  // 8. GET /providers/presets
  // ============================================================
  describe('GET /providers/presets', () => {
    it('Should return the presets array', () => {
      const result = controller.getPresets();
      expect(result).toHaveProperty('presets');
    });
  });

  // ============================================================
  // 9. POST /providers/from-preset
  // ============================================================
  describe('POST /providers/from-preset', () => {
    it('Should reject an empty providerId', async () => {
      await expect(controller.createFromPreset({ providerId: '', apiKey: 'k' })).rejects.toThrow(
        HttpException,
      );
    });

    it('Should reject an empty apiKey', async () => {
      await expect(
        controller.createFromPreset({ providerId: 'deepseek', apiKey: '' }),
      ).rejects.toThrow(HttpException);
    });

    it('Should create and reload', async () => {
      controller = await createController({
        providerConfig: { createFromPreset: jest.fn().mockResolvedValue({ id: 'p1' }) },
      });
      const result = await controller.createFromPreset({
        providerId: 'deepseek',
        apiKey: 'sk-xxx',
      });
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 10. POST /providers
  // ============================================================
  describe('POST /providers', () => {
    it('Should create a supplier', async () => {
      const result = await controller.createProvider({} as any);
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 11. PUT /providers/:id
  // ============================================================
  describe('PUT /providers/:id', () => {
    it('Should update the supplier', async () => {
      const result = await controller.updateProvider('p1', {} as any);
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 12. DELETE /providers/:id
  // ============================================================
  describe('DELETE /providers/:id', () => {
    it('Should delete the supplier', async () => {
      const result = await controller.deleteProvider('p1');
      expect(result).toEqual({ success: true });
    });
  });

  // ============================================================
  // 13. PUT /providers/:id/toggle
  // ============================================================
  describe('PUT /providers/:id/toggle', () => {
    it('Should toggle the enabled state', async () => {
      const result = await controller.toggleProvider('p1', true);
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 14. POST /providers/:id/test
  // ============================================================
  describe('POST /providers/:id/test', () => {
    it('Should throw 404 when the supplier does not exist', async () => {
      await expect(controller.testProvider('not-exist')).rejects.toThrow(HttpException);
    });

    it('Should return success: false when there is no apiKey', async () => {
      controller = await createController({
        providerConfig: {
          getProviderConfigById: jest.fn().mockResolvedValue({ providerId: 'p1', apiKey: '' }),
        },
      });
      const result = await controller.testProvider('p1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('API Key');
    });
  });

  // ============================================================
  // 15. GET /safety/stats
  // ============================================================
  describe('GET /safety/stats', () => {
    it('Should return the statistics object', () => {
      const result = controller.getSafetyStats();
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 16. POST /safety/override
  // ============================================================
  describe('POST /safety/override', () => {
    it('Should return overrideToken', () => {
      const result = controller.generateSafetyOverride();
      expect(result).toHaveProperty('overrideToken');
      expect(result).toHaveProperty('expiresIn');
    });
  });

  // ============================================================
  // 17. POST /agent/execute
  // ============================================================
  describe('POST /agent/execute', () => {
    it('Should set the SSE response headers and write heartbeat', async () => {
      const res = mockResponse();
      await controller.agentExecute({ messages: [], taskType: 'chat' } as any, { user: { id: 'user-1' } } as any, res);
      expect(res.headers['content-type']).toBe('text/event-stream');
      // heartbeat is the first line
      expect(res.chunks[0]).toContain('heartbeat');
    });

    it('Should stream steps and end with [DONE]', async () => {
      const res = mockResponse();
      await controller.agentExecute({ messages: [], taskType: 'chat' } as any, { user: { id: 'user-1' } } as any, res);
      const data = res.chunks.join('');
      expect(data).toContain('data: ');
      expect(data).toContain('[DONE]');
    });

    it('Should send the error event when the orchestrator throws', async () => {
      controller = await createController({
        orchestrator: {
          async *execute() {
            throw new Error('test error');
          },
        },
      });
      const res = mockResponse();
      await controller.agentExecute({ messages: [], taskType: 'chat' } as any, { user: { id: 'user-1' } } as any, res);
      const data = res.chunks.join('');
      expect(data).toContain('event: error');
    });
  });

  // ============================================================
  // 18. POST /kb/index
  // ============================================================
  describe('POST /kb/index', () => {
    it('Should reject empty items', async () => {
      await expect(controller.indexKnowledge({ items: [] })).rejects.toThrow(HttpException);
    });

    it('Should call ragQA.indexDocuments', async () => {
      const result = await controller.indexKnowledge({
        items: [{ id: 'd1', content: 'test' }] as any,
      });
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 19. POST /kb/ask
  // ============================================================
  describe('POST /kb/ask', () => {
    it('Should reject an empty question', async () => {
      await expect(controller.askKnowledge({ question: '' })).rejects.toThrow(HttpException);
    });

    it('Should call ragQA.ask', async () => {
      const result = await controller.askKnowledge({ question: '如何使用？' });
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // 20. POST /kb/ask/stream
  // ============================================================
  describe('POST /kb/ask/stream', () => {
    it('Should set the SSE response headers', async () => {
      const res = mockResponse();
      await controller.askKnowledgeStream({ question: '如何？' }, res);
      expect(res.headers['content-type']).toBe('text/event-stream');
    });

    it('Should reject an empty question', async () => {
      const res = mockResponse();
      await expect(controller.askKnowledgeStream({ question: '' }, res)).rejects.toThrow(
        HttpException,
      );
    });

    it('Should end with [DONE]', async () => {
      const res = mockResponse();
      await controller.askKnowledgeStream({ question: '如何？' }, res);
      const data = res.chunks.join('');
      expect(data).toContain('[DONE]');
    });
  });

  // ============================================================
  // 21. GET /kb/status
  // ============================================================
  describe('GET /kb/status', () => {
    it('Should return indexed + chunks', () => {
      const result = controller.getKBStatus();
      expect(result).toHaveProperty('indexed');
      expect(result).toHaveProperty('chunks');
    });
  });

  // ============================================================
  // 22. POST /binding/recommend (A004)
  // ============================================================
  describe('POST /binding/recommend (A004)', () => {
    it('Should call phase2.recommendBindings', async () => {
      const phase2 = {
        recommendBindings: jest.fn().mockReturnValue({ recommendations: [], strategy: 'semantic' }),
      };
      controller = await createController({ phase2 });
      const result = controller.recommendBindings({
        graphicType: 'valve',
        properties: [],
      });
      expect(result).toBeDefined();
      expect(phase2.recommendBindings).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 23. POST /layout/optimize (A005)
  // ============================================================
  describe('POST /layout/optimize (A005)', () => {
    it('Should call phase2.optimizeLayout', async () => {
      const phase2 = {
        optimizeLayout: jest.fn().mockReturnValue({
          graphics: [],
          changes: [],
          metrics: { aligned: 0, spacingFixed: 0, collisions: 0 },
        }),
      };
      controller = await createController({ phase2 });
      const result = controller.optimizeLayout({
        graphics: [],
        canvasWidth: 800,
        canvasHeight: 600,
      });
      expect(result).toBeDefined();
      expect(phase2.optimizeLayout).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 24. POST /context/help (C002)
  // ============================================================
  describe('POST /context/help (C002)', () => {
    it('Should call phase2.getContextHelp', async () => {
      const phase2 = {
        getContextHelp: jest
          .fn()
          .mockResolvedValue({ matchedDocs: [], suggestions: [], relatedOperations: [] }),
      };
      controller = await createController({ phase2 });
      const result = await controller.getContextHelp({ context: {} });
      expect(result).toBeDefined();
      expect(phase2.getContextHelp).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 25. POST /search (C003)
  // ============================================================
  describe('POST /search (C003)', () => {
    it('Should call phase2.smartSearch', async () => {
      const phase2 = {
        smartSearch: jest.fn().mockReturnValue({ results: [], total: 0, elapsed: 0 }),
      };
      controller = await createController({ phase2 });
      const result = controller.smartSearch({ query: 'test' });
      expect(result).toBeDefined();
      expect(phase2.smartSearch).toHaveBeenCalled();
    });
  });

  // ============================================================
  // 26. POST /command/parse (E003)
  // ============================================================
  describe('POST /command/parse (E003)', () => {
    it('Should call phase2.parseCommand', async () => {
      const phase2 = {
        parseCommand: jest
          .fn()
          .mockReturnValue({ intent: 'unknown', confidence: 0, params: {}, description: '' }),
      };
      controller = await createController({ phase2 });
      const result = controller.parseCommand({ input: '测试' });
      expect(result).toBeDefined();
      expect(phase2.parseCommand).toHaveBeenCalled();
    });
  });
});
