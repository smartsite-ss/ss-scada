// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Embedding Service - P1-T08 RAG text embedding service
 *
 * Calls the AI provider's embedding endpoint to convert text into vectors.
 * Reuses LLMProxyService's routing/fallback capabilities.
 *
 * Usage:
 *   const vectors = await embeddingService.embed(['text1', 'text2']);
 *   // -> [ [0.123, -0.456, ...], [0.789, -0.012, ...] ]
 */

import { Injectable, Logger } from '@nestjs/common';
import { LLMProxyService } from './llm-proxy.service';

/** Embedding request */
export interface EmbedRequest {
  texts: string[];
  /** Embedding model (auto-selected by default) */
  model?: string;
}

/** Embedding result */
export interface EmbedResult {
  /** Vector list (one-to-one with input texts) */
  vectors: number[][];
  /** Vector dimension */
  dimension: number;
  /** Model used */
  model: string;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private cachedDimension = 0;

  constructor(private readonly proxy: LLMProxyService) {}

  /**
   * Single text embedding
   */
  async embedSingle(text: string): Promise<number[]> {
    const result = await this.embed([text]);
    return result.vectors[0];
  }

  /**
   * Batch text embedding
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    if (!texts.length) {
      return { vectors: [], dimension: this.cachedDimension, model: 'unknown' };
    }

    try {
      const response = await this.proxy.embed({
        inputs: texts,
      });

      if (response?.embeddings) {
        this.cachedDimension = response.dimension || response.embeddings[0]?.length || 0;
        return {
          vectors: response.embeddings,
          dimension: this.cachedDimension,
          model: response.model || 'unknown',
        };
      }

      throw new Error('嵌入响应格式错误');
    } catch (err) {
      this.logger.error(`Embedding failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Get cached vector dimension
   */
  getDimension(): number {
    return this.cachedDimension;
  }
}
