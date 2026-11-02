// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Tool Executor — P1-T03 frontend tool executor
 *
 * Manages registration and execution of frontend-available tools.
 * Tools interact with local systems via the MCP protocol (editor cmd / data-platform query).
 *
 * Tools fall into two categories:
 *   - Local: tools operating the editor directly (scene.*, plugin.*)
 *   - Remote: tools calling backend APIs (alarm.*, device.*, script.*)
 *
 * Related decisions: D-005 (hybrid mode), D-013 (MCP tool protocol)
 *
 * Usage:
 *   const result = await toolExecutor.execute('scene_addGraphic', { type: 'pump', x: 100 });
 */

/** Tool parameter schema */
export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
}

/** Tool definition */
export interface ToolDefinition {
  name: string;
  description: string;
  category: 'scene' | 'plugin' | 'script' | 'alarm' | 'device' | 'datatag' | 'kb' | 'layout';
  params: ToolParam[];
  /** Callback executing the tool */
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/** Tool execution result */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Tool execution options */
export interface ToolExecuteOptions {
  /** Caller identifier */
  caller?: string;
  /** Timeout in ms */
  timeout?: number;
}

/** Tool registry */
const toolRegistry = new Map<string, ToolDefinition>();

export class ToolExecutor {
  /**
   * Register a tool
   */
  register(tool: ToolDefinition): void {
    if (toolRegistry.has(tool.name)) {
      console.warn(`[ToolExecutor] 工具 ${tool.name} 已注册，将被覆盖`);
    }
    toolRegistry.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get all registered tools (for system prompt generation)
   */
  getToolList(): ToolDefinition[] {
    return Array.from(toolRegistry.values());
  }

  /**
   * Generate tool schemas (for LLM function calling)
   */
  getToolSchemas(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return this.getToolList().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            tool.params.map((p) => [
              p.name,
              { type: p.type, description: p.description },
            ]),
          ),
          required: tool.params.filter((p) => p.required).map((p) => p.name),
        },
      },
    }));
  }

  /**
   * Execute a tool by name
   */
  async execute(
    toolName: string,
    params: Record<string, unknown> = {},
    options: ToolExecuteOptions = {},
  ): Promise<ToolResult> {
    const tool = toolRegistry.get(toolName);
    if (!tool) {
      return { success: false, error: `未找到工具: ${toolName}` };
    }

    const timeout = options.timeout || 30_000;
    const timer = new Promise<ToolResult>((_, reject) => {
      setTimeout(() => reject(new Error(`工具执行超时: ${toolName}`)), timeout);
    });

    try {
      const result = await Promise.race([tool.execute(params), timer]);
      return result;
    } catch (err) {
      return {
        success: false,
        error: `工具执行失败: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Execute multiple tool calls
   */
  async executeBatch(toolCalls: Array<{ name: string; params: Record<string, unknown> }>): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((tc) => this.execute(tc.name, tc.params)));
  }

  /**
   * Unregister a tool
   */
  unregister(toolName: string): boolean {
    return toolRegistry.delete(toolName);
  }
}

/** Singleton */
export const toolExecutor = new ToolExecutor();
