// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Batch read optimizer
 *
 * Groups tags by address contiguity so they can be merged into fewer read requests.
 * Suitable for Modbus register merged reads, S7 DB-block merged reads, etc.
 */

/** Group result */
export interface BatchGroup<T> {
  /** Tags included in this batch */
  items: T[];
  /** Start address */
  startAddress: number;
  /** Total length of this batch */
  length: number;
}

export class BatchReadOptimizer {
  /**
   * Group tags by address contiguity
   *
   * Algorithm:
   *  1. Sort by address ascending
   *  2. Scan sequentially; if the gap from the previous tag <= gapThreshold and the accumulated size is within maxBatchSize, merge into the current batch
   *  3. Otherwise close the current batch and start a new one
   *
   * @param tags tag list
   * @param getAddress function to extract the address from a tag
   * @param getSize function to get the read size from a tag (default 1)
   * @param gapThreshold max allowed gap between adjacent tags (default 0, i.e. only merge fully contiguous addresses)
   * @param maxBatchSize max size per batch (default 64)
   */
  static groupByContiguousAddress<T>(
    tags: T[],
    getAddress: (tag: T) => number,
    getSize?: (tag: T) => number,
    gapThreshold: number = 0,
    maxBatchSize: number = 64,
  ): BatchGroup<T>[] {
    if (!tags || tags.length === 0) return [];

    const sizeFn = getSize ?? (() => 1);

    // Sort by address
    const sorted = [...tags]
      .map((tag) => ({ tag, address: getAddress(tag) }))
      .filter((item) => !Number.isNaN(item.address))
      .sort((a, b) => a.address - b.address);

    const batches: BatchGroup<T>[] = [];
    let batch: T[] = [];
    let batchEnd = -1;
    let batchBytes = 0;

    for (const { tag, address } of sorted) {
      const size = sizeFn(tag);
      const tagEnd = address + size;

      if (batch.length === 0) {
        batch = [tag];
        batchEnd = tagEnd;
        batchBytes = size;
      } else {
        const gap = address - batchEnd;

        if (
          gap >= 0 &&
          gap <= gapThreshold &&
          batchBytes + gap + size <= maxBatchSize &&
          batch.length < maxBatchSize
        ) {
          batch.push(tag);
          batchEnd = Math.max(batchEnd, tagEnd);
          batchBytes += gap + size;
        } else {
          batches.push({
            items: batch,
            startAddress: getAddress(batch[0]),
            length: batchBytes,
          });
          batch = [tag];
          batchEnd = tagEnd;
          batchBytes = size;
        }
      }
    }

    if (batch.length > 0) {
      batches.push({
        items: batch,
        startAddress: getAddress(batch[0]),
        length: batchBytes,
      });
    }

    return batches;
  }
}
