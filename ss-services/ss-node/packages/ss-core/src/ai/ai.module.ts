// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * AI Module - backend AI service gateway
 *
 * Aggregates:
 *   - LLM Provider (unified OpenAICompatibleProvider, one instance per preset vendor)
 *   - LLMProxyService (routing + fallback + health check)
 *   - AI Controller (REST API + SSE endpoints + Provider CRUD + preset template query)
 *   - AiProviderConfigService (DB CRUD + AES encryption + preset seeding)
 *
 * Usage:
 *   import { AiModule } from '@ss-node/ss-core';
 *   @Module({ imports: [AiModule] })
 *
 * Related decisions:
 *   - D-010 multi-vendor routing + fallback
 *   - D-012 Feature Flag (AI_ENABLED)
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LLM_PROVIDERS } from './llm-provider.interface';
import { OpenAICompatibleProvider } from './openai-compatible-provider';
import { LLMProxyService } from './llm-proxy.service';
import { AiController } from './ai.controller';
import { AiProviderConfigService } from './ai-provider-config.service';
import { AiProvider } from './entities/ai-provider.entity';
import { AiConversation, AiMessage } from './entities/ai-conversation.entity';
import { AiPrompt, AiPromptVersion } from './entities/ai-prompt.entity';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { ConversationService } from './conversation.service';
import { PromptVersionService } from './prompt-version.service';
import { CostMonitorService } from './cost-monitor.service';
import { PROVIDER_PRESETS } from './provider-presets';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagGuard } from './feature-flag.guard';
import { LLMSafetyGuardService } from './llm-safety-guard.service';
import { AgentOrchestratorService } from './agent-orchestrator.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { RetrievalService } from './retrieval.service';
import { RAGQAService } from './rag-qa.service';
import { Phase2FeaturesService } from './phase2-features.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiProvider,
      AiConversation,
      AiMessage,
      AiPrompt,
      AiPromptVersion,
      AiUsageLog,
    ]),
  ],
  controllers: [AiController],
  providers: [
    FeatureFlagService,
    FeatureFlagGuard,
    LLMSafetyGuardService,
    AgentOrchestratorService,
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    RetrievalService,
    RAGQAService,
    LLMProxyService,
    AiProviderConfigService,
    // P2-T08: conversation persistence + Prompt version management + cost monitoring
    ConversationService,
    PromptVersionService,
    CostMonitorService,
    // Phase 2 smart features (A004/A005/C002/C003/E003)
    Phase2FeaturesService,
    /**
     * LLM Provider factory
     *
     * Creates an independent OpenAICompatibleProvider instance for each preset vendor.
     * Instances are distinguished by providerId (deepseek/zhipu/qwen/moonshot/ernie/openai/claude/gemini/mistral/custom).
     * The 'custom' instance handles user-defined OpenAI-compatible endpoints.
     */
    {
      provide: LLM_PROVIDERS,
      useFactory: () => {
        return PROVIDER_PRESETS.map((preset) => new OpenAICompatibleProvider(preset.providerId));
      },
    },
  ],
  exports: [
    LLMProxyService,
    AiProviderConfigService,
    FeatureFlagService,
    FeatureFlagGuard,
    LLMSafetyGuardService,
    AgentOrchestratorService,
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    RetrievalService,
    RAGQAService,
    ConversationService,
    PromptVersionService,
    CostMonitorService,
    Phase2FeaturesService,
  ],
})
export class AiModule {}
