// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Retrieval Service - P1-T08 RAG hybrid retrieval service
 *
 * Fuses two retrieval methods:
 *   - Semantic retrieval: based on vector similarity (provided by VectorStoreService)
 *   - Keyword retrieval: simple keyword matching based on BM25
 *
 * Results are re-ranked via weighted fusion (RRF / Reciprocal Rank Fusion).
 *
 * Usage:
 *   const results = await retrievalService.retrieve('How to configure Modbus?', { topK: 5 });
 */

import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService, SearchResult } from './vector-store.service';

/** Retrieval config */
export interface RetrievalConfig {
  /** Number of results to return */
  topK: number;
  /** Semantic retrieval weight (0-1) */
  semanticWeight: number;
  /** Minimum similarity */
  minSimilarity: number;
  /** Whether to fuse keyword retrieval */
  hybrid: boolean;
}

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  topK: 5,
  semanticWeight: 0.7,
  minSimilarity: 0.5,
  hybrid: true,
};

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  /**
   * Retrieve
   * @param query - user query
   * @param config - retrieval config
   */
  async retrieve(query: string, config?: Partial<RetrievalConfig>): Promise<SearchResult[]> {
    const mergedConfig = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };

    if (this.vectorStore.size() === 0) {
      this.logger.warn('向量存储为空，返回空结果');
      return [];
    }

    // 1. Semantic retrieval
    const queryVector = await this.embeddingService.embedSingle(query);
    const semanticResults = this.vectorStore.search(queryVector, {
      topK: mergedConfig.topK * 2,
      minSimilarity: mergedConfig.minSimilarity,
    });

    // 2. Keyword retrieval (if enabled)
    if (mergedConfig.hybrid) {
      const keywordResults = this.keywordSearch(query, mergedConfig.topK * 2);
      return this.fusionRank(
        semanticResults,
        keywordResults,
        mergedConfig.semanticWeight,
        mergedConfig.topK,
      );
    }

    return semanticResults.slice(0, mergedConfig.topK);
  }

  // ============================================================
  //  Keyword retrieval (simplified BM25)
  // ============================================================

  private keywordSearch(query: string, topK: number): SearchResult[] {
    // Query keywords
    const queryTerms = this.tokenize(query);

    const results: SearchResult[] = [];
    for (const entry of this.vectorStore['entries'] || []) {
      if (!entry) continue;
      const chunk = entry.chunk;
      const chunkTerms = this.tokenize(chunk.content);

      // Compute keyword match score (simplified TF-IDF)
      let score = 0;
      for (const qt of queryTerms) {
        const tf = chunkTerms.filter((t) => t === qt).length;
        if (tf > 0) {
          score += Math.log(1 + tf);
        }
      }

      // Normalize: by chunk length
      const normalizedScore =
        chunk.content.length > 0 ? score / Math.log(1 + chunk.content.length / 100) : score;

      if (normalizedScore > 0) {
        results.push({ chunk, similarity: Math.min(normalizedScore, 0.99) });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * RRF (Reciprocal Rank Fusion) re-ranking
   */
  private fusionRank(
    semantic: SearchResult[],
    keyword: SearchResult[],
    semanticWeight: number,
    topK: number,
  ): SearchResult[] {
    const keywordWeight = 1 - semanticWeight;
    const scoreMap = new Map<string, { chunk: SearchResult['chunk']; score: number }>();

    const k = 60; // RRF constant

    // Semantic retrieval ranking
    for (let i = 0; i < semantic.length; i++) {
      const r = semantic[i];
      const key = r.chunk.id;
      const current = scoreMap.get(key);
      scoreMap.set(key, {
        chunk: r.chunk,
        score: (current?.score || 0) + semanticWeight * (1 / (k + i + 1)),
      });
    }

    // Keyword retrieval ranking
    for (let i = 0; i < keyword.length; i++) {
      const r = keyword[i];
      const key = r.chunk.id;
      const current = scoreMap.get(key);
      scoreMap.set(key, {
        chunk: r.chunk,
        score: (current?.score || 0) + keywordWeight * (1 / (k + i + 1)),
      });
    }

    const sorted = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ chunk, score }) => ({ chunk, similarity: score }));

    return sorted;
  }

  // ============================================================
  //  Tokenization (simple Chinese word segmentation)
  // ============================================================

  private tokenize(text: string): string[] {
    if (!text) return [];

    // Simple tokenization: split by non-Chinese chars + unigram n-grams
    const segments = text.split(
      /[\s\n\r\t.,;:!?，。；：！？、""''「」【】《》\(\)\[\]{}<>\/\\\-_+=@#$%^&*|`~]+/,
    );

    const tokens: string[] = [];
    for (const seg of segments) {
      if (!seg) continue;
      // English words split directly by space
      if (/^[a-zA-Z0-9]+$/.test(seg)) {
        tokens.push(seg.toLowerCase());
      } else {
        // Chinese: bigram
        for (let i = 0; i < seg.length - 1; i++) {
          tokens.push(seg.substring(i, i + 2));
        }
        // Keep unigrams too (for short queries)
        if (seg.length === 1) {
          tokens.push(seg);
        }
      }
    }

    return tokens;
  }
}
