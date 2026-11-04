// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Cyclic activate/deactivate tests: verify no state drift, no event/listener
// accumulation, no executor/timer leaks across many start/stop cycles.

import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { PluginRegistry } from '../plugin-registry';
import { PluginManagerService } from '../plugin-manager.service';
import { IsolationFactory } from '../isolation/isolation-factory';
import { ChildProcessExecutor } from '../isolation/child-process-executor';
import { WorkerThreadExecutor } from '../isolation/worker-thread-executor';
import { DEFAULT_ISOLATION_CONFIG } from '../isolation/isolation.types';
import { CollectorPluginMeta, PluginCategory, IsolationMode } from '../plugin.types';

// ============================================================
// Helpers
// ============================================================

function makeMeta(overrides: Partial<CollectorPluginMeta> = {}): CollectorPluginMeta {
  return {
    protocol: 'virtual',
    displayName: 'Virtual',
    version: '1.0.0',
    description: 'Virtual collector plugin',
    category: PluginCategory.INDUSTRIAL_BUS,
    transport: 'tcp',
    connectionSchema: { type: 'object', properties: {} },
    defaultConnection: {},
    supportedDataTypes: ['int16'],
    enabledByDefault: true,
    isolationMode: IsolationMode.IN_PROCESS,
    ...overrides,
  };
}

function makeAdapter() {
  return {
    connect: jest.fn().mockResolvedValue({ kind: 'virtual-client' }),
    disconnect: jest.fn().mockResolvedValue(undefined),
    readTag: jest.fn(),
    writeTag: jest.fn(),
    onActivate: jest.fn().mockResolvedValue(undefined),
    onDeactivate: jest.fn().mockResolvedValue(undefined),
  };
}

function makeEventBusMock() {
  return { on: jest.fn(), emit: jest.fn() };
}

// ============================================================
// Test suite
// ============================================================

describe('Plugin lifecycle cycles (start/stop repeatedly)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------
  // Registry-level: 100 full activate/deactivate cycles
  // -------------------------------------------------------------
  it('Registry: 100 cycles keep a consistent state with no accumulation', async () => {
    const eventBus = makeEventBusMock();
    const configService = { setActivated: jest.fn() };
    const registry = new PluginRegistry(eventBus as any, configService as any);
    const adapter = makeAdapter();

    registry.register(makeMeta(), adapter as any);

    const cycles = 100;
    for (let i = 0; i < cycles; i++) {
      await registry.activate('virtual');
      expect(registry.getPlugin('virtual')!.status).toBe('active');
      await registry.deactivate('virtual');
      expect(registry.getPlugin('virtual')!.status).toBe('inactive');
    }

    // No map growth (no per-cycle plugin entry leak)
    expect(registry.count).toBe(1);
    // Persistence toggled every cycle, final state deactivated
    expect(configService.setActivated).toHaveBeenCalledTimes(cycles * 2);
    expect(configService.setActivated).toHaveBeenLastCalledWith('virtual', false);
    // Lifecycle hooks ran once per cycle (no accumulation)
    expect(adapter.onActivate).toHaveBeenCalledTimes(cycles);
    expect(adapter.onDeactivate).toHaveBeenCalledTimes(cycles);
    // Events: 1 registered + 2 per cycle, no listener registration by the registry
    expect(eventBus.emit).toHaveBeenCalledTimes(1 + cycles * 2);
    expect(eventBus.on).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------
  // Manager-level: 50 cycles balance executor prepare/destroy calls
  // -------------------------------------------------------------
  it('Manager: 50 cycles call prepare and destroyExecutor equally (no net growth)', async () => {
    const eventBus = makeEventBusMock();
    const registry = new PluginRegistry(eventBus as any, { setActivated: jest.fn() } as any);
    registry.register(makeMeta(), makeAdapter() as any);

    const isolationFactory = {
      prepare: jest.fn().mockResolvedValue(undefined),
      destroyExecutor: jest.fn().mockResolvedValue(undefined),
      getExecutor: jest.fn(),
    };
    const manager = new PluginManagerService(
      registry,
      { discoverPlugins: jest.fn() } as any,
      { hotReload: jest.fn(), checkUpdate: jest.fn(), rollback: jest.fn() } as any,
      { getMonitorData: jest.fn(), clearLogs: jest.fn(), writeLog: jest.fn() } as any,
      { getConfig: jest.fn(), saveConfig: jest.fn() } as any,
      isolationFactory as any,
      undefined,
    );

    const cycles = 50;
    for (let i = 0; i < cycles; i++) {
      await manager.activate('virtual');
      await manager.deactivate('virtual');
    }

    expect(isolationFactory.prepare).toHaveBeenCalledTimes(cycles);
    expect(isolationFactory.destroyExecutor).toHaveBeenCalledTimes(cycles);
    expect(registry.getPlugin('virtual')!.status).toBe('inactive');
  });

  // -------------------------------------------------------------
  // Factory-level: in_process executor create/destroy cycles release connections
  // -------------------------------------------------------------
  it('IsolationFactory: 50 create/destroy cycles leave no executors or connections behind', async () => {
    const adapter = makeAdapter();
    const registry = {
      getPlugin: jest.fn().mockReturnValue({ meta: makeMeta() }),
      getAdapter: jest.fn().mockReturnValue(adapter),
    };
    const factory = new IsolationFactory(registry as any, undefined, undefined);

    const cycles = 50;
    for (let i = 0; i < cycles; i++) {
      const executor = factory.getExecutor('virtual');
      await executor.connect({ id: 'dev-1' } as any);
      await factory.destroyExecutor('virtual');
      // Executor map is emptied every cycle (no accumulation)
      expect((factory as any).executors.size).toBe(0);
    }

    // Each destroy released the pooled connection via adapter.disconnect
    expect(adapter.connect).toHaveBeenCalledTimes(cycles);
    expect(adapter.disconnect).toHaveBeenCalledTimes(cycles);
  });

  // -------------------------------------------------------------
  // ChildProcessExecutor: destroy suppresses crash events and auto-restart
  // -------------------------------------------------------------
  it('ChildProcessExecutor: destroy prevents orphan respawn and crash events (leak regression)', async () => {
    const eventBus = makeEventBusMock();
    const executor = new ChildProcessExecutor(eventBus as any);
    (executor as any).config = { ...DEFAULT_ISOLATION_CONFIG };

    const fakeChild = new EventEmitter() as any;
    fakeChild.send = jest.fn();
    fakeChild.kill = jest.fn();
    fakeChild.killed = false;
    fakeChild.pid = 4242;
    (executor as any).child = fakeChild;
    // Mirror the exit wiring done inside startChild()
    fakeChild.on('exit', (code: number | null, signal: string | null) =>
      (executor as any).handleCrash(code, signal),
    );

    // One in-flight request creates a pending timer
    const request = (executor as any).sendRequest('health', {});
    request.catch(() => {});
    expect((executor as any).pending.size).toBe(1);

    await executor.destroy();

    // Pending timers cleared so they can never fire after teardown
    expect((executor as any).pending.size).toBe(0);

    // Simulate the child dying from our SIGTERM: must NOT be treated as a crash
    fakeChild.emit('exit', 1, 'SIGTERM');
    expect(eventBus.emit).not.toHaveBeenCalledWith(
      'plugin.isolation.crash',
      expect.anything(),
    );

    // No auto-restart timer may be scheduled after destroy (orphan process leak)
    const startChildSpy = jest.spyOn(executor as any, 'startChild');
    jest.advanceTimersByTime(15000);
    expect(startChildSpy).not.toHaveBeenCalled();

    // The SIGKILL fallback fires on the captured child reference (5s)
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');

    // Destroy is idempotent
    await expect(executor.destroy()).resolves.not.toThrow();
  });

  it('ChildProcessExecutor: a genuine crash before destroy still schedules auto-restart, cleared by destroy', async () => {
    const eventBus = makeEventBusMock();
    const executor = new ChildProcessExecutor(eventBus as any);
    (executor as any).config = { ...DEFAULT_ISOLATION_CONFIG };

    const fakeChild = new EventEmitter() as any;
    fakeChild.send = jest.fn();
    fakeChild.kill = jest.fn();
    fakeChild.killed = false;
    fakeChild.pid = 4243;
    (executor as any).child = fakeChild;
    // Mirror the exit wiring done inside startChild()
    fakeChild.on('exit', (code: number | null, signal: string | null) =>
      (executor as any).handleCrash(code, signal),
    );

    // Genuine crash while running: auto-restart scheduled + crash event emitted
    fakeChild.emit('exit', 1, null);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'plugin.isolation.crash',
      expect.objectContaining({ protocol: '' }),
    );
    expect((executor as any).restartTimer).toBeDefined();

    // Destroy cancels the pending restart (no orphan respawn after teardown)
    await executor.destroy();
    expect((executor as any).restartTimer).toBeUndefined();
    jest.advanceTimersByTime(15000);
    expect((executor as any).child).toBeNull();
  });

  // -------------------------------------------------------------
  // WorkerThreadExecutor: destroy suppresses crash events and auto-restart
  // -------------------------------------------------------------
  it('WorkerThreadExecutor: destroy prevents orphan respawn and crash events (leak regression)', async () => {
    const eventBus = makeEventBusMock();
    const executor = new WorkerThreadExecutor(eventBus as any);
    (executor as any).config = { ...DEFAULT_ISOLATION_CONFIG };

    const fakeWorker = new EventEmitter() as any;
    fakeWorker.postMessage = jest.fn();
    fakeWorker.terminate = jest.fn().mockResolvedValue(0);
    fakeWorker.threadId = 7;
    (executor as any).worker = fakeWorker;
    // Mirror the exit wiring done inside startWorker()
    fakeWorker.on('exit', (code: number) => {
      if (code !== 0) (executor as any).handleCrash(new Error(`Worker exited with code ${code}`));
    });

    const request = (executor as any).sendRequest('health', {});
    request.catch(() => {});
    expect((executor as any).pending.size).toBe(1);

    await executor.destroy();

    expect((executor as any).pending.size).toBe(0);
    expect(fakeWorker.terminate).toHaveBeenCalled();

    // Simulate the worker exiting from terminate(): must NOT be treated as a crash
    fakeWorker.emit('exit', 1);
    expect(eventBus.emit).not.toHaveBeenCalledWith(
      'plugin.isolation.crash',
      expect.anything(),
    );

    const startWorkerSpy = jest.spyOn(executor as any, 'startWorker');
    jest.advanceTimersByTime(15000);
    expect(startWorkerSpy).not.toHaveBeenCalled();

    await expect(executor.destroy()).resolves.not.toThrow();
  });
});
