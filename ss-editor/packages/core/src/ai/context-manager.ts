// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Context Manager — P1-T03 frontend context manager
 *
 * Collects editor runtime context for Agent decision-making:
 *   - Editor state (current page, selected graphics, history)
 *   - Data-platform state (active alarms, device list, etc., available for future integration)
 *   - User context (role, recent actions, preferences)
 *
 * Related decision: D-005 hybrid mode (context injected into the system prompt)
 *
 * Usage:
 *   const ctx = contextManager.collectContext();
 *   const systemPrompt = contextManager.buildSystemPrompt(ctx);
 */

/** Editor context */
export interface EditorContext {
  currentPage?: {
    id: string;
    name: string;
    width: number;
    height: number;
  };
  selectedElements: Array<{
    id: string;
    type: string;
    name: string;
  }>;
  historySteps: number;
  zoom: number;
}

/** Runtime context */
export interface RuntimeContext {
  activeAlarms: number;
  connectedDevices: number;
  currentProject: string;
}

/** User context */
export interface UserContext {
  role: string;
  language: string;
  theme: string;
}

/** Full context */
export interface AgentContext {
  editor: EditorContext;
  runtime: RuntimeContext;
  user: UserContext;
  timestamp: number;
}

export class ContextManager {
  private editorState: EditorContext = {
    selectedElements: [],
    historySteps: 0,
    zoom: 1,
  };

  private runtimeState: RuntimeContext = {
    activeAlarms: 0,
    connectedDevices: 0,
    currentProject: '',
  };

  /**
   * Update the editor state
   */
  updateEditorState(partial: Partial<EditorContext>): void {
    this.editorState = { ...this.editorState, ...partial };
  }

  /**
   * Update the runtime state
   */
  updateRuntimeState(partial: Partial<RuntimeContext>): void {
    this.runtimeState = { ...this.runtimeState, ...partial };
  }

  /**
   * Collect the full context
   */
  collectContext(): AgentContext {
    return {
      editor: { ...this.editorState },
      runtime: { ...this.runtimeState },
      user: {
        role: 'editor',
        language: localStorage.getItem('i18n') || 'zh-CN',
        theme: localStorage.getItem('theme') || 'light',
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Build the system prompt (with context injection)
   */
  buildSystemPrompt(ctx: AgentContext): string {
    const parts = [
      '你是一个智能 SCADA 系统 AI 助手，具备以下能力：',
      '- 画面创建与编辑（添加图元、调整布局、自动排版）',
      '- 数据绑定（关联数据标签与图元属性）',
      '- 脚本生成（生成采集/计算脚本）',
      '- 插件开发辅助（生成自定义图元插件代码）',
      '- 知识问答（SCADA 系统使用说明）',
    ];

    // Editor context
    if (ctx.editor.currentPage) {
      const p = ctx.editor.currentPage;
      parts.push(
        `\n【当前编辑器状态】`,
        `- 当前页面：${p.name}（${p.width}×${p.height}，ID: ${p.id}）`,
      );
    }
    if (ctx.editor.selectedElements.length > 0) {
      parts.push(
        `- 选中图元：${ctx.editor.selectedElements.map((e) => `${e.name}(${e.type})`).join(', ')}`,
      );
    }

    // Runtime context
    parts.push(
      `\n【系统状态】`,
      `- 当前项目：${ctx.runtime.currentProject || '(未加载)'}`,
      `- 活动报警：${ctx.runtime.activeAlarms} 条`,
      `- 在线设备：${ctx.runtime.connectedDevices} 台`,
    );

    return parts.join('\n');
  }
}

/** Singleton */
export const contextManager = new ContextManager();
