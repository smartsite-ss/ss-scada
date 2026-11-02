// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';
import type { ApiResponse } from '../types/api';

/** WebSocket monitoring overview data */
export interface WsMonitorOverview {
  metrics: {
    broadcastCounts: Record<string, number>;
    broadcastErrors: Record<string, number>;
    roomHitStats: Record<string, { broadcasts: number; totalRecipients: number }>;
    offlineCacheHits: number;
    offlineCacheMisses: number;
    bridgeLatencyMs: { count: number; totalMs: number; avgMs: number; maxMs: number };
    totalBroadcasts: number;
    totalRecipients: number;
    startedAt: number;
    snapshotAt: number;
  };
  monitor: {
    totalConnections: number;
    connectionsByProject: Record<string, number>;
    connectionsByUser: Record<string, number>;
    messageRates: Array<{ socketId: string; messagesPerSecond: number; totalMessages: number; windowSeconds: number }>;
    durationStats: {
      avgMs: number;
      maxMs: number;
      distribution: { under1Min: number; under10Min: number; under1Hour: number; under1Day: number; over1Day: number };
    };
    abnormalConnections: string[];
  };
  limiter: {
    totalConnections: number;
    userConnections: number;
    uniqueUsers: number;
    uniqueIps: number;
  };
  gateway: {
    totalConnections: number;
    roomCount: number;
    rooms: Array<{ name: string; size: number }>;
  };
}

/** Connection snapshot */
export interface WsConnectionSnapshot {
  socketId: string;
  userId?: string;
  username?: string;
  ip: string;
  /** Business source: page path where the connection was established */
  source?: string;
  /** Client full URL */
  url?: string;
  /** Client User-Agent */
  userAgent?: string;
  connectedAt: number;
  projectRooms: string[];
  messageCount: number;
  lastActivityAt: number;
}

/** Connection limit configuration */
export interface WsConnectionConfig {
  maxConnectionsPerUser: number;
  maxGlobalConnections: number;
  maxConnectionsPerIp: number;
  idleTimeoutMinutes: number;
}

/** Diagnostic information */
export interface WsDiagnosticInfo {
  conclusions?: string[];
  suggestions?: string[];
  details?: Record<string, unknown>;
}

export const websocketApi = {
  /** Get the combined overview */
  getOverview(): Promise<ApiResponse<WsMonitorOverview>> {
    return client.get('/ws/admin/overview').then((res) => res.data);
  },

  /** Get all connection details */
  getConnections(): Promise<ApiResponse<{ total: number; connections: WsConnectionSnapshot[] }>> {
    return client.get('/ws/admin/connections').then((res) => res.data);
  },

  /** Forcefully disconnect a specified connection */
  forceDisconnect(socketId: string): Promise<ApiResponse<void>> {
    return client.delete(`/ws/admin/connections/${socketId}`).then((res) => res.data);
  },

  /** Clean up idle connections */
  cleanupIdle(): Promise<ApiResponse<{ cleaned: number; total: number }>> {
    return client.post('/ws/admin/connections/cleanup-idle').then((res) => res.data);
  },

  /** Get the connection limit configuration */
  getConfig(): Promise<ApiResponse<WsConnectionConfig>> {
    return client.get('/ws/admin/config').then((res) => res.data);
  },

  /** Update the connection limit configuration */
  updateConfig(config: Partial<WsConnectionConfig>): Promise<ApiResponse<WsConnectionConfig>> {
    return client.put('/ws/admin/config', config).then((res) => res.data);
  },

  /** Get diagnostic information */
  getDiagnostic(): Promise<ApiResponse<WsDiagnosticInfo>> {
    return client.get('/ws/metrics/diagnostic').then((res) => res.data);
  },
};
