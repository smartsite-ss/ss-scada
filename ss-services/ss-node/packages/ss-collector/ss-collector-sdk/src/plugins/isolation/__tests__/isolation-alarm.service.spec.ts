// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IsolationAlarmService } from '../isolation-alarm.service';
import { IsolationMode } from '../../plugin.types';

// ============================================================
// Mock EventBusService
// ============================================================
const createMockEventBus = () => {
  const handlers: Record<string, Function[]> = {};
  return {
    handlers,
    emit: jest.fn(),
    on: jest.fn((event: string, handler: Function) => {
      (handlers[event] ??= []).push(handler);
    }),
    off: jest.fn((event: string) => {
      delete handlers[event];
    }),
    once: jest.fn(),
    removeAllListeners: jest.fn(),
    eventNames: jest.fn().mockReturnValue([]),
    listeners: jest.fn().mockReturnValue([]),
    listenerCount: jest.fn().mockReturnValue(0),
    rawListeners: jest.fn().mockReturnValue([]),
    hasListeners: jest.fn().mockReturnValue(false),
    waitFor: jest.fn(),
    emitAsync: jest.fn(),
    emitMany: jest.fn(),
    addListener: jest.fn(),
    prependListener: jest.fn(),
    prependOnceListener: jest.fn(),
    removeListener: jest.fn(),
    setMaxListeners: jest.fn(),
    getMaxListeners: jest.fn().mockReturnValue(10),
    listenTo: jest.fn(),
    stopListeningTo: jest.fn(),
    toJSON: jest.fn().mockReturnValue({}),
    eventBus: {} as any,
    /** Manually trigger the event (for testing) */
    trigger: (event: string, payload: any) => {
      for (const h of handlers[event] || []) h(payload);
    },
  };
};

// ============================================================
// Mock IsolationFactory
// ============================================================
const createMockIsolationFactory = (
  overrides: {
    getAllHealth?: jest.Mock;
    pluginRegistry?: any;
  } = {},
) => ({
  getAllHealth: overrides.getAllHealth ?? jest.fn().mockResolvedValue(new Map()),
  getExecutor: jest.fn(),
  prepare: jest.fn(),
  isIsolated: jest.fn(),
  pluginRegistry: overrides.pluginRegistry ?? {
    getPlugin: jest.fn().mockReturnValue(null),
  },
  onModuleDestroy: jest.fn(),
});

// ============================================================
// Test data
// ============================================================
const createCrashPayload = (
  overrides: Partial<{
    protocol: string;
    mode: IsolationMode;
    restartCount: number;
    error: string;
    timestamp: number;
  }> = {},
) => ({
  protocol: 'virtual',
  mode: IsolationMode.WORKER_THREAD,
  restartCount: 1,
  error: 'Worker crashed',
  timestamp: Date.now(),
  ...overrides,
});

const createHealthData = (
  overrides: Partial<{
    status: string;
    avgLatencyMs: number;
  }> = {},
) => ({
  status: 'healthy',
  avgLatencyMs: 5,
  ...overrides,
});

// ============================================================
// Test suite
// ============================================================
describe('IsolationAlarmService', () => {
  let service: IsolationAlarmService;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let isolationFactory: ReturnType<typeof createMockIsolationFactory>;

  beforeEach(() => {
    jest.useFakeTimers();
    eventBus = createMockEventBus();
    isolationFactory = createMockIsolationFactory();
    service = new IsolationAlarmService(isolationFactory as any, eventBus as any);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('Should subscribe to the plugin.isolation.crash event', () => {
      expect(eventBus.on).toHaveBeenCalledWith('plugin.isolation.crash', expect.any(Function));
    });

    it('Should start the health check timer', () => {
      // Verify the timer has started (setInterval was called)
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });
  });

  describe('onCrash', () => {
    it('Crash events should be recorded in restartRecords', () => {
      const payload = createCrashPayload();
      eventBus.trigger('plugin.isolation.crash', payload);

      const record = service.getRestartRecord('virtual');
      expect(record).toBeDefined();
      expect(record!.restartCount).toBe(1);
      expect(record!.mode).toBe(IsolationMode.WORKER_THREAD);
    });

    it('Multiple crashes should accumulate the restart count', () => {
      eventBus.trigger('plugin.isolation.crash', createCrashPayload({ restartCount: 1 }));
      eventBus.trigger('plugin.isolation.crash', createCrashPayload({ restartCount: 2 }));
      eventBus.trigger('plugin.isolation.crash', createCrashPayload({ restartCount: 3 }));

      const record = service.getRestartRecord('virtual');
      expect(record!.restartCount).toBe(3);
    });

    it('Different protocols should have independent restart records', () => {
      eventBus.trigger(
        'plugin.isolation.crash',
        createCrashPayload({ protocol: 'modbus_tcp', restartCount: 2 }),
      );
      eventBus.trigger(
        'plugin.isolation.crash',
        createCrashPayload({ protocol: 'opcua', restartCount: 5 }),
      );

      expect(service.getRestartRecord('modbus_tcp')!.restartCount).toBe(2);
      expect(service.getRestartRecord('opcua')!.restartCount).toBe(5);
    });
  });

  describe('checkHighRestart', () => {
    it('More than 3 restarts within 10 minutes should trigger an alarm', () => {
      const now = Date.now();
      // Simulate 4 crashes, time span < 10 minutes
      eventBus.trigger(
        'plugin.isolation.crash',
        createCrashPayload({
          restartCount: 4,
          timestamp: now,
        }),
      );

      // Manually mark firstRestartAt as 5 minutes ago
      const record = service.getRestartRecord('virtual')!;
      record.firstRestartAt = now - 5 * 60 * 1000;

      // 5th crash
      eventBus.trigger(
        'plugin.isolation.crash',
        createCrashPayload({
          restartCount: 5,
          timestamp: now,
        }),
      );

      expect(eventBus.emit).toHaveBeenCalledWith(
        'plugin.isolation.alarm',
        expect.objectContaining({
          alarmType: 'worker-high-restart',
          protocol: 'virtual',
          level: 'warning',
        }),
      );
    });

    it('Restart counts below the threshold should not trigger an alarm', () => {
      eventBus.trigger('plugin.isolation.crash', createCrashPayload({ restartCount: 2 }));
      eventBus.trigger('plugin.isolation.crash', createCrashPayload({ restartCount: 3 }));

      const alarmCalls = eventBus.emit.mock.calls.filter(
        (call: any[]) => call[1]?.alarmType === 'worker-high-restart',
      );
      expect(alarmCalls.length).toBe(0);
    });
  });

  describe('performHealthCheck', () => {
    it('The dead status should trigger the worker-dead alarm', async () => {
      const mockGetAllHealth = jest
        .fn()
        .mockResolvedValue(new Map([['virtual', createHealthData({ status: 'dead' })]]));
      const mockPluginRegistry = {
        getPlugin: jest.fn().mockReturnValue({
          meta: { isolationMode: IsolationMode.WORKER_THREAD },
        }),
      };

      service.onModuleDestroy(); // clean up the old instance
      const factory = createMockIsolationFactory({
        getAllHealth: mockGetAllHealth,
        pluginRegistry: mockPluginRegistry,
      });
      service = new IsolationAlarmService(factory as any, eventBus as any);

      // Advance the timer to trigger the health check
      jest.advanceTimersByTime(30000);

      // Wait for async to finish
      await Promise.resolve();

      expect(eventBus.emit).toHaveBeenCalledWith(
        'plugin.isolation.alarm',
        expect.objectContaining({
          alarmType: 'worker-dead',
          protocol: 'virtual',
          level: 'critical',
        }),
      );
    });

    it('Latency over the threshold should trigger the worker-high-latency alarm', async () => {
      const mockGetAllHealth = jest
        .fn()
        .mockResolvedValue(new Map([['virtual', createHealthData({ avgLatencyMs: 15000 })]]));
      const mockPluginRegistry = {
        getPlugin: jest.fn().mockReturnValue({
          meta: { isolationMode: IsolationMode.WORKER_THREAD },
        }),
      };

      service.onModuleDestroy();
      const factory = createMockIsolationFactory({
        getAllHealth: mockGetAllHealth,
        pluginRegistry: mockPluginRegistry,
      });
      service = new IsolationAlarmService(factory as any, eventBus as any);

      jest.advanceTimersByTime(30000);
      await Promise.resolve();

      expect(eventBus.emit).toHaveBeenCalledWith(
        'plugin.isolation.alarm',
        expect.objectContaining({
          alarmType: 'worker-high-latency',
          protocol: 'virtual',
          level: 'warning',
        }),
      );
    });

    it('Healthy status should not trigger an alarm', async () => {
      const mockGetAllHealth = jest
        .fn()
        .mockResolvedValue(
          new Map([['virtual', createHealthData({ status: 'healthy', avgLatencyMs: 5 })]]),
        );

      service.onModuleDestroy();
      const factory = createMockIsolationFactory({ getAllHealth: mockGetAllHealth });
      service = new IsolationAlarmService(factory as any, eventBus as any);

      jest.advanceTimersByTime(30000);
      await Promise.resolve();

      const alarmCalls = eventBus.emit.mock.calls.filter(
        (call: any[]) => call[0] === 'plugin.isolation.alarm',
      );
      expect(alarmCalls.length).toBe(0);
    });
  });

  describe('getRestartRecords', () => {
    it('Should return a copy of all restart records', () => {
      eventBus.trigger('plugin.isolation.crash', createCrashPayload({ protocol: 'modbus_tcp' }));
      eventBus.trigger('plugin.isolation.crash', createCrashPayload({ protocol: 'opcua' }));

      const records = service.getRestartRecords();
      expect(records.size).toBe(2);
      expect(records.has('modbus_tcp')).toBe(true);
      expect(records.has('opcua')).toBe(true);
    });
  });

  describe('onModuleDestroy', () => {
    it('Should clean up timers and event listeners', () => {
      service.onModuleDestroy();

      expect(eventBus.off).toHaveBeenCalledWith('plugin.isolation.crash');
      const records = service.getRestartRecords();
      expect(records.size).toBe(0);
    });
  });
});
