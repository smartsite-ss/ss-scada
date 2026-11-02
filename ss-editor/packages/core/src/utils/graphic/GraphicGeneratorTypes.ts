// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IGraphic } from '@scada-editor/plugin-sdk';

// Layout mode
export type LayoutMode = 'grid' | 'random' | 'flow' | 'spiral';

// Single graphic configuration
export interface GraphicConfig {
  type: string;                      // Graphic type
  x?: number;                        // X coordinate (fixed position only)
  y?: number;                        // Y coordinate (fixed position only)
  width?: number;                    // Width
  height?: number;                   // Height
  customProps?: Record<string, any>; // Custom properties
}

// Generation configuration
export interface GenerateConfig {
  type: string;                      // Graphic type
  count: number;                     // Number to generate
  layoutMode: LayoutMode;            // Layout mode
  startX: number;                    // Start X coordinate
  startY: number;                    // Start Y coordinate
  areaWidth: number;                 // Area width
  areaHeight: number;                // Area height

  // Graphic size configuration
  minWidth?: number;                 // Minimum width
  maxWidth?: number;                 // Maximum width
  minHeight?: number;                // Minimum height
  maxHeight?: number;                // Maximum height
  fixedWidth?: number;               // Fixed width
  fixedHeight?: number;              // Fixed height

  // Spacing configuration
  gapX?: number;                     // Horizontal gap
  gapY?: number;                     // Vertical gap

  // Grid configuration
  cols?: number;                     // Number of grid columns

  // Random configuration
  randomColors?: boolean;            // Random colors
  randomSizes?: boolean;             // Random sizes
  randomRotation?: boolean;          // Random rotation
}

// Batch generation configuration
export interface BatchGenerateConfig {
  graphics: GraphicConfig[];         // Multiple graphic configurations
  layoutMode?: LayoutMode;           // Overall layout
}

// Generation result
export interface GenerateResult {
  graphics: IGraphic[];              // Generated graphic array
  duration: number;                  // Generation time (milliseconds)
  count: number;                     // Actual number generated
}

// Grid options
export interface GridOptions {
  startX?: number;
  startY?: number;
  cols?: number;
  gapX?: number;
  gapY?: number;
  width?: number;
  height?: number;
}

// Random options
export interface RandomOptions {
  areaWidth?: number;
  areaHeight?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  randomColors?: boolean;
  randomSizes?: boolean;
  randomRotation?: boolean;
}
