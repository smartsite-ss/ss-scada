// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Script execution Web Worker manager
 *
 * Runs scripts in a separate background thread to avoid blocking the main thread and freezing the browser tab.
 * Supports true timeout termination (Worker.terminate).
 */

export interface WorkerInput {
  script: string;
  tagValues: Record<string, any>;
  graphicId: string;
  /** Event simulation data for interaction mode (simulates an event object) */
  event?: Record<string, any>;
}

export interface WorkerOutput {
  success: boolean;
  output?: any;
  error?: string;
  executionTime: number;
  apiCalls: Array<{ method: string; args: any[] }>;
}

/** Inline Worker script code (self-contained, no external dependencies) */
function getWorkerCode(): string {
  return `
// ── 简单的 Mock API（Worker 内自包含） ──
function createMockApi(apiCalls, tagValues, postApiCall) {
  return {
    readTag: function(tagId) {
      apiCalls.push({ method: 'readTag', args: [tagId] });
      // 从 tagValues 中读取模拟数据，支持嵌套路径如 'data.number'
      if (tagValues && tagValues.hasOwnProperty(tagId)) {
        return tagValues[tagId];
      }
      return null;
    },
    writeTag: function(tagId, value) {
      apiCalls.push({ method: 'writeTag', args: [tagId, value] });
    },
    getTagQuality: function(tagId) {
      apiCalls.push({ method: 'getTagQuality', args: [tagId] });
      return 'good';
    },
    setGraphicProps: function(graphicId, props) {
      apiCalls.push({ method: 'setGraphicProps', args: [graphicId, props] });
      postApiCall('setGraphicProps', [graphicId, props]);
    },
    showGraphic: function(graphicId) {
      apiCalls.push({ method: 'showGraphic', args: [graphicId] });
      postApiCall('showGraphic', [graphicId]);
    },
    hideGraphic: function(graphicId) {
      apiCalls.push({ method: 'hideGraphic', args: [graphicId] });
      postApiCall('hideGraphic', [graphicId]);
    },
    moveGraphic: function(graphicId, x, y) {
      apiCalls.push({ method: 'moveGraphic', args: [graphicId, x, y] });
      postApiCall('moveGraphic', [graphicId, x, y]);
    },
    rotateGraphic: function(graphicId, angle) {
      apiCalls.push({ method: 'rotateGraphic', args: [graphicId, angle] });
    },
    triggerAlarm: function(config) {
      apiCalls.push({ method: 'triggerAlarm', args: [config] });
    },
    acknowledgeAlarm: function(alarmId) {
      apiCalls.push({ method: 'acknowledgeAlarm', args: [alarmId] });
    },
    clearAlarm: function(alarmId) {
      apiCalls.push({ method: 'clearAlarm', args: [alarmId] });
    },
    getActiveAlarms: function() {
      apiCalls.push({ method: 'getActiveAlarms', args: [] });
      return [];
    },
    switchPage: function(pageId) {
      apiCalls.push({ method: 'switchPage', args: [pageId] });
    },
    getCurrentPageId: function() {
      apiCalls.push({ method: 'getCurrentPageId', args: [] });
      return 'test-page';
    },
    fetch: function(url, options) {
      apiCalls.push({ method: 'fetch', args: [url, options] });
      return Promise.resolve({ status: 200, data: {} });
    },
    setTimeout: function(cb, delay) {
      apiCalls.push({ method: 'setTimeout', args: [delay] });
      return 0;
    },
    setInterval: function(cb, interval) {
      apiCalls.push({ method: 'setInterval', args: [interval] });
      return 0;
    },
    clearTimeout: function(id) { apiCalls.push({ method: 'clearTimeout', args: [id] }); },
    clearInterval: function(id) { apiCalls.push({ method: 'clearInterval', args: [id] }); },
    sleep: function(ms) {
      apiCalls.push({ method: 'sleep', args: [ms] });
      return new Promise(function(resolve) {
        setTimeout(resolve, ms);
      });
    },
    notify: function(msg, level) {
      apiCalls.push({ method: 'notify', args: [msg, level || 'info'] });
    },
    log: function(level, msg) {
      apiCalls.push({ method: 'log', args: [level, msg] });
    },
    round: function(v, d) {
      apiCalls.push({ method: 'round', args: [v, d || 0] });
      var f = Math.pow(10, d || 0);
      return Math.round(v * f) / f;
    },
    clamp: function(v, min, max) {
      apiCalls.push({ method: 'clamp', args: [v, min, max] });
      return Math.max(min, Math.min(max, v));
    },
    mapRange: function(v, inMin, inMax, outMin, outMax) {
      apiCalls.push({ method: 'mapRange', args: [v, inMin, inMax, outMin, outMax] });
      return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
    },
    colorForValue: function(v, min, max) {
      apiCalls.push({ method: 'colorForValue', args: [v, min || 0, max || 100] });
      var ratio = Math.max(0, Math.min(1, (v - (min || 0)) / ((max || 100) - (min || 0))));
      var r = Math.round(ratio * 255).toString(16);
      var g = Math.round((1 - ratio) * 255).toString(16);
      return '#' + (r.length === 1 ? '0' + r : r) + (g.length === 1 ? '0' + g : g) + '00';
    },
    isAlarm: function(v, high, low) {
      apiCalls.push({ method: 'isAlarm', args: [v, high, low || 0] });
      return v >= high || v <= (low || 0);
    },
  };
}

// ── Worker 入口 ──
self.onmessage = function(e) {
  var data = e.data;
  var startTime = performance.now();
  var apiCalls = [];

  // 实时 API 调用通知：将图元操作实时发送到主线程
  var postApiCall = function(method, args) {
    self.postMessage({ type: 'apiCall', method: method, args: args });
  };

  var api = createMockApi(apiCalls, data.tagValues, postApiCall);
  // 将 API 函数注入到全局作用域，使脚本中可以直接调用 showGraphic() 等函数
  // （无需 api. 前缀），与运行态行为保持一致
  for (var key in api) {
    if (typeof api[key] === 'function') {
      self[key] = api[key];
    }
  }
  // 模拟 event 对象（交互模式），注入到全局作用域
  var mockEvent = data.event || {
    graphicId: 'test-graphic',
    x: 100,
    y: 100,
    type: 'click',
    timestamp: Date.now(),
  };
  self.event = mockEvent;

  var context = {
    graphicId: data.graphicId || 'test-graphic',
    tagValues: data.tagValues || {},
    triggerType: 'manual',
    event: mockEvent,
  };

  var sandboxConsole = {
    log: function() {},
    warn: function() {},
    error: function() {},
  };

  try {
    var fn = new Function('api', 'context', 'console', '"use strict";' + data.script);
    var output = fn(api, context, sandboxConsole);
    // 支持 async/await 脚本：如果返回值是 Promise，等待其完成
    if (output && typeof output.then === 'function') {
      output.then(function(resolved) {
        var executionTime = performance.now() - startTime;
        self.postMessage({
          success: true,
          output: resolved,
          executionTime: executionTime,
          apiCalls: apiCalls,
        });
      }).catch(function(err) {
        var executionTime = performance.now() - startTime;
        self.postMessage({
          success: false,
          error: err.message || String(err),
          executionTime: executionTime,
          apiCalls: apiCalls,
        });
      });
    } else {
      var executionTime = performance.now() - startTime;
      self.postMessage({
        success: true,
        output: output,
        executionTime: executionTime,
        apiCalls: apiCalls,
      });
    }
  } catch (err) {
    var executionTime = performance.now() - startTime;
    self.postMessage({
      success: false,
      error: err.message || String(err),
      executionTime: executionTime,
      apiCalls: apiCalls,
    });
  }
};
`;
}

let _workerCodeBlobUrl: string | null = null;

function getWorkerBlobUrl(): string {
  if (!_workerCodeBlobUrl) {
    const blob = new Blob([getWorkerCode()], { type: 'application/javascript' });
    _workerCodeBlobUrl = URL.createObjectURL(blob);
  }
  return _workerCodeBlobUrl;
}

/**
 * Execute a script in a Web Worker with true timeout termination.
 * After timeout the Worker is terminated, fully releasing the main thread.
 * @param onApiCall Optional callback triggered in real time when the Worker calls a graphic operation API, used to sync page updates
 */
export function executeInWorker(
  input: WorkerInput,
  timeoutMs: number = 5000,
  onApiCall?: (method: string, args: any[]) => void,
): Promise<WorkerOutput> {
  return new Promise<WorkerOutput>((resolve) => {
    let worker: Worker;

    try {
      worker = new Worker(getWorkerBlobUrl());
    } catch (workerErr: any) {
      // Worker creation failed (e.g. CSP restrictions), return an error directly
      resolve({
        success: false,
        error: `无法创建 Worker: ${workerErr.message || String(workerErr)}`,
        executionTime: 0,
        apiCalls: [],
      });
      return;
    }

    const timeoutId = setTimeout(() => {
      worker.terminate();
      resolve({
        success: false,
        error: `脚本执行超时 (${timeoutMs / 1000}s)`,
        executionTime: timeoutMs,
        apiCalls: [],
      });
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      // Real-time API call message: apply to the page immediately
      if (data && data.type === 'apiCall') {
        onApiCall?.(data.method, data.args);
        return;
      }
      // Final result message
      clearTimeout(timeoutId);
      worker.terminate();
      resolve(data as WorkerOutput);
    };

    worker.onerror = (err) => {
      clearTimeout(timeoutId);
      worker.terminate();
      resolve({
        success: false,
        error: err.message || 'Worker 执行异常',
        executionTime: 0,
        apiCalls: [],
      });
    };

    worker.postMessage(input);
  });
}

/**
 * Release the Worker Blob URL (call on page unload)
 */
export function releaseWorkerBlobUrl(): void {
  if (_workerCodeBlobUrl) {
    URL.revokeObjectURL(_workerCodeBlobUrl);
    _workerCodeBlobUrl = null;
  }
}