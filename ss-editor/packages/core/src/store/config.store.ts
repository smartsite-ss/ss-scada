// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { defineStore } from 'pinia';
import { DEFAULT_SHORTCUTS, ShortcutConfig } from '../canvas-page/shortcuts.config';
import { KeyboardContext, KeyModifiers } from '../canvas-page/keyboard.service';
import { loadPersistedState, persistState } from './persistent-store';

const CONFIG_STORAGE_KEY = 'scada-editor-config';

export const DEFAULT_MIN_PANEL_WIDTH = 200;
export const DEFAULT_MAX_PANEL_WIDTH = 600;
export const DEFAULT_LEFT_WIDTH = 220;
export const DEFAULT_RIGHT_WIDTH = 320;
export const DEFAULT_COLLAPSED_WIDTH = 16;

// Get default state
function getDefaultState() {
  return {
    // Tool configuration
    tools: {
      selectedTool: 'select', // select, rect, circle, text, image
      fillColor: '#4CAF50',
      strokeColor: '#388E3C',
      lineWidth: 2,
      fontSize: 14,
      fontFamily: 'Arial',
    },

    // Canvas configuration
    canvas: {
      grid: true,
      gridSize: 20,
      snapToGrid: true,
      showRulers: true,
      zoom: 1,
      scaleMin: 20,
      scaleMax: 300,
      zoomStep: 5,
      renderMode: 'canvas' as 'canvas' | 'konva' | 'svg' | 'webgl',
      useCanvasSelection: false,
    },

    // UI configuration
    ui: {
      showToolbar: true,
      showPropertyPanel: true,
      showLayerPanel: true,
      theme: 'dark',
      language: 'zh-CN', // zh-CN, en-US
      leftPanelWidth: DEFAULT_LEFT_WIDTH,
      rightPanelWidth: DEFAULT_RIGHT_WIDTH,
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      minPanelWidth: DEFAULT_MIN_PANEL_WIDTH,
      maxPanelWidth: DEFAULT_MAX_PANEL_WIDTH,
      collapsedPanelWidth: DEFAULT_COLLAPSED_WIDTH,
      headerHeight: 60,       // Top bar height
      sidebarWidth: 200,      // Sidebar width
      // AI assistant floating panel config (data platform)
      aiAssistantVisible: true,  // Whether to show the AI assistant floating button
      aiAssistantX: null as number | null,   // Panel X position (null = default bottom-right)
      aiAssistantY: null as number | null,   // Panel Y position
    },

    // Auto-save configuration
    autoSave: {
      enabled: true,
      interval: 300, // Default 300 seconds
    },

    // Shortcut configuration
    shortcuts: DEFAULT_SHORTCUTS as ShortcutConfig[],
  };
}

function getInitialState() {
  return loadPersistedState(CONFIG_STORAGE_KEY, getDefaultState, (saved, defaults) => ({
    ...defaults,
    ...saved,
    tools: { ...defaults.tools, ...(saved as any).tools },
    canvas: { ...defaults.canvas, ...(saved as any).canvas },
    ui: { ...defaults.ui, ...(saved as any).ui },
    autoSave: { ...defaults.autoSave, ...(saved as any).autoSave },
    shortcuts: (saved as any).shortcuts || defaults.shortcuts,
  }));
}

// Config state management
export const useConfigStore = defineStore('config', {
  state: () => getInitialState(),

  actions: {
    saveConfig(): { success: boolean; error?: string } {
      try {
        persistState(CONFIG_STORAGE_KEY, {
          tools: this.tools,
          canvas: this.canvas,
          ui: this.ui,
          autoSave: this.autoSave,
          shortcuts: this.shortcuts,
        });
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[ConfigStore] Failed to save config: ${errorMessage}`);
        return { success: false, error: errorMessage };
      }
    },

    // Update tool config
    updateToolConfig(config: Partial<Record<string, any>>) {
      Object.assign(this.tools, config);
      this.saveConfig();
    },

    // Update canvas config
    updateCanvasConfig(config: Partial<Record<string, any>>) {
      Object.assign(this.canvas, config);
      this.saveConfig();
    },

    // Update UI config
    updateUIConfig(config: Partial<Record<string, any>>) {
      Object.assign(this.ui, config);
      this.saveConfig();
    },

    // Update auto-save config
    updateAutoSaveConfig(config: Partial<{ enabled: boolean; interval: number }>) {
      Object.assign(this.autoSave, config);
      this.saveConfig();
    },

    // Update a single shortcut
    updateShortcut(id: string, config: Partial<ShortcutConfig>) {
      const index = this.shortcuts.findIndex((s: ShortcutConfig) => s.id === id);
      if (index !== -1) {
        this.shortcuts[index] = { ...this.shortcuts[index], ...config };
        this.saveConfig();
      }
    },

    // Batch update shortcuts
    updateShortcuts(shortcuts: Partial<ShortcutConfig>[]) {
      shortcuts.forEach(shortcut => {
        if (shortcut.id) {
          this.updateShortcut(shortcut.id, shortcut);
        }
      });
    },

    // Reset a single shortcut to default
    resetShortcut(id: string) {
      const defaultShortcut = DEFAULT_SHORTCUTS.find((s: ShortcutConfig) => s.id === id);
      if (defaultShortcut) {
        const index = this.shortcuts.findIndex((s: ShortcutConfig) => s.id === id);
        if (index !== -1) {
          this.shortcuts[index] = { ...defaultShortcut };
          this.saveConfig();
        }
      }
    },

    // Reset all shortcuts to default
    resetAllShortcuts() {
      this.shortcuts = [...DEFAULT_SHORTCUTS];
      this.saveConfig();
    },

    // Get shortcut config
    getShortcut(id: string): ShortcutConfig | undefined {
      return this.shortcuts.find((s: ShortcutConfig) => s.id === id);
    },

    // Get all shortcuts
    getAllShortcuts(): ShortcutConfig[] {
      return [...this.shortcuts];
    },

    // Check shortcut conflicts
    checkShortcutConflict(key: string, modifiers: KeyModifiers, context: KeyboardContext, excludeId?: string): boolean {
      return this.shortcuts.some((s: ShortcutConfig) => {
        if (excludeId && s.id === excludeId) return false;
        if (s.context !== context && s.context !== KeyboardContext.GLOBAL) return false;
        if (s.key.toLowerCase() !== key.toLowerCase()) return false;
        return (
          (modifiers.ctrl === undefined || s.modifiers.ctrl === modifiers.ctrl) &&
          (modifiers.shift === undefined || s.modifiers.shift === modifiers.shift) &&
          (modifiers.alt === undefined || s.modifiers.alt === modifiers.alt) &&
          (modifiers.meta === undefined || s.modifiers.meta === modifiers.meta)
        );
      });
    },

    // Reset config
    resetConfig() {
      this.$reset();
      this.saveConfig();
    },

    // Import config
    importConfig(data: any) {
      if (data.tools) {
        this.tools = data.tools;
      }
      if (data.canvas) {
        this.canvas = data.canvas;
      }
      if (data.ui) {
        this.ui = data.ui;
      }
      if (data.autoSave) {
        this.autoSave = data.autoSave;
      }
      if (data.shortcuts) {
        this.shortcuts = data.shortcuts;
      }
      this.saveConfig();
    },

    // Export config
    exportConfig() {
      return {
        tools: this.tools,
        canvas: this.canvas,
        ui: this.ui,
        autoSave: this.autoSave,
        shortcuts: this.shortcuts,
      };
    },
  },
});
