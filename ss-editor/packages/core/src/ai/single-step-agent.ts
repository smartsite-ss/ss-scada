// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Single Step Agent — P1-T03 frontend single-step Agent
 *
 * Handles simple intents (chat/alarm_query/device_query/kb_query),
 * a single LLM call + optional tool execution (no ReAct loop needed).
 *
 * Complex intents → forwarded to the backend ReAct orchestrator.
 *
 * Related decision: D-005 hybrid mode
 *
 * Usage:
 *   const agent = new SingleStepAgent();
 *   const result = await agent.run(intentResult, context);
 */

import { aiClient, ChatMessage, TaskType } from './ai-client';
import { IntentResult } from './intent-parser';
import { contextManager } from './context-manager';
import { ToolExecutor, toolExecutor, ToolDefinition } from './tool-executor';

/** Single-step Agent execution result */
export interface SingleStepResult {
  /** Response text */
  content: string;
  /** Execution time (ms) */
  latencyMs: number;
  /** Whether tool calls were included */
  hasToolCalls: boolean;
  /** Tool execution results */
  toolResults?: Array<{ name: string; success: boolean; data?: unknown }>;
}

/** Agent config */
export interface AgentConfig {
  /** Timeout in ms */
  timeout: number;
  /** Max tool calls */
  maxToolCalls: number;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  timeout: 60_000,
  maxToolCalls: 3,
};

export class SingleStepAgent {
  private config: AgentConfig;
  private executor: ToolExecutor;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.executor = toolExecutor;
  }

  /**
   * Run the single-step Agent
   * @param intent — intent parsing result
   * @returns execution result
   */
  async run(intent: IntentResult): Promise<SingleStepResult> {
    const startTime = Date.now();
    const ctx = contextManager.collectContext();
    const systemPrompt = contextManager.buildSystemPrompt(ctx);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: intent.rawInput },
    ];

    // Get available tools
    const tools = this.executor.getToolSchemas();

    try {
      const response = await aiClient.chat({
        messages,
        taskType: this.mapIntentToTaskType(intent.intent),
        tools: tools.length > 0 ? tools : undefined,
      });

      const latencyMs = Date.now() - startTime;

      // Check for tool calls
      const assistantMsg = response;
      const toolCalls = assistantMsg?.toolCalls;

      if (toolCalls && toolCalls.length > 0) {
        const toolResults = await this.executeTools(toolCalls.slice(0, this.config.maxToolCalls));
        return {
          content: assistantMsg.content || '正在执行操作...',
          latencyMs,
          hasToolCalls: true,
          toolResults,
        };
      }

      return {
        content: assistantMsg.content || '(无响应)',
        latencyMs,
        hasToolCalls: false,
      };
    } catch (err) {
      return {
        content: `抱歉，处理请求时出错：${(err as Error).message}`,
        latencyMs: Date.now() - startTime,
        hasToolCalls: false,
      };
    }
  }

  /**
   * Whether to forward to the backend ReAct orchestrator
   */
  shouldDelegate(intent: IntentResult): boolean {
    return intent.complexity === 'complex';
  }

  /**
   * Register frontend tools
   */
  registerTool(tool: ToolDefinition): void {
    this.executor.register(tool);
  }

  /**
   * Intent type → task type mapping
   */
  private mapIntentToTaskType(intent: IntentResult['intent']): TaskType {
    const map: Record<string, TaskType> = {
      chat: 'chat',
      alarm_query: 'analysis',
      device_query: 'analysis',
      kb_query: 'chat',
      script_gen: 'script-dev',
      plugin_gen: 'plugin-dev',
      page_create: 'chat',
      graphic_add: 'chat',
      layout_adjust: 'chat',
      data_bind: 'chat',
      unknown: 'chat',
    };
    return map[intent] || 'chat';
  }

  /**
   * Execute the tool call chain
   */
  private async executeTools(
    toolCalls: Array<{ function: { name: string; arguments: string } }>,
  ): Promise<Array<{ name: string; success: boolean; data?: unknown }>> {
    const results = await toolExecutor.executeBatch(
      toolCalls.map((tc) => ({
        name: tc.function.name,
        params: this.safeParseJSON(tc.function.arguments),
      })),
    );
    return results.map((r, i) => ({
      name: toolCalls[i]?.function?.name || 'unknown',
      success: r.success,
      data: r.data,
    }));
  }

  private safeParseJSON(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

/** Singleton */
export const singleStepAgent = new SingleStepAgent();
