// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type {
  ScriptContext,
  ScriptResult,
  ScriptAPI,
  SandboxEnv,
  ScriptDefinition,
  ScriptTrigger,
  ExecutionContext,
  EventBinding,
  ScriptLog,
} from '../types/script.types';
import { ALLOWED_GLOBALS, BLOCKED_GLOBALS } from '../types/script.types';
import { ClientScriptAPIFactory } from './ClientScriptAPI';

export class ScriptEngine {
  private static instance: ScriptEngine;
  private scripts: Map<string, ScriptDefinition> = new Map();
  private executionHistory: Map<string, ExecutionContext[]> = new Map();
  private eventBindings: Map<string, EventBinding> = new Map();
  private logs: ScriptLog[] = [];
  private eventBus: any = null;
  /** Graphic change handler: injected by the caller at runtime to apply script graphic operations directly to the render layer */
  private graphicChangeHandler: ((graphicId: string, props: Record<string, any>) => void) | null = null;

  static getInstance(): ScriptEngine {
    if (!ScriptEngine.instance) {
      ScriptEngine.instance = new ScriptEngine();
    }
    return ScriptEngine.instance;
  }

  setEventBus(bus: any): void {
    this.eventBus = bus;
  }

  /**
   * Set the graphic change handler
   * Injected by the caller at runtime (e.g. PageBrowser) to apply script graphic operations
   * (moveGraphic / setGraphicProps / showGraphic / hideGraphic etc.) directly to the render layer,
   * without indirectly handling them through apiCalls return values.
   */
  setGraphicChangeHandler(handler: ((graphicId: string, props: Record<string, any>) => void) | null): void {
    this.graphicChangeHandler = handler;
  }

  // ─── Script registration management ───

  registerScript(definition: ScriptDefinition): void {
    this.scripts.set(definition.id, definition);
    if (!this.executionHistory.has(definition.id)) {
      this.executionHistory.set(definition.id, []);
    }
  }

  unregisterScript(scriptId: string): void {
    this.scripts.delete(scriptId);
    this.executionHistory.delete(scriptId);
    // Clean up event bindings
    for (const [key, binding] of this.eventBindings) {
      if (binding.scriptId === scriptId) {
        binding.unsubscribe();
        this.eventBindings.delete(key);
      }
    }
  }

  getScript(scriptId: string): ScriptDefinition | undefined {
    return this.scripts.get(scriptId);
  }

  getAllScripts(): ScriptDefinition[] {
    return Array.from(this.scripts.values());
  }

  getExecutionHistory(scriptId: string): ExecutionContext[] {
    return this.executionHistory.get(scriptId) ?? [];
  }

  getLogs(): ScriptLog[] {
    return this.logs;
  }

  // ─── Script execution ───

  executeScript(script: string, context: ScriptContext): ScriptResult {
    const startTime = performance.now();
    const apiCalls: Array<{ method: string; args: any[] }> = [];

    const api = ClientScriptAPIFactory.create(context, {
      onGraphicChange: (graphicId, props) => {
        apiCalls.push({ method: 'setGraphicProps', args: [graphicId, props] });
        // At runtime, apply directly to the render layer via the handler
        this.graphicChangeHandler?.(graphicId, props);
      },
      onTagWrite: (tagId, value) => apiCalls.push({ method: 'writeTag', args: [tagId, value] }),
      onAlarmTrigger: (config) => apiCalls.push({ method: 'triggerAlarm', args: [config] }),
      onLog: (level, msg) => apiCalls.push({ method: 'log', args: [level, msg] }),
    });

    const sandbox = this.createSandbox(context, api);

    try {
      const wrappedCode = `
        "use strict";
        ${script}
      `;

      const fn = new Function('api', 'context', 'console', wrappedCode);
      const output = fn.call(sandbox, sandbox.api, sandbox.context, sandbox.console);

      const executionTime = performance.now() - startTime;

      return {
        success: true,
        output,
        executionTime,
        apiCalls,
      };
    } catch (error: any) {
      const executionTime = performance.now() - startTime;
      return {
        success: false,
        error: error?.message ?? String(error),
        executionTime,
        apiCalls,
      };
    }
  }

  /** Execute a script asynchronously (supports timeout and retry) */
  async executeAsync(scriptId: string, triggerType: ScriptTrigger = 'manual'): Promise<ScriptResult> {
    const definition = this.scripts.get(scriptId);
    if (!definition) {
      return { success: false, error: `Script not found: ${scriptId}`, executionTime: 0 };
    }

    if (!definition.enabled) {
      return { success: false, error: `Script is disabled: ${scriptId}`, executionTime: 0 };
    }

    const ctx: ExecutionContext = {
      scriptId: definition.id,
      scriptName: definition.name,
      triggerType,
      startTime: Date.now(),
      status: 'running',
      retryCount: 0,
    };

    this.executionHistory.get(scriptId)?.push(ctx);
    const maxRetries = definition.maxRetries ?? 0;
    const timeout = definition.timeout ?? 5000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      ctx.retryCount = attempt;

      try {
        const result = await this.executeWithTimeout(definition, ctx, timeout);

        ctx.status = 'success';
        ctx.endTime = Date.now();
        ctx.result = result;

        this.recordLog(definition, triggerType, result, result.executionTime);
        return result;
      } catch (error: any) {
        if (attempt < maxRetries) continue;

        ctx.status = error?.message?.includes('timeout') ? 'timeout' : 'error';
        ctx.endTime = Date.now();
        ctx.error = error?.message ?? String(error);

        const result: ScriptResult = {
          success: false,
          error: ctx.error,
          executionTime: ctx.endTime - ctx.startTime,
        };
        ctx.result = result;

        this.recordLog(definition, triggerType, result, result.executionTime);
        return result;
      }
    }

    return { success: false, error: 'Max retries exceeded', executionTime: 0 };
  }

  private executeWithTimeout(
    definition: ScriptDefinition,
    ctx: ExecutionContext,
    timeout: number,
  ): Promise<ScriptResult> {
    const context: ScriptContext = {
      graphicId: '',
      tagValues: {},
      triggerType: ctx.triggerType === 'manual' ? 'manual' : 'dataChange',
    };

    return new Promise<ScriptResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Script execution timeout (${timeout}ms): ${definition.name}`));
      }, timeout);

      try {
        const result = this.executeScript(definition.script, context);
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /** Edit-mode test execution (no history recording) */
  testExecute(script: string, context: ScriptContext): ScriptResult {
    return this.executeScript(script, context);
  }

  /** Validate script syntax */
  validateScript(script: string): { valid: boolean; error?: string } {
    try {
      new Function('"use strict";' + script);
      return { valid: true };
    } catch (e: any) {
      return { valid: false, error: e?.message ?? String(e) };
    }
  }

  /**
   * Execute a filter script (unified entry, replacing the scattered new Function in DataPipeline / DataDriverEngine).
   *
   * Sandbox strategy: uses a Proxy to intercept BLOCKED_GLOBALS (window/document/fetch/eval etc.),
   * a step counter to prevent infinite loops, and exposes only ALLOWED_GLOBALS (Math/Date/JSON and other pure functions).
   *
   * Script parameter compatibility:
   * - `value` / `data` both point to the same data (filter scripts conventionally use `value`, GraphicData scripts use `data`)
   * - `res` is the context object (tagId/tagName/quality/dataType/unit etc.)
   * - `api` is the built-in helpers (clamp/mapRange/colorForValue/formatNumber etc.)
   *
   * @param script the user-written filter script
   * @param data raw data (fullDataSet ?? rawValue)
   * @param res context object
   * @returns the script's return value
   * @throws script execution error (handled by the caller's own error strategy)
   */
  executeFilterScript(
    script: string,
    data: unknown,
    res: Record<string, unknown>,
  ): unknown {
    try {
      // Expose the same data as both value / data, compatible with both script styles
      const sandbox = this._createLightweightSandbox({ value: data, data, res });
      const fn = new Function('value', 'data', 'res', 'api', '"use strict";\n' + script);
      return fn.call(sandbox, data, data, res, sandbox.api);
    } catch (err: unknown) {
      // Log then re-throw, letting the caller handle it per its own error strategy (DataPipeline.executeChain's stop/skip/defaultValue strategies)
      console.error('[ScriptEngine] executeFilterScript error:', err);
      throw err;
    }
  }

  /**
   * Execute a driver script (unified entry, replacing new Function in DataDriverEngine).
   *
   * @param script the user-written driver script, signature (data, allData, graphic, api) => void
   * @param data the current graphic data
   * @param allData all data points
   * @param graphic the graphic context
   * @param api driver script API (setText/setBackground/setVisible etc.)
   * @returns whether the script executed successfully
   */
  executeDriverScript(
    script: string,
    data: unknown,
    allData: unknown,
    graphic: unknown,
    api: Record<string, unknown>,
  ): boolean {
    try {
      // Merge the caller-provided api (setText/setBackground etc. graphic operations) into sandbox.api,
      // so api.setText(...) in scripts routes correctly to the caller's implementation; fixes the original {} as DriverScriptAPI making side effects fail
      const sandbox = this._createLightweightSandbox({ data, allData, graphic }, api);
      const fn = new Function('data', 'allData', 'graphic', 'api', '"use strict";\n' + script);
      fn.call(sandbox, data, allData, graphic, sandbox.api);
      return true;
    } catch (err: unknown) {
      console.error('[ScriptEngine] executeDriverScript error:', err);
      return false;
    }
  }

  /**
   * Evaluate an expression (unified entry, replacing new Function in BindingManager / ExpressionDataSource).
   *
   * @param expression expression string, e.g. "val * 1.8 + 32"
   * @param val input value
   * @returns the evaluation result; returns the original value on failure
   */
  evaluateExpression(expression: string, val: unknown): unknown {
    try {
      const sandbox = this._createLightweightSandbox({ val });
      const fn = new Function('val', `"use strict";\nreturn (${expression});`);
      return fn.call(sandbox, val);
    } catch (err: unknown) {
      console.error('[ScriptEngine] evaluateExpression error:', err);
      return val;
    }
  }

  /**
   * Create a lightweight sandbox (no ScriptAPI dependency) for filter/driver/expression script execution.
   * Reuses createSandbox's Proxy + BLOCKED_GLOBALS + step-counter mechanism.
   *
   * @param vars variables visible to the script
   * @param apiOverride caller-provided api (e.g. DriverScriptAPI's setText/setBackground etc.),
   *                    merged with the built-in helpers (clamp/mapRange/colorForValue etc.);
   *                    same-named methods provided override the built-in helpers.
   */
  private _createLightweightSandbox(
    vars: Record<string, unknown>,
    apiOverride?: Record<string, unknown>,
  ): { api: Record<string, unknown> } & Record<string, unknown> {
    const helpers = this._buildScriptHelpers();
    const api = apiOverride ? { ...helpers, ...apiOverride } : helpers;
    const env: Record<string, unknown> = { ...vars, api, console: this._buildSandboxConsole() };

    let stepCount = 0;
    const MAX_STEPS = 50000;

    return new Proxy(env, {
      get(target, prop) {
        stepCount++;
        if (stepCount > MAX_STEPS) {
          throw new Error(`脚本执行超过最大步数限制 (${MAX_STEPS})，可能存在无限循环`);
        }
        if (typeof prop === 'string') {
          if (BLOCKED_GLOBALS.has(prop)) {
            throw new Error(`Access to "${prop}" is blocked in sandbox`);
          }
          if (prop in target) {
            return target[prop];
          }
          if (ALLOWED_GLOBALS.has(prop) && prop in globalThis) {
            return (globalThis as any)[prop];
          }
        }
        return undefined;
      },
      set(_target, prop) {
        if (typeof prop === 'string' && BLOCKED_GLOBALS.has(prop)) {
          throw new Error(`Modification of "${prop}" is blocked in sandbox`);
        }
        return true;
      },
    }) as any;
  }

  /** Build the script utility API (clamp/mapRange/colorForValue etc.), a single source eliminating duplication */
  private _buildScriptHelpers(): Record<string, unknown> {
    return {
      Math,
      round: (v: unknown, d: number = 0) => {
        const n = Number(v);
        const factor = Math.pow(10, d);
        return Math.round(n * factor) / factor;
      },
      clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
      mapRange: (v: number, inMin: number, inMax: number, outMin: number, outMax: number) =>
        outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin),
      colorForValue: (v: number, min: number = 0, max: number = 100) => {
        const ratio = Math.max(0, Math.min(1, (v - min) / (max - min)));
        const r = Math.round(ratio * 255);
        const g = Math.round((1 - ratio) * 255);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}00`;
      },
      isAlarm: (v: number, high: number, low: number = 0) => v >= high || v <= low,
      isGood: (v: number, high: number, low: number = 0) => v < high && v > low,
      formatNumber: (v: number, d: number = 2) => v.toFixed(d),
      formatDate: (ts?: number) => new Date(ts ?? Date.now()).toISOString(),
    };
  }

  /** Build the sandbox console (log collection, does not pollute the global console) */
  private _buildSandboxConsole(): { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } {
    return {
      log: (...args: unknown[]) => console.log('[sandbox]', ...args),
      warn: (...args: unknown[]) => console.warn('[sandbox]', ...args),
      error: (...args: unknown[]) => console.error('[sandbox]', ...args),
    };
  }

  // ─── Sandbox creation ───

  private createSandbox(context: ScriptContext, api: ScriptAPI): SandboxEnv {
    const sandboxConsole = {
      log: (...args: any[]) => {
        api.log('info', args.map(String).join(' '));
      },
      warn: (...args: any[]) => {
        api.log('warn', args.map(String).join(' '));
      },
      error: (...args: any[]) => {
        api.log('error', args.map(String).join(' '));
      },
    };

    const env: SandboxEnv = {
      context,
      api,
      console: sandboxConsole,
    };

    // Step counter: prevents infinite loops from freezing the browser
    let stepCount = 0;
    const MAX_STEPS = 50000;

    return new Proxy(env, {
      get(target, prop) {
        // Each property access counts as one step; throw when the threshold is exceeded
        stepCount++;
        if (stepCount > MAX_STEPS) {
          throw new Error(`脚本执行超过最大步数限制 (${MAX_STEPS})，可能存在无限循环`);
        }
        if (typeof prop === 'string') {
          if (BLOCKED_GLOBALS.has(prop)) {
            throw new Error(`Access to "${prop}" is blocked in sandbox`);
          }
          if (prop in target) {
            return (target as any)[prop];
          }
          if (ALLOWED_GLOBALS.has(prop) && prop in globalThis) {
            return (globalThis as any)[prop];
          }
        }
        return undefined;
      },
      set(_target, prop) {
        if (typeof prop === 'string' && BLOCKED_GLOBALS.has(prop)) {
          throw new Error(`Modification of "${prop}" is blocked in sandbox`);
        }
        return true;
      },
    }) as unknown as SandboxEnv;
  }

  // ─── Event binding ───

  bindToEvent(scriptId: string, eventFullName: string, condition?: string): EventBinding {
    const key = `${scriptId}:${eventFullName}:${condition ?? ''}`;

    if (this.eventBindings.has(key)) {
      return this.eventBindings.get(key)!;
    }

    const handler = (eventData: any) => {
      if (condition && !this.evaluateCondition(condition, eventData)) {
        return;
      }
      this.executeAsync(scriptId, 'event');
    };

    const unsubscribe = this.eventBus?.on?.(eventFullName, handler) ?? (() => {});

    const binding: EventBinding = { scriptId, eventFullName, condition, unsubscribe };
    this.eventBindings.set(key, binding);
    return binding;
  }

  unbindFromEvent(scriptId: string, eventFullName: string, condition?: string): void {
    const key = `${scriptId}:${eventFullName}:${condition ?? ''}`;
    const binding = this.eventBindings.get(key);
    if (binding) {
      binding.unsubscribe();
      this.eventBindings.delete(key);
    }
  }

  private evaluateCondition(condition: string, eventData: any): boolean {
    try {
      const fn = new Function('data', `return ${condition}`);
      return Boolean(fn(eventData));
    } catch {
      return false;
    }
  }

  // ─── Logging ───

  private recordLog(
    definition: ScriptDefinition,
    triggerType: ScriptTrigger,
    result: ScriptResult,
    executionTime: number,
  ): void {
    this.logs.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      scriptId: definition.id,
      scriptName: definition.name,
      triggerType,
      startTime: Date.now() - executionTime,
      executionTime,
      success: result.success,
      output: result.output,
      error: result.error,
      apiCalls: result.apiCalls ?? [],
    });

    // Keep the log cap at 1000 entries
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }

  // ─── Cleanup ───

  destroy(): void {
    for (const binding of this.eventBindings.values()) {
      binding.unsubscribe();
    }
    this.eventBindings.clear();
    this.scripts.clear();
    this.executionHistory.clear();
    this.logs = [];
  }
}