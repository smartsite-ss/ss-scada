// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  WebSocketGateway as NestWebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OfflineMessageCacheService } from './offline-message-cache.service';
import { WebSocketMetricsService } from './websocket-metrics.service';
import { ConnectionLimiterService } from './connection-limiter.service';
import { ConnectionMonitorService } from './connection-monitor.service';

interface AuthenticatedSocket extends Socket {
  user?: { sub: string; username: string; role: string };
  connectedAt?: number;
}

/**
 * WebSocket CORS whitelist: sourced from the same env vars as the HTTP layer (main.ts enableCors),
 * and always includes the Tauri desktop origin (the page origin https://tauri.localhost is cross-origin to the backend;
 * if missing, the socket.io handshake is rejected, manifesting as device-monitor real-time data not updating).
 */
function buildWsCorsOrigins(): string[] {
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:4000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const TAURI_DESKTOP_ORIGINS = ['https://tauri.localhost', 'tauri://localhost'];
  for (const tauriOrigin of TAURI_DESKTOP_ORIGINS) {
    if (!origins.includes(tauriOrigin)) {
      origins.push(tauriOrigin);
    }
  }
  return origins;
}

@Injectable()
@NestWebSocketGateway({
  cors: { origin: buildWsCorsOrigins(), credentials: true },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class ScadaWebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ScadaWebSocketGateway.name);
  private connectedClients = new Map<string, AuthenticatedSocket>();

  /** Batch-update buffer: projectId -> pending tag-data list */
  private batchUpdateBuffer = new Map<
    string,
    Array<{ tagId: string; tagName: string; value: number; quality: string; timestamp: string }>
  >();
  /** Batch-flush timer (merges pushes within a 200ms window) */
  private batchFlushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly batchFlushIntervalMs = 200;
  /** Idle-connection cleanup timer (checked every 60 seconds) */
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private readonly idleCheckIntervalMs = 60000;

  constructor(
    private jwtService: JwtService,
    private readonly offlineCache: OfflineMessageCacheService,
    private readonly metricsService: WebSocketMetricsService,
    private readonly connectionLimiter: ConnectionLimiterService,
    private readonly connectionMonitor: ConnectionMonitorService,
  ) {
    // Idle-connection cleanup timer: check every 60 seconds, disconnect timed-out connections
    this.idleCheckTimer = setInterval(() => {
      try {
        const idleSocketIds = this.connectionLimiter.checkIdleConnections();
        for (const socketId of idleSocketIds) {
          this.connectedClients.get(socketId)?.disconnect(true);
        }
        if (idleSocketIds.length > 0) {
          this.logger.log(`Idle cleanup: disconnected ${idleSocketIds.length} idle connections`);
        }
      } catch (err) {
        this.logger.error(`Idle check timer error: ${(err as Error).message}`);
      }
    }, this.idleCheckIntervalMs);
  }

  handleConnection(client: AuthenticatedSocket): void {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;

      if (token) {
        try {
          const payload = this.jwtService.verify(token);
          client.user = { sub: payload.sub, username: payload.username, role: payload.role };
          client.connectedAt = Date.now();

          // Join the user's private room (for personal notifications)
          client.join(`user:${payload.sub}`);
        } catch {
          // Unauthenticated users may connect but with limited functionality
          this.logger.warn(`Unauthenticated WS connection: ${client.id}`);
        }
      }

      // Connection-limit check (after JWT auth, before adding to connectedClients)
      const ip = client.handshake.address || client.conn.remoteAddress || 'unknown';
      const userId = client.user?.sub;
      const username = client.user?.username;
      const checkResult = this.connectionLimiter.registerConnection(client.id, userId, ip);
      if (!checkResult.allowed) {
        this.logger.warn(`WS connection rejected: ${client.id} (reason: ${checkResult.reason})`);
        client.emit('connection:error', { reason: checkResult.reason });
        client.disconnect(true);
        return;
      }

      // Extract business-source info (so the monitoring page can tell which page/module the connection came from)
      const handshakeAuth = (client.handshake.auth || {}) as {
        source?: string;
        clientUrl?: string;
      };
      const headers = client.handshake.headers || {};
      const source = handshakeAuth.source || '';
      const url = handshakeAuth.clientUrl || headers.referer || headers.origin || '';
      const userAgent = (headers['user-agent'] as string) || '';

      // Register connection monitoring
      this.connectionMonitor.registerConnection(
        client.id,
        userId,
        username,
        ip,
        source,
        url,
        userAgent,
      );

      this.connectedClients.set(client.id, client);

      this.logger.log(
        `WS client connected: ${client.id}` +
          (client.user ? ` (user: ${client.user.username})` : ' (anonymous)') +
          ` [total: ${this.connectedClients.size}]`,
      );

      client.emit('connection', {
        message: 'WebSocket connected',
        authenticated: !!client.user,
        timestamp: new Date().toISOString(),
      });

      // Offline-message replay: check and replay messages cached while the client was offline
      this.resendPendingMessages(client);
    } catch (error) {
      this.logger.error(`WS connection error: ${(error as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
    // Unregister the connection-limit record
    this.connectionLimiter.unregisterConnection(client.id);
    // Unregister the connection-monitor record
    this.connectionMonitor.unregisterConnection(client.id);
    // Note: do not clear the offline-message cache; keep it for replay when the client reconnects
    this.logger.log(`WS client disconnected: ${client.id} [total: ${this.connectedClients.size}]`);
  }

  /**
   * Replay messages cached while the client was offline
   * Uses userId as the client identifier (stable, does not change with socket.id)
   */
  private resendPendingMessages(client: AuthenticatedSocket): void {
    if (!client.user) {
      return;
    }

    const clientId = client.user.sub;
    this.offlineCache.registerClient(clientId);

    const pendingMessages = this.offlineCache.getPendingMessages(clientId);
    if (pendingMessages.length === 0) {
      return;
    }

    this.logger.log(
      `Resending ${pendingMessages.length} pending messages to client ${client.id} (user: ${client.user.username})`,
    );

    for (const message of pendingMessages) {
      client.emit(message.event, message.data);
    }

    // Clear the cache after replay completes
    this.offlineCache.clearMessages(clientId);
  }

  /**
   * Get the set of currently online authenticated user IDs
   * Used by the offline-message cache to decide which clients are offline
   */
  getOnlineUserIds(): Set<string> {
    const onlineIds = new Set<string>();
    this.connectedClients.forEach((client) => {
      if (client.user) {
        onlineIds.add(client.user.sub);
      }
    });
    return onlineIds;
  }

  /**
   * Cache messages for offline clients
   * @param event event name
   * @param data message data
   */
  private cacheForOfflineClients(event: string, data: unknown): void {
    const onlineIds = this.getOnlineUserIds();
    const offlineIds = this.offlineCache.getOfflineClientIds(onlineIds);

    for (const clientId of offlineIds) {
      this.offlineCache.cacheMessage(clientId, event, data);
    }
  }

  // ── Heartbeat ──
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): void {
    this.connectionLimiter.recordActivity(client.id);
    this.connectionMonitor.recordMessage(client.id);
    client.emit('pong', {
      message: 'Pong',
      timestamp: new Date().toISOString(),
      connections: this.connectedClients.size,
    });
  }

  // ── Room management ──

  @SubscribeMessage('subscribe:project')
  handleSubscribeProject(
    @MessageBody() data: { projectId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const room = `project:${data.projectId}`;
    client.join(room);
    // Update the connection monitor's project-room info
    this.connectionMonitor.updateProjectRooms(client.id, [room]);
    this.connectionLimiter.recordActivity(client.id);
    this.connectionMonitor.recordMessage(client.id);
    this.logger.log(`Client ${client.id} joined room: ${room}`);
    client.emit('room:joined', { room, projectId: data.projectId });
  }

  @SubscribeMessage('unsubscribe:project')
  handleUnsubscribeProject(
    @MessageBody() data: { projectId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const room = `project:${data.projectId}`;
    client.leave(room);
    this.connectionLimiter.recordActivity(client.id);
    this.connectionMonitor.recordMessage(client.id);
    client.emit('room:left', { room });
  }

  @SubscribeMessage('subscribe:device')
  handleSubscribeDevice(
    @MessageBody() data: { deviceId: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const room = `device:${data.deviceId}`;
    client.join(room);
    this.connectionLimiter.recordActivity(client.id);
    this.connectionMonitor.recordMessage(client.id);
    this.logger.debug(`Client ${client.id} joined device room: ${data.deviceId}`);
  }

  @SubscribeMessage('subscribe:tag')
  handleSubscribeTag(
    @MessageBody() data: { tagIds: string[] },
    @ConnectedSocket() client: Socket,
  ): void {
    for (const tagId of data.tagIds) {
      client.join(`tag:${tagId}`);
    }
    this.connectionLimiter.recordActivity(client.id);
    this.connectionMonitor.recordMessage(client.id);
  }

  // ── Data broadcasting ──

  /**
   * Record broadcast metrics (monitoring the "outgoing" leg of messages)
   * @param event WebSocket event name
   * @param room target room name
   */
  private recordBroadcastMetric(event: string, room: string): void {
    try {
      const recipientCount = this.getRoomSize(room);
      this.metricsService.recordBroadcast(event, room, recipientCount);
    } catch (err) {
      // Metric-recording failure does not affect broadcasting
      this.metricsService.recordBroadcastError(event);
    }
  }

  /** Broadcast tag-value changes to the project room */
  broadcastTagUpdate(
    projectId: string,
    tagData: {
      tagId: string;
      tagName: string;
      value: number | null;
      quality: string;
      timestamp: string;
    },
  ): void {
    const projectRoom = `project:${projectId}`;
    const tagRoom = `tag:${tagData.tagId}`;
    this.server.to(projectRoom).emit('data:update', {
      event: 'tagValueChanged',
      ...tagData,
    });
    // Also push to the tag-specific room
    this.server.to(tagRoom).emit('data:update', {
      event: 'tagValueChanged',
      ...tagData,
    });
    // Record broadcast metrics
    this.recordBroadcastMetric('data:update', projectRoom);
    this.recordBroadcastMetric('data:update', tagRoom);
  }

  /** Batch-broadcast tag values (buffer merge: multiple calls within a 200ms window coalesce into one push, lowering frequency) */
  broadcastBatchUpdate(
    projectId: string,
    tags: Array<{
      tagId: string;
      tagName: string;
      value: number | null;
      quality: string;
      timestamp: string;
    }>,
  ): void {
    // Buffer into batchUpdateBuffer, flushed uniformly by the timer
    const existing = this.batchUpdateBuffer.get(projectId) || [];
    existing.push(...tags);
    this.batchUpdateBuffer.set(projectId, existing);

    // Start the periodic flush timer (if not started)
    if (!this.batchFlushTimer) {
      this.batchFlushTimer = setInterval(() => this.flushBatchUpdates(), this.batchFlushIntervalMs);
    }
  }

  /**
   * Flush the batch-update buffer
   * Pushes the buffered tag data to the corresponding project rooms in one shot, stopping the timer when there is no data
   */
  private flushBatchUpdates(): void {
    if (this.batchUpdateBuffer.size === 0) {
      // Nothing to flush; stop the timer (restarted on the next broadcastBatchUpdate call)
      if (this.batchFlushTimer) {
        clearInterval(this.batchFlushTimer);
        this.batchFlushTimer = null;
      }
      return;
    }

    const now = new Date().toISOString();
    for (const [projectId, tags] of this.batchUpdateBuffer.entries()) {
      this.server.to(`project:${projectId}`).emit('data:batch', {
        event: 'tagValuesChanged',
        data: tags,
        timestamp: now,
      });
      // Record broadcast metrics
      this.recordBroadcastMetric('data:batch', `project:${projectId}`);
    }

    this.batchUpdateBuffer.clear();
  }

  // ── Alarm broadcasting ──

  /** Broadcast an alarm trigger */
  broadcastAlarmTrigger(
    projectId: string,
    alarmData: {
      alarmId: string;
      ruleName: string;
      tagName: string;
      level: string;
      value: number;
      message: string;
      timestamp: string;
    },
  ): void {
    const projectRoom = `project:${projectId}`;
    this.server.to(projectRoom).emit('alarm:trigger', {
      event: 'alarmTriggered',
      ...alarmData,
    });
    // Record broadcast metrics
    this.recordBroadcastMetric('alarm:trigger', projectRoom);
  }

  /** Broadcast an alarm acknowledgement */
  broadcastAlarmAcknowledged(
    projectId: string,
    data: {
      alarmId: string;
      acknowledgedBy: string;
      timestamp: string;
    },
  ): void {
    const payload = {
      event: 'alarmAcknowledged',
      ...data,
    };
    this.server.to(`project:${projectId}`).emit('alarm:acknowledged', payload);
    // Cache the message for offline clients
    this.cacheForOfflineClients('alarm:acknowledged', payload);
  }

  /** Broadcast an alarm clear */
  broadcastAlarmCleared(
    projectId: string,
    data: {
      alarmId: string;
      clearedBy: string;
      timestamp: string;
    },
  ): void {
    const payload = {
      event: 'alarmCleared',
      ...data,
    };
    this.server.to(`project:${projectId}`).emit('alarm:cleared', payload);
    // Cache the message for offline clients
    this.cacheForOfflineClients('alarm:cleared', payload);
  }

  /** Broadcast an alarm auto-recovery */
  broadcastAlarmRecovered(
    projectId: string,
    data: {
      alarmId: string;
      recoveredValue: string;
      ruleName?: string;
      timestamp: string;
    },
  ): void {
    const payload = {
      event: 'alarmRecovered',
      ...data,
    };
    this.server.to(`project:${projectId}`).emit('alarm:recovered', payload);
    // Cache the message for offline clients
    this.cacheForOfflineClients('alarm:recovered', payload);
  }

  // ── Device-status broadcasting ──

  /** Broadcast a device-status change */
  broadcastDeviceStatus(
    projectId: string,
    deviceId: string,
    status: {
      fromStatus: string;
      toStatus: string;
      errorMessage?: string;
      timestamp: string;
    },
  ): void {
    const projectRoom = `project:${projectId}`;
    const deviceRoom = `device:${deviceId}`;
    this.server.to(projectRoom).emit('device:statusChange', {
      event: 'deviceStatusChanged',
      deviceId,
      ...status,
    });
    this.server.to(deviceRoom).emit('device:statusChange', {
      event: 'deviceStatusChanged',
      deviceId,
      ...status,
    });
    // Record broadcast metrics
    this.recordBroadcastMetric('device:statusChange', projectRoom);
    this.recordBroadcastMetric('device:statusChange', deviceRoom);
  }

  // ── System broadcasting ──

  /** System-wide broadcast (admin room only) */
  broadcastSystem(message: string, data?: unknown): void {
    const payload = {
      event: 'systemBroadcast',
      message,
      data,
      timestamp: new Date().toISOString(),
    };
    this.server.emit('system:broadcast', payload);
    // Cache system-broadcast messages for offline clients
    this.cacheForOfflineClients('system:broadcast', payload);
  }

  /** Send a notification to a specific user */
  sendToUser(userId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  /** Admin force-disconnect a connection */
  forceDisconnect(socketId: string): boolean {
    const client = this.connectedClients.get(socketId);
    if (client) {
      client.disconnect(true);
      return true;
    }
    return false;
  }

  // ── Statistics ──

  getConnectionCount(): number {
    return this.connectedClients.size;
  }

  getRoomSize(room: string): number {
    const adapter = this.server.sockets.adapter;
    return adapter.rooms.get(room)?.size || 0;
  }

  getMetrics(): {
    totalConnections: number;
    roomCount: number;
    rooms: Array<{ name: string; size: number }>;
  } {
    const adapter = this.server.sockets.adapter;
    const rooms: Array<{ name: string; size: number }> = [];
    adapter.rooms.forEach((sockets, roomName) => {
      // Exclude the default room where socket.id == roomName
      if (roomName.length < 20) {
        rooms.push({ name: roomName, size: sockets.size });
      }
    });

    return {
      totalConnections: this.connectedClients.size,
      roomCount: rooms.length,
      rooms: rooms.sort((a, b) => b.size - a.size).slice(0, 50),
    };
  }
}
