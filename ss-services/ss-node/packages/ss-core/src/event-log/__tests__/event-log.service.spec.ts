// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventLogService } from '../event-log.service';
import { EventLog, EventLogStatus } from '../entities/event-log.entity';
import { EventBusService } from '../../event-bus/event-bus.service';

/**
 * EventLogService unit tests
 *
 * Covers core capabilities:
 * 1. Emission recording (recordEmission)
 * 2. Subscriber tracing (recordSubscriberStart/Success/Failure)
 * 3. Status recalculation (recalculateStatus)
 * 4. Query APIs (findByFilter / findFailed)
 * 5. Whitelist filtering (shouldPersist)
 * 6. emit-hook mechanism (handleEmit)
 */
describe('EventLogService', () => {
  let service: EventLogService;
  let eventBus: jest.Mocked<EventBusService>;
  let repo: jest.Mocked<Repository<EventLog>>;

  beforeEach(async () => {
    // Create mock repositories
    const mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    // Create a mock EventBusService
    const mockEventBus = {
      registerEmitHook: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventLogService,
        { provide: getRepositoryToken(EventLog), useValue: mockRepo },
        { provide: EventBusService, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get<EventLogService>(EventLogService);
    eventBus = module.get(EventBusService) as jest.Mocked<EventBusService>;
    repo = module.get(getRepositoryToken(EventLog)) as jest.Mocked<Repository<EventLog>>;
  });

  describe('shouldPersist', () => {
    it('Should return true for config-change events', () => {
      expect(service.shouldPersist('device.created')).toBe(true);
      expect(service.shouldPersist('device.updated')).toBe(true);
      expect(service.shouldPersist('project:enabled')).toBe(true);
      expect(service.shouldPersist('alarm.triggered')).toBe(true);
      expect(service.shouldPersist('plugin.activated')).toBe(true);
    });

    it('Should return false for high-frequency data events', () => {
      expect(service.shouldPersist('data_point_changed')).toBe(false);
      expect(service.shouldPersist('device_status_changed')).toBe(false);
      expect(service.shouldPersist('user.joined')).toBe(false);
      expect(service.shouldPersist('plugin.discovered')).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    it('Should register the emit hook to EventBusService', () => {
      service.onModuleInit();
      expect(eventBus.registerEmitHook).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordEmission', () => {
    it('Should write event logs correctly and return logId', async () => {
      const fakeLog = { id: 'log-uuid-123' } as EventLog;
      repo.create.mockReturnValue(fakeLog);
      repo.save.mockResolvedValue(fakeLog as any);

      const payload = {
        deviceId: 'dev-123',
        projectId: 'proj-1',
        protocol: 'modbus_tcp',
        userId: 'user-001',
        timestamp: Date.now(),
      };

      const logId = await service.recordEmission('device.created', payload);

      expect(logId).toBe('log-uuid-123');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'device.created',
          projectId: 'proj-1',
          emittedBy: 'user-001',
          source: 'rest_api',
          status: 'emitted',
        }),
      );
    });

    it('When the payload has no userId, source should be system', async () => {
      const fakeLog = { id: 'log-1' } as EventLog;
      repo.create.mockReturnValue(fakeLog);
      repo.save.mockResolvedValue(fakeLog as any);

      await service.recordEmission('plugin.activated', {
        protocol: 'modbus_tcp',
        sourceInstance: 'PluginRegistry',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'system',
          emittedBy: 'PluginRegistry',
        }),
      );
    });

    it('Should return null and not throw when the Repository write fails', async () => {
      repo.save.mockRejectedValue(new Error('DB 错误') as any);

      const logId = await service.recordEmission('device.created', { projectId: 'p1' });

      expect(logId).toBeNull();
    });

    it('timestamp supports number / string / Date formats', async () => {
      const fakeLog = { id: 'log-1' } as EventLog;
      repo.create.mockReturnValue(fakeLog);
      repo.save.mockResolvedValue(fakeLog as any);

      // number
      await service.recordEmission('device.created', { timestamp: 1700000000000 });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventTimestamp: new Date(1700000000000),
        }),
      );

      // string
      await service.recordEmission('device.created', {
        timestamp: '2026-08-04T10:00:00.000Z',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventTimestamp: new Date('2026-08-04T10:00:00.000Z'),
        }),
      );

      // Date
      const dateObj = new Date();
      await service.recordEmission('device.created', { timestamp: dateObj });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventTimestamp: dateObj,
        }),
      );
    });

    it('When the payload exceeds 64KB, the tags array should be truncated', async () => {
      const fakeLog = { id: 'log-1' } as EventLog;
      repo.create.mockReturnValue(fakeLog);
      repo.save.mockResolvedValue(fakeLog as any);

      // Build a payload over 64KB
      const largeTags = Array.from({ length: 10000 }, (_, i) => ({
        tagId: `tag-${i}`,
        name: `tag-name-${i}-padding-padding-padding-padding`,
      }));

      await service.recordEmission('device.created', {
        deviceId: 'dev-1',
        tags: largeTags,
      });

      const createCall = repo.create.mock.calls[0][0];
      expect(createCall.payload._tagsTruncated).toBe(true);
      expect(createCall.payload.tags.length).toBeLessThanOrEqual(100);
    });
  });

  describe('recordSubscriberStart / Success / Failure', () => {
    const logId = 'log-123';
    const subscriberName = 'DeviceConfigWatcher';

    beforeEach(() => {
      // Simulate an existing event log
      const existingLog: Partial<EventLog> = {
        id: logId,
        eventType: 'device.created',
        subscribers: [],
        status: 'emitted',
      };
      repo.findOne.mockResolvedValue(existingLog as EventLog);
      repo.save.mockResolvedValue(existingLog as EventLog);
    });

    it('recordSubscriberStart should add a subscriber record with processing status', async () => {
      await service.recordSubscriberStart(logId, subscriberName);

      const savedLog = repo.save.mock.calls[0][0] as EventLog;
      expect(savedLog.subscribers).toHaveLength(1);
      expect(savedLog.subscribers[0]).toEqual(
        expect.objectContaining({
          name: subscriberName,
          status: 'processing',
        }),
      );
      expect(savedLog.status).toBe('processing');
    });

    it('recordSubscriberSuccess should update to processed status and trigger status recomputation', async () => {
      // Simulate an existing processing record
      const logWithSubscriber: Partial<EventLog> = {
        id: logId,
        eventType: 'device.created',
        subscribers: [{ name: subscriberName, status: 'processing' }],
        status: 'processing',
      };
      repo.findOne.mockResolvedValue(logWithSubscriber as EventLog);

      await service.recordSubscriberSuccess(logId, subscriberName, 23, {
        connectionId: 'conn-1',
        tagsLoaded: 12,
      });

      // The second save is updateSubscriberRecord, the third save is recalculateStatus
      const savedLog = repo.save.mock.calls[0][0] as EventLog;
      expect(savedLog.subscribers[0]).toEqual(
        expect.objectContaining({
          status: 'processed',
          duration: 23,
          result: { connectionId: 'conn-1', tagsLoaded: 12 },
        }),
      );
    });

    it('recordSubscriberFailure should update to failed status and record the error', async () => {
      const logWithSubscriber: Partial<EventLog> = {
        id: logId,
        eventType: 'device.created',
        subscribers: [{ name: subscriberName, status: 'processing' }],
        status: 'processing',
      };
      repo.findOne.mockResolvedValue(logWithSubscriber as EventLog);

      await service.recordSubscriberFailure(
        logId,
        subscriberName,
        'Connection timeout',
        { oldConnectionClosed: true },
      );

      const savedLog = repo.save.mock.calls[0][0] as EventLog;
      expect(savedLog.subscribers[0]).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'Connection timeout',
          result: { oldConnectionClosed: true },
        }),
      );
    });
  });

  describe('recalculateStatus', () => {
    const logId = 'log-123';

    /**
      * Helper: create a stateful mock so findOne returns the object from the most recent save
      *
      * This way the chain updateSubscriberRecord -> save -> recalculateStatus -> findOne
      * gets the latest state including the new subscriber 'C', so the recalculation logic is verified.
      */
    const setupStatefulMock = (initial: Partial<EventLog>): void => {
      let current: EventLog = initial as EventLog;
      repo.findOne.mockImplementation(async () => current);
      repo.save.mockImplementation(async (log: EventLog) => {
        current = log;
        return log;
      });
    };

    it('status=processed when all subscribers succeed', async () => {
      setupStatefulMock({
        id: logId,
        subscribers: [
          { name: 'A', status: 'processed' },
          { name: 'B', status: 'processed' },
        ],
      });

      // Trigger recalculateStatus via recordSubscriberSuccess('C', ...)
      // 'C' is not in subscribers, so it gets added as processed
      await service.recordSubscriberSuccess(logId, 'C', 10);

      const lastSavedLog = repo.save.mock.calls[repo.save.mock.calls.length - 1][0] as EventLog;
      expect(lastSavedLog.status).toBe('processed');
      expect(lastSavedLog.successRatio).toBe('3/3');
    });

    it('status=partial when some subscribers fail', async () => {
      setupStatefulMock({
        id: logId,
        subscribers: [
          { name: 'A', status: 'processed' },
          { name: 'B', status: 'failed', error: 'timeout' },
        ],
      });

      // Add a new successful subscriber C, triggering recalculateStatus
      // At this point A=processed, B=failed, C=processed -> partial (2/3)
      await service.recordSubscriberSuccess(logId, 'C', 10);

      const lastSavedLog = repo.save.mock.calls[repo.save.mock.calls.length - 1][0] as EventLog;
      expect(lastSavedLog.status).toBe('partial');
      expect(lastSavedLog.successRatio).toBe('2/3');
      expect(lastSavedLog.errorMessage).toContain('B: timeout');
    });

    it('status=failed when all subscribers fail', async () => {
      setupStatefulMock({
        id: logId,
        subscribers: [
          { name: 'A', status: 'failed', error: 'err1' },
          { name: 'B', status: 'failed', error: 'err2' },
        ],
      });

      // Add a new failed subscriber C
      await service.recordSubscriberFailure(logId, 'C', 'err3');

      const lastSavedLog = repo.save.mock.calls[repo.save.mock.calls.length - 1][0] as EventLog;
      expect(lastSavedLog.status).toBe('failed');
      expect(lastSavedLog.errorMessage).toContain('A: err1');
      expect(lastSavedLog.errorMessage).toContain('B: err2');
      expect(lastSavedLog.errorMessage).toContain('C: err3');
    });
  });

  describe('withLogLock (concurrency safety)', () => {
    const logId = 'log-concurrent-1';

    /**
      * Helper: create a stateful mock simulating the DB's read-modify-write behavior
      * - findOne returns the current in-memory log object (by reference)
      * - save updates the current in-memory log object
      *
      * This genuinely exposes the concurrency race:
      * if two updateSubscriberRecord calls run concurrently without a lock,
      * both read subscribers=[], each adds one subscriber and saves,
      * and the later save overwrites the earlier one.
      */
    const setupStatefulMock = (initial: Partial<EventLog>): void => {
      let current: EventLog = initial as EventLog;
      repo.findOne.mockImplementation(async () => current);
      repo.save.mockImplementation(async (log: EventLog) => {
        current = log;
        return log;
      });
    };

    it('Two subscribers concurrently calling recordSubscriberStart should not lose either record', async () => {
      setupStatefulMock({
        id: logId,
        eventType: 'device.deleted',
        subscribers: [],
        status: 'emitted',
      });

      // Call two recordSubscriberStart concurrently
      await Promise.all([
        service.recordSubscriberStart(logId, 'SubscriberA'),
        service.recordSubscriberStart(logId, 'SubscriberB'),
      ]);

      // Re-read the final state
      const finalLog = await repo.findOne({ where: { id: logId } });
      expect(finalLog!.subscribers).toHaveLength(2);
      const names = finalLog!.subscribers.map((s) => s.name);
      expect(names).toContain('SubscriberA');
      expect(names).toContain('SubscriberB');
    });

    it('Three subscribers concurrently calling recordSubscriberSuccess should all be recorded with correct status', async () => {
      setupStatefulMock({
        id: logId,
        eventType: 'device.created',
        subscribers: [],
        status: 'emitted',
      });

      // Three subscribers complete successfully concurrently
      await Promise.all([
        service.recordSubscriberSuccess(logId, 'SubA', 10, { tasksRegistered: 1 }),
        service.recordSubscriberSuccess(logId, 'SubB', 20, { tasksRegistered: 2 }),
        service.recordSubscriberSuccess(logId, 'SubC', 30, { tasksRegistered: 3 }),
      ]);

      const finalLog = await repo.findOne({ where: { id: logId } });
      expect(finalLog!.subscribers).toHaveLength(3);
      expect(finalLog!.status).toBe('processed');
      expect(finalLog!.successRatio).toBe('3/3');
    });

    it('Concurrent mixed success/failure should compute partial status correctly', async () => {
      setupStatefulMock({
        id: logId,
        eventType: 'device.updated',
        subscribers: [],
        status: 'emitted',
      });

      await Promise.all([
        service.recordSubscriberSuccess(logId, 'SuccessSub', 10, { ok: true }),
        service.recordSubscriberFailure(logId, 'FailSub', 'Connection refused'),
      ]);

      const finalLog = await repo.findOne({ where: { id: logId } });
      expect(finalLog!.subscribers).toHaveLength(2);
      expect(finalLog!.status).toBe('partial');
      expect(finalLog!.successRatio).toBe('1/2');
      expect(finalLog!.errorMessage).toContain('FailSub: Connection refused');
    });
  });

  describe('wrapSubscriber', () => {
    it('On success should track automatically and return business effects', async () => {
      const logId = 'log-wrap-1';
      const existingLog: Partial<EventLog> = {
        id: logId,
        subscribers: [],
        status: 'emitted',
      };
      repo.findOne.mockResolvedValue(existingLog as EventLog);
      repo.save.mockResolvedValue(existingLog as EventLog);

      // Simulate findRecentLogId returning via the in-memory index
      // Call recordEmission first to populate the in-memory index
      repo.create.mockReturnValue({ id: logId } as EventLog);
      await service.recordEmission('device.created', { projectId: 'p1', deviceId: 'd1' });

      const handler = jest.fn().mockResolvedValue({ connectionId: 'conn-1' });
      const wrapped = service.wrapSubscriber(
        'device.created',
        'DeviceConfigWatcher',
        handler,
      );

      await wrapped({ projectId: 'p1', deviceId: 'd1' });

      expect(handler).toHaveBeenCalled();
      // recordSubscriberStart and recordSubscriberSuccess should have been called
      expect(repo.save.mock.calls.length).toBeGreaterThanOrEqual(2);

      // The last save should include the business effect
      const lastSavedLog = repo.save.mock.calls[repo.save.mock.calls.length - 1][0] as EventLog;
      const subscriber = lastSavedLog.subscribers?.find((s) => s.name === 'DeviceConfigWatcher');
      expect(subscriber?.result).toEqual({ connectionId: 'conn-1' });
    });

    it('On failure, the error should be logged and rethrown', async () => {
      const logId = 'log-wrap-2';
      const existingLog: Partial<EventLog> = {
        id: logId,
        subscribers: [],
        status: 'emitted',
      };
      repo.findOne.mockResolvedValue(existingLog as EventLog);
      repo.save.mockResolvedValue(existingLog as EventLog);

      repo.create.mockReturnValue({ id: logId } as EventLog);
      await service.recordEmission('device.updated', { projectId: 'p1', deviceId: 'd1' });

      const error = new Error('Connection refused');
      const handler = jest.fn().mockRejectedValue(error);
      const wrapped = service.wrapSubscriber(
        'device.updated',
        'DeviceConfigWatcher',
        handler,
      );

      await expect(wrapped({ projectId: 'p1', deviceId: 'd1' })).rejects.toThrow(
        'Connection refused',
      );

      // recordSubscriberFailure should have been called
      const savedLogs = repo.save.mock.calls.map((call) => call[0] as EventLog);
      const failedRecord = savedLogs.find((log) =>
        log.subscribers?.some((s) => s.status === 'failed'),
      );
      expect(failedRecord).toBeDefined();
    });

    it('When logId is not found, the handler should still run but tracking is not recorded', async () => {
      // Do not call recordEmission, so findRecentLogId returns null
      repo.findOne.mockResolvedValue(null);

      const handler = jest.fn().mockResolvedValue({ ok: true });
      const wrapped = service.wrapSubscriber(
        'device.created',
        'DeviceConfigWatcher',
        handler,
      );

      await wrapped({ projectId: 'unknown', deviceId: 'unknown' });

      // The handler should run
      expect(handler).toHaveBeenCalled();
      // No subscriber records should be written
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('findByFilter', () => {
    it('Should support paginated queries', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'log-1' }], 1]),
      };
      repo.createQueryBuilder.mockReturnValue(queryBuilder as any);

      const result = await service.findByFilter({
        projectId: 'p1',
        page: 1,
        pageSize: 20,
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
    });

    it('Should support filtering by status', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repo.createQueryBuilder.mockReturnValue(queryBuilder as any);

      await service.findByFilter({ status: 'failed' });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'log.status = :status',
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });

  describe('findFailed', () => {
    it('Should query events with failed and partial status', async () => {
      const queryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 'log-1', status: 'failed' }]),
      };
      repo.createQueryBuilder.mockReturnValue(queryBuilder as any);

      const result = await service.findFailed({ projectId: 'p1' });

      expect(result).toHaveLength(1);
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'log.status IN (:...statuses)',
        expect.objectContaining({ statuses: ['failed', 'partial'] }),
      );
    });
  });
});
