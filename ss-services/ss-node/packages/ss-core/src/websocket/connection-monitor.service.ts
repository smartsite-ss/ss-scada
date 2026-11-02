// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { I18nService } from '@ss-node/ss-i18n';
import { EventBusService } from '../event-bus/event-bus.service';

export interface ConnectionSnapshot {
  socketId: string;
  userId?: string;
  username?: string;
  ip: string;
  /** Business source: page path where the client established the connection (e.g. /system/device-monitor) */
  source?: string;
  /** Client full URL (from handshake auth.clientUrl or the Referer header) */
  url?: string;
  /** Client User-Agent */
  userAgent?: string;
  connectedAt: number;
  projectRooms: string[];
  messageCount: number;
  lastActivityAt: number;
}

export interface MessageRateStats {
  socketId: string;
  messagesPerSecond: number;
  totalMessages: number;
  windowSeconds: number;
}

export interface DurationStats {
  avgMs: number;
  maxMs: number;
  distribution: {
    under1Min: number;
    under10Min: number;
    under1Hour: number;
    under1Day: number;
    over1Day: number;
  };
}

export interface MonitorStats {
  totalConnections: number;
  connectionsByProject: Record<string, number>;
  connectionsByUser: Record<string, number>;
  messageRates: MessageRateStats[];
  durationStats: DurationStats;
  abnormalConnections: string[];
}

interface MessageRecord {
  socketId: string;
  timestamp: number;
}

@Injectable()
export class ConnectionMonitorService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionMonitorService.name);

  /** Message-record sliding window (for rate computation) */
  private readonly messageWindow: MessageRecord[] = [];
  /** Rate-computation window size (ms), default 10 seconds */
  private readonly rateWindowMs = 10000;
  /** Abnormal message-rate threshold (msg/sec), default 100 */
  private abnormalRateThreshold = 100;
  /** Abnormal connection-duration threshold (ms); connections over 24 hours are flagged abnormal, default 24h */
  private abnormalDurationThreshold = 24 * 60 * 60 * 1000;

  /** Connection info snapshot */
  private readonly connectionSnapshots = new Map<string, ConnectionSnapshot>();

  /** Periodic check timer */
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(I18nService)
    private readonly i18n: I18nService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.logger.log('ConnectionMonitorService initialized');

    // Check abnormal connections every 30 seconds
    this.checkInterval = setInterval(() => {
      this.detectAbnormalConnections();
    }, 30000);
  }

  onModuleDestroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /** Register connection monitoring */
  registerConnection(
    socketId: string,
    userId?: string,
    username?: string,
    ip?: string,
    source?: string,
    url?: string,
    userAgent?: string,
  ): void {
    this.connectionSnapshots.set(socketId, {
      socketId,
      userId,
      username,
      ip: ip || 'unknown',
      source,
      url,
      userAgent,
      connectedAt: Date.now(),
      projectRooms: [],
      messageCount: 0,
      lastActivityAt: Date.now(),
    });
  }

  /** Unregister connection monitoring */
  unregisterConnection(socketId: string): void {
    this.connectionSnapshots.delete(socketId);
  }

  /** Update the connection's project rooms */
  updateProjectRooms(socketId: string, rooms: string[]): void {
    const snapshot = this.connectionSnapshots.get(socketId);
    if (snapshot) {
      snapshot.projectRooms = rooms;
    }
  }

  /** Record a message */
  recordMessage(socketId: string): void {
    const snapshot = this.connectionSnapshots.get(socketId);
    if (snapshot) {
      snapshot.messageCount++;
      snapshot.lastActivityAt = Date.now();
    }

    this.messageWindow.push({ socketId, timestamp: Date.now() });

    // Clean up expired message records
    this.cleanMessageWindow();
  }

  /** Get the message rate */
  getMessageRates(): MessageRateStats[] {
    const now = Date.now();
    const windowStart = now - this.rateWindowMs;
    const recentMessages = this.messageWindow.filter((r) => r.timestamp >= windowStart);

    const socketMessages = new Map<string, number>();
    for (const record of recentMessages) {
      socketMessages.set(record.socketId, (socketMessages.get(record.socketId) || 0) + 1);
    }

    const rates: MessageRateStats[] = [];
    socketMessages.forEach((count, socketId) => {
      rates.push({
        socketId,
        messagesPerSecond: Math.round((count / (this.rateWindowMs / 1000)) * 100) / 100,
        totalMessages: count,
        windowSeconds: this.rateWindowMs / 1000,
      });
    });

    return rates.sort((a, b) => b.messagesPerSecond - a.messagesPerSecond);
  }

  /** Get connection-duration statistics */
  getDurationStats(): DurationStats {
    const now = Date.now();
    const durations: number[] = [];
    const distribution = {
      under1Min: 0,
      under10Min: 0,
      under1Hour: 0,
      under1Day: 0,
      over1Day: 0,
    };

    this.connectionSnapshots.forEach((snapshot) => {
      const duration = now - snapshot.connectedAt;
      durations.push(duration);

      if (duration < 60000) distribution.under1Min++;
      else if (duration < 600000) distribution.under10Min++;
      else if (duration < 3600000) distribution.under1Hour++;
      else if (duration < 86400000) distribution.under1Day++;
      else distribution.over1Day++;
    });

    const avgMs =
      durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;
    const maxMs = durations.length > 0 ? Math.max(...durations) : 0;

    return { avgMs, maxMs, distribution };
  }

  /** Detect abnormal connections */
  detectAbnormalConnections(): string[] {
    const abnormal: string[] = [];
    const now = Date.now();

    // Detect high message rates
    const rates = this.getMessageRates();
    for (const rate of rates) {
      if (rate.messagesPerSecond > this.abnormalRateThreshold) {
        abnormal.push(rate.socketId);
        this.logger.warn(
          `Abnormal message rate: ${rate.socketId} (${rate.messagesPerSecond} msg/s)`,
        );
      }
    }

    // Detect overly long connections
    this.connectionSnapshots.forEach((snapshot, socketId) => {
      if (now - snapshot.connectedAt > this.abnormalDurationThreshold) {
        if (!abnormal.includes(socketId)) {
          abnormal.push(socketId);
        }
        this.logger.warn(
          `Abnormal connection duration: ${socketId} (${Math.round((now - snapshot.connectedAt) / 3600000)}h)`,
        );
      }

      // Detect long inactivity
      const idleDuration = now - snapshot.lastActivityAt;
      if (idleDuration > this.abnormalDurationThreshold) {
        if (!abnormal.includes(socketId)) {
          abnormal.push(socketId);
        }
        this.logger.warn(
          `Abnormal idle duration: ${socketId} (${Math.round(idleDuration / 3600000)}h)`,
        );
      }
    });

    return abnormal;
  }

  /** Get full monitoring statistics */
  getStats(): MonitorStats {
    const connectionsByProject: Record<string, number> = {};
    const connectionsByUser: Record<string, number> = {};
    const _now = Date.now();

    this.connectionSnapshots.forEach((snapshot) => {
      // Statistics by project
      for (const room of snapshot.projectRooms) {
        if (room.startsWith('project:')) {
          const projectId = room.replace('project:', '');
          connectionsByProject[projectId] = (connectionsByProject[projectId] || 0) + 1;
        }
      }

      // Statistics by user
      if (snapshot.userId) {
        connectionsByUser[snapshot.userId] = (connectionsByUser[snapshot.userId] || 0) + 1;
      }
    });

    return {
      totalConnections: this.connectionSnapshots.size,
      connectionsByProject,
      connectionsByUser,
      messageRates: this.getMessageRates(),
      durationStats: this.getDurationStats(),
      abnormalConnections: this.detectAbnormalConnections(),
    };
  }

  /** Get online connection count (by project) */
  getOnlineCountByProject(projectId: string): number {
    let count = 0;
    this.connectionSnapshots.forEach((snapshot) => {
      if (snapshot.projectRooms.includes(`project:${projectId}`)) {
        count++;
      }
    });
    return count;
  }

  /** Get online connection count (by user) */
  getOnlineCountByUser(userId: string): number {
    let count = 0;
    this.connectionSnapshots.forEach((snapshot) => {
      if (snapshot.userId === userId) {
        count++;
      }
    });
    return count;
  }

  /** Get a connection snapshot */
  getConnectionSnapshot(socketId: string): ConnectionSnapshot | undefined {
    return this.connectionSnapshots.get(socketId);
  }

  /** Get all connection snapshots */
  getAllSnapshots(): ConnectionSnapshot[] {
    return Array.from(this.connectionSnapshots.values());
  }

  /** Set abnormal-detection thresholds */
  setAbnormalThresholds(rateThreshold?: number, durationThresholdMs?: number): void {
    if (rateThreshold !== undefined) {
      this.abnormalRateThreshold = rateThreshold;
    }
    if (durationThresholdMs !== undefined) {
      this.abnormalDurationThreshold = durationThresholdMs;
    }
  }

  private cleanMessageWindow(): void {
    const cutoff = Date.now() - this.rateWindowMs * 2;
    while (this.messageWindow.length > 0 && this.messageWindow[0].timestamp < cutoff) {
      this.messageWindow.shift();
    }

    // Prevent the message window from growing unboundedly
    if (this.messageWindow.length > 10000) {
      this.messageWindow.splice(0, this.messageWindow.length - 5000);
    }
  }
}
