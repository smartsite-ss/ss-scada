// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { TagValue, TagMeta } from '@scada-editor/core';
import { useWsStore } from './ws.store';
import type { TagValueEntry } from './ws.store';

export type DataSourceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * WebSocketDriver — data source driver based on wsStore
 *
 * Split from ws.store.ts into a standalone file. Responsibilities:
 * 1. Register incremental data callbacks via wsStore.onFlushed, avoiding full $subscribe triggers
 * 2. Only callbacks entries matching the current _tags, emitting TagValue[] conforming to IDataSourceDriver.onData
 * 3. Supports write operations (sends the write:tag event via wsStore.safeEmit)
 *
 * Note: this class holds no WebSocket connection; connections are managed by wsStore.
 * It serves only as the driver adapter of DataSourceManager, converting the wsStore data stream into the driver protocol.
 */
export class WebSocketDriver {
  private _status: DataSourceStatus = 'disconnected';
  private _callbacks: Array<(values: TagValue[]) => void> = [];
  private _tags: string[] = [];
  /** Unsubscribe handle for the onFlushed callback registered to wsStore */
  private _unregisterFlushed: (() => void) | null = null;

  getStatus(): DataSourceStatus {
    return this._status;
  }

  async connect(config?: unknown): Promise<void> {
    this._status = 'connecting';

    const wsStore = useWsStore();
    const cfg = config as Record<string, unknown> | undefined;

    const projectId = (cfg?.projectId as string) ?? wsStore.subscribedProjectId ?? '';
    const deviceId = (cfg?.deviceId as string);

    if (!projectId) {
      this._status = 'error';
      throw new Error('WebSocketDriver: projectId is required');
    }

    // Register the incremental callback via onFlushed, avoiding full $subscribe triggers
    if (this._unregisterFlushed) {
      this._unregisterFlushed();
      this._unregisterFlushed = null;
    }
    this._unregisterFlushed = wsStore.onFlushed((flushedEntries: Map<string, TagValueEntry>) => {
      this._onFlushed(flushedEntries);
    });

    await wsStore.connect(projectId);

    // wsStore.connect resolves directly without actually connecting when there is no token; the connection state must be verified
    if (!wsStore.isConnected) {
      // No token (not logged in) is an expected state, not an error — set disconnected without throwing
      // wsStore.error already contains a user-friendly message (e.g. "Not logged in; cannot connect WebSocket")
      // DataSourceManager will read this status via getStatus() and show "Disconnected" instead of "Error" in the panel
      this._status = 'disconnected';
      return Promise.resolve();
    }

    if (deviceId) {
      wsStore.subscribeDevice(deviceId);
    }

    if (this._tags.length > 0) {
      wsStore.subscribeTags(this._tags);
    }

    this._status = 'connected';
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    if (this._unregisterFlushed) {
      this._unregisterFlushed();
      this._unregisterFlushed = null;
    }
    this._status = 'disconnected';
    return Promise.resolve();
  }

  subscribe(tagIds: string[]): void {
    this._tags = [...new Set([...this._tags, ...tagIds])];
    const wsStore = useWsStore();
    if (wsStore.isConnected) {
      wsStore.subscribeTags(tagIds);
    }
  }

  unsubscribe(tagIds: string[]): void {
    this._tags = this._tags.filter((t) => !tagIds.includes(t));
    const wsStore = useWsStore();
    wsStore.unsubscribeTags(tagIds);
  }

  onData(callback: (values: TagValue[]) => void): void {
    this._callbacks.push(callback);
  }

  offData(callback: (values: TagValue[]) => void): void {
    this._callbacks = this._callbacks.filter((c) => c !== callback);
  }

  async write(tagId: string, value: unknown): Promise<void> {
    const wsStore = useWsStore();
    wsStore.safeEmit('write:tag', { tagId, value });
    wsStore.updateTagValue(tagId, value);
    return Promise.resolve();
  }

  getAvailableTags(): TagMeta[] {
    return [];
  }

  /**
   * Handle incremental data pushed by wsStore (only entries changed in this flush).
   * Only callbacks entries matching the current _tags, avoiding repeated pushes of unchanged values.
   * Emits TagValue[] conforming to IDataSourceDriver.onData; the sourceId placeholder is overwritten by DataSourceManager.
   */
  private _onFlushed(flushedEntries: Map<string, TagValueEntry>): void {
    // Empty _tags means no tag has been subscribed yet; no callback needed
    if (this._tags.length === 0 || flushedEntries.size === 0) return;

    const changed: TagValue[] = [];
    for (const tagId of this._tags) {
      const val = flushedEntries.get(tagId);
      if (val) {
        changed.push({
          tagId: val.tagId,
          value: val.value,
          quality: val.quality,
          timestamp: val.timestamp,
          // sourceId is overwritten by TagCache.processReceivedData in DataSourceManager._onDataReceived
          sourceId: 'websocket',
        });
      }
    }

    if (changed.length === 0) return;

    for (const cb of this._callbacks) {
      try { cb(changed); } catch { void 0; }
    }
  }
}
