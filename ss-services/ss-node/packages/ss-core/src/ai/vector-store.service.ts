// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Vector Store - P1-T08 RAG vector storage service
 *
 * Phase 1: in-memory vector storage (cosine-similarity retrieval)
 * Phase 2: migrate to pgvector + HNSW index
 *
 * Usage:
 *   await vectorStore.addChunks(chunks, embeddings);
 *   const results = await vectorStore.search(queryVector, { topK: 5 });
 */

import { Injectable, Logger } from '@nestjs/common';
import { TextChunk } from './chunking.service';

/** Vector entry */
export interface VectorEntry {
  chunk: TextChunk;
  vector: number[];
}

/** Retrieval config */
export interface SearchConfig {
  /** Number of results to return */
  topK: number;
  /** Minimum similarity threshold (0-1) */
  minSimilarity: number;
}

/** Retrieval result */
export interface SearchResult {
  chunk: TextChunk;
  /** Cosine similarity (0-1) */
  similarity: number;
}

const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  topK: 5,
  minSimilarity: 0.5,
};

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private entries: VectorEntry[] = [];

  /**
   * Add chunk + vector
   */
  addChunk(chunk: TextChunk, vector: number[]): void {
    this.entries.push({ chunk, vector });
  }

  /**
   * Batch add
   */
  addChunks(chunks: TextChunk[], vectors: number[][]): void {
    if (chunks.length !== vectors.length) {
      throw new Error(`块数与向量数不匹配: ${chunks.length} vs ${vectors.length}`);
    }
    for (let i = 0; i < chunks.length; i++) {
      this.entries.push({ chunk: chunks[i], vector: vectors[i] });
    }
    this.logger.log(`已添加 ${chunks.length} 个向量块，总计 ${this.entries.length}`);
  }

  /**
   * Cosine-similarity search
   * @param queryVector - query vector
   * @param config - retrieval config
   * @returns results sorted descending by similarity
   */
  search(queryVector: number[], config?: Partial<SearchConfig>): SearchResult[] {
    const mergedConfig = { ...DEFAULT_SEARCH_CONFIG, ...config };

    if (this.entries.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const entry of this.entries) {
      const similarity = this.cosineSimilarity(queryVector, entry.vector);
      if (similarity >= mergedConfig.minSimilarity) {
        results.push({ chunk: entry.chunk, similarity });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, mergedConfig.topK);
  }

  /**
   * Clear the vector store
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get entry count
   */
  size(): number {
    return this.entries.length;
  }

  // ============================================================
  //  Cosine similarity computation
  // ============================================================

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`向量维度不匹配: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
