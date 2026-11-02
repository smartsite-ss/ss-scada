// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { Ref, Component } from 'vue';

// Canvas interaction options
export interface CanvasInteractionOptions {
  panX: Ref<number>;
  panY: Ref<number>;
  canvasWidth: Ref<number>;
  canvasHeight: Ref<number>;
  cursorStyle: Ref<string>;
  hoveredGraphicId: Ref<string>;
  graphicDecorators: Ref<Record<string, any>>;
  formatPainterManager?: import('@scada-editor/core').FormatPainterManager;
}

// Panel configuration
export interface PanelConfig {
  id: string;
  title: string;
  component: Component;
  position: 'left' | 'right' | 'bottom';
  defaultOpen?: boolean;
  icon?: string;
}

// Tool configuration
export interface ToolConfig {
  id: string;
  name: string;
  icon: string;
  component?: Component;
  onActivate?: () => void;
  onDeactivate?: () => void;
}

// UI plugin interface
export interface UIPlugin {
  name: string;
  install(context: any): void;
  components?: Record<string, Component>;
  panels?: PanelConfig[];
  tools?: ToolConfig[];
}
