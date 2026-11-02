// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Offline cache type definitions
 * Aligned with the backend ss-core OfflineCacheService
 */

/** Offline cache statistics */
export interface OfflineCacheStats {
  /** Currently buffered message count */
  totalBuffered: number;
  /** Maximum capacity */
  maxCapacity: number;
  /** Earliest buffered timestamp */
  oldestTimestamp: number | null;
  /** Latest buffered timestamp */
  newestTimestamp: number | null;
  /** Full path of the dump file */
  dumpDir: string;
  /** Dump file size (bytes); null when the file does not exist */
  dumpFileSize: number | null;
}

/** Flush result */
export interface OfflineCacheFlushResult {
  /** Number of flushed messages */
  flushed: number;
}
