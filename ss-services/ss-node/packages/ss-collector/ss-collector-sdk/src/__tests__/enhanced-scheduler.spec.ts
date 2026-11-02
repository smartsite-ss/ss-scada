// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  EnhancedScheduler,
  TaskPriority,
  AcquisitionTask,
} from '../pipeline/scheduler/enhanced-scheduler';
import { EventBusService } from '@ss-node/ss-core';
import { Logger } from '@nestjs/common';

// ── Mock EventBusService ──────────────────────────────────────────
function makeMockEventBus(): jest.Mocked<EventBusService> {
  return {
    emitDeviceStatusChanged: jest.fn(),
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    emitConfigChanged: jest.fn(),
  } as unknown as jest.Mocked<EventBusService>;
}

function makeTask(overrides: Partial<AcquisitionTask> = {}): AcquisitionTask {
  return {
    id: 'task-001',
    deviceId: 'device-001',
    tagId: 'tag-001',
    tagConfig: { projectId: 'project-001' },
    deviceClient: { protocol: 'virtual', connection: {} },
    priority: TaskPriority.NORMAL,
    interval: 1000,
    retryCount: 0,
    maxRetries: 3,
    enabled: true,
    lastExecution: new Date(),
    ...overrides,
  };
}

describe('EnhancedScheduler', () => {
  let scheduler: EnhancedScheduler;
  let mockEventBus: jest.Mocked<EventBusService>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    mockEventBus = makeMockEventBus();
    scheduler = new EnhancedScheduler({}, mockEventBus);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('adaptive throttling (handleCommSuccess)', () => {
    /**
     * Verify adaptive throttling: min(scanRate, 30s)
     * High-frequency tasks are throttled by scanRate; low-frequency tasks are throttled by the 30s cap.
     */
    it('High-frequency tasks (100ms) should be throttled by scanRate, unaffected by the 30s cap', async () => {
      const task = makeTask({ interval: 100 });
      scheduler.registerTask(task);

      // Simulate handleCommSuccess (by accessing the internal method)
      const handleCommSuccess = (scheduler as any).handleCommSuccess.bind(scheduler);

      // First emission
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(1);

      // Should not emit after 50ms (within the 100ms throttle window)
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 50);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(1);

      // Should emit after 150ms (past the 100ms throttle window)
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 150);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(2);
    });

    it('Low-frequency tasks (60s) should be throttled at the 30s cap, not 60s', async () => {
      const task = makeTask({ interval: 60000 });
      scheduler.registerTask(task);

      const handleCommSuccess = (scheduler as any).handleCommSuccess.bind(scheduler);

      // First emission
      const baseTime = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(baseTime);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(1);

      // Should not emit after 20s (within the 30s cap)
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 20000);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(1);

      // Should emit after 35s (past the 30s cap, even though below the 60s scanRate)
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 35000);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(2);
    });

    it('Mid-frequency tasks (30s) should be throttled at exactly 30s', () => {
      const task = makeTask({ interval: 30000 });
      scheduler.registerTask(task);

      const handleCommSuccess = (scheduler as any).handleCommSuccess.bind(scheduler);

      const baseTime = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(baseTime);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(1);

      // Should not emit after 29s
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 29000);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(1);

      // Should emit after 31s
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 31000);
      handleCommSuccess('device-001', task);
      expect(mockEventBus.emitDeviceStatusChanged).toHaveBeenCalledTimes(2);
    });
  });

  describe('lastOnlineEmitAt cleanup (unregisterTask)', () => {
    it('Should clean up lastOnlineEmitAt records when the last task is unregistered', () => {
      const task = makeTask({ id: 'task-A', deviceId: 'device-A' });
      scheduler.registerTask(task);

      // Trigger an online event and write lastOnlineEmitAt
      const handleCommSuccess = (scheduler as any).handleCommSuccess.bind(scheduler);
      handleCommSuccess('device-A', task);

      const lastOnlineEmitAt = (scheduler as any).lastOnlineEmitAt as Map<string, number>;
      expect(lastOnlineEmitAt.has('device-A')).toBe(true);

      // After deregistering the task, the state should be cleaned up
      scheduler.unregisterTask('task-A');
      expect(lastOnlineEmitAt.has('device-A')).toBe(false);
    });

    it('Should not clean up lastOnlineEmitAt records when the device has other tasks', () => {
      const taskA = makeTask({ id: 'task-A', deviceId: 'device-A', tagId: 'tag-A' });
      const taskB = makeTask({ id: 'task-B', deviceId: 'device-A', tagId: 'tag-B' });
      scheduler.registerTask(taskA);
      scheduler.registerTask(taskB);

      const handleCommSuccess = (scheduler as any).handleCommSuccess.bind(scheduler);
      handleCommSuccess('device-A', taskA);

      const lastOnlineEmitAt = (scheduler as any).lastOnlineEmitAt as Map<string, number>;

      // Deregister task-A, but device-A still has task-B, so it should not be cleaned up
      scheduler.unregisterTask('task-A');
      expect(lastOnlineEmitAt.has('device-A')).toBe(true);
    });
  });

  describe('updateTaskInterval', () => {
    it('Should update the execution interval of all tasks of the specified device', () => {
      const task1 = makeTask({ id: 'task-1', deviceId: 'device-X', interval: 1000 });
      const task2 = makeTask({ id: 'task-2', deviceId: 'device-X', interval: 1000 });
      const task3 = makeTask({ id: 'task-3', deviceId: 'device-Y', interval: 1000 });
      scheduler.registerTask(task1);
      scheduler.registerTask(task2);
      scheduler.registerTask(task3);

      const updated = scheduler.updateTaskInterval('device-X', 5000);
      expect(updated).toBe(2);

      const tasks = scheduler.getTaskStatus();
      expect(tasks.get('task-1')?.interval).toBe(5000);
      expect(tasks.get('task-2')?.interval).toBe(5000);
      expect(tasks.get('task-3')?.interval).toBe(1000);
    });

    it('Invalid intervals should be ignored', () => {
      const task = makeTask({ id: 'task-1', deviceId: 'device-X', interval: 1000 });
      scheduler.registerTask(task);

      const updated = scheduler.updateTaskInterval('device-X', 0);
      expect(updated).toBe(0);
      expect(scheduler.getTaskStatus().get('task-1')?.interval).toBe(1000);
    });
  });
});
