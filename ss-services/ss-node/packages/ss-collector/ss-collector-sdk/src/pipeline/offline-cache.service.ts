// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PersistWriterRegistry } from './persist-writer-registry';
import { DataPoint } from './interfaces';

export interface OfflineDataPoint {
  tagId: string;
  deviceId: string;
  projectId: string;
  value: number | null;
  quality: string;
  timestamp: Date;
  bufferedAt: number;
}

export interface OfflineCacheStats {
  totalBuffered: number;
  maxCapacity: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  dumpDir: string;
  dumpFileSize: number | null;
}

export interface OfflineCacheConfig {
  maxCapacity: number;
  dumpThreshold: number;
  dumpDir: string;
  autoFlushEnabled: boolean;
}

const DEFAULT_CONFIG: OfflineCacheConfig = {
  maxCapacity: 10000,
  dumpThreshold: 0.8,
  dumpDir: process.env.OFFLINE_CACHE_DIR || './data/offline_data',
  autoFlushEnabled: true,
};

@Injectable()
export class OfflineCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfflineCacheService.name);
  private readonly bufferMap = new Map<string, OfflineDataPoint>();
  private readonly config: OfflineCacheConfig;

  /** Dump throttle: timestamp of the last dump, to prevent high-frequency synchronous I/O */
  private lastDumpTime = 0;
  /** Dump throttle interval (ms) */
  private readonly dumpThrottleMs = 5000;
  /** Warning-log throttle */
  private lastWarnTime = 0;
  /** Async dump timer handle, used for debounce */
  private dumpTimer: NodeJS.Timeout | null = null;

  constructor(
    @Optional() config?: Partial<OfflineCacheConfig>,
    @Optional() private readonly writerRegistry?: PersistWriterRegistry,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onModuleInit(): void {
    this.logger.log(
      `OfflineCacheService initialized (maxCapacity=${this.config.maxCapacity}, dumpDir=${this.config.dumpDir})`,
    );
    this.ensureDumpDir();
    this.loadFromDisk();
  }

  onModuleDestroy(): void {
    this.logger.log('OfflineCacheService destroyed, dumping to disk');
    if (this.dumpTimer) clearTimeout(this.dumpTimer);
    this.dumpToDiskSync();
    this.bufferMap.clear();
  }

  buffer(tagId: string, data: OfflineDataPoint): void {
    const key = `${tagId}:${data.bufferedAt}`;
    this.bufferMap.set(key, data);

    const now = Date.now();

    // Trigger a throttled dump when capacity is exceeded
    if (this.bufferMap.size >= this.config.maxCapacity) {
      // Warning-log throttle: at most once per 30s
      if (now - this.lastWarnTime > 30000) {
        this.lastWarnTime = now;
        this.logger.warn(`Buffer full (${this.bufferMap.size}/${this.config.maxCapacity})`);
      }

      // Dump throttle: at most one async disk write per 5s, to avoid synchronous I/O on every buffer()
      if (now - this.lastDumpTime > this.dumpThrottleMs) {
        this.lastDumpTime = now;
        this.scheduleAsyncDump();
      }
    }

    // Hard-cap protection: when exceeding 2x capacity, drop the oldest 25% of data to prevent unbounded memory growth
    const hardCap = this.config.maxCapacity * 2;
    if (this.bufferMap.size > hardCap) {
      const dropCount = Math.floor(this.bufferMap.size - this.config.maxCapacity * 1.5);
      this.dropOldest(dropCount);
    }
  }

  getBufferedCount(): number {
    return this.bufferMap.size;
  }

  getBufferedData(deviceId?: string): OfflineDataPoint[] {
    const items = Array.from(this.bufferMap.values());

    if (deviceId) {
      return items.filter((item) => item.deviceId === deviceId);
    }

    return items;
  }

  async flush(maxBatch?: number): Promise<OfflineDataPoint[]> {
    const items = Array.from(this.bufferMap.values());
    const batch = maxBatch ? items.slice(0, maxBatch) : items;

    if (batch.length === 0) {
      return [];
    }

    this.logger.log(`Flushing ${batch.length} buffered items`);

    // Write back to each storage backend via PersistWriterRegistry
    let allSucceeded = true;
    if (this.writerRegistry) {
      const dataPoints: DataPoint[] = batch.map((item) => ({
        tagId: item.tagId,
        deviceId: item.deviceId,
        projectId: item.projectId,
        value: item.value,
        quality: item.quality,
        timestamp: item.timestamp,
      }));

      const writers = this.writerRegistry.getWriters();
      for (const writer of writers) {
        try {
          await writer.writeBatch(dataPoints);
          this.logger.log(`Flushed ${batch.length} items to ${writer.name}`);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Flush to ${writer.name} failed: ${errMsg}`);
          allSucceeded = false;
        }
      }
    } else {
      this.logger.warn(
        `No PersistWriterRegistry available, ${batch.length} items cannot be flushed`,
      );
      allSucceeded = false;
    }

    if (!allSucceeded) {
      this.logger.warn(`Flush incomplete, ${batch.length} items remain in buffer`);
      return [];
    }

    // All writers succeeded; remove from the buffer
    for (const item of batch) {
      const key = `${item.tagId}:${item.bufferedAt}`;
      this.bufferMap.delete(key);
    }

    if (this.bufferMap.size > 0) {
      this.dumpToDiskSync();
    } else {
      this.clearDiskDump();
    }

    return batch;
  }

  clear(): void {
    this.logger.log(`Clearing ${this.bufferMap.size} buffered items`);
    this.bufferMap.clear();
    this.clearDiskDump();
  }

  isBufferFull(): boolean {
    return this.bufferMap.size >= this.config.maxCapacity;
  }

  getBufferStats(): OfflineCacheStats {
    const items = Array.from(this.bufferMap.values());
    const timestamps = items.map((i) => i.bufferedAt).filter((t) => t > 0);

    let dumpFileSize: number | null = null;
    const dumpPath = this.getDumpFilePath();
    try {
      if (fs.existsSync(dumpPath)) {
        dumpFileSize = fs.statSync(dumpPath).size;
      }
    } catch {
      // Ignore stat errors
    }

    return {
      totalBuffered: this.bufferMap.size,
      maxCapacity: this.config.maxCapacity,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null,
      dumpDir: dumpPath,
      dumpFileSize,
    };
  }

  private ensureDumpDir(): void {
    try {
      if (!fs.existsSync(this.config.dumpDir)) {
        fs.mkdirSync(this.config.dumpDir, { recursive: true });
      }
    } catch (error) {
      this.logger.error(`Failed to create dump directory: ${error.message}`);
    }
  }

  private getDumpFilePath(): string {
    return path.join(this.config.dumpDir, 'offline-cache-dump.json');
  }

  private dumpToDiskSync(): void {
    if (this.bufferMap.size === 0) return;

    try {
      this.ensureDumpDir();
      const items = Array.from(this.bufferMap.values());
      const dumpData = JSON.stringify(items);
      fs.writeFileSync(this.getDumpFilePath(), dumpData, 'utf-8');
    } catch (error) {
      this.logger.error(
        `Failed to dump buffer to disk: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private scheduleAsyncDump(): void {
    if (this.dumpTimer) return; // a dump is already pending
    this.dumpTimer = setTimeout(() => {
      this.dumpTimer = null;
      this.dumpToDiskAsync();
    }, 1000); // 1s debounce: coalesce multiple writes within a short period
  }

  private async dumpToDiskAsync(): Promise<void> {
    if (this.bufferMap.size === 0) return;

    try {
      this.ensureDumpDir();
      const items = Array.from(this.bufferMap.values());
      const dumpData = JSON.stringify(items);
      await fs.promises.writeFile(this.getDumpFilePath(), dumpData, 'utf-8');
      this.logger.debug(`Async dumped ${items.length} items to disk`);
    } catch (error) {
      this.logger.error(
        `Failed to async dump buffer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Drop the N oldest entries in the buffer (ordered by bufferedAt) to prevent unbounded memory growth
   */
  private dropOldest(count: number): void {
    const entries = Array.from(this.bufferMap.entries());
    entries.sort((a, b) => a[1].bufferedAt - b[1].bufferedAt);
    const toDrop = entries.slice(0, Math.min(count, entries.length));
    for (const [key] of toDrop) {
      this.bufferMap.delete(key);
    }
    this.logger.warn(
      `Dropped ${toDrop.length} oldest items from buffer (remaining: ${this.bufferMap.size})`,
    );
  }

  private loadFromDisk(): void {
    try {
      const dumpPath = this.getDumpFilePath();
      if (!fs.existsSync(dumpPath)) return;

      const raw = fs.readFileSync(dumpPath, 'utf-8');
      const items: OfflineDataPoint[] = JSON.parse(raw);

      if (items.length > 0) {
        // Load at most maxCapacity entries into memory; keep the rest in the disk file
        const toLoad = items.slice(-this.config.maxCapacity);
        const dropped = items.length - toLoad.length;
        for (const item of toLoad) {
          item.timestamp = new Date(item.timestamp);
          const key = `${item.tagId}:${item.bufferedAt}`;
          this.bufferMap.set(key, item);
        }
        this.logger.log(
          `Loaded ${toLoad.length} items from disk dump` +
            (dropped > 0 ? ` (dropped ${dropped} oldest items exceeding maxCapacity)` : ''),
        );
        // If truncated, update the disk file
        if (dropped > 0) {
          fs.writeFileSync(dumpPath, JSON.stringify(toLoad), 'utf-8');
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to load buffer from disk: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private clearDiskDump(): void {
    try {
      const dumpPath = this.getDumpFilePath();
      if (fs.existsSync(dumpPath)) {
        fs.unlinkSync(dumpPath);
      }
    } catch (error) {
      this.logger.error(`Failed to clear disk dump: ${error.message}`);
    }
  }
}
