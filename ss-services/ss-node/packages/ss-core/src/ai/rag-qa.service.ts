// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * RAG QA Service - P1-T08 RAG Q&A service
 *
 * Integrates retrieval + LLM generation to provide end-to-end knowledge-base Q&A.
 *
 * Flow:
 *   1. User asks a question
 *   2. RetrievalService retrieves relevant document chunks
 *   3. Concatenate context + Prompt template
 *   4. LLM generates the answer (SSE streaming output)
 *
 * Usage:
 *   const answer = await ragQaService.ask('How to configure a Modbus TCP device?');
 */

import { Injectable, Logger } from '@nestjs/common';
import { LLMProxyService } from './llm-proxy.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService, SearchResult } from './vector-store.service';
import { RetrievalService, RetrievalConfig } from './retrieval.service';
import { ChunkingService } from './chunking.service';
import { LLMSafetyGuardService } from './llm-safety-guard.service';
import { ChatMessage, ChatStreamChunk } from './llm.types';
import { FeatureFlagService, AI_FEATURE_FLAGS } from './feature-flag.service';

/** RAG QA request */
export interface RAGQuestionRequest {
  /** User question */
  question: string;
  /** Conversation history (optional) */
  history?: ChatMessage[];
  /** Retrieval param overrides */
  retrievalConfig?: Partial<RetrievalConfig>;
}

/** RAG QA answer */
export interface RAGAnswer {
  /** Answer text */
  answer: string;
  /** Citation sources */
  sources: Array<{
    text: string;
    sourcePath: string;
    heading?: string;
  }>;
  /** Execution time (ms) */
  latencyMs: number;
}

/** RAG knowledge-base item */
export interface KnowledgeItem {
  /** Document path */
  path: string;
  /** Document content */
  content: string;
}

@Injectable()
export class RAGQAService {
  private readonly logger = new Logger(RAGQAService.name);
  private indexed = false;

  constructor(
    private readonly proxy: LLMProxyService,
    private readonly embedding: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
    private readonly retrieval: RetrievalService,
    private readonly chunking: ChunkingService,
    private readonly safetyGuard: LLMSafetyGuardService,
    private readonly featureFlag: FeatureFlagService,
  ) {}

  /**
   * Index documents
   * @param items - knowledge-base item list
   */
  async indexDocuments(items: KnowledgeItem[]): Promise<{ chunks: number; errors: number }> {
    if (!this.featureFlag.isEnabled(AI_FEATURE_FLAGS.KB)) {
      throw new Error('知识库功能未启用（Feature Flag: ai.kb.enabled）');
    }

    let totalChunks = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const chunks = this.chunking.chunk(item.content, item.path);
        const texts = chunks.map((c) => c.content);
        const embedResult = await this.embedding.embed(texts);
        this.vectorStore.addChunks(chunks, embedResult.vectors);
        totalChunks += chunks.length;
      } catch (err) {
        errors++;
        this.logger.error(`Indexing failed: ${item.path} - ${(err as Error).message}`);
      }
    }

    this.indexed = true;
    this.logger.log(`Indexing complete: ${totalChunks} chunks, ${errors} errors`);
    return { chunks: totalChunks, errors };
  }

  /**
   * Q&A (synchronous)
   * @param req - Q&A request
   * @returns answer + citation sources
   */
  async ask(req: RAGQuestionRequest): Promise<RAGAnswer> {
    const startTime = Date.now();

    // Feature Flag
    if (!this.featureFlag.isEnabled(AI_FEATURE_FLAGS.KB)) {
      throw new Error('知识库功能未启用（Feature Flag: ai.kb.enabled）');
    }

    // Safety filter
    const safetyResult = this.safetyGuard.filterInput(req.question);
    if (!safetyResult.passed) {
      throw new Error(`输入被安全过滤拦截：${safetyResult.reason}`);
    }

    // Retrieve
    const results = await this.retrieval.retrieve(req.question, req.retrievalConfig);

    // Sanitize context
    const chunkTexts = results.map((r) => r.chunk.content);
    const sanitized = this.safetyGuard.sanitizeContext(chunkTexts);
    if (!sanitized.passed || !sanitized.content) {
      return {
        answer: '抱歉，未找到相关知识，或检索内容被安全过滤。',
        sources: [],
        latencyMs: Date.now() - startTime,
      };
    }

    // Build prompt
    const messages = this.buildRAGPrompt(req.question, sanitized.content, results, req.history);

    // LLM generation
    const response = await this.proxy.generate({ messages, stream: false }, 'chat');

    const latencyMs = Date.now() - startTime;

    return {
      answer: response.content || '(无响应)',
      sources: results.slice(0, 5).map((r) => ({
        text: r.chunk.content.substring(0, 200),
        sourcePath: r.chunk.sourcePath,
        heading: r.chunk.metadata.heading,
      })),
      latencyMs,
    };
  }

  /**
   * Q&A (streaming)
   * @returns AsyncGenerator, each chunk is SSE text
   */
  async *askStream(req: RAGQuestionRequest): AsyncGenerator<ChatStreamChunk, void, unknown> {
    if (!this.featureFlag.isEnabled(AI_FEATURE_FLAGS.KB)) {
      yield { delta: '[ERROR] 知识库功能未启用', done: true };
      return;
    }

    // Safety filter
    const safetyResult = this.safetyGuard.filterInput(req.question);
    if (!safetyResult.passed) {
      yield { delta: `[ERROR] 输入被安全过滤拦截：${safetyResult.reason}`, done: true };
      return;
    }

    // Retrieve
    const results = await this.retrieval.retrieve(req.question, req.retrievalConfig);
    const chunkTexts = results.map((r) => r.chunk.content);
    const sanitized = this.safetyGuard.sanitizeContext(chunkTexts);

    if (!sanitized.passed || !sanitized.content) {
      yield { delta: '抱歉，未找到相关知识。', done: true };
      return;
    }

    const messages = this.buildRAGPrompt(req.question, sanitized.content, results, req.history);

    // Streaming generation
    yield* this.proxy.streamChat({ messages, stream: true }, 'chat');
  }

  /**
   * Whether indexing has been done
   */
  isIndexed(): boolean {
    return this.indexed;
  }

  /**
   * Reset index
   */
  reset(): void {
    this.vectorStore.clear();
    this.indexed = false;
    this.logger.log('Index reset');
  }

  // ============================================================
  //  Prompt template
  // ============================================================

  private buildRAGPrompt(
    question: string,
    context: string,
    sources: SearchResult[],
    history?: ChatMessage[],
  ): ChatMessage[] {
    const sourceInfo = sources
      .slice(0, 3)
      .map((s, i) => `[${i + 1}] ${s.chunk.metadata.heading || s.chunk.sourcePath}`)
      .join('\n');

    const systemPrompt = `你是一个专业 SCADA 系统知识助手。
请根据以下参考资料回答用户问题。如果资料中没有相关信息，请如实告知。

【参考资料】
${context}

【引用来源】
${sourceInfo}

回答要求：
- 基于参考资料回答，不要编造
- 回答末尾标注引用来源编号
- 使用中文回答
- 如果问题涉及操作步骤，请按步骤清晰列出`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(history || []),
      { role: 'user', content: question },
    ];

    return messages;
  }
}
