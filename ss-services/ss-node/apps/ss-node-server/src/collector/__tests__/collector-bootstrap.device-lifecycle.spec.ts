// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DeviceCollectorBootstrap } from '../collector-bootstrap.service';

const PROJECT = 'ce-shi-gong-cheng';
const DEVICE_ID = '00cae63a-417f-4c92-8807-b8d963d6c8b0';

function makeMocks() {
  const eventBus = { on: jest.fn(), emit: jest.fn() };
  const deviceLoadingService = {
    trackSingleDevice: jest.fn(),
    loadAllDevices: jest
      .fn()
      .mockResolvedValue({ totalDevices: 0, loadedByProtocol: {}, skippedDevices: 0 }),
    compensateActivePlugins: jest.fn().mockResolvedValue([]),
  };
  const taskRegistrationService = {
    hasDeviceTasks: jest.fn().mockReturnValue(false),
    registerTasksForDevice: jest.fn().mockResolvedValue(undefined),
    reloadDeviceTasks: jest.fn().mockResolvedValue(undefined),
    stopDeviceTasks: jest.fn().mockReturnValue(2),
    stopProjectTasks: jest.fn(),
    getRegisteredDeviceIds: jest.fn().mockReturnValue(new Set<string>()),
    getTaskCount: jest.fn().mockReturnValue(5),
  };
  const devicePersistenceService = {
    markDeviceDirty: jest.fn(),
    startPeriodicPersistence: jest.fn(),
    stopPeriodicPersistence: jest.fn(),
  };
  const pluginEventAdapter = {
    subscribeToPluginEvents: jest.fn(),
    listenForPluginsReady: jest.fn(),
    setAvailableProjects: jest.fn(),
  };
  const deviceStateManager = {
    unregisterDevice: jest.fn(),
    getAllStates: jest.fn().mockReturnValue(new Map()),
    getAllStats: jest.fn().mockReturnValue({}),
  };
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const projectDbService = {
    getSystemDb: jest.fn().mockResolvedValue({
      getRepository: jest.fn().mockReturnValue({ forTest: true }),
    }),
  };

  const bootstrap = new DeviceCollectorBootstrap(
    deviceLoadingService as any,
    taskRegistrationService as any,
    devicePersistenceService as any,
    pluginEventAdapter as any,
    deviceStateManager as any,
    configService as any,
    projectDbService as any,
    eventBus as any,
    undefined,
  );

  return {
    bootstrap,
    eventBus,
    deviceLoadingService,
    taskRegistrationService,
    devicePersistenceService,
    pluginEventAdapter,
    deviceStateManager,
    configService,
    projectDbService,
  };
}

function getHandler(eventBus: { on: jest.Mock }, event: string): (...args: any[]) => Promise<void> {
  const calls = eventBus.on.mock.calls.filter(([name]: [string]) => name === event);
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

describe('DeviceCollectorBootstrap - runtime device lifecycle', () => {
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    mocks = makeMocks();
    (mocks.bootstrap as any).subscribeToDeviceLifecycleEvents();
    (mocks.bootstrap as any).availableProjects = [PROJECT];
    (mocks.bootstrap as any).isProjectEnabled = jest.fn().mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers collection tasks for a device created in an enabled project', async () => {
    const device = { id: DEVICE_ID, deviceName: 'Probe Collect', projectId: PROJECT };
    mocks.deviceLoadingService.trackSingleDevice.mockResolvedValue({ device, protocol: 'virtual' });

    await getHandler(mocks.eventBus, 'device.created')({
      deviceId: DEVICE_ID,
      projectId: PROJECT,
      protocol: 'virtual',
    });

    expect(mocks.deviceLoadingService.trackSingleDevice).toHaveBeenCalledWith(PROJECT, DEVICE_ID);
    expect(mocks.taskRegistrationService.registerTasksForDevice).toHaveBeenCalledWith(
      device,
      'virtual',
      expect.anything(),
      PROJECT,
    );
    expect(mocks.taskRegistrationService.reloadDeviceTasks).not.toHaveBeenCalled();
    expect(mocks.devicePersistenceService.markDeviceDirty).toHaveBeenCalledWith(DEVICE_ID);
  });

  it('rebuilds tasks instead of appending when the device is already scheduled', async () => {
    const device = { id: DEVICE_ID, deviceName: 'Probe Collect', projectId: PROJECT };
    mocks.deviceLoadingService.trackSingleDevice.mockResolvedValue({ device, protocol: 'virtual' });
    mocks.taskRegistrationService.hasDeviceTasks.mockReturnValue(true);

    await getHandler(mocks.eventBus, 'device.created')({
      deviceId: DEVICE_ID,
      projectId: PROJECT,
      protocol: 'virtual',
    });

    expect(mocks.taskRegistrationService.reloadDeviceTasks).toHaveBeenCalledWith(
      DEVICE_ID,
      PROJECT,
      'virtual',
      device,
      expect.anything(),
    );
    expect(mocks.taskRegistrationService.registerTasksForDevice).not.toHaveBeenCalled();
  });

  it('skips task registration when the project is not enabled for collection', async () => {
    (mocks.bootstrap as any).isProjectEnabled = jest.fn().mockReturnValue(false);

    await getHandler(mocks.eventBus, 'device.created')({
      deviceId: DEVICE_ID,
      projectId: PROJECT,
      protocol: 'virtual',
    });

    expect(mocks.deviceLoadingService.trackSingleDevice).not.toHaveBeenCalled();
    expect(mocks.taskRegistrationService.registerTasksForDevice).not.toHaveBeenCalled();
  });

  it('skips task registration when the device cannot be scheduled (plugin inactive)', async () => {
    mocks.deviceLoadingService.trackSingleDevice.mockResolvedValue({
      skippedReason: 'plugin "virtual" status is "inactive" (expected "active")',
    });

    await getHandler(mocks.eventBus, 'device.created')({
      deviceId: DEVICE_ID,
      projectId: PROJECT,
      protocol: 'virtual',
    });

    expect(mocks.taskRegistrationService.registerTasksForDevice).not.toHaveBeenCalled();
    expect(mocks.devicePersistenceService.markDeviceDirty).not.toHaveBeenCalled();
  });

  it('registers a project enabled after startup into availableProjects', async () => {
    (mocks.bootstrap as any).availableProjects = [];
    const device = { id: DEVICE_ID, deviceName: 'Probe Collect', projectId: PROJECT };
    mocks.deviceLoadingService.trackSingleDevice.mockResolvedValue({ device, protocol: 'virtual' });

    await getHandler(mocks.eventBus, 'device.created')({
      deviceId: DEVICE_ID,
      projectId: PROJECT,
      protocol: 'virtual',
    });

    expect((mocks.bootstrap as any).availableProjects).toContain(PROJECT);
    expect(mocks.pluginEventAdapter.setAvailableProjects).toHaveBeenCalledWith([PROJECT]);
  });

  it('stops tasks and unregisters state when a device is deleted', async () => {
    await getHandler(mocks.eventBus, 'device.deleted')({
      deviceId: DEVICE_ID,
      projectId: PROJECT,
      protocol: 'virtual',
    });

    expect(mocks.taskRegistrationService.stopDeviceTasks).toHaveBeenCalledWith(DEVICE_ID);
    expect(mocks.deviceStateManager.unregisterDevice).toHaveBeenCalledWith(DEVICE_ID);
  });

  it('isProjectEnabled reflects projectinfo.json enabled flag', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-projects-'));
    const enabledDir = path.join(root, 'enabled-project');
    const disabledDir = path.join(root, 'disabled-project');
    fs.mkdirSync(enabledDir);
    fs.mkdirSync(disabledDir);
    fs.writeFileSync(path.join(enabledDir, 'projectinfo.json'), JSON.stringify({ enabled: true }));
    fs.writeFileSync(path.join(disabledDir, 'projectinfo.json'), JSON.stringify({ enabled: false }));

    mocks.configService.get.mockReturnValue(root);
    // Drop the instance-level stub installed by beforeEach so the real implementation runs
    delete (mocks.bootstrap as any).isProjectEnabled;
    const isProjectEnabled = (mocks.bootstrap as any).isProjectEnabled.bind(mocks.bootstrap);

    expect(isProjectEnabled('enabled-project')).toBe(true);
    expect(isProjectEnabled('disabled-project')).toBe(false);
    expect(isProjectEnabled('missing-project')).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
