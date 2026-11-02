// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../api/client';
import { getWsServerUrl } from '../utils/ws-url';
import { i18n, ScadaDataManager } from '@scada-editor/core';
import type { TagValue } from '@scada-editor/core';

// WebSocketDriver has been split into a standalone file; re-exported here for backward compatibility
export { WebSocketDriver } from './WebSocketDriver';
export type { DataSourceStatus } from './WebSocketDriver';
import type { DataSourceStatus } from './WebSocketDriver';

export interface TagValueEntry {
  tagId: string;
  tagName: string;
  value: any;
  /** Formatted string produced by the backend FormatStep (e.g. "12.3"); may be empty */
  displayValue?: string;
  quality: string;
  /** Normalized to a millisecond timestamp (auto-converted when the backend pushes ISO strings) */
  timestamp: number;
  /** Active alarms (present only when the backend push includes this field; undefined when there are no alarms) */
  activeAlarms?: Array<{
    alarmId: string;
    level: string;
    condition: string;
    message: string;
  }>;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Device status change entry (corresponds to the backend device:statusChange event) */
export interface DeviceStatusEntry {
  deviceId: string;
  fromStatus: string;
  toStatus: string;
  errorMessage?: string;
  timestamp: string;
}

/** Active alarm entry (corresponds to the backend alarm:trigger event) */
export interface AlarmEntry {
  alarmId: string;
  ruleName: string;
  tagName: string;
  level: string;
  value: number;
  message: string;
  timestamp: string;
  /** Alarm status: active/acknowledged/cleared */
  state: 'active' | 'acknowledged' | 'cleared';
  acknowledgedBy?: string;
  clearedBy?: string;
}

/** System broadcast message (corresponds to the backend system:broadcast event) */
export interface SystemMessageEntry {
  message: string;
  data?: unknown;
  timestamp: string;
}

/** Normalize backend-pushed timestamps (ISO strings or numbers) into millisecond timestamps */
function toEpochMs(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    if (!Number.isNaN(ms)) return ms;
  }
  return Date.now();
}

export const useWsStore = defineStore('ws', () => {
  const socket = ref<Socket | null>(null);
  const connectionStatus = ref<ConnectionStatus>('disconnected');
  // Current client socket.id, filled after connection and cleared after disconnect; shown on the WS monitor page
  const socketId = ref<string | null>(null);
  const tagValues = shallowRef<Map<string, TagValueEntry>>(new Map());
  /** Incremented on every flushTagUpdates, letting external watch forcibly trigger computed recomputation */
  const tagFlushVersion = ref(0);
  const subscribedTags = ref<Set<string>>(new Set());
  const subscribedProjectId = ref<string | null>(null);
  const error = ref<string | null>(null);
  const reconnectAttempts = ref(0);

  // Device status, alarms, system broadcasts
  const deviceStatuses = ref<Map<string, DeviceStatusEntry>>(new Map());
  const activeAlarms = ref<Map<string, AlarmEntry>>(new Map());
  const systemMessages = ref<SystemMessageEntry[]>([]);
  const lastPongAt = ref<string | null>(null);

  // Outbound message buffer: messages emitted while disconnected are enqueued and auto-sent after reconnection
  const MAX_OUTBOUND_BUFFER = 100;
  const outboundBuffer: Array<{ event: string; data: any }> = [];
  const outboundBufferSize = ref(0);

  // Tag subscription reference counting: multiple callers (BindingManager / WebSocketDriver / DataSourceConfigDialog)
  // may each subscribe to the same tag; the server unsubscribe happens only when the ref count reaches zero
  const _tagReferenceCount = new Map<string, number>();

  // Tag value batching: use RAF to merge multiple WS updates within the same frame, reducing Vue reactive triggers
  const pendingTagUpdates = new Map<string, TagValueEntry>();
  let rafId: number | null = null;
  let flushPending = false;

  // Incremental data callback listeners: registered by WebSocketDriver (when it takes over at runtime).
  // When listeners exist, flushTagUpdates no longer emits EventBus directly, avoiding double triggering.
  const flushedListeners = new Set<(entries: Map<string, TagValueEntry>) => void>();

  /**
   * Register an incremental data callback. Returns an unsubscribe function.
   * Registered by WebSocketDriver.connect so it takes over the data stream (runtime goes through the DataSourceManager path).
   * In edit mode with no listeners, flushTagUpdates still emits EventBus directly as a fallback.
   */
  function onFlushed(cb: (entries: Map<string, TagValueEntry>) => void): () => void {
    flushedListeners.add(cb);
    return () => { flushedListeners.delete(cb); };
  }

  function flushTagUpdates() {
    flushPending = false;
    rafId = null;
    if (pendingTagUpdates.size === 0) return;
    const current = tagValues.value;
    const next = new Map(current);
    pendingTagUpdates.forEach((entry, tagId) => {
      next.set(tagId, entry);
    });
    // Save a copy for callbacks / EventBus emission (cannot iterate after clear)
    const flushedEntries = new Map(pendingTagUpdates);
    const flushTagIds = [...flushedEntries.keys()];
    pendingTagUpdates.clear();
    tagValues.value = next;
    tagFlushVersion.value++;
    // Dispatch to WebSocketDriver listeners first (runtime goes through the DataSourceManager → EventBus path)
    if (flushedListeners.size > 0) {
      for (const cb of flushedListeners) {
        try { cb(flushedEntries); } catch { void 0; }
      }
      return;
    }

    // Fallback: in edit mode without WebSocketDriver takeover, emit EventBus directly
    const eventBus = ScadaDataManager.eventBus;
    if (eventBus) {
      flushedEntries.forEach((entry, tagId) => {
        eventBus.emit('tagValueChanged', {
          tagId,
          value: entry.value,
          quality: entry.quality,
          timestamp: entry.timestamp,
        });
      });
    }
  }

  function scheduleTagFlush() {
    if (!flushPending) {
      flushPending = true;
      rafId = requestAnimationFrame(flushTagUpdates);
    }
  }

  // Heartbeat timer: sends a ping every 25s to prevent backend idle cleanup (60s) from disconnecting
  const HEARTBEAT_INTERVAL_MS = 25000;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const isConnected = computed(() => connectionStatus.value === 'connected');

  /** Safe emit: sends directly when connected; enqueues into the buffer when disconnected */
  function safeEmit(event: string, data: any): void {
    if (socket.value?.connected) {
      socket.value.emit(event, data);
    } else {
      // Buffer cap: drop the earliest messages when exceeded
      if (outboundBuffer.length >= MAX_OUTBOUND_BUFFER) {
        outboundBuffer.shift();
      }
      outboundBuffer.push({ event, data });
      outboundBufferSize.value = outboundBuffer.length;
    }
  }

  /** After reconnection, re-send the messages in the outbound buffer */
  function flushOutboundBuffer(): void {
    while (outboundBuffer.length > 0) {
      const { event, data } = outboundBuffer.shift()!;
      socket.value?.emit(event, data);
    }
    outboundBufferSize.value = 0;
  }

  function connect(projectId: string): Promise<void> {
    if (socket.value?.connected) {
      if (subscribedProjectId.value !== projectId) {
        switchProject(projectId);
      }
      return Promise.resolve();
    }

    let token = getToken();
    // Debug token fallback strategy (by priority):
    // 1. getToken() already returns a valid token → use it directly
    // 2. localStorage.scada_debug_skip_auth === '1' → the user explicitly enabled debug mode
    // 3. import.meta.env.DEV → Vite dev server mode, automatically use the debug token
    if (!token) {
      try {
        if (localStorage.getItem('scada_debug_skip_auth') === '1') {
          token = 'debug-mock-token';
        }
      } catch { /* not in browser */ }
    }
    if (!token && import.meta.env.DEV) {
      token = 'debug-mock-token';
    }
    if (!token) {
      error.value = i18n.global.t('system.ws.notLoggedIn');
      return Promise.resolve();
    }

    connectionStatus.value = 'connecting';
    error.value = null;

    // Web same-origin: page origin (Vite/reverse proxy forwarding); desktop (Tauri): backend absolute address,
    // otherwise socket.io connects to https://tauri.localhost/socket.io and real-time data stops updating (see ws-url.ts)
    const wsUrl = getWsServerUrl();

    socket.value = io(wsUrl, {
      transports: ['websocket', 'polling'],
      auth: {
        token,
        source: typeof window !== 'undefined' ? window.location.pathname : '',
        clientUrl: typeof window !== 'undefined' ? window.location.href : '',
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 10,
    });

    const connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      socket.value!.on('connect', () => {
        if (settled) return;
        settled = true;
        connectionStatus.value = 'connected';
        socketId.value = socket.value?.id ?? null;
        reconnectAttempts.value = 0;
        subscribeProject(projectId);
        flushOutboundBuffer();
        startHeartbeat();
        resolve();
      });

      socket.value!.on('connect_error', (err: any) => {
        if (settled) return;
        settled = true;
        connectionStatus.value = 'error';
        socketId.value = null;
        reconnectAttempts.value += 1;
        error.value = i18n.global.t('system.ws.connectFailed', { message: err.message });
        reject(err);
      });
    });

    socket.value.on('connection', (data: any) => {
      if (!data?.authenticated) {
        error.value = i18n.global.t('system.ws.authFailed');
      }
    });

    socket.value.on('connection:error', (data: any) => {
      error.value = i18n.global.t('system.ws.connectionRejected', {
        reason: data?.reason || 'unknown',
      });
    });

    socket.value.on('disconnect', (reason: string) => {
      connectionStatus.value = 'disconnected';
      socketId.value = null;
      stopHeartbeat();
      if (reason === 'io server disconnect') {
        error.value = i18n.global.t('system.ws.serverDisconnected');
      }
    });

    socket.value.on('data:update', (data: any) => {
      if (data?.tagId) {
        pendingTagUpdates.set(data.tagId, {
          tagId: data.tagId,
          tagName: data.tagName || '',
          value: data.value,
          displayValue: data.displayValue,
          quality: data.quality || 'good',
          timestamp: toEpochMs(data.timestamp),
          activeAlarms: data.activeAlarms,
        });
        scheduleTagFlush();
      }
    });

    socket.value.on('data:batch', (data: any) => {
      if (data?.data && Array.isArray(data.data)) {
        data.data.forEach((item: any) => {
          if (item.tagId) {
            pendingTagUpdates.set(item.tagId, {
              tagId: item.tagId,
              tagName: item.tagName || '',
              value: item.value,
              displayValue: item.displayValue,
              quality: item.quality || 'good',
              timestamp: toEpochMs(item.timestamp),
              activeAlarms: item.activeAlarms,
            });
          }
        });
        scheduleTagFlush();
      }
    });

    // Device status change: update the deviceStatuses Map
    socket.value.on('device:statusChange', (data: any) => {
      if (data?.deviceId) {
        deviceStatuses.value.set(data.deviceId, {
          deviceId: data.deviceId,
          fromStatus: data.fromStatus || '',
          toStatus: data.toStatus || '',
          errorMessage: data.errorMessage,
          timestamp: data.timestamp || new Date().toISOString(),
        });
        deviceStatuses.value = new Map(deviceStatuses.value);
      }
    });

    // Alarm triggered: add to activeAlarms
    socket.value.on('alarm:trigger', (data: any) => {
      if (data?.alarmId) {
        activeAlarms.value.set(data.alarmId, {
          alarmId: data.alarmId,
          ruleName: data.ruleName || '',
          tagName: data.tagName || '',
          level: data.level || 'warning',
          value: data.value,
          message: data.message || '',
          timestamp: data.timestamp || new Date().toISOString(),
          state: 'active',
        });
        activeAlarms.value = new Map(activeAlarms.value);
      }
    });

    // Alarm acknowledged: update status to acknowledged
    socket.value.on('alarm:acknowledged', (data: any) => {
      if (data?.alarmId) {
        const alarm = activeAlarms.value.get(data.alarmId);
        if (alarm) {
          alarm.state = 'acknowledged';
          alarm.acknowledgedBy = data.acknowledgedBy;
          activeAlarms.value = new Map(activeAlarms.value);
        }
      }
    });

    // Alarm cleared: update status to cleared
    socket.value.on('alarm:cleared', (data: any) => {
      if (data?.alarmId) {
        const alarm = activeAlarms.value.get(data.alarmId);
        if (alarm) {
          alarm.state = 'cleared';
          alarm.clearedBy = data.clearedBy;
          activeAlarms.value = new Map(activeAlarms.value);
        }
      }
    });

    // Alarm auto-recovered: update status to cleared (auto recovery)
    socket.value.on('alarm:recovered', (data: any) => {
      if (data?.alarmId) {
        const alarm = activeAlarms.value.get(data.alarmId);
        if (alarm) {
          alarm.state = 'cleared';
          alarm.clearedBy = 'system';
          activeAlarms.value = new Map(activeAlarms.value);
          // Remove recovered alarms from activeAlarms after 30s
          setTimeout(() => {
            if (activeAlarms.value.get(data.alarmId)?.state === 'cleared') {
              activeAlarms.value.delete(data.alarmId);
              activeAlarms.value = new Map(activeAlarms.value);
            }
          }, 30000);
        }
      }
    });

    // System broadcast
    socket.value.on('system:broadcast', (data: any) => {
      if (data?.message) {
        systemMessages.value.push({
          message: data.message,
          data: data.data,
          timestamp: data.timestamp || new Date().toISOString(),
        });
        // Keep only the most recent 50 entries
        if (systemMessages.value.length > 50) {
          systemMessages.value = systemMessages.value.slice(-50);
        }
      }
    });

    // Heartbeat response
    socket.value.on('pong', (data: any) => {
      lastPongAt.value = data?.timestamp || new Date().toISOString();
    });

    return connectPromise;
  }

  function subscribeProject(projectId: string) {
    if (!socket.value?.connected) return;
    safeEmit('subscribe:project', { projectId });
    subscribedProjectId.value = projectId;
  }

  function subscribeDevice(deviceId: string) {
    if (!socket.value?.connected) return;
    safeEmit('subscribe:device', { deviceId });
  }

  function subscribeTags(tagIds: string[]) {
    if (!socket.value?.connected || tagIds.length === 0) return;
    const newTagIds: string[] = [];
    for (const id of tagIds) {
      const prev = _tagReferenceCount.get(id) || 0;
      _tagReferenceCount.set(id, prev + 1);
      if (prev === 0) {
        newTagIds.push(id);
      }
    }
    if (newTagIds.length === 0) return;
    safeEmit('subscribe:tag', { tagIds: newTagIds });
    newTagIds.forEach((id) => subscribedTags.value.add(id));
  }

  function unsubscribeTags(tagIds: string[]) {
    const removedTagIds: string[] = [];
    for (const id of tagIds) {
      const prev = _tagReferenceCount.get(id);
      if (prev === undefined) continue;
      if (prev <= 1) {
        _tagReferenceCount.delete(id);
        removedTagIds.push(id);
      } else {
        _tagReferenceCount.set(id, prev - 1);
      }
    }
    if (removedTagIds.length === 0) return;
    if (socket.value?.connected) {
      safeEmit('unsubscribe:tag', { tagIds: removedTagIds });
    }
    subscribedTags.value = new Set(
      [...subscribedTags.value].filter((id) => !removedTagIds.includes(id)),
    );
  }

  function switchProject(newProjectId: string) {
    if (!socket.value?.connected) return;
    if (subscribedProjectId.value) {
      safeEmit('unsubscribe:project', { projectId: subscribedProjectId.value });
    }
    subscribedTags.value.clear();
    _tagReferenceCount.clear();
    tagValues.value = new Map();
    subscribeProject(newProjectId);
  }

  function updateTagValue(tagId: string, value: any) {
    const next = new Map(tagValues.value);
    next.set(tagId, {
      tagId,
      tagName: '',
      value,
      quality: 'good',
      timestamp: Date.now(),
    });
    tagValues.value = next;
  }

  function getTagValue(tagId: string): any {
    return tagValues.value.get(tagId)?.value ?? null;
  }

  function disconnect() {
    stopHeartbeat();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      flushPending = false;
    }
    pendingTagUpdates.clear();
    if (socket.value) {
      socket.value.removeAllListeners();
      socket.value.disconnect();
      socket.value = null;
    }
    connectionStatus.value = 'disconnected';
    socketId.value = null;
    subscribedProjectId.value = null;
    subscribedTags.value.clear();
    tagValues.value = new Map();
    deviceStatuses.value.clear();
    activeAlarms.value.clear();
    systemMessages.value = [];
    lastPongAt.value = null;
    error.value = null;
    outboundBuffer.length = 0;
    outboundBufferSize.value = 0;
  }

  function clearError() {
    error.value = null;
  }

  /** Start the client heartbeat: periodically send pings to prevent backend idle-cleanup disconnection */
  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      safeEmit('ping', {});
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Stop the heartbeat timer */
  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  return {
    connectionStatus,
    socketId,
    tagValues,
    tagFlushVersion,
    subscribedTags,
    subscribedProjectId,
    error,
    isConnected,
    outboundBufferSize,
    deviceStatuses,
    activeAlarms,
    systemMessages,
    lastPongAt,
    connect,
    disconnect,
    subscribeProject,
    subscribeDevice,
    subscribeTags,
    unsubscribeTags,
    switchProject,
    updateTagValue,
    getTagValue,
    safeEmit,
    clearError,
    startHeartbeat,
    stopHeartbeat,
    onFlushed,
  };
});