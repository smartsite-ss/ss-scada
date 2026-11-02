// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Timer-related type definitions
 */

/**
 * Configuration for a single timer
 */
export interface ITimerConfig {
  id: string;                    // Unique timer ID
  name: string;                  // Timer name
  enabled: boolean;              // Whether enabled
  interval: number;              // Execution interval (ms)
  script: string;                // JavaScript script content
  type: 'interval' | 'timeout';  // Timer type
  repeatCount?: number;          // Repeat count (only valid for timeout type)
  lastExecuteTime?: number;      // Last execution time
  executeCount?: number;         // Execution count
}

/**
 * Page timer context
 */
export interface ITimerContext {
  page: any;                     // Current page object
  getGraphics: () => any[];      // Get all graphics
  getGraphicById: (id: string) => any | null; // Get a graphic by ID
  updateGraphicProperty: (id: string, propertyPath: string, value: any) => void; // Update graphic property
  refreshDisplay: () => void;    // Refresh display
}

/**
 * Timer execution result
 */
export interface ITimerExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  timestamp: number;
}

/**
 * Default timer configuration
 */
export const DEFAULT_TIMER_CONFIG: Partial<ITimerConfig> = {
  name: 'New Timer',
  enabled: true,
  interval: 1000,
  script: '// 在这里写你的脚本\n// 示例: page.getGraphicById("id")',
  type: 'interval',
  executeCount: 0,
};
