// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, Inject } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as acorn from 'acorn';
import { Script, ScriptExecution } from './entities/script.entity';

export interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  durationMs: number;
  memoryUsedMb: number;
}

export interface AstValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * ScriptEngineService — script sandbox execution engine
 *
 * Phase 5.4 hardening highlights:
 * 1. Added the `runScript()` pure execution method (no DB side effects) for ExecutionQueueService;
 *    `execute()` internally calls runScript and then persists a ScriptExecution record, staying backward compatible.
 * 2. Added `validateScriptAst(code)` — an acorn AST walk that blocks references to
 *    eval/Function/Reflect/Proxy/WebAssembly/globalThis and property accesses on constructor/__proto__.
 * 3. Hardened executeSandboxed: AST validation runs first + `.call(null)` ensures this is null.
 * 4. createSandboxContext now shadows dangerous globals (Function/Reflect/Proxy/WebAssembly/globalThis = undefined).
 * 5. executeWithPrivileges no longer injects the duplicated httpGet (provided uniformly by ScriptApiService).
 */
@Injectable()
export class ScriptEngineService {
  private readonly logger = new Logger(ScriptEngineService.name);

  /** Dangerous identifier references blocked by AST validation (not property keys) */
  private static readonly DANGEROUS_REFS = new Set([
    'eval',
    'Function',
    'Reflect',
    'Proxy',
    'WebAssembly',
    'globalThis',
  ]);

  /** Dangerous property accesses blocked by AST validation (non-computed) */
  private static readonly DANGEROUS_PROPS = new Set(['constructor', '__proto__']);

  constructor(
    @Inject(getRepositoryToken(ScriptExecution))
    private readonly executionRepo: Repository<ScriptExecution>,
  ) {}

  /**
   * Pure execution method — does not write to the DB, called by ExecutionQueueService
   *
   * The caller (ScriptService) is responsible for creating/updating ScriptExecution records,
   * decoupling execution from persistence for queue backpressure control and async execution.
   */
  async runScript(script: Script, context: Record<string, any> = {}): Promise<ExecutionResult> {
    const startedAt = Date.now();
    try {
      const apiProvider = context.apiProvider;
      const sandboxContext = this.createSandboxContext(script, context, apiProvider);

      this.logger.debug(`Running script: ${script.name} (${script.id})`);

      let result: any;
      if (script.allowNetwork || script.allowFileSystem) {
        result = await this.executeWithPrivileges(script, sandboxContext);
      } else {
        result = await this.executeSandboxed(script, sandboxContext);
      }

      return { success: true, result, durationMs: Date.now() - startedAt, memoryUsedMb: 0 };
    } catch (error) {
      this.logger.error(`Script ${script.name} failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        durationMs: Date.now() - startedAt,
        memoryUsedMb: 0,
      };
    }
  }

  /**
   * Execute a script and persist the execution record (backward-compatible entry)
   *
   * Internally calls runScript to get the result, then writes to the ScriptExecution table.
   * After queue integration, manual execution still goes through this method; queue execution uses runScript + manual record management.
   */
  async execute(script: Script, context: Record<string, any> = {}): Promise<ExecutionResult> {
    const startedAt = Date.now();

    const execution = this.executionRepo.create({
      scriptId: script.id,
      trigger: script.triggerType,
      status: 'running',
      startedAt: new Date(),
      memoryUsedMb: 0,
    });

    const result = await this.runScript(script, context);
    const durationMs = Date.now() - startedAt;

    execution.status = result.success ? 'completed' : 'failed';
    execution.result =
      result.success && result.result !== undefined
        ? typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result)
        : undefined;
    execution.error = result.error;
    execution.durationMs = durationMs;
    execution.finishedAt = new Date();
    await this.executionRepo.save(execution);

    if (result.success) {
      this.logger.log(`Script ${script.name} completed in ${durationMs}ms`);
    }

    return result;
  }

  /**
   * AST validation — blocks dangerous global access and prototype-chain escapes
   *
   * Block list:
   * - Identifier references: eval / Function / Reflect / Proxy / WebAssembly / globalThis
   *   (excluding cases used as object property keys, to avoid false positives on legal literals like { eval: 1 })
   * - Property access (non-computed): x.constructor / x.__proto__
   *   (obtaining the Function constructor through the prototype chain is a classic sandbox escape)
   *
   * @param code script code
   * @returns validation result (valid + errors list)
   */
  validateScriptAst(code: string): AstValidationResult {
    const errors: string[] = [];
    let ast: any;
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: 'script',
        allowReturnOutsideFunction: true,
      });
    } catch (err: any) {
      return { valid: false, errors: [`Syntax error: ${err.message}`] };
    }

    const visit = (node: any, parent?: any): void => {
      if (!node || typeof node !== 'object') return;

      // Block dangerous property access (non-computed): x.constructor, x.__proto__
      if (node.type === 'MemberExpression' && !node.computed) {
        const propName = node.property?.name;
        if (propName && ScriptEngineService.DANGEROUS_PROPS.has(propName)) {
          errors.push(`Forbidden property access: "${propName}"`);
        }
      }

      // Block dangerous identifier references (excluding cases used as property keys)
      if (node.type === 'Identifier') {
        const isPropKey =
          parent &&
          ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
            (parent.type === 'Property' && parent.key === node && !parent.computed) ||
            (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed));
        if (!isPropKey && ScriptEngineService.DANGEROUS_REFS.has(node.name)) {
          errors.push(`Forbidden global reference: "${node.name}"`);
        }
      }

      // Recursively walk child nodes
      for (const key in node) {
        if (key === 'type' || key === 'start' || key === 'end' || key === 'range' || key === 'loc') {
          continue;
        }
        const child = (node as any)[key];
        if (Array.isArray(child)) {
          child.forEach((c: any) => visit(c, node));
        } else if (child && typeof child === 'object' && child.type) {
          visit(child, node);
        }
      }
    };

    visit(ast);
    return { valid: errors.length === 0, errors };
  }

  private async executeSandboxed(script: Script, context: Record<string, any>): Promise<any> {
    // 1. Run AST validation first — blocks eval/Function/constructor/__proto__ etc.
    const validation = this.validateScriptAst(script.code);
    if (!validation.valid) {
      throw new Error(`Script AST validation failed: ${validation.errors.join('; ')}`);
    }

    try {
      const contextKeys = Object.keys(context);
      const sandboxFn = new Function(
        ...contextKeys,
        `
        "use strict";
        const ___start = Date.now();
        try {
          ${script.code}
          return { ok: true, value: undefined };
        } catch (___err) {
          return { ok: false, error: ___err.message || String(___err) };
        }
        `,
      );

      // .call(null) ensures this is null in strict mode (not the global object)
      const result = await Promise.race([
        sandboxFn.call(null, ...Object.values(context)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Script execution timeout')), script.timeoutMs),
        ),
      ]);

      if (result && result.ok === false) {
        throw new Error(result.error);
      }

      return result?.value;
    } catch (error) {
      if (error.message === 'Script execution timeout') {
        throw error;
      }
      throw error;
    }
  }

  private async executeWithPrivileges(script: Script, context: Record<string, any>): Promise<any> {
    this.logger.warn(`Script ${script.name} running with elevated privileges`);
    // httpGet/httpPost are provided uniformly by ScriptApiService (controlled HTTP utilities);
    // the raw require('http') is no longer injected here, preventing audit bypass.
    return this.executeSandboxed(script, context);
  }

  private createSandboxContext(
    script: Script,
    context: Record<string, any>,
    apiProvider?: any,
  ): Record<string, any> {
    return {
      console: {
        log: (...args: any[]) => this.logger.debug(`[Script ${script.id}] ${args.join(' ')}`),
        info: (...args: any[]) => this.logger.log(`[Script ${script.id}] ${args.join(' ')}`),
        warn: (...args: any[]) => this.logger.warn(`[Script ${script.id}] ${args.join(' ')}`),
        error: (...args: any[]) => this.logger.error(`[Script ${script.id}] ${args.join(' ')}`),
      },
      JSON: JSON,
      Math: Math,
      Date: Date,
      String: String,
      Number: Number,
      Boolean: Boolean,
      Array: Array,
      Object: Object,
      parseInt: parseInt,
      parseFloat: parseFloat,
      isNaN: isNaN,
      // ── Dangerous global shadowing (overriding global scope via function parameters) ──
      // eval/arguments cannot be parameter names in strict mode; blocked by AST validation
      Function: undefined,
      Reflect: undefined,
      Proxy: undefined,
      WebAssembly: undefined,
      globalThis: undefined,
      // ── Original blockings ──
      setTimeout: undefined,
      setInterval: undefined,
      require: undefined,
      process: undefined,
      global: undefined,
      ...context,
      ...(apiProvider || {}),
    };
  }
}
