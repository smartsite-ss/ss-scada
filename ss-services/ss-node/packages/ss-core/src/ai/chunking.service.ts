// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Chunking Service - P1-T08 RAG document chunker
 *
 * Splits Markdown documents into overlapping text chunks by semantic boundaries.
 * Supports two chunking strategies:
 *   - heading: split by Markdown headings
 *   - fixed: fixed-size + overlapping-window chunking
 *
 * Phase 1 implementation: simple version (no NLP sentence splitter dependency).
 *
 * Usage:
 *   const chunks = chunkingService.chunk(markdownText, { strategy: 'heading' });
 */

import { Injectable, Optional } from '@nestjs/common';

/** Text chunk */
export interface TextChunk {
  /** Chunk ID */
  id: string;
  /** Chunk content */
  content: string;
  /** Source document path */
  sourcePath: string;
  /** In-document index (0-based) */
  chunkIndex: number;
  /** Metadata (heading level, etc.) */
  metadata: {
    /** Section heading it belongs to */
    heading?: string;
    /** Heading level (1-6) */
    headingLevel?: number;
    /** Chunk start character position */
    startPos: number;
    /** Chunk end character position */
    endPos: number;
  };
}

/** Chunking strategy */
export type ChunkStrategy = 'heading' | 'fixed';

/** Chunking config */
export interface ChunkConfig {
  /** Chunking strategy */
  strategy: ChunkStrategy;
  /** Fixed chunk size (char count, for the fixed strategy) */
  chunkSize: number;
  /** Inter-chunk overlap character count */
  overlap: number;
  /** Minimum chunk size (chunks smaller than this are merged into the previous chunk) */
  minChunkSize: number;
}

const DEFAULT_CONFIG: ChunkConfig = {
  strategy: 'heading',
  chunkSize: 1000,
  overlap: 200,
  minChunkSize: 100,
};

@Injectable()
export class ChunkingService {
  private config: ChunkConfig;

  constructor(@Optional() config: Partial<ChunkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Chunking main entry point
   * @param text - full document text
   * @param sourcePath - source path
   * @param options - overrides for the default config
   */
  chunk(text: string, sourcePath: string, options?: Partial<ChunkConfig>): TextChunk[] {
    const cfg = { ...this.config, ...options };
    return cfg.strategy === 'heading'
      ? this.chunkByHeading(text, sourcePath, cfg)
      : this.chunkByFixedSize(text, sourcePath, cfg);
  }

  // ============================================================
  //  Chunk by heading
  // ============================================================

  private chunkByHeading(text: string, sourcePath: string, cfg: ChunkConfig): TextChunk[] {
    const lines = text.split('\n');
    const chunks: TextChunk[] = [];
    let currentHeading = '';
    let currentLevel = 0;
    let currentContent: string[] = [];
    let startPos = 0;
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

      if (headingMatch) {
        // save the current chunk
        if (currentContent.length > 0) {
          const content = currentContent.join('\n').trim();
          if (content.length >= cfg.minChunkSize) {
            chunks.push({
              id: `${sourcePath}#c${chunkIndex}`,
              content,
              sourcePath,
              chunkIndex,
              metadata: {
                heading: currentHeading || undefined,
                headingLevel: currentLevel || undefined,
                startPos,
                endPos: startPos + content.length,
              },
            });
            chunkIndex++;
          }
        }

        currentHeading = headingMatch[2];
        currentLevel = headingMatch[1].length;
        currentContent = [line];
        startPos = text.indexOf(line, startPos);
      } else if (line.trim()) {
        currentContent.push(line);
      }
    }

    // last chunk
    if (currentContent.length > 0) {
      const content = currentContent.join('\n').trim();
      if (content.length >= cfg.minChunkSize) {
        chunks.push({
          id: `${sourcePath}#c${chunkIndex}`,
          content,
          sourcePath,
          chunkIndex,
          metadata: {
            heading: currentHeading || undefined,
            headingLevel: currentLevel || undefined,
            startPos,
            endPos: startPos + content.length,
          },
        });
      }
    }

    return chunks;
  }

  // ============================================================
  //  Fixed-size chunking
  // ============================================================

  private chunkByFixedSize(text: string, sourcePath: string, cfg: ChunkConfig): TextChunk[] {
    const chunks: TextChunk[] = [];
    const { chunkSize, overlap, minChunkSize } = cfg;

    if (text.length < minChunkSize) {
      return [
        {
          id: `${sourcePath}#c0`,
          content: text,
          sourcePath,
          chunkIndex: 0,
          metadata: { startPos: 0, endPos: text.length },
        },
      ];
    }

    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      // try to split at a paragraph boundary
      if (end < text.length) {
        const paragraphBreak = text.lastIndexOf('\n\n', end);
        if (paragraphBreak > start + minChunkSize) {
          end = paragraphBreak;
        }
      }

      const content = text.substring(start, end).trim();
      if (content.length >= minChunkSize) {
        chunks.push({
          id: `${sourcePath}#c${chunkIndex}`,
          content,
          sourcePath,
          chunkIndex,
          metadata: { startPos: start, endPos: end },
        });
        chunkIndex++;
      }

      start = end - overlap;
    }

    return chunks;
  }
}
