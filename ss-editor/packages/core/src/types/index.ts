// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// ==================== Base type exports (avoid duplicate definitions) ====================

// Re-export base interfaces to ensure type consistency
export type { IGraphic } from '@scada-editor/plugin-sdk';
export type { IPage } from '../graphic-editing/graphic/base/IPage';
export type { ILayout } from '../canvas-page/layouts/base/ILayout';

// Re-export graphic property interfaces
export type {
  IPosition, ISize, IGeometry,
  IGraphicStyle, IGraphicConfig, IGraphicProps,
  IEvent, IGraphicEvent,
  IDataValidation, IDataSource, IAnimation
} from '../graphic-editing/graphic/base/IProperty';

// ==================== New types (migrated from UI) ====================

// Partial render options
export interface PartialRenderOptions {
  partial: boolean;
  dirtyRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Draw callback type
export type DrawCanvasCallback = (options?: PartialRenderOptions) => void;

// Canvas state
export interface CanvasState {
  width: number;
  height: number;
  scale: number;
  pan: { x: number; y: number };
  showGrid: boolean;
  showRulers: boolean;
  showReferenceLines: boolean;
  isSelecting: boolean;
  selectionRect: { left: number; top: number; width: number; height: number };
  selectedIds: string[];
  hoveredId: string | null;
  cursorStyle: string;
}

// Page-related types
export interface IThemeColors {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
}

export interface ISelectionHistoryItem {
  selectedGraphicId: string | null;
  selectedGraphicIds: string[];
}

// Control-point related types
export enum ControlPointType {
  RESIZE = 'resize',
  ROTATE = 'rotate',
}

// Selection mode enum
export enum SelectionMode {
  SINGLE = 'single',           // Single mode: click selects, deselecting previous
  ADDITIVE = 'additive',       // Additive mode:
                               //   - Single selection: Shift/Ctrl click toggles selection (add/remove)
                               //   - Box selection: Shift/Ctrl drag toggles selection (adds unselected, removes selected)
  SUBTRACTIVE = 'subtractive', // Subtractive mode: Ctrl+Shift click or drag removes from selection
  BOX = 'box',                 // Box mode: drag to replace selection
}

// Selection box render data interface
export interface SelectionRenderData {
  isSelecting: boolean;
  selectionRect: { left: number; top: number; width: number; height: number };
  selectedGraphicIds: string[];
  selectedGraphics: any[];
}

// Selection state interface
export interface ISelectionState {
  selectedGraphicId: string | null;
  selectedGraphicIds: string[];
  mode: SelectionMode;
  isSelecting: boolean;
  selectionRect: { left: number; top: number; width: number; height: number };
}

export enum ResizeHandleType {
  TOP_LEFT = 'top-left',
  TOP_RIGHT = 'top-right',
  BOTTOM_LEFT = 'bottom-left',
  BOTTOM_RIGHT = 'bottom-right',
  LEFT = 'left',
  RIGHT = 'right',
  TOP = 'top',
  BOTTOM = 'bottom',
}



// Project-related types - migrated to project/Project.ts
export type { IProject } from '../project/Project';

// Template related types
export interface GraphicTemplate {
  name: string;
  graphics: any[];
  createdAt: string;
}

// Timer-related types
export * from './timer';

// Data source related types
export * from './data-source.types';
