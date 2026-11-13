// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * collector-worker.js — collection isolation Worker script
 *
 * Compatible with both worker_threads and child_process modes.
 * Uses worker_threads' parentPort in Worker threads,
 * and process.send / process.on('message') in child processes.
 *
 * Does not depend on NestJS; only depends on the collector adapter's own package.
 */

'use strict';

const { parentPort, workerData } = (() => {
  try { return require('worker_threads'); } catch { return {}; }
})();

const { protocol, adapterModule } = workerData || {
  protocol: process.env.COLLECTOR_PROTOCOL,
  adapterModule: process.env.COLLECTOR_ADAPTER_MODULE,
};

// Set process title to distinguish collector child processes of different protocols in the system process list
if (protocol && process.title !== undefined) {
  process.title = `ss-collector-${protocol}`;
  // Examples: ss-collector-modbus_tcp, ss-collector-opcua, ss-collector-mqtt
}

let adapter = null;
const connections = new Map();

/**
 * Dynamically load the adapter module
 *
 * Scan module exports for classes implementing the IProtocolAdapter interface (readTag method)
 * or BaseCollectorService subclasses (doReadTag method), and try to instantiate them.
 *
 * Instantiation strategy:
 * 1. Prefer no-arg instantiation (for collectors without dependencies, e.g. ModbusRTUService)
 * 2. On failure, look up no-arg instantiable classes in the same module as dependency candidates,
 *    and try injecting them in order (for collectors with dependencies, e.g. VirtualProtocolAdapter needs SimulatorFactory)
 */
async function loadAdapter() {
  let mod;
  try {
    mod = require(adapterModule);
  } catch (e) {
    // Fallback: resolve from cwd/node_modules (child process cwd inherits from parent, containing workspace dependencies)
    const path = require('path');
    const modPath = path.resolve(process.cwd(), 'node_modules', adapterModule);
    try {
      mod = require(modPath);
    } catch (e2) {
      throw new Error(
        `Cannot find module '${adapterModule}' (tried direct require and ${modPath}): ${e2.message}`,
      );
    }
  }

  // 1. Find the adapter class (prefer readTag, compatible with doReadTag)
  let AdapterClass = null;
  let adapterKey = null;
  for (const key of Object.keys(mod)) {
    const cls = mod[key];
    if (!cls || !cls.prototype) continue;
    if (typeof cls.prototype.readTag === 'function') {
      AdapterClass = cls;
      adapterKey = key;
      break;
    }
  }
  // Compatible with BaseCollectorService subclasses
  if (!AdapterClass) {
    for (const key of Object.keys(mod)) {
      const cls = mod[key];
      if (!cls || !cls.prototype) continue;
      if (typeof cls.prototype.doReadTag === 'function') {
        AdapterClass = cls;
        adapterKey = key;
        break;
      }
    }
  }
  if (!AdapterClass) {
    throw new Error(`No adapter class (readTag/doReadTag) found in ${adapterModule}`);
  }

  // 2. Try no-arg instantiation
  try {
    adapter = new AdapterClass();
    log('info', `Adapter loaded: ${adapterModule} (${adapterKey})`);
    return;
  } catch (e) {
    log('info', `Direct instantiation failed, resolving deps: ${e.message}`);
  }

  // 3. Collect no-arg instantiable classes in the same module as dependency candidates
  const depCandidates = [];
  for (const key of Object.keys(mod)) {
    if (mod[key] === AdapterClass) continue;
    const cls = mod[key];
    if (typeof cls !== 'function') continue;
    try {
      const instance = new cls();
      depCandidates.push(instance);
      log('info', `Dependency candidate: ${key}`);
    } catch {
      // Skip classes that cannot be instantiated without arguments
    }
  }

  // 4. Try instantiation with dependencies (increasing argument count one by one)
  for (let n = 1; n <= depCandidates.length; n++) {
    const args = depCandidates.slice(0, n);
    try {
      adapter = new AdapterClass(...args);
      log('info', `Adapter loaded: ${adapterModule} (${adapterKey}) with ${n} dep(s)`);
      return;
    } catch {
      // Keep trying more dependencies
    }
  }

  throw new Error(
    `Failed to instantiate ${adapterKey} from ${adapterModule}: cannot resolve constructor deps (tried ${depCandidates.length} candidates)`,
  );
}

const handlers = {
  async connect({ device }) {
    const client = await adapter.connect(device);
    const connectionId = device.id || `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    connections.set(connectionId, client);
    return { connectionId, protocol };
  },

  async read_tag({ connectionId, tag }) {
    const client = connections.get(connectionId);
    if (!client) throw new Error(`Connection not found: ${connectionId}`);
    return adapter.readTag(client, tag);
  },

  async write_tag({ connectionId, tag, value }) {
    const client = connections.get(connectionId);
    if (!client) throw new Error(`Connection not found: ${connectionId}`);
    return adapter.writeTag(client, tag, value);
  },

  async disconnect({ connectionId }) {
    const client = connections.get(connectionId);
    if (client) {
      await adapter.disconnect(client);
      connections.delete(connectionId);
    }
    return { ok: true };
  },

  async validate({ config }) {
    if (typeof adapter.validateChannelConfig === 'function') {
      return adapter.validateChannelConfig(config);
    }
    return { valid: true };
  },

  health() {
    return {
      status: adapter ? 'healthy' : 'starting',
      connectionCount: connections.size,
      mode: workerData ? 'worker_thread' : 'child_process',
      pid: typeof process !== 'undefined' && process.pid ? process.pid : undefined,
      uptime: typeof process !== 'undefined' && process.uptime ? Math.floor(process.uptime() * 1000) : 0,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
      restartCount: 0,
    };
  },

  async shutdown() {
    const closePromises = [];
    for (const [, client] of connections) {
      closePromises.push(adapter.disconnect(client).catch(() => {}));
    }
    await Promise.all(closePromises);
    connections.clear();
    process.exit(0);
  },
};

function send(msg) {
  if (parentPort) {
    parentPort.postMessage(msg);
  } else if (typeof process !== 'undefined' && typeof process.send === 'function') {
    process.send(msg);
  } else {
    // Fallback: no IPC channel available
  }
}

function log(level, message) {
  send({ type: 'log', level, message: `${message}` });
}

/**
 * Message send/receive — compatible with worker_threads' parentPort.on and child_process' process.on
 */
function setupReceiver() {
  const receiver = parentPort || process;
  receiver.on('message', async (msg) => {
    if (!msg || !msg.type) return;

    try {
      const handler = handlers[msg.type];
      if (!handler) {
        log('warn', `Unknown message type: ${msg.type}`);
        return;
      }
      const result = await handler(msg);
      if (msg.requestId) {
        send({ type: 'result', requestId: msg.requestId, payload: result });
      }
    } catch (err) {
      if (msg.requestId) {
        send({ type: 'error', requestId: msg.requestId, error: { message: err.message } });
      } else {
        log('error', `Handler [${msg.type}] error: ${err.message}`);
      }
    }
  });
}

// Uncaught exception fallback (critical protection in child-process mode)
if (typeof process !== 'undefined') {
  process.on('uncaughtException', (err) => {
    console.error(`[${protocol}] Uncaught exception:`, err);
    send({ type: 'fatal', error: { message: err.message, stack: err.stack } });
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    console.error(`[${protocol}] Unhandled rejection:`, reason);
  });
}

// === Startup ===
(async () => {
  try {
    await loadAdapter();
    setupReceiver();
    send({ type: 'ready', protocol });
  } catch (err) {
    console.error(`[${protocol}] Failed to start worker:`, err);
    send({ type: 'fatal', error: { message: err.message, stack: err.stack } });
    process.exit(1);
  }
})();
