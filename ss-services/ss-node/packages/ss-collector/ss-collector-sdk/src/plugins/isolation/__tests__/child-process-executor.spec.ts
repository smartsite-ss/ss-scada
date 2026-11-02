// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ChildProcessExecutor } from '../child-process-executor';
import { IsolationMode } from '../../plugin.types';
import { IDeviceContext, ITagContext } from '../../../types';

// ============================================================
// Real EventEmitter-style Mock ChildProcess
// ============================================================
const createMockChild = () => {
  const handlers: Record<string, Function[]> = {};
  return {
    handlers,
    on: jest.fn((event: string, handler: Function) => {
      (handlers[event] ??= []).push(handler);
    }),
    off: jest.fn((event: string, handler: Function) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
    }),
    emit: (event: string, ...args: any[]) => {
      for (const h of handlers[event] || []) h(...args);
    },
    send: jest.fn(),
    kill: jest.fn(),
    pid: 67890,
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    killed: false,
    connected: true,
  };
};

let mockChildInstance: ReturnType<typeof createMockChild>;

jest.mock('child_process', () => ({
  fork: jest.fn().mockImplementation(() => {
    mockChildInstance = createMockChild();
    return mockChildInstance;
  }),
}));

// ============================================================
// Mock EventBusService
// ============================================================
const createMockEventBus = () => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
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
});

// ============================================================
// Test data
// ============================================================
const mockDevice: IDeviceContext = {
  id: 'dev-001',
  name: 'Test Device',
  type: 'opcua',
  config: { endpoint: 'opc.tcp://127.0.0.1:4840' },
  scanRate: 1000,
  groupId: 'group-001',
  projectId: 'proj-001',
  enabled: true,
  status: 'online',
  lastOnlineAt: new Date(),
  lastDataAt: new Date(),
  createdBy: 'user-001',
  updatedBy: 'user-001',
  createdAt: new Date(),
  updatedAt: new Date(),
} as any;

const mockTag: ITagContext = {
  id: 'tag-001',
  name: 'Test Tag',
  address: 'ns=1;s=Temperature',
  dataType: 'float',
  deviceId: 'dev-001',
  deviceType: 'opcua',
  projectId: 'proj-001',
  scanRate: 1000,
} as any;

// ============================================================
// Helper functions
// ============================================================
const getChild = () => mockChildInstance;

const simulateReady = () => {
  getChild().emit('message', { type: 'ready', protocol: 'opcua' });
};

const simulateResponse = (requestId: string, payload: any) => {
  getChild().emit('message', { type: 'result', requestId, payload });
};

const simulateError = (requestId: string, message: string) => {
  getChild().emit('message', { type: 'error', requestId, error: { message } });
};

const simulateExit = (code: number | null, signal: string | null) => {
  getChild().emit('exit', code, signal);
};

// ============================================================
// Test suite
// ============================================================
describe('ChildProcessExecutor', () => {
  let executor: ChildProcessExecutor;
  const { fork } = require('child_process');

  beforeEach(() => {
    mockChildInstance = null as any;
    executor = new ChildProcessExecutor(createMockEventBus() as any);
  });

  afterEach(async () => {
    try {
      await executor.destroy();
    } catch {}
  });

  describe('init', () => {
    it('Should fork a child process and wait for ready', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;
      expect(fork).toHaveBeenCalled();
      expect(executor.name).toBe('ChildProcess');
    });

    it('Child process startup timeout should throw an error', async () => {
      const initPromise = executor.init('opcua', null, { startupTimeoutMs: 100 });
      jest.advanceTimersByTime(200);
      await expect(initPromise).rejects.toThrow('startup timeout');
    });

    it('Should set up stdout/stderr listeners', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      expect(getChild().stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(getChild().stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
    });
  });

  describe('connect', () => {
    it('Should send the connect message and return a ShardRef', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      const connectPromise = executor.connect(mockDevice);
      const connectCall = getChild().send.mock.calls.find(
        (call: any[]) => call[0].type === 'connect',
      )?.[0];
      simulateResponse(connectCall.requestId, { connectionId: 'conn-opc-001', protocol: 'opcua' });

      const shard = await connectPromise;
      expect(shard.connectionId).toBe('conn-opc-001');
      expect(shard.protocol).toBe('opcua');
    });
  });

  describe('readTag', () => {
    it('Should send the read_tag message and return the result', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      const shard = { connectionId: 'conn-opc-001', protocol: 'opcua' };
      const readPromise = executor.readTag(shard, mockTag);
      const readCall = getChild().send.mock.calls.find(
        (call: any[]) => call[0].type === 'read_tag',
      )?.[0];
      simulateResponse(readCall.requestId, 25.5);

      expect(await readPromise).toBe(25.5);
    });

    it('Child process errors should propagate to the caller', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      const shard = { connectionId: 'conn-opc-001', protocol: 'opcua' };
      const readPromise = executor.readTag(shard, mockTag);
      const readCall = getChild().send.mock.calls.find(
        (call: any[]) => call[0].type === 'read_tag',
      )?.[0];
      simulateError(readCall.requestId, 'OPC UA read error');

      await expect(readPromise).rejects.toThrow('OPC UA read error');
    });

    it('Request timeout should throw an error', async () => {
      const initPromise = executor.init('opcua', null, { requestTimeoutMs: 100 });
      simulateReady();
      await initPromise;

      const readPromise = executor.readTag({ connectionId: 'c1', protocol: 'opcua' }, mockTag);
      jest.advanceTimersByTime(200);
      await expect(readPromise).rejects.toThrow('Child process request timeout');
    });
  });

  describe('writeTag', () => {
    it('Should send the write_tag message', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      const shard = { connectionId: 'conn-opc-001', protocol: 'opcua' };
      const writePromise = executor.writeTag(shard, mockTag, 100);
      const writeCall = getChild().send.mock.calls.find(
        (call: any[]) => call[0].type === 'write_tag',
      )?.[0];
      simulateResponse(writeCall.requestId, undefined);

      await expect(writePromise).resolves.toBeUndefined();
    });
  });

  describe('disconnect', () => {
    it('Should send the disconnect message', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      const shard = { connectionId: 'conn-opc-001', protocol: 'opcua' };
      const disconnectPromise = executor.disconnect(shard);
      const dc = getChild().send.mock.calls.find(
        (call: any[]) => call[0].type === 'disconnect',
      )?.[0];
      simulateResponse(dc.requestId, undefined);

      await expect(disconnectPromise).resolves.toBeUndefined();
    });
  });

  describe('getHealth', () => {
    it('Should return the health status (including PID)', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      const healthPromise = executor.getHealth();
      const healthCall = getChild().send.mock.calls.find(
        (call: any[]) => call[0].type === 'health',
      )?.[0];
      simulateResponse(healthCall.requestId, {
        mode: IsolationMode.CHILD_PROCESS,
        status: 'healthy',
        uptime: 5000,
        requestCount: 100,
        errorCount: 2,
        avgLatencyMs: 12.3,
      });

      const health = await healthPromise;
      expect(health.status).toBe('healthy');
      expect(health.pid).toBe(67890);
      expect(health.restartCount).toBe(0);
    });

    it('Returns degraded when the child process is unresponsive', async () => {
      const initPromise = executor.init('opcua', null, { requestTimeoutMs: 100 });
      simulateReady();
      await initPromise;

      const healthPromise = executor.getHealth();
      jest.advanceTimersByTime(200);
      const health = await healthPromise;
      expect(health.status).toBe('degraded');
    });
  });

  describe('crash recovery', () => {
    it('Child process crash should trigger the plugin.isolation.crash event', async () => {
      const eventBus = createMockEventBus();
      executor = new ChildProcessExecutor(eventBus as any);

      const initPromise = executor.init('opcua', null, { autoRestart: true, maxRestarts: 5 });
      simulateReady();
      await initPromise;

      simulateExit(1, null);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'plugin.isolation.crash',
        expect.objectContaining({
          protocol: 'opcua',
          mode: IsolationMode.CHILD_PROCESS,
        }),
      );
    });

    it('After a crash, all pending requests should be rejected', async () => {
      const initPromise = executor.init('opcua', null, { autoRestart: true, maxRestarts: 5 });
      simulateReady();
      await initPromise;

      const shard = { connectionId: 'conn-opc-001', protocol: 'opcua' };
      const readPromise = executor.readTag(shard, mockTag);

      simulateExit(1, null);

      await expect(readPromise).rejects.toThrow('Child process crashed');
    });

    it('Killing the child process with the SIGTERM signal also triggers the crash event', async () => {
      const eventBus = createMockEventBus();
      executor = new ChildProcessExecutor(eventBus as any);

      const initPromise = executor.init('opcua', null, { autoRestart: true, maxRestarts: 5 });
      simulateReady();
      await initPromise;

      simulateExit(null, 'SIGTERM');

      expect(eventBus.emit).toHaveBeenCalledWith('plugin.isolation.crash', expect.any(Object));
    });
  });

  describe('destroy', () => {
    it('Should send the shutdown message and kill the child process', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      await executor.destroy();

      expect(getChild().send).toHaveBeenCalledWith({ type: 'shutdown' });
      expect(getChild().kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('After destroy, getHealth should return dead', async () => {
      const initPromise = executor.init('opcua', null, {});
      simulateReady();
      await initPromise;

      await executor.destroy();

      const health = await executor.getHealth();
      expect(health.status).toBe('dead');
    });
  });
});
