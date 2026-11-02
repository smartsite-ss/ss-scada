// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import { EventBusService, EventLogService } from '@ss-node/ss-core';
import { IsolationFactory } from '../plugins';
import { EnhancedScheduler } from '../pipeline/scheduler/enhanced-scheduler';
import { DeviceConfigWatcher } from '../pipeline/device-config-watcher.service';

// ============================================================
// Mock factory
// ============================================================

function makeMockEventBus() {
  const handlers = new Map<string, Set<(payload: any) => void>>();
  return {
    on: jest.fn((event: string, handler: (payload: any) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    emit: jest.fn((event: string, payload: any) => {
      handlers.get(event)?.forEach((h) => h(payload));
    }),
    off: jest.fn(),
    /** Test helper: manually trigger registered handlers and wait for all async handlers to finish
     * Simulates the real EventBus.emit error-capture behavior: one handler's failure does not affect others */
    async fire(event: string, payload: any) {
      const set = handlers.get(event);
      if (!set) return;
      await Promise.all(
        Array.from(set).map(async (h) => {
          try {
            await h(payload);
          } catch {
            // Simulate EventBus.emit error capture: log but do not throw
          }
        }),
      );
    },
    /** Test helper: manually trigger and collect errors thrown by handlers (to verify failure tracking) */
    async fireAndCollectErrors(event: string, payload: any): Promise<Error[]> {
      const set = handlers.get(event);
      if (!set) return [];
      const errors: Error[] = [];
      await Promise.all(
        Array.from(set).map(async (h) => {
          try {
            await h(payload);
          } catch (err) {
            errors.push(err as Error);
          }
        }),
      );
      return errors;
    },
    /** Test helper: get the list of registered events */
    registeredEvents: () => Array.from(handlers.keys()),
  };
}

function makeMockEventLogService() {
  const self: any = {
    recordEmission: jest.fn().mockResolvedValue('log-id-mock'),
    recordSubscriberStart: jest.fn().mockResolvedValue(undefined),
    recordSubscriberSuccess: jest.fn().mockResolvedValue(undefined),
    recordSubscriberFailure: jest.fn().mockResolvedValue(undefined),
    findRecentLogId: jest.fn().mockResolvedValue('log-id-mock'),
    shouldPersist: jest.fn().mockReturnValue(true),
  };

  /** Simulate the real wrapSubscriber: record start -> call handler -> record success/failure -> rethrow on failure */
  self.wrapSubscriber = jest.fn(
    <T extends any[]>(
      eventType: string,
      subscriberName: string,
      handler: (...args: T) => Promise<Record<string, any> | void>,
    ) => {
      const logId = 'log-id-mock';
      return async (...args: T): Promise<void> => {
        await self.recordSubscriberStart(logId, subscriberName);
        const startedAt = Date.now();
        try {
          const result = await handler(...args);
          await self.recordSubscriberSuccess(
            logId,
            subscriberName,
            Date.now() - startedAt,
            result,
          );
        } catch (err) {
          await self.recordSubscriberFailure(
            logId,
            subscriberName,
            (err as Error).message,
          );
          throw err;
        }
      };
    },
  );

  return self as unknown as jest.Mocked<EventLogService>;
}

function makeMockExecutor() {
  return {
    name: 'MockExecutor',
    connect: jest.fn().mockResolvedValue({ connectionId: 'conn-1', protocol: 'modbus_tcp' }),
    disconnect: jest.fn().mockResolvedValue(undefined),
    readTag: jest.fn().mockResolvedValue({ value: 1 }),
    writeTag: jest.fn().mockResolvedValue(undefined),
    getHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
    destroy: jest.fn().mockResolvedValue(undefined),
    init: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockIsolationFactory(executor: ReturnType<typeof makeMockExecutor>) {
  return {
    getExecutor: jest.fn().mockReturnValue(executor),
    prepare: jest.fn().mockResolvedValue(undefined),
    getAllHealth: jest.fn().mockResolvedValue(new Map()),
    isIsolated: jest.fn().mockReturnValue(false),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  } as unknown as IsolationFactory;
}

function makeMockScheduler() {
  return {
    updateTaskInterval: jest.fn().mockReturnValue(1),
    registerTask: jest.fn(),
    unregisterTask: jest.fn(),
    setPipelineSteps: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({}),
    onModuleDestroy: jest.fn(),
    onModuleInit: jest.fn(),
  } as unknown as EnhancedScheduler;
}

// ============================================================
// DeviceConfigWatcher
// ============================================================
describe('DeviceConfigWatcher', () => {
  let eventBus: ReturnType<typeof makeMockEventBus>;
  let executor: ReturnType<typeof makeMockExecutor>;
  let isolationFactory: IsolationFactory;
  let scheduler: EnhancedScheduler;
  let watcher: DeviceConfigWatcher;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    eventBus = makeMockEventBus();
    executor = makeMockExecutor();
    isolationFactory = makeMockIsolationFactory(executor);
    scheduler = makeMockScheduler();
    watcher = new DeviceConfigWatcher(
      eventBus as unknown as EventBusService,
      undefined,
      isolationFactory,
      scheduler,
    );
  });

  describe('onModuleInit', () => {
    it('Should register 5 device event listeners', () => {
      watcher.onModuleInit();
      expect(eventBus.on).toHaveBeenCalledTimes(5);
      expect(eventBus.on).toHaveBeenCalledWith('device.created', expect.any(Function));
      expect(eventBus.on).toHaveBeenCalledWith('device.updated', expect.any(Function));
      expect(eventBus.on).toHaveBeenCalledWith('device.deleted', expect.any(Function));
      expect(eventBus.on).toHaveBeenCalledWith('device.enabled', expect.any(Function));
      expect(eventBus.on).toHaveBeenCalledWith('device.disabled', expect.any(Function));
    });
  });

  describe('device.created event', () => {
    beforeEach(() => {
      watcher.onModuleInit();
    });

    it('Should call ensureConnection to establish the connection', async () => {
      await eventBus.fire('device.created', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1', port: 502 },
        scanRate: 1000,
      });

      expect(executor.connect).toHaveBeenCalledWith({
        id: 'dev-1',
        name: 'dev-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1', port: 502 },
      });
      expect(watcher.getActiveDevices().has('dev-1')).toBe(true);
    });

    it('Should skip the connection when isolationFactory is unavailable', async () => {
      const watcherNoFactory = new DeviceConfigWatcher(
        eventBus as unknown as EventBusService,
        undefined,
        undefined,
        undefined,
      );
      watcherNoFactory.onModuleInit();
      await eventBus.fire('device.created', {
        deviceId: 'dev-2',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: {},
        scanRate: 1000,
      });
      expect(watcherNoFactory.getActiveDevices().has('dev-2')).toBe(false);
    });

    it('When connection throws, the error should be logged but not rethrown', async () => {
      executor.connect.mockRejectedValueOnce(new Error('connect fail'));
      await eventBus.fire('device.created', {
        deviceId: 'dev-err',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: {},
        scanRate: 1000,
      });
      // Should not throw, and the device is not in the active list
      expect(watcher.getActiveDevices().has('dev-err')).toBe(false);
    });
  });

  describe('device.updated event', () => {
    beforeEach(async () => {
      watcher.onModuleInit();
      // Create the device first
      await eventBus.fire('device.created', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1', port: 502 },
        scanRate: 1000,
      });
    });

    it('When connection changes, the old connection should be disconnected first before establishing the new one', async () => {
      await eventBus.fire('device.updated', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: ['connection'],
        connection: { host: '192.168.1.1', port: 502 },
      });

      expect(executor.disconnect).toHaveBeenCalled();
      expect(executor.connect).toHaveBeenCalledWith({
        id: 'dev-1',
        name: 'dev-1',
        protocol: 'modbus_tcp',
        connection: { host: '192.168.1.1', port: 502 },
      });
    });

    it('A scanRate change should call scheduler.updateTaskInterval', async () => {
      await eventBus.fire('device.updated', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: ['scanRate'],
        scanRate: 500,
      });

      expect(scheduler.updateTaskInterval).toHaveBeenCalledWith('dev-1', 500);
    });

    it('When the scheduler is unavailable, a scanRate change should log a warning', async () => {
      // Use a fresh eventBus to avoid interference from the original watcher's handlers
      const freshBus = makeMockEventBus();
      const watcherNoScheduler = new DeviceConfigWatcher(
        freshBus as unknown as EventBusService,
        undefined,
        isolationFactory,
        undefined,
      );
      watcherNoScheduler.onModuleInit();
      // Create the device first
      await freshBus.fire('device.created', {
        deviceId: 'dev-2',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1' },
        scanRate: 1000,
      });

      await freshBus.fire('device.updated', {
        deviceId: 'dev-2',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: ['scanRate'],
        scanRate: 250,
      });
      // scheduler is undefined, so updateTaskInterval should not be called
      expect(scheduler.updateTaskInterval).not.toHaveBeenCalled();
    });

    it('Changing both connection and scanRate should handle both', async () => {
      await eventBus.fire('device.updated', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: ['connection', 'scanRate'],
        connection: { host: '10.0.0.1' },
        scanRate: 200,
      });

      expect(executor.disconnect).toHaveBeenCalled();
      expect(executor.connect).toHaveBeenCalledWith({
        id: 'dev-1',
        name: 'dev-1',
        protocol: 'modbus_tcp',
        connection: { host: '10.0.0.1' },
      });
      expect(scheduler.updateTaskInterval).toHaveBeenCalledWith('dev-1', 200);
    });

    it('Should do nothing when there are no changed fields', async () => {
      executor.disconnect.mockClear();
      executor.connect.mockClear();

      await eventBus.fire('device.updated', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: [],
      });

      expect(executor.disconnect).not.toHaveBeenCalled();
      expect(scheduler.updateTaskInterval).not.toHaveBeenCalled();
    });

    it('A tags change should emit the device.tagsChanged event', async () => {
      const tagsChangedSpy = jest.fn();
      eventBus.on('device.tagsChanged', tagsChangedSpy);

      await eventBus.fire('device.updated', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: ['tags'],
      });

      expect(tagsChangedSpy).toHaveBeenCalledTimes(1);
      expect(tagsChangedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'dev-1',
          projectId: 'proj-1',
          protocol: 'modbus_tcp',
          changeType: 'template_sync',
        }),
      );
    });

    it('A tags change should not trigger disconnect or updateTaskInterval', async () => {
      executor.disconnect.mockClear();
      (scheduler.updateTaskInterval as jest.Mock).mockClear();

      await eventBus.fire('device.updated', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: ['tags'],
      });

      expect(executor.disconnect).not.toHaveBeenCalled();
      expect(scheduler.updateTaskInterval).not.toHaveBeenCalled();
    });

    it('Changing both tags and connection should handle both', async () => {
      const tagsChangedSpy = jest.fn();
      eventBus.on('device.tagsChanged', tagsChangedSpy);

      await eventBus.fire('device.updated', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        changedFields: ['connection', 'tags'],
        connection: { host: '10.0.0.1' },
      });

      expect(executor.disconnect).toHaveBeenCalled();
      expect(executor.connect).toHaveBeenCalled();
      expect(tagsChangedSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('device.deleted event', () => {
    beforeEach(async () => {
      watcher.onModuleInit();
      await eventBus.fire('device.created', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1' },
        scanRate: 1000,
      });
    });

    it('Should disconnect and remove from the active list', async () => {
      expect(watcher.getActiveDevices().has('dev-1')).toBe(true);

      await eventBus.fire('device.deleted', { deviceId: 'dev-1' });

      expect(executor.disconnect).toHaveBeenCalled();
      expect(watcher.getActiveDevices().has('dev-1')).toBe(false);
    });

    it('Deleting an unknown device should be safe', async () => {
      await eventBus.fire('device.deleted', { deviceId: 'unknown-dev' });
      // Should not throw an error
      expect(watcher.getActiveDevices().has('unknown-dev')).toBe(false);
    });
  });

  describe('device.enabled / device.disabled events', () => {
    beforeEach(() => {
      watcher.onModuleInit();
    });

    it('device.enabled should be equivalent to device.created', async () => {
      await eventBus.fire('device.enabled', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1' },
        scanRate: 1000,
      });
      expect(watcher.getActiveDevices().has('dev-1')).toBe(true);
    });

    it('device.disabled should be equivalent to device.deleted', async () => {
      // enable first
      await eventBus.fire('device.enabled', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1' },
        scanRate: 1000,
      });
      expect(watcher.getActiveDevices().has('dev-1')).toBe(true);

      // then disable
      await eventBus.fire('device.disabled', { deviceId: 'dev-1' });
      expect(watcher.getActiveDevices().has('dev-1')).toBe(false);
    });
  });

  describe('ensureConnection', () => {
    it('Should call isolationFactory.getExecutor and establish the connection', async () => {
      watcher.onModuleInit();
      await watcher.ensureConnection('dev-x', 'modbus_tcp', { host: '1.2.3.4' });
      expect(executor.connect).toHaveBeenCalledWith({
        id: 'dev-x',
        name: 'dev-x',
        protocol: 'modbus_tcp',
        connection: { host: '1.2.3.4' },
      });
      expect(watcher.getActiveDevices().has('dev-x')).toBe(true);
    });

    it('Should skip and log a warning when isolationFactory is empty', async () => {
      const w = new DeviceConfigWatcher(
        eventBus as unknown as EventBusService,
        undefined,
        undefined,
        undefined,
      );
      await w.ensureConnection('dev-x', 'modbus_tcp', {});
      expect(w.getActiveDevices().has('dev-x')).toBe(false);
    });
  });

  describe('disconnectDevice', () => {
    it('Should call executor.disconnect and clean up the active list', async () => {
      watcher.onModuleInit();
      await watcher.ensureConnection('dev-x', 'modbus_tcp', { host: '1.2.3.4' });
      expect(watcher.getActiveDevices().has('dev-x')).toBe(true);

      const result = await watcher.disconnectDevice('dev-x');
      expect(result).toBe(true);
      expect(executor.disconnect).toHaveBeenCalled();
      expect(watcher.getActiveDevices().has('dev-x')).toBe(false);
    });

    it('Disconnecting an unknown device should return false', async () => {
      await expect(watcher.disconnectDevice('unknown')).resolves.toBe(false);
    });

    it('Errors thrown by disconnect should be swallowed but still return true', async () => {
      watcher.onModuleInit();
      await watcher.ensureConnection('dev-x', 'modbus_tcp', {});
      executor.disconnect.mockRejectedValueOnce(new Error('fail'));
      await expect(watcher.disconnectDevice('dev-x')).resolves.toBe(true);
      expect(watcher.getActiveDevices().has('dev-x')).toBe(false);
    });
  });

  describe('getActiveDevices', () => {
    it('Should return a copy of the active devices', async () => {
      watcher.onModuleInit();
      await watcher.ensureConnection('dev-1', 'modbus_tcp', {});
      await watcher.ensureConnection('dev-2', 'modbus_tcp', {});

      const active = watcher.getActiveDevices();
      expect(active.size).toBe(2);
      expect(active.has('dev-1')).toBe(true);
      expect(active.has('dev-2')).toBe(true);

      // Modifying the returned Map should not affect internal state
      active.delete('dev-1');
      expect(watcher.getActiveDevices().has('dev-1')).toBe(true);
    });
  });

  // ==========================================================================
  // #6 Event persistence: business-effect tracking
  // ==========================================================================
  describe('Business effect tracking (EventLogService integration)', () => {
    let eventLogService: jest.Mocked<EventLogService>;

    beforeEach(() => {
      eventLogService = makeMockEventLogService();
      watcher = new DeviceConfigWatcher(
        eventBus as unknown as EventBusService,
        undefined,
        isolationFactory,
        scheduler,
        eventLogService,
      );
    });

    it('onModuleInit should call wrapSubscriber for every event', () => {
      watcher.onModuleInit();
      // All 5 event types should be wrapped via wrapSubscriber
      expect(eventLogService.wrapSubscriber).toHaveBeenCalledTimes(5);
      expect(eventLogService.wrapSubscriber).toHaveBeenCalledWith(
        'device.created',
        'DeviceConfigWatcher',
        expect.any(Function),
      );
      expect(eventLogService.wrapSubscriber).toHaveBeenCalledWith(
        'device.updated',
        'DeviceConfigWatcher',
        expect.any(Function),
      );
      expect(eventLogService.wrapSubscriber).toHaveBeenCalledWith(
        'device.deleted',
        'DeviceConfigWatcher',
        expect.any(Function),
      );
    });

    it('On successful device.created handling, the wrapSubscriber-wrapped handler should be invoked', async () => {
      watcher.onModuleInit();
      await eventBus.fire('device.created', {
        deviceId: 'dev-1',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: { host: '127.0.0.1', port: 502 },
        scanRate: 1000,
      });

      // The wrapped handler returned by wrapSubscriber called the real handler
      expect(executor.connect).toHaveBeenCalled();
      expect(watcher.getActiveDevices().has('dev-1')).toBe(true);
    });

    it('On failed device.created handling, the failure should be recorded and caught (avoiding unhandled rejection)', async () => {
      watcher.onModuleInit();
      executor.connect.mockRejectedValueOnce(new Error('connect fail'));

      // fire simulates EventBus's error-capture behavior
      const errors = await eventBus.fireAndCollectErrors('device.created', {
        deviceId: 'dev-err',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        connection: {},
        scanRate: 1000,
      });

      // The outer catch should capture the error to avoid unhandled rejection
      expect(errors).toHaveLength(0);
      // wrapSubscriber should have recorded the failed business effect
      expect(eventLogService.recordSubscriberFailure).toHaveBeenCalledWith(
        'log-id-mock',
        'DeviceConfigWatcher',
        'connect fail',
      );
      // Device is not in the active list (because ensureConnection failed)
      expect(watcher.getActiveDevices().has('dev-err')).toBe(false);
    });
  });
});
