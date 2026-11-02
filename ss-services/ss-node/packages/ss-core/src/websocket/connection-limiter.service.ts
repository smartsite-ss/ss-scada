// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { I18nService } from '@ss-node/ss-i18n';

export interface ConnectionLimiterConfig {
  /** Max connections per user, default 5 */
  maxConnectionsPerUser: number;
  /** Global max connections, default 1000 */
  maxGlobalConnections: number;
  /** Max connections per IP, default 10 */
  maxConnectionsPerIp: number;
  /** Idle timeout in minutes (no business messages), default 30 */
  idleTimeoutMinutes: number;
}

export const DEFAULT_CONNECTION_LIMITER_CONFIG: ConnectionLimiterConfig = {
  maxConnectionsPerUser: 5,
  maxGlobalConnections: 1000,
  maxConnectionsPerIp: 10,
  idleTimeoutMinutes: 30,
};

interface ConnectionRecord {
  socketId: string;
  userId?: string;
  ip: string;
  connectedAt: number;
  lastActivityAt: number;
}

@Injectable()
export class ConnectionLimiterService implements OnModuleInit {
  private readonly logger = new Logger(ConnectionLimiterService.name);

  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly userConnections = new Map<string, Set<string>>();
  private readonly ipConnections = new Map<string, Set<string>>();

  private config: ConnectionLimiterConfig;

  constructor(
    @Inject(I18nService)
    private readonly i18n: I18nService,
  ) {
    this.config = { ...DEFAULT_CONNECTION_LIMITER_CONFIG };
  }

  onModuleInit(): void {
    this.logger.log(
      `ConnectionLimiterService initialized (user:${this.config.maxConnectionsPerUser}, global:${this.config.maxGlobalConnections}, ip:${this.config.maxConnectionsPerIp}, idle:${this.config.idleTimeoutMinutes}min)`,
    );
  }

  updateConfig(partial: Partial<ConnectionLimiterConfig>): void {
    this.config = { ...this.config, ...partial };
    this.logger.log(`ConnectionLimiter config updated: ${JSON.stringify(this.config)}`);
  }

  getConfig(): ConnectionLimiterConfig {
    return { ...this.config };
  }

  /** Register a new connection, returns whether it is allowed */
  registerConnection(
    socketId: string,
    userId: string | undefined,
    ip: string,
  ): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // Global connection-count check
    if (this.connections.size >= this.config.maxGlobalConnections) {
      const reason = this.i18n.tSync('websocket.connection.global_limit_exceeded', {
        current: String(this.connections.size),
        max: String(this.config.maxGlobalConnections),
      });
      this.logger.warn(
        `Global connection limit reached: ${this.connections.size}/${this.config.maxGlobalConnections}`,
      );
      return { allowed: false, reason };
    }

    // IP connection-count check
    const ipSet = this.ipConnections.get(ip);
    if (ipSet && ipSet.size >= this.config.maxConnectionsPerIp) {
      const reason = this.i18n.tSync('websocket.connection.ip_limit_exceeded', {
        ip,
        current: String(ipSet.size),
        max: String(this.config.maxConnectionsPerIp),
      });
      this.logger.warn(
        `IP connection limit reached: ${ip} (${ipSet.size}/${this.config.maxConnectionsPerIp})`,
      );
      return { allowed: false, reason };
    }

    // User connection-count check
    if (userId) {
      const userSet = this.userConnections.get(userId);
      if (userSet && userSet.size >= this.config.maxConnectionsPerUser) {
        const reason = this.i18n.tSync('websocket.connection.user_limit_exceeded', {
          username: userId,
          current: String(userSet.size),
          max: String(this.config.maxConnectionsPerUser),
        });
        this.logger.warn(
          `User connection limit reached: ${userId} (${userSet.size}/${this.config.maxConnectionsPerUser})`,
        );
        return { allowed: false, reason };
      }
    }

    // Record the connection
    const record: ConnectionRecord = {
      socketId,
      userId,
      ip,
      connectedAt: now,
      lastActivityAt: now,
    };
    this.connections.set(socketId, record);

    // Update the IP index
    if (!this.ipConnections.has(ip)) {
      this.ipConnections.set(ip, new Set());
    }
    this.ipConnections.get(ip)!.add(socketId);

    // Update the user index
    if (userId) {
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(socketId);
    }

    return { allowed: true };
  }

  /** Unregister a connection */
  unregisterConnection(socketId: string): void {
    const record = this.connections.get(socketId);
    if (!record) return;

    this.connections.delete(socketId);

    // Clean up the IP index
    const ipSet = this.ipConnections.get(record.ip);
    if (ipSet) {
      ipSet.delete(socketId);
      if (ipSet.size === 0) {
        this.ipConnections.delete(record.ip);
      }
    }

    // Clean up the user index
    if (record.userId) {
      const userSet = this.userConnections.get(record.userId);
      if (userSet) {
        userSet.delete(socketId);
        if (userSet.size === 0) {
          this.userConnections.delete(record.userId);
        }
      }
    }
  }

  /** Record business-message activity */
  recordActivity(socketId: string): void {
    const record = this.connections.get(socketId);
    if (record) {
      record.lastActivityAt = Date.now();
    }
  }

  /** Check idle-timed-out connections, returning the socketId list to disconnect */
  checkIdleConnections(): string[] {
    const now = Date.now();
    const idleTimeoutMs = this.config.idleTimeoutMinutes * 60 * 1000;
    const idleSocketIds: string[] = [];

    this.connections.forEach((record, socketId) => {
      const idleDuration = now - record.lastActivityAt;
      if (idleDuration > idleTimeoutMs) {
        idleSocketIds.push(socketId);
        this.logger.log(
          `Idle connection detected: ${socketId} (idle ${Math.round(idleDuration / 60000)}min)`,
        );
      }
    });

    return idleSocketIds;
  }

  /** Get connection statistics */
  getStats(): {
    totalConnections: number;
    userConnections: number;
    uniqueUsers: number;
    uniqueIps: number;
  } {
    let userConnectionCount = 0;
    this.userConnections.forEach((set) => {
      userConnectionCount += set.size;
    });

    return {
      totalConnections: this.connections.size,
      userConnections: userConnectionCount,
      uniqueUsers: this.userConnections.size,
      uniqueIps: this.ipConnections.size,
    };
  }

  /** Get a user's connection count */
  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }

  /** Get an IP's connection count */
  getIpConnectionCount(ip: string): number {
    return this.ipConnections.get(ip)?.size || 0;
  }

  /** Get a connection record */
  getConnection(socketId: string): ConnectionRecord | undefined {
    return this.connections.get(socketId);
  }

  /** Get all connections */
  getAllConnections(): ConnectionRecord[] {
    return Array.from(this.connections.values());
  }

  /** Get the connection's IP */
  getConnectionIp(socketId: string): string | undefined {
    return this.connections.get(socketId)?.ip;
  }
}
