// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * WebSocket module integration tests
 *
 * Tests the end-to-end collaboration flow between WebSocket module services.
 * Uses real service instances (services themselves are not mocked); only framework objects are mocked
 * (Socket, Server, JwtService, I18nService, EventEmitter2).
 *
 * Covered scenarios:
 * 1. connection limit end-to-end flow
 * 2. connection monitor end-to-end flow
 * 3. idle connection detection
 * 4. offline message caching and reconnect re-delivery (OfflineMessageService)
 * 5. offline cache service (OfflineMessageCacheService)
 * 6. Gateway + service integration flow
 * 7. dynamic connection config update
 */

import { ScadaWebSocketGateway } from '../websocket/websocket.gateway';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { Socket, Server } from 'socket.io';
import { ConnectionLimiterService } from '../websocket/connection-limiter.service';
import { ConnectionMonitorService } from '../websocket/connection-monitor.service';
import { OfflineMessageService } from '../websocket/offline-message.service';
import { OfflineMessageCacheService } from '../websocket/offline-message-cache.service';
import { WebSocketMetricsService } from '../websocket/websocket-metrics.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { I18nService } from '@ss-node/ss-i18n';

// ── Helper: create mock Socket ──
function createMockSocket(id: string, ip: string = '127.0.0.1', token?: string): any {
  const socket: any = {
    id,
    handshake: {
      auth: token ? { token } : {},
      query: {},
      headers: {},
      time: '',
      address: ip,
      xdomain: false,
      secure: false,
      issued: 0,
      url: '',
    },
    conn: {
      remoteAddress: ip,
    },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  return socket;
}

// ── Helper: create mock Server ──
function createMockServer(): Partial<Server> {
  return {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    sockets: {
      adapter: {
        rooms: new Map(),
      },
    } as any,
  } as any;
}

// ── Helper: create mock I18nService ──
function createMockI18n(): jest.Mocked<I18nService> {
  return {
    tSync: jest.fn().mockImplementation((key: string, args?: Record<string, unknown>) => {
      if (args) {
        return `${key} ${JSON.stringify(args)}`;
      }
      return key;
    }),
    t: jest.fn(),
    translate: jest.fn(),
    translateSync: jest.fn(),
    getLanguage: jest.fn(),
    getFallbackLanguage: jest.fn().mockReturnValue('zh-CN'),
    getSupportedLanguages: jest.fn().mockReturnValue(['zh-CN', 'en-US']),
  } as any;
}

// ── Helper: create mock EventEmitter2 ──
function createMockEventEmitter(): any {
  return {
    emit: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    off: jest.fn(),
    removeAllListeners: jest.fn(),
  };
}

describe('WebSocket Module Integration', () => {
  // real service instances
  let connectionLimiter: ConnectionLimiterService;
  let connectionMonitor: ConnectionMonitorService;
  let offlineMessageService: OfflineMessageService;
  let offlineCacheService: OfflineMessageCacheService;
  let metricsService: WebSocketMetricsService;
  let gateway: ScadaWebSocketGateway;

  // mock framework objects
  let mockJwtService: jest.Mocked<JwtService>;
  let mockI18n: jest.Mocked<I18nService>;
  let mockEventBus: EventBusService;
  let mockEventEmitter: any;
  let mockServer: Partial<Server>;

  beforeEach(() => {
    // silence all logs
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    // create mock dependencies
    mockI18n = createMockI18n();
    mockEventEmitter = createMockEventEmitter();
    mockEventBus = new EventBusService(mockEventEmitter);
    mockJwtService = { verify: jest.fn() } as any;
    mockServer = createMockServer();

    // create real service instances
    connectionLimiter = new ConnectionLimiterService(mockI18n);
    connectionMonitor = new ConnectionMonitorService(mockI18n, mockEventBus);
    offlineMessageService = new OfflineMessageService(mockI18n);
    offlineCacheService = new OfflineMessageCacheService();
    metricsService = new WebSocketMetricsService();

    // create a real Gateway instance, injecting the real services
    gateway = new ScadaWebSocketGateway(
      mockJwtService,
      offlineCacheService,
      metricsService,
      connectionLimiter,
      connectionMonitor,
    );
    (gateway as any).server = mockServer;
  });

  afterEach(() => {
    // clean up the Gateway's timers (idleCheckTimer is created in the constructor)
    const gw = gateway as any;
    if (gw.idleCheckTimer) {
      clearInterval(gw.idleCheckTimer);
      gw.idleCheckTimer = null;
    }
    if (gw.batchFlushTimer) {
      clearInterval(gw.batchFlushTimer);
      gw.batchFlushTimer = null;
    }
    jest.restoreAllMocks();
  });

  // ==================== 1. connection-limit end-to-end flow ====================
  describe('Connection Limiter End-to-End', () => {
    it('should allow 5 connections for a single user (default limit)', () => {
      for (let i = 0; i < 5; i++) {
        const result = connectionLimiter.registerConnection(`socket-${i}`, 'user-1', `10.0.0.${i}`);
        expect(result.allowed).toBe(true);
      }
    });

    it('should reject the 6th connection for the same user', () => {
      for (let i = 0; i < 5; i++) {
        connectionLimiter.registerConnection(`socket-${i}`, 'user-1', `10.0.0.${i}`);
      }

      const result = connectionLimiter.registerConnection('socket-5', 'user-1', '10.0.0.5');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should allow connections for different users independently', () => {
      for (let i = 0; i < 5; i++) {
        connectionLimiter.registerConnection(`socket-a${i}`, 'user-a', `10.0.1.${i}`);
      }

      const result = connectionLimiter.registerConnection('socket-b0', 'user-b', '10.0.2.0');
      expect(result.allowed).toBe(true);
      expect(connectionLimiter.getUserConnectionCount('user-a')).toBe(5);
      expect(connectionLimiter.getUserConnectionCount('user-b')).toBe(1);
    });

    it('should reject 11th connection from the same IP (default limit 10)', () => {
      for (let i = 0; i < 10; i++) {
        connectionLimiter.registerConnection(`socket-ip${i}`, `user-${i}`, '10.0.0.1');
      }

      const result = connectionLimiter.registerConnection('socket-ip10', 'user-10', '10.0.0.1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('should reject connection exceeding global limit', () => {
      connectionLimiter.updateConfig({ maxGlobalConnections: 3 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');
      connectionLimiter.registerConnection('s2', 'u2', '10.0.0.2');
      connectionLimiter.registerConnection('s3', 'u3', '10.0.0.3');

      const result = connectionLimiter.registerConnection('s4', 'u4', '10.0.0.4');
      expect(result.allowed).toBe(false);
    });

    it('should release quota after disconnect', () => {
      for (let i = 0; i < 5; i++) {
        connectionLimiter.registerConnection(`socket-${i}`, 'user-1', `10.0.0.${i}`);
      }
      expect(connectionLimiter.getUserConnectionCount('user-1')).toBe(5);

      connectionLimiter.unregisterConnection('socket-0');
      expect(connectionLimiter.getUserConnectionCount('user-1')).toBe(4);

      const result = connectionLimiter.registerConnection('socket-new', 'user-1', '10.0.0.99');
      expect(result.allowed).toBe(true);
    });

    it('should update lastActivityAt on recordActivity', () => {
      connectionLimiter.registerConnection('socket-1', 'user-1', '10.0.0.1');
      const record = connectionLimiter.getConnection('socket-1');
      expect(record).toBeDefined();

      const originalActivity = record!.lastActivityAt;
      // simulate an old activity time
      (record as any).lastActivityAt = originalActivity - 60000;

      // record new activity
      connectionLimiter.recordActivity('socket-1');

      const updated = connectionLimiter.getConnection('socket-1');
      expect(updated!.lastActivityAt).toBe(Date.now());
    });
  });

  // ==================== 2. connection-monitor end-to-end flow ====================
  describe('Connection Monitor End-to-End', () => {
    it('should return correct connection count in getStats after registration', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      connectionMonitor.registerConnection('s2', 'u2', 'user2', '10.0.0.2');

      const stats = connectionMonitor.getStats();
      expect(stats.totalConnections).toBe(2);
    });

    it('should group connections by project', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      connectionMonitor.registerConnection('s2', 'u2', 'user2', '10.0.0.2');
      connectionMonitor.updateProjectRooms('s1', ['project:p1']);
      connectionMonitor.updateProjectRooms('s2', ['project:p1', 'project:p2']);

      const stats = connectionMonitor.getStats();
      expect(stats.connectionsByProject['p1']).toBe(2);
      expect(stats.connectionsByProject['p2']).toBe(1);
    });

    it('should group connections by user', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      connectionMonitor.registerConnection('s2', 'u1', 'user1', '10.0.0.2');

      const stats = connectionMonitor.getStats();
      expect(stats.connectionsByUser['u1']).toBe(2);
    });

    it('should update message count on recordMessage', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      const before = connectionMonitor.getConnectionSnapshot('s1')!.messageCount;

      connectionMonitor.recordMessage('s1');

      const after = connectionMonitor.getConnectionSnapshot('s1')!.messageCount;
      expect(after).toBe(before + 1);
    });

    it('should return message rates from getMessageRates', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      for (let i = 0; i < 5; i++) {
        connectionMonitor.recordMessage('s1');
      }

      const rates = connectionMonitor.getMessageRates();
      expect(rates.length).toBeGreaterThan(0);

      const s1Rate = rates.find((r) => r.socketId === 's1');
      expect(s1Rate).toBeDefined();
      expect(s1Rate!.totalMessages).toBe(5);
    });

    it('should remove connection from monitor on unregister', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      expect(connectionMonitor.getConnectionSnapshot('s1')).toBeDefined();

      connectionMonitor.unregisterConnection('s1');

      expect(connectionMonitor.getConnectionSnapshot('s1')).toBeUndefined();
    });

    it('should detect abnormal high message rate', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      // set the anomaly-rate threshold to 0 (any message counts as anomaly)
      connectionMonitor.setAbnormalThresholds(0, undefined);

      connectionMonitor.recordMessage('s1');

      const abnormal = connectionMonitor.detectAbnormalConnections();
      expect(abnormal).toContain('s1');
    });

    it('should return duration distribution stats', () => {
      connectionMonitor.registerConnection('s1', 'u1', 'user1', '10.0.0.1');
      connectionMonitor.registerConnection('s2', 'u2', 'user2', '10.0.0.2');

      const durationStats = connectionMonitor.getDurationStats();
      expect(durationStats.distribution.under1Min).toBeGreaterThanOrEqual(2);
      expect(durationStats.avgMs).toBeGreaterThanOrEqual(0);
      expect(durationStats.maxMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== 3. idle connection detection ====================
  describe('Idle Connection Detection', () => {
    it('should detect idle connections after timeout exceeded', () => {
      connectionLimiter.updateConfig({ idleTimeoutMinutes: 1 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');

      // simulate an activity time 2 minutes ago
      const record = connectionLimiter.getConnection('s1');
      (record as any).lastActivityAt = Date.now() - 2 * 60 * 1000;

      const idle = connectionLimiter.checkIdleConnections();
      expect(idle).toContain('s1');
    });

    it('should not detect recently registered connections as idle', () => {
      connectionLimiter.updateConfig({ idleTimeoutMinutes: 1 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');

      // just registered, lastActivityAt is the current time
      const idle = connectionLimiter.checkIdleConnections();
      expect(idle).not.toContain('s1');
    });

    it('should not detect connections with recent activity as idle', () => {
      connectionLimiter.updateConfig({ idleTimeoutMinutes: 1 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');

      // set an old activity time
      const record = connectionLimiter.getConnection('s1');
      (record as any).lastActivityAt = Date.now() - 2 * 60 * 1000;

      // record new activity to refresh lastActivityAt
      connectionLimiter.recordActivity('s1');

      const idle = connectionLimiter.checkIdleConnections();
      expect(idle).not.toContain('s1');
    });
  });

  // ==================== 4. offline message caching & reconnect re-delivery ====================
  describe('Offline Message Service End-to-End', () => {
    it('should cache a message and return it in getUnreadMessages', () => {
      const msg = offlineMessageService.cacheMessage('u1', 'alarm_trigger', 'p1', {
        alarmId: 'a1',
      });

      expect(msg).toBeDefined();
      expect(msg.confirmed).toBe(false);

      const unread = offlineMessageService.getUnreadMessages('u1');
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe(msg.id);
    });

    it('should return unread messages in replayMessages', () => {
      offlineMessageService.cacheMessage('u1', 'alarm_trigger', 'p1', { alarmId: 'a1' });
      offlineMessageService.cacheMessage('u1', 'device_status_change', 'p1', {
        deviceId: 'd1',
      });

      const replay = offlineMessageService.replayMessages('u1');
      expect(replay).toHaveLength(2);
    });

    it('should exclude confirmed messages from getUnreadMessages', () => {
      const msg = offlineMessageService.cacheMessage('u1', 'alarm_trigger', 'p1', {
        alarmId: 'a1',
      });

      offlineMessageService.confirmMessage(msg.id);

      const unread = offlineMessageService.getUnreadMessages('u1');
      expect(unread).toHaveLength(0);
    });

    it('should delete all user messages', () => {
      offlineMessageService.cacheMessage('u1', 'alarm_trigger', 'p1', { alarmId: 'a1' });
      offlineMessageService.cacheMessage('u1', 'alarm_cleared', 'p1', { alarmId: 'a2' });

      const count = offlineMessageService.deleteUserMessages('u1');
      expect(count).toBe(2);
      expect(offlineMessageService.getAllMessages('u1')).toHaveLength(0);
    });

    it('should clean up expired messages', () => {
      offlineMessageService.updateConfig({ expireAfterMs: 100 });
      offlineMessageService.cacheMessage('u1', 'alarm_trigger', 'p1', { alarmId: 'a1' });

      // advance time to expire the messages
      jest.advanceTimersByTime(200);

      const cleaned = offlineMessageService.cleanupExpiredMessages();
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(offlineMessageService.getAllMessages('u1')).toHaveLength(0);
    });

    it('should return correct stats', () => {
      offlineMessageService.cacheMessage('u1', 'alarm_trigger', 'p1', { alarmId: 'a1' });
      offlineMessageService.cacheMessage('u2', 'device_status_change', 'p2', {
        deviceId: 'd1',
      });

      const stats = offlineMessageService.getStats();
      expect(stats.totalMessages).toBe(2);
      expect(stats.activeUsers).toBe(2);
      expect(stats.unconfirmedMessages).toBe(2);
    });
  });

  // ==================== 5. offline cache service (OfflineMessageCacheService) ====================
  describe('Offline Message Cache Service End-to-End', () => {
    it('should register a client', () => {
      offlineCacheService.registerClient('client-1');

      // when no client is online, client-1 should be in the offline list
      const offline = offlineCacheService.getOfflineClientIds(new Set());
      expect(offline).toContain('client-1');
    });

    it('should cache a message for a client', () => {
      offlineCacheService.cacheMessage('client-1', 'test:event', { data: 'hello' });

      const pending = offlineCacheService.getPendingMessages('client-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].event).toBe('test:event');
      expect(pending[0].data).toEqual({ data: 'hello' });
    });

    it('should return pending messages excluding expired', () => {
      offlineCacheService.cacheMessage('client-1', 'test:event', { data: 'hello' });

      // advance time beyond the TTL (5 minutes)
      jest.advanceTimersByTime(6 * 60 * 1000);

      const pending = offlineCacheService.getPendingMessages('client-1');
      expect(pending).toHaveLength(0);
    });

    it('should clear messages for a client', () => {
      offlineCacheService.cacheMessage('client-1', 'test:event', { data: 'hello' });
      offlineCacheService.cacheMessage('client-1', 'test:event2', { data: 'world' });

      offlineCacheService.clearMessages('client-1');

      const pending = offlineCacheService.getPendingMessages('client-1');
      expect(pending).toHaveLength(0);
    });

    it('should return cache stats', () => {
      offlineCacheService.cacheMessage('client-1', 'test:event', { data: '1' });
      offlineCacheService.cacheMessage('client-1', 'test:event', { data: '2' });
      offlineCacheService.cacheMessage('client-2', 'test:event', { data: '3' });

      const stats = offlineCacheService.getCacheStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.totalMessages).toBe(3);
    });

    it('should return offline client ids', () => {
      offlineCacheService.registerClient('client-1');
      offlineCacheService.registerClient('client-2');
      offlineCacheService.registerClient('client-3');

      // client-2 is online
      const offline = offlineCacheService.getOfflineClientIds(new Set(['client-2']));
      expect(offline).toContain('client-1');
      expect(offline).toContain('client-3');
      expect(offline).not.toContain('client-2');
    });
  });

  // ==================== 6. Gateway + service integration flow ====================
  describe('Gateway + Services Integration', () => {
    it('should register connection in limiter and monitor on connect with valid JWT', () => {
      const payload = { sub: 'user-1', username: 'testuser', role: 'user' };
      mockJwtService.verify.mockReturnValue(payload);
      const socket = createMockSocket('socket-001', '10.0.0.1', 'valid-token');

      gateway.handleConnection(socket);

      // verify the connection limiter recorded the connection
      expect(connectionLimiter.getConnection('socket-001')).toBeDefined();
      // verify the connection monitor recorded the connection
      const snapshot = connectionMonitor.getConnectionSnapshot('socket-001');
      expect(snapshot).toBeDefined();
      expect(snapshot!.userId).toBe('user-1');
      expect(snapshot!.username).toBe('testuser');
      // verify the socket was joined to the user's room
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      // verify the connection-success event was emitted
      expect(socket.emit).toHaveBeenCalledWith(
        'connection',
        expect.objectContaining({ authenticated: true }),
      );
    });

    it('should reject connection when limiter denies (user limit exceeded)', () => {
      // fill the connection limit with the same user (default 5)
      mockJwtService.verify.mockReturnValue({
        sub: 'user-1',
        username: 'u',
        role: 'user',
      });
      for (let i = 0; i < 5; i++) {
        const s = createMockSocket(`socket-${i}`, `10.0.0.${i}`, 'token');
        gateway.handleConnection(s);
      }

      // the 6th connection should be rejected
      const socket = createMockSocket('socket-5', '10.0.0.5', 'token');
      gateway.handleConnection(socket);

      expect(socket.emit).toHaveBeenCalledWith(
        'connection:error',
        expect.objectContaining({ reason: expect.any(String) }),
      );
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      // verify the rejected connection did not enter the limiter
      expect(connectionLimiter.getConnection('socket-5')).toBeUndefined();
    });

    it('should update monitor project rooms on subscribe:project', () => {
      const socket = createMockSocket('socket-001', '10.0.0.1');
      gateway.handleConnection(socket);

      gateway.handleSubscribeProject({ projectId: 'p1' }, socket as Socket);

      const snapshot = connectionMonitor.getConnectionSnapshot('socket-001');
      expect(snapshot!.projectRooms).toContain('project:p1');
      // verify socket.join was called
      expect(socket.join).toHaveBeenCalledWith('project:p1');
      // verify the room:joined event was emitted
      expect(socket.emit).toHaveBeenCalledWith('room:joined', {
        room: 'project:p1',
        projectId: 'p1',
      });
    });

    it('should unregister from limiter and monitor on disconnect', () => {
      const socket = createMockSocket('socket-001', '10.0.0.1');
      gateway.handleConnection(socket);
      expect(connectionLimiter.getConnection('socket-001')).toBeDefined();
      expect(connectionMonitor.getConnectionSnapshot('socket-001')).toBeDefined();

      gateway.handleDisconnect(socket as Socket);

      expect(connectionLimiter.getConnection('socket-001')).toBeUndefined();
      expect(connectionMonitor.getConnectionSnapshot('socket-001')).toBeUndefined();
    });

    it('should replay pending offline messages on reconnect', () => {
      // cache the offline message first
      offlineCacheService.registerClient('user-1');
      offlineCacheService.cacheMessage('user-1', 'alarm:trigger', { alarmId: 'a1' });
      offlineCacheService.cacheMessage('user-1', 'alarm:cleared', { alarmId: 'a2' });

      // simulate a reconnect
      const payload = { sub: 'user-1', username: 'testuser', role: 'user' };
      mockJwtService.verify.mockReturnValue(payload);
      const socket = createMockSocket('socket-reconnect', '10.0.0.1', 'token');

      gateway.handleConnection(socket);

      // verify the cached message was re-delivered
      expect(socket.emit).toHaveBeenCalledWith('alarm:trigger', { alarmId: 'a1' });
      expect(socket.emit).toHaveBeenCalledWith('alarm:cleared', { alarmId: 'a2' });

      // verify the cache was cleared after re-delivery
      const pending = offlineCacheService.getPendingMessages('user-1');
      expect(pending).toHaveLength(0);
    });

    it('should not replay messages for anonymous (unauthenticated) connections', () => {
      offlineCacheService.registerClient('user-1');
      offlineCacheService.cacheMessage('user-1', 'alarm:trigger', { alarmId: 'a1' });

      // anonymous connection without a token
      const socket = createMockSocket('socket-anon', '10.0.0.1');
      gateway.handleConnection(socket);

      // should not re-deliver alarm:trigger events (only connection events should be emitted)
      expect(socket.emit).not.toHaveBeenCalledWith('alarm:trigger', expect.anything());
      // the cache should be retained
      const pending = offlineCacheService.getPendingMessages('user-1');
      expect(pending).toHaveLength(1);
    });

    it('should cache messages for offline clients on system broadcast', () => {
      // register a client (simulate a previous connection)
      offlineCacheService.registerClient('user-1');

      // no client is currently connected through the Gateway; user-1 is offline
      gateway.broadcastSystem('System maintenance', { type: 'warning' });

      // verify the message was cached for the offline client
      const pending = offlineCacheService.getPendingMessages('user-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].event).toBe('system:broadcast');
      // verify it was also broadcast to all online clients via Server
      expect(mockServer.emit).toHaveBeenCalledWith(
        'system:broadcast',
        expect.objectContaining({ message: 'System maintenance' }),
      );
    });
  });

  // ==================== 7. dynamic connection config update ====================
  describe('Connection Config Dynamic Update', () => {
    it('should apply new maxConnectionsPerUser immediately', () => {
      connectionLimiter.updateConfig({ maxConnectionsPerUser: 2 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');
      connectionLimiter.registerConnection('s2', 'u1', '10.0.0.2');

      const result = connectionLimiter.registerConnection('s3', 'u1', '10.0.0.3');
      expect(result.allowed).toBe(false);
    });

    it('should apply new maxConnectionsPerIp immediately', () => {
      connectionLimiter.updateConfig({ maxConnectionsPerIp: 2 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');
      connectionLimiter.registerConnection('s2', 'u2', '10.0.0.1');

      const result = connectionLimiter.registerConnection('s3', 'u3', '10.0.0.1');
      expect(result.allowed).toBe(false);
    });

    it('should apply new maxGlobalConnections immediately', () => {
      connectionLimiter.updateConfig({ maxGlobalConnections: 2 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');
      connectionLimiter.registerConnection('s2', 'u2', '10.0.0.2');

      const result = connectionLimiter.registerConnection('s3', 'u3', '10.0.0.3');
      expect(result.allowed).toBe(false);
    });

    it('should apply new idleTimeoutMinutes immediately', () => {
      // initial timeout 5 minutes
      connectionLimiter.updateConfig({ idleTimeoutMinutes: 5 });
      connectionLimiter.registerConnection('s1', 'u1', '10.0.0.1');
      const record = connectionLimiter.getConnection('s1');
      // set activity time 3 minutes ago (within the 5-minute timeout)
      (record as any).lastActivityAt = Date.now() - 3 * 60 * 1000;

      let idle = connectionLimiter.checkIdleConnections();
      expect(idle).not.toContain('s1');

      // update timeout to 2 minutes (3 minutes > 2 minutes, should be detected as idle)
      connectionLimiter.updateConfig({ idleTimeoutMinutes: 2 });
      idle = connectionLimiter.checkIdleConnections();
      expect(idle).toContain('s1');
    });
  });
});
