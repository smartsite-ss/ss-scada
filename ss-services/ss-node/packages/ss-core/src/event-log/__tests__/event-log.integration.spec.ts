// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EventLogService } from '../event-log.service';
import { EventLog } from '../entities/event-log.entity';

/**
 * Integration test: EventLog + EventBus end-to-end flow
 *
 * Verifies the full chain of #6 event persistence:
 * 1. EventBusService.emit() fires emit hooks
 * 2. EventLogService.handleEmit() writes to evt_event_log (status='emitted')
 * 3. Wrapped handlers (wrapSubscriber) execute:
 *    a. recordSubscriberStart -> adds a processing record to subscribers
 *    b. handler runs business logic and returns the business effect
 *    c. recordSubscriberSuccess -> updates to processed + result
 *    d. recalculateStatus -> updates overall status and successRatio
 *
 * Test strategy:
 * - Uses a real SQLite in-memory database (direct DataSource connection, bypassing NestJS TypeOrmModule ModuleRef dependency issues)
 * - Uses a real EventBusService (with EventEmitter2)
 * - Uses a real EventLogService (with emit-hook registration)
 */
describe('EventLog + EventBus integration tests', () => {
  let dataSource: DataSource;
  let eventBus: EventBusService;
  let eventLogService: EventLogService;
  let eventEmitter: EventEmitter2;

  beforeAll(async () => {
    // The global setup.ts enables fake timers, which would prevent setTimeout from ever firing,
    // hanging flushAsync and SQLite busy_timeout. Restore real timers here.
    jest.useRealTimers();

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    // 1. Create a real SQLite in-memory database
    //    Note: :memory: + a multi-connection pool gives each connection its own separate DB,
    //    so use extra to limit it to a single connection, ensuring reads/writes hit the same in-memory DB.
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [EventLog],
      synchronize: true,
      logging: false,
      extra: { connectionLimit: 1 },
    });
    await dataSource.initialize();

    // 2. Create a real EventEmitter2 (wildcard mode, same as production)
    eventEmitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 100,
      verboseMemoryLeak: true,
    });

    // 3. Create a real EventBusService
    eventBus = new EventBusService(eventEmitter);
    (eventBus as any).onModuleInit();

    // 4. Create a real EventLogService (injecting the real repository and eventBus)
    const eventLogRepo = dataSource.getRepository(EventLog);
    eventLogService = new EventLogService(eventLogRepo, eventBus);

    // 5. Trigger onModuleInit (registers emit hooks)
    (eventLogService as any).onModuleInit();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  // Helper: wait for all async operations to complete (both emit hooks and subscriber tracing are async)
  const flushAsync = (ms = 200): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Wrap wrapSubscriber to simulate production error-capture behavior
   *
   * In production code (DeviceConfigWatcher / DeviceCollectorBootstrap), the wrap helper adds
   * try/catch around wrapSubscriber to avoid unhandled rejections from EventBus.emit (synchronous)
   * not awaiting async handlers. Tests must simulate this too, otherwise Jest treats the
   * unhandled rejection as a test failure.
   */
  const wrapForTest = <T extends any[]>(
    eventType: string,
    subscriberName: string,
    handler: (...args: T) => Promise<Record<string, any> | void>,
  ): ((...args: T) => Promise<void>) => {
    const traced = eventLogService.wrapSubscriber(eventType, subscriberName, handler);
    return async (...args: T) => {
      try {
        await traced(...args);
      } catch {
        // Simulate EventBus.emit's error capture: wrapSubscriber already recorded the failure; here we only prevent unhandled rejection
      }
    };
  };

  it('Full flow: emit device.created → record emission → handler processes → record business effects', async () => {
    // 1. Register a wrapped subscriber that returns a business effect
    const handler = jest.fn().mockResolvedValue({
      connectionId: 'conn-integration-1',
      tagsLoaded: 5,
      tasksRegistered: 5,
      deviceOnline: true,
    });

    eventBus.on(
      'device.created',
      wrapForTest('device.created', 'DeviceConfigWatcher', handler),
    );

    // 2. Emit the event (use emitAsync to await all async subscribers, avoiding unhandled rejection)
    await eventBus.emitAsync('device.created', {
      deviceId: 'dev-int-1',
      projectId: 'proj-int-1',
      protocol: 'modbus_tcp',
      connection: { host: '127.0.0.1', port: 502 },
      scanRate: 1000,
      userId: 'tester',
      timestamp: Date.now(),
    });

    // 3. Wait for async writes to complete (emit hook + wrapSubscriber records)
    await flushAsync(300);

    // 4. Verify the handler was called
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-int-1' }),
    );

    // 5. Query the event log and verify the record
    const allLogs = await eventLogService.findByFilter({
      eventType: 'device.created',
      projectId: 'proj-int-1',
      page: 1,
      pageSize: 10,
    });

    expect(allLogs.total).toBeGreaterThanOrEqual(1);
    const log = allLogs.items[0];

    // Verify base fields
    expect(log.eventType).toBe('device.created');
    expect(log.projectId).toBe('proj-int-1');
    expect(log.emittedBy).toBe('tester');
    expect(log.source).toBe('rest_api');
    expect(log.status).toBe('processed');

    // Verify subscriber tracing + business effect
    expect(log.subscribers).toHaveLength(1);
    expect(log.subscribers[0].name).toBe('DeviceConfigWatcher');
    expect(log.subscribers[0].status).toBe('processed');
    expect(log.subscribers[0].result).toEqual({
      connectionId: 'conn-integration-1',
      tagsLoaded: 5,
      tasksRegistered: 5,
      deviceOnline: true,
    });
    expect(log.subscribers[0].duration).toBeGreaterThanOrEqual(0);

    // Verify the success ratio
    expect(log.successRatio).toBe('1/1');

    // There should be no failed records
    const failedLogs = await eventLogService.findFailed({ projectId: 'proj-int-1' });
    expect(failedLogs).toHaveLength(0);
  });

  it('Failure flow: handler throws → records failed status + errorMessage', async () => {
    const handler = jest
      .fn()
      .mockRejectedValue(new Error('Connection timeout 192.168.1.99:502'));

    // Use the new event type device.updated (avoiding conflict with the device.created test subscriber above)
    eventBus.on(
      'device.updated',
      wrapForTest('device.updated', 'DeviceConfigWatcher', handler),
    );

    // Modify the device IP to simulate a connection-failure scenario
    await eventBus.emitAsync('device.updated', {
      deviceId: 'dev-int-2',
      projectId: 'proj-int-3',
      protocol: 'modbus_tcp',
      changedFields: ['connection'],
      changes: {
        'connection.host': { old: '192.168.1.10', new: '192.168.1.99' },
      },
      userId: 'tester',
      timestamp: Date.now(),
    });

    // Wait for async writes to complete
    await flushAsync(300);

    const logs = await eventLogService.findByFilter({
      eventType: 'device.updated',
      projectId: 'proj-int-3',
      page: 1,
      pageSize: 10,
    });

    expect(logs.total).toBeGreaterThanOrEqual(1);
    const log = logs.items[0];

    // Verify the status is failed
    expect(log.status).toBe('failed');
    expect(log.successRatio).toBe('0/1');
    expect(log.errorMessage).toContain('Connection timeout');
    expect(log.errorMessage).toContain('DeviceConfigWatcher');

    // Verify the subscriber record
    expect(log.subscribers).toHaveLength(1);
    expect(log.subscribers[0].status).toBe('failed');
    expect(log.subscribers[0].error).toContain('Connection timeout');

    // Verify failed records are queryable
    const failedLogs = await eventLogService.findFailed({ projectId: 'proj-int-3' });
    expect(failedLogs.length).toBeGreaterThanOrEqual(1);
    expect(
      failedLogs.some(
        (l) =>
          l.eventType === 'device.updated' &&
          l.subscribers?.some((s) => s.status === 'failed'),
      ),
    ).toBe(true);
  });

  it('Partial failure: multiple subscribers, some succeed some fail → status=partial', async () => {
    // Use an independent project ID to avoid interference with subscribers from earlier tests
    const projectId = 'proj-int-partial';

    // Subscriber 1: success
    const successHandler = jest.fn().mockResolvedValue({
      taskId: 'task-1',
      scanRate: 1000,
    });

    // Subscriber 2: failure
    const failHandler = jest
      .fn()
      .mockRejectedValue(new Error('WebSocket room not found'));

    // Use device.deleted (no subscriber registered for this event in earlier tests)
    eventBus.on(
      'device.deleted',
      wrapForTest('device.deleted', 'EnhancedScheduler', successHandler),
    );
    eventBus.on(
      'device.deleted',
      wrapForTest('device.deleted', 'DataPushBridge', failHandler),
    );

    await eventBus.emitAsync('device.deleted', {
      deviceId: 'dev-int-3',
      projectId,
      protocol: 'opcua',
      userId: 'tester',
      timestamp: Date.now(),
    });

    await flushAsync(400);

    const logs = await eventLogService.findByFilter({
      eventType: 'device.deleted',
      projectId,
      page: 1,
      pageSize: 10,
    });

    expect(logs.total).toBeGreaterThanOrEqual(1);
    const log = logs.items[0];

    // There should be 2 subscribers
    expect(log.subscribers).toHaveLength(2);
    const subscriberNames = log.subscribers.map((s) => s.name);
    expect(subscriberNames).toContain('EnhancedScheduler');
    expect(subscriberNames).toContain('DataPushBridge');

    // Verify success and failure counts
    const successCount = log.subscribers.filter((s) => s.status === 'processed').length;
    const failedCount = log.subscribers.filter((s) => s.status === 'failed').length;
    expect(successCount).toBe(1);
    expect(failedCount).toBe(1);

    // Overall status should be partial
    expect(log.status).toBe('partial');
    expect(log.successRatio).toBe('1/2');

    // errorMessage should contain the DataPushBridge error
    expect(log.errorMessage).toContain('DataPushBridge');
    expect(log.errorMessage).toContain('WebSocket room not found');

    // Business-effect verification
    const schedulerSub = log.subscribers.find((s) => s.name === 'EnhancedScheduler');
    expect(schedulerSub?.result).toEqual({ taskId: 'task-1', scanRate: 1000 });
  });

  it('Events outside the whitelist are not persisted: data_point_changed should not be written to evt_event_log', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    eventBus.on(
      'data_point_changed',
      wrapForTest('data_point_changed', 'NoOpSubscriber', handler),
    );

    await eventBus.emitAsync('data_point_changed', {
      tagId: 'tag-1',
      deviceId: 'dev-1',
      projectId: 'proj-int-1',
      value: 42.5,
      timestamp: Date.now(),
    });

    await flushAsync(200);

    // The handler should still run
    expect(handler).toHaveBeenCalledTimes(1);

    // But the event log should have no data_point_changed record
    const logs = await eventLogService.findByFilter({
      eventType: 'data_point_changed',
      page: 1,
      pageSize: 10,
    });
    expect(logs.total).toBe(0);
  });

  it('Events with no subscribers: stay in emitted state', async () => {
    // project.beforeDelete is in the whitelist but has no subscribers
    await eventBus.emitAsync('project.beforeDelete', {
      projectId: 'proj-orphan',
      userId: 'tester',
      timestamp: Date.now(),
    });

    await flushAsync(200);

    const logs = await eventLogService.findByFilter({
      eventType: 'project.beforeDelete',
      projectId: 'proj-orphan',
      page: 1,
      pageSize: 10,
    });

    expect(logs.total).toBeGreaterThanOrEqual(1);
    const log = logs.items[0];

    // The emission should be recorded, but with no subscribers
    expect(log.emittedBy).toBe('tester');
    expect(log.subscribers).toHaveLength(0);
    // Status stays emitted (no subscriber processed it)
    expect(log.status).toBe('emitted');
  });
});
