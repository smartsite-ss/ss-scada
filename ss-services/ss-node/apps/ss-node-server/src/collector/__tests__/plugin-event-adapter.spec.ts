// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import { PluginEventAdapter } from '../plugin-event-adapter';
import { PluginLifecycleEvent } from '@ss-node/ss-collector-sdk';

// ============================================================
// Helpers
// ============================================================

function makeAdapterMocks() {
  const eventBus = { on: jest.fn(), emit: jest.fn() };
  const deviceLoadingService = { reloadDevicesForProtocol: jest.fn().mockResolvedValue([]) };
  const taskRegistrationService = {
    stopProjectTasks: jest.fn(),
    getRegisteredDeviceIds: jest.fn().mockReturnValue(new Set<string>()),
    registerTasksForDevice: jest.fn().mockResolvedValue(undefined),
    getTaskCount: jest.fn().mockReturnValue(0),
  };
  const devicePersistenceService = { markDeviceDirty: jest.fn() };
  const deviceStateManager = {
    getDeviceIdsByProtocol: jest.fn().mockReturnValue([] as string[]),
    setOffline: jest.fn(),
    setError: jest.fn(),
    setDiagnostics: jest.fn(),
    getState: jest.fn().mockReturnValue(undefined),
  };
  const projectDbService = { getSystemDb: jest.fn() };

  const adapter = new PluginEventAdapter(
    eventBus as any,
    deviceLoadingService as any,
    taskRegistrationService as any,
    devicePersistenceService as any,
    deviceStateManager as any,
    projectDbService as any,
    undefined,
  );

  return {
    adapter,
    eventBus,
    deviceLoadingService,
    taskRegistrationService,
    devicePersistenceService,
    deviceStateManager,
    projectDbService,
  };
}

function getHandler(eventBus: { on: jest.Mock }, event: string): (...args: any[]) => any {
  const calls = eventBus.on.mock.calls.filter(([name]) => name === event);
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

// Flush pending microtasks (fake timers do not affect Promise)
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

function makeLifecycleEvent(protocol: string): PluginLifecycleEvent {
  return {
    protocol,
    displayName: protocol,
    version: '1.0.0',
    category: 'industrial_bus',
    status: 'active',
    timestamp: Date.now(),
  };
}

// ============================================================
// Test suite
// ============================================================

describe('PluginEventAdapter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('plugin.deactivated', () => {
    it('Should stop scheduled tasks and mark all protocol devices offline', () => {
      const { adapter, eventBus, taskRegistrationService, deviceStateManager, devicePersistenceService } =
        makeAdapterMocks();
      deviceStateManager.getDeviceIdsByProtocol.mockReturnValue(['dev-1', 'dev-2']);

      adapter.subscribeToPluginEvents();
      getHandler(eventBus, 'plugin.deactivated')(makeLifecycleEvent('MQTT'));

      expect(deviceStateManager.getDeviceIdsByProtocol).toHaveBeenCalledWith('mqtt');
      expect(taskRegistrationService.stopProjectTasks).toHaveBeenCalledWith(['dev-1', 'dev-2']);
      expect(deviceStateManager.setOffline).toHaveBeenCalledTimes(2);
      expect(deviceStateManager.setOffline).toHaveBeenCalledWith('dev-1', 'Plugin deactivated');
      expect(devicePersistenceService.markDeviceDirty).toHaveBeenCalledWith('dev-2');
    });

    it('Should not call stopProjectTasks when the protocol has no devices', () => {
      const { adapter, eventBus, taskRegistrationService, deviceStateManager } =
        makeAdapterMocks();
      deviceStateManager.getDeviceIdsByProtocol.mockReturnValue([]);

      adapter.subscribeToPluginEvents();
      getHandler(eventBus, 'plugin.deactivated')(makeLifecycleEvent('mqtt'));

      expect(taskRegistrationService.stopProjectTasks).not.toHaveBeenCalled();
      expect(deviceStateManager.setOffline).not.toHaveBeenCalled();
    });
  });

  describe('plugin.activated', () => {
    it('Should reload devices for the protocol and register collection tasks', async () => {
      const {
        adapter,
        eventBus,
        deviceLoadingService,
        taskRegistrationService,
        deviceStateManager,
        projectDbService,
      } = makeAdapterMocks();
      const device = { id: 'dev-1', deviceCode: 'dev-001' };
      deviceLoadingService.reloadDevicesForProtocol.mockResolvedValue([device]);
      deviceStateManager.getState.mockReturnValue({ projectId: 'proj-1' });
      const tagRepo = { marker: 'tag-repo' };
      projectDbService.getSystemDb.mockResolvedValue({
        getRepository: jest.fn().mockReturnValue(tagRepo),
      });

      adapter.subscribeToPluginEvents();
      getHandler(eventBus, 'plugin.activated')(makeLifecycleEvent('MQTT'));
      await flushAsync();

      expect(deviceLoadingService.reloadDevicesForProtocol).toHaveBeenCalledWith(
        'mqtt',
        [],
        new Set(),
      );
      expect(taskRegistrationService.registerTasksForDevice).toHaveBeenCalledWith(
        device,
        'mqtt',
        tagRepo,
        'proj-1',
      );
    });

    it('Should pass already-registered device ids as the skip list', async () => {
      const { adapter, eventBus, taskRegistrationService, deviceLoadingService } =
        makeAdapterMocks();
      taskRegistrationService.getRegisteredDeviceIds.mockReturnValue(new Set(['dev-1']));

      adapter.subscribeToPluginEvents();
      getHandler(eventBus, 'plugin.activated')(makeLifecycleEvent('mqtt'));
      await flushAsync();

      expect(deviceLoadingService.reloadDevicesForProtocol).toHaveBeenCalledWith(
        'mqtt',
        [],
        new Set(['dev-1']),
      );
    });

    it('Should swallow internal errors without crashing', async () => {
      const { adapter, eventBus, deviceLoadingService } = makeAdapterMocks();
      deviceLoadingService.reloadDevicesForProtocol.mockRejectedValue(new Error('db down'));

      adapter.subscribeToPluginEvents();
      expect(() =>
        getHandler(eventBus, 'plugin.activated')(makeLifecycleEvent('mqtt')),
      ).not.toThrow();
      await flushAsync();
    });
  });

  describe('plugin.isolation.crash', () => {
    it('Should mark all protocol devices as error with crash diagnostics', () => {
      const { adapter, eventBus, deviceStateManager, devicePersistenceService } =
        makeAdapterMocks();
      deviceStateManager.getDeviceIdsByProtocol.mockReturnValue(['dev-1']);

      adapter.subscribeToPluginEvents();
      getHandler(eventBus, 'plugin.isolation.crash')({
        protocol: 'mqtt',
        error: 'child process exited',
        mode: 'child_process',
      });

      expect(deviceStateManager.setError).toHaveBeenCalledWith(
        'dev-1',
        expect.stringContaining('child process exited'),
      );
      expect(deviceStateManager.setDiagnostics).toHaveBeenCalledWith('dev-1', {
        circuitState: 'open',
        lastErrorAt: expect.any(Number),
      });
      expect(devicePersistenceService.markDeviceDirty).toHaveBeenCalledWith('dev-1');
    });
  });

  describe('device:statusChanged', () => {
    it('Should mark the device dirty for persistence', () => {
      const { adapter, eventBus, devicePersistenceService } = makeAdapterMocks();

      adapter.subscribeToPluginEvents();
      getHandler(eventBus, 'device:statusChanged')({
        deviceId: 'dev-1',
        previousStatus: 'online',
      });

      expect(devicePersistenceService.markDeviceDirty).toHaveBeenCalledWith('dev-1');
    });
  });
});
