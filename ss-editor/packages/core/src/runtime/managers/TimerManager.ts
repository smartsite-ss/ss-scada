// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ITimerConfig, ITimerExecutionResult, DEFAULT_TIMER_CONFIG } from '../../types/timer';
import { IPage } from '../../graphic-editing/graphic/base/IPage';
import { ScriptError, errorService } from '../../utils/core/errors';

/**
 * Timer manager
 * Manages all timers of a page
 */
export class TimerManager {
  private timers: Map<string, ITimerConfig> = new Map();
  private runningTimers: Map<string, any> = new Map(); // Stores setTimeout/setInterval IDs
  private executionLogs: Map<string, ITimerExecutionResult[]> = new Map();

  private readonly MAX_LOGS_PER_TIMER = 100;

  /**
   * Auto-generate a timer name
   * Format: timer-01, timer-02... based on the max number of existing names + 1
   * Deleted numbers in the middle are not reused
   */
  private generateTimerName(): string {
    let maxNum = 0;
    for (const timer of this.timers.values()) {
      const match = timer.name.match(/定时器(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return `定时器${String(maxNum + 1).padStart(2, '0')}`;
  }

  /**
   * Constructor
   */
  constructor() {}

  /**
   * Get all timers
   */
  getAllTimers(): ITimerConfig[] {
    return Array.from(this.timers.values());
  }

  /**
   * Get a single timer
   */
  getTimer(id: string): ITimerConfig | null {
    return this.timers.get(id) || null;
  }

  /**
   * Add a timer
   * Names are auto-generated in the "timer-01, timer-02..." format (based on the max existing number + 1)
   */
  addTimer(timerConfig: Omit<ITimerConfig, 'id' | 'lastExecuteTime' | 'executeCount'>): ITimerConfig {
    const isNameExplicitlySet = timerConfig.name !== undefined && timerConfig.name !== '';

    const timer: ITimerConfig = {
      ...DEFAULT_TIMER_CONFIG,
      ...timerConfig,
      id: `timer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      lastExecuteTime: undefined,
      executeCount: 0,
    };

    // When the name is not explicitly provided (or still uses the default), auto-generate in the timer-01 format
    if (!isNameExplicitlySet || timer.name === DEFAULT_TIMER_CONFIG.name) {
      timer.name = this.generateTimerName();
    }

    this.timers.set(timer.id, timer);
    this.executionLogs.set(timer.id, []);
    return timer;
  }

  /**
   * Update a timer
   */
  updateTimer(id: string, config: Partial<ITimerConfig>): void {
    const timer = this.timers.get(id);
    if (timer) {
      // If updating the enabled state, stop first then start
      const wasEnabled = timer.enabled;

      Object.assign(timer, config);

      if (config.enabled !== undefined && config.enabled !== wasEnabled) {
        if (config.enabled) {
          this.startTimer(id);
        } else {
          this.stopTimer(id);
        }
      }
    }
  }

  /**
   * Delete a timer
   */
  removeTimer(id: string): void {
    this.stopTimer(id);
    this.timers.delete(id);
    this.executionLogs.delete(id);
  }

  /**
   * Enable a timer
   */
  enableTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer && !timer.enabled) {
      timer.enabled = true;
    }
  }

  /**
   * Disable a timer
   */
  disableTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer && timer.enabled) {
      timer.enabled = false;
      this.stopTimer(id);
    }
  }

  /**
   * Start a single timer
   */
  startTimer(id: string, page?: IPage): void {
    const timer = this.timers.get(id);
    if (!timer || !timer.enabled) {
      return;
    }

    // If already running, stop first
    this.stopTimer(id);

    // Create the executor
    const execute = () => {
      try {
        if (page) {
          this.executeTimerScript(timer, page);
        } else {
          this.executeTimer(timer);
        }
      } catch (error) {
        console.error(`Timer ${timer.id} execution error:`, error);
      }
    };

    let intervalId: ReturnType<typeof setTimeout>;
    if (timer.type === 'interval') {
      // Interval timer
      intervalId = setInterval(execute, timer.interval) as unknown as ReturnType<typeof setTimeout>;
    } else {
      // Timeout timer, with repeat support
      const executeTimeout = (remaining: number) => {
        if (remaining <= 0) return;

        intervalId = setTimeout(() => {
          try {
            if (page) {
              this.executeTimerScript(timer, page);
            } else {
              this.executeTimer(timer);
            }
            if (timer.repeatCount === undefined || timer.repeatCount < 0 || (timer.executeCount ?? 0) < timer.repeatCount) {
              executeTimeout(remaining - 1);
            }
          } catch (error) {
            console.error(`Timer ${timer.id} execution error:`, error);
          }
        }, timer.interval);

        this.runningTimers.set(id, intervalId);
      };

      executeTimeout(timer.repeatCount || Infinity);
      return;
    }

    this.runningTimers.set(id, intervalId);
  }

  /**
   * Stop a single timer
   */
  stopTimer(id: string): void {
    const intervalId = this.runningTimers.get(id);
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      clearTimeout(intervalId);
      this.runningTimers.delete(id);
    }
  }

  /**
   * Start all enabled timers
   */
  startAllTimers(): void {
    for (const [id, timer] of this.timers.entries()) {
      if (timer.enabled) {
        this.startTimer(id);
      }
    }
  }

  /**
   * Stop all timers
   */
  stopAllTimers(): void {
    for (const id of this.runningTimers.keys()) {
      this.stopTimer(id);
    }
  }

  /**
   * Execute the timer script
   * @param page Optional page object; when passed, the script can access graphics and the script engine interface through the page API
   */
  executeTimer(timer: ITimerConfig, page?: IPage): ITimerExecutionResult {
    const result: ITimerExecutionResult = {
      success: true,
      timestamp: Date.now(),
    };

    try {
      // Create the sandbox execution environment (when page is passed, the script can access graphics and the script engine interface through the page object)
      const output = this.executeScriptInSandbox(timer.script, timer.id, page || null);
      result.output = output;

      // Update execution statistics
      timer.lastExecuteTime = Date.now();
      timer.executeCount = (timer.executeCount || 0) + 1;
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
    }

    // Record the execution log
    this.addExecutionLog(timer.id, result);
    return result;
  }

  /**
   * Execute the timer script (with page parameter)
   */
  executeTimerScript(timer: ITimerConfig, page: IPage): ITimerExecutionResult {
    const result: ITimerExecutionResult = {
      success: true,
      timestamp: Date.now(),
    };

    try {
      // Create the sandbox execution environment
      const output = this.executeScriptInSandbox(timer.script, timer.id, page);
      result.output = output;

      // Update execution statistics
      timer.lastExecuteTime = Date.now();
      timer.executeCount = (timer.executeCount || 0) + 1;
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
    }

    // Record the execution log
    this.addExecutionLog(timer.id, result);
    return result;
  }

  /**
   * Execute a script in the sandbox
   */
  private executeScriptInSandbox(script: string, timerId: string, page: IPage | null): string {
    const output: string[] = [];

    // Create the sandbox execution environment
    const sandbox: Record<string, any> = {
      // Page-related API
      page: page ? {
        id: page.id,
        name: page.name,
        width: page.width,
        height: page.height,
        // Get all graphics
        getGraphics: () => page.getGraphics(),
        // Get a graphic by ID
        getGraphicById: (id: string) => {
          // Use BasePage's findGraphicById, which looks up from the graphicManager
          const graphic = page.findGraphicById(id);
          if (!graphic) {
            return null;
          }
          // Return a simplified but reliable graphic object wrapper
          return {
            id: graphic.id,
            type: graphic.type,
            // Method to directly access properties
            getProperty: (path: string, defaultValue?: any) => {
              return this.getNestedProperty(graphic, path, defaultValue);
            },
            // Directly access position
            getPosition: () => {
              const geometry = graphic.config?.geometry || {};
              return {
                x: geometry.x ?? 0,
                y: geometry.y ?? 0
              };
            },
            getSize: () => {
              const geometry = graphic.config?.geometry || {};
              return {
                width: geometry.width ?? 100,
                height: geometry.height ?? 100
              };
            }
          };
        },
        // Update graphic property
        updateGraphicProperty: (id: string, propertyPath: string, value: any) => {

          // Build the correct property object - note: only properties under config are needed!
          const keys = propertyPath.split('.');
          const properties: Record<string, any> = {};

          // Make sure we skip the 'config' prefix (if present)
          let startIndex = 0;
          if (keys.length >= 2 && keys[0] === 'config' && keys[1] === 'config') {
            startIndex = 2;
          }

          // Build the nested property object
          let current = properties;
          for (let i = startIndex; i < keys.length - 1; i++) {
            current[keys[i]] = {};
            current = current[keys[i]];
          }
          current[keys[keys.length - 1]] = value;

          page.updateGraphic(id, properties);
        },
        // Move a graphic (a more convenient method)
        moveGraphic: (id: string, x: number, y: number) => {
          page.moveGraphic(id, x, y);
        },
        // Batch update graphics
        batchUpdateGraphics: (updates: Array<{ id: string; properties: Record<string, any> }>) => {
          updates.forEach(u => {
            page.updateGraphic(u.id, u.properties);
          });
        },
        // Refresh display
        refreshDisplay: () => {},
      } : null,
      // Utility functions
      utils: {
        log: (...args: any[]) => {
          output.push(args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
          ).join(' '));
        },
        formatDate: (date?: Date) => {
          const d = date || new Date();
          return d.toLocaleString();
        },
        random: (min: number, max: number) => {
          return Math.random() * (max - min) + min;
        },
        sleep: (ms: number) => {
          return new Promise((resolve) => setTimeout(resolve, ms));
        },
      },
      // Timer-related API
      timer: {
        id: timerId,
        getCurrentTimer: () => this.getTimer(timerId),
        getExecutionCount: () => (this.getTimer(timerId)?.executeCount || 0),
      },
      // Data binding API (placeholder)
      data: {
        getValue: (_key: string) => null,
        setValue: (_key: string, _value: any) => {},
      },
    };

    // ══════════════════════════════════════════════════════
    // Inject top-level APIs (kept compatible with ScriptEngine ScriptAPI)
    // ══════════════════════════════════════════════════════
    // Graphic operation API
    sandbox.showGraphic = (id: string) => {
      if (page) page.updateGraphic(id, { visible: true });
    };
    sandbox.hideGraphic = (id: string) => {
      if (page) page.updateGraphic(id, { visible: false });
    };
    sandbox.setGraphicProps = (id: string, props: Record<string, any>) => {
      if (page) page.updateGraphic(id, props);
    };
    sandbox.moveGraphic = (id: string, x: number, y: number) => {
      if (page) page.moveGraphic(id, x, y);
    };
    // Front-end timer API (based on the browser-native setTimeout/setInterval)
    sandbox.setTimeout = (callback: (...args: any[]) => any, delay: number): number => {
      return setTimeout(callback, delay) as unknown as number;
    };
    sandbox.clearTimeout = (id: number): void => {
      clearTimeout(id);
    };
    sandbox.setInterval = (callback: (...args: any[]) => any, interval: number): number => {
      return setInterval(callback, interval) as unknown as number;
    };
    sandbox.clearInterval = (id: number): void => {
      clearInterval(id);
    };
    // sleep (kept compatible with ClientScriptAPI, returns a Promise)
    sandbox.sleep = (ms: number): Promise<void> => {
      return new Promise((resolve) => setTimeout(resolve, ms));
    };

    // Create a safe script execution environment (supports async/await)
    try {
      const sandboxKeys = Object.keys(sandbox);
      const sandboxValues = Object.values(sandbox);
      // Wrap with an async IIFE so async calls like await sleep() can be used
      const fn = new Function(...sandboxKeys, `return (async () => {\n${script}\n})();`);
      const result = fn(...sandboxValues);
      // If the result is a Promise, do not block execution (avoid blocking the interval loop)
      if (result instanceof Promise) {
        result.catch((error: any) => {
          const err = new ScriptError(
            timerId,
            error instanceof Error ? error.message : String(error)
          );
          errorService.record(err, 'TimerManager.executeScriptInSandbox');
        });
      }
      return output.join('\n');
    } catch (error) {
      const err = new ScriptError(
        timerId,
        error instanceof Error ? error.message : String(error)
      );
      errorService.record(err, 'TimerManager.executeScriptInSandbox');
      throw err;
    }
  }

  /**
   * Get a nested property
   */
  private getNestedProperty(obj: any, path: string, defaultValue?: any): any {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length; i++) {
      if (current === null || current === undefined) {
        return defaultValue;
      }
      current = current[keys[i]];
    }

    return current !== undefined ? current : defaultValue;
  }

  /**
   * Add an execution log
   */
  private addExecutionLog(timerId: string, result: ITimerExecutionResult): void {
    let logs = this.executionLogs.get(timerId);
    if (!logs) {
      logs = [];
      this.executionLogs.set(timerId, logs);
    }
    logs.push(result);

    // Limit the number of logs
    if (logs.length > this.MAX_LOGS_PER_TIMER) {
      logs.shift();
    }
  }

  /**
   * Get execution logs
   */
  getExecutionLogs(timerId: string): ITimerExecutionResult[] {
    return this.executionLogs.get(timerId) || [];
  }

  /**
   * Clear execution logs
   */
  clearExecutionLogs(timerId?: string): void {
    if (timerId) {
      this.executionLogs.set(timerId, []);
    } else {
      for (const key of this.executionLogs.keys()) {
        this.executionLogs.set(key, []);
      }
    }
  }

  /**
   * Check whether a timer is running
   */
  isTimerRunning(id: string): boolean {
    return this.runningTimers.has(id);
  }

  /**
   * Serialize to JSON (for persistence)
   */
  toJSON(): ITimerConfig[] {
    return this.getAllTimers();
  }

  /**
   * Restore from JSON
   */
  fromJSON(timersData: ITimerConfig[]): void {
    this.stopAllTimers();
    this.timers.clear();
    this.executionLogs.clear();

    for (const timerData of timersData) {
      // Validate data
      const timer: ITimerConfig = {
        id: timerData.id || `timer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: timerData.name || 'New Timer',
        enabled: Boolean(timerData.enabled),
        interval: typeof timerData.interval === 'number' ? timerData.interval : 1000,
        script: timerData.script || '',
        type: timerData.type === 'timeout' ? 'timeout' : 'interval',
        repeatCount: timerData.repeatCount,
        lastExecuteTime: timerData.lastExecuteTime,
        executeCount: timerData.executeCount || 0,
      };
      this.timers.set(timer.id, timer);
      this.executionLogs.set(timer.id, []);
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopAllTimers();
    this.timers.clear();
    this.executionLogs.clear();
  }
}
