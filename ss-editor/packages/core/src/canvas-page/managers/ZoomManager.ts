// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { i18n } from '../../locales';

// Asserted as (key: string) => string via unknown: avoids vue-i18n's deep type
// instantiation of the messages literal schema (TS2589)
const t = (key: string): string =>
  (i18n.global as unknown as { t: (key: string) => string }).t('zoomManager.' + key);

/**
 * Zoom mode
 */
export enum ZoomMode {
  MOUSE_CENTER = 'mouse-center',
  CANVAS_CENTER = 'canvas-center',
  TOP_LEFT = 'top-left'
}

/**
 * Fit mode
 */
export type FitMode = 'auto' | 'contain' | 'fitWidth' | 'fitHeight' | 'stretch';

/**
 * Fit mode configuration
 */
export interface FitModeConfig {
  mode: FitMode;
  label: string;
  description: string;
}

/**
 * Fit mode options list
 */
export const fitModeOptions: FitModeConfig[] = [
  { mode: 'auto', label: t('fitModes.auto.label'), description: t('fitModes.auto.description') },
  { mode: 'contain', label: t('fitModes.contain.label'), description: t('fitModes.contain.description') },
  { mode: 'fitWidth', label: t('fitModes.fitWidth.label'), description: t('fitModes.fitWidth.description') },
  { mode: 'fitHeight', label: t('fitModes.fitHeight.label'), description: t('fitModes.fitHeight.description') },
  { mode: 'stretch', label: t('fitModes.stretch.label'), description: t('fitModes.stretch.description') },
];

/**
 * Auto-fit strategy configuration
 */
export interface AutoFitConfig {
  enabled: boolean;           // Whether auto-fit is enabled
  debounceDelay: number;      // Debounce delay (ms)
  minAspectRatio: number;     // Minimum aspect ratio for Y-axis fill
  maxAspectRatio: number;     // Maximum aspect ratio for X-axis fill
}

/**
 * Scale range (percentage), used to override ZoomManager's internal defaults (10~200)
 */
export interface ScaleRange {
  minScale: number;
  maxScale: number;
}

/**
 * Default auto-fit configuration
 */
export const defaultAutoFitConfig: AutoFitConfig = {
  enabled: true,
  debounceDelay: 300,
  minAspectRatio: 1.0,
  maxAspectRatio: 1.5
};

/**
 * Zoom management class
 */
export class ZoomManager {
  private static defaultMinScale = 10;
  private static defaultMaxScale = 200;
  private static defaultStep = 10;

  /**
   * Compute the offset after zooming
   * @param currentScale Current scale
   * @param newScale New scale
   * @param zoomMode Zoom mode
   * @param mouseX Mouse X coordinate
   * @param mouseY Mouse Y coordinate
   * @param canvasWidth Canvas width
   * @param canvasHeight Canvas height
   * @returns New offset
   */
  public static calculateZoomOffset(
    currentScale: number,
    newScale: number,
    zoomMode: ZoomMode,
    mouseX: number,
    mouseY: number,
    canvasWidth: number,
    canvasHeight: number
  ): { offsetX: number; offsetY: number } {
    let offsetX = 0;
    let offsetY = 0;

    const scaleRatio = newScale / currentScale;

    switch (zoomMode) {
      case ZoomMode.MOUSE_CENTER:
        // Zoom centered on mouse position
        offsetX = mouseX - (mouseX * scaleRatio);
        offsetY = mouseY - (mouseY * scaleRatio);
        break;

      case ZoomMode.CANVAS_CENTER:
        // Zoom centered on canvas center
        const canvasCenterX = canvasWidth / 2;
        const canvasCenterY = canvasHeight / 2;
        offsetX = canvasCenterX - (canvasCenterX * scaleRatio);
        offsetY = canvasCenterY - (canvasCenterY * scaleRatio);
        break;

      case ZoomMode.TOP_LEFT:
        // Zoom centered on top-left corner
        offsetX = 0;
        offsetY = 0;
        break;
    }

    return { offsetX, offsetY };
  }

  /**
   * Clamp the scale range
   * @param scale Current scale
   * @param minScale Minimum scale
   * @param maxScale Maximum scale
   * @returns Clamped scale
   */
  public static clampScale(scale: number, minScale = this.defaultMinScale, maxScale = this.defaultMaxScale): number {
    return Math.max(minScale, Math.min(maxScale, scale));
  }

  /**
   * Compute the canvas size after scaling
   * @param originalWidth Original width
   * @param originalHeight Original height
   * @param scale Scale
   * @returns Scaled size
   */
  public static calculateScaledSize(originalWidth: number, originalHeight: number, scale: number): { width: number; height: number } {
    return {
      width: originalWidth * (scale / 100),
      height: originalHeight * (scale / 100)
    };
  }

  /**
   * Compute the scaled point coordinates
   * @param x Original X coordinate
   * @param y Original Y coordinate
   * @param scale Scale
   * @returns Scaled coordinates
   */
  public static scalePoint(x: number, y: number, scale: number): { x: number; y: number } {
    return {
      x: x * (scale / 100),
      y: y * (scale / 100)
    };
  }

  /**
   * Compute the unscaled point coordinates
   * @param x Scaled X coordinate
   * @param y Scaled Y coordinate
   * @param scale Scale
   * @returns Original coordinates
   */
  public static unscalePoint(x: number, y: number, scale: number): { x: number; y: number } {
    return {
      x: x / (scale / 100),
      y: y / (scale / 100)
    };
  }

  /**
   * Get the default zoom parameters
   * @returns Default zoom parameters
   */
  public static getDefaultZoomParams(): { minScale: number; maxScale: number; step: number } {
    return {
      minScale: this.defaultMinScale,
      maxScale: this.defaultMaxScale,
      step: this.defaultStep
    };
  }

  /**
   * Set the default zoom parameters
   * @param minScale Minimum scale
   * @param maxScale Maximum scale
   * @param step Zoom step
   */
  public static setDefaultZoomParams(minScale: number, maxScale: number, step: number): void {
    this.defaultMinScale = minScale;
    this.defaultMaxScale = maxScale;
    this.defaultStep = step;
  }

  /**
   * Automatically select a fit mode based on the screen aspect ratio
   * @param aspectRatio Screen aspect ratio
   * @param config Auto-fit configuration
   * @returns Fit mode
   */
  public static autoSelectFitMode(aspectRatio: number, config: AutoFitConfig = defaultAutoFitConfig): FitMode {
    if (aspectRatio < config.minAspectRatio) {
      return 'fitHeight';      // Portrait: fill Y axis
    } else if (aspectRatio < config.maxAspectRatio) {
      return 'contain';        // Near square: fit proportionally
    } else {
      return 'fitWidth';       // Landscape: fill X axis
    }
  }

  /**
   * Compute the scale for a given fit mode
   * @param fitMode Fit mode
   * @param contentWidth Content width
   * @param contentHeight Content height
   * @param viewportWidth Window width
   * @param viewportHeight Window height
   * @returns Scale (percentage)
   */
  public static calculateFitScale(
    fitMode: FitMode,
    contentWidth: number,
    contentHeight: number,
    viewportWidth: number,
    viewportHeight: number
  ): number {
    let scaleX = 100;
    let scaleY = 100;

    switch (fitMode) {
      case 'contain':
        // Scale proportionally, take the smaller value
        scaleX = (viewportWidth / contentWidth) * 100;
        scaleY = (viewportHeight / contentHeight) * 100;
        return Math.min(scaleX, scaleY);

      case 'fitWidth':
        // Fill X axis
        return (viewportWidth / contentWidth) * 100;

      case 'fitHeight':
        // Fill Y axis
        return (viewportHeight / contentHeight) * 100;

      case 'stretch':
        // Stretch without preserving ratio (not recommended)
        scaleX = (viewportWidth / contentWidth) * 100;
        scaleY = (viewportHeight / contentHeight) * 100;
        // Return the average value as reference
        return (scaleX + scaleY) / 2;

      default:
        return 100;
    }
  }

  /**
   * Automatically compute the best scale based on window size
   * @param contentWidth Content width
   * @param contentHeight Content height
   * @param viewportWidth Window width
   * @param viewportHeight Window height
   * @param config Auto-fit configuration
   * @returns Result containing fit mode and scale
   */
  public static calculateAutoFitScale(
    contentWidth: number,
    contentHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    config: AutoFitConfig = defaultAutoFitConfig,
    scaleRange?: ScaleRange,
  ): { fitMode: FitMode; scale: number } {
    // Compute screen aspect ratio
    const aspectRatio = viewportWidth / viewportHeight;

    // Auto-select fit mode
    const fitMode = this.autoSelectFitMode(aspectRatio, config);

    // Compute scale
    const scale = this.calculateFitScale(
      fitMode,
      contentWidth,
      contentHeight,
      viewportWidth,
      viewportHeight
    );

    // Clamp the scale (fall back to internal defaults when scaleRange is not passed)
    const clampedScale = this.clampScale(
      scale,
      scaleRange?.minScale,
      scaleRange?.maxScale,
    );

    return { fitMode, scale: clampedScale };
  }

  /**
   * Compute the scale based on the current fit mode (supports auto mode)
   * @param currentFitMode Current fit mode
   * @param contentWidth Content width
   * @param contentHeight Content height
   * @param viewportWidth Window width
   * @param viewportHeight Window height
   * @param config Auto-fit configuration
   * @returns Result containing the actual fit mode and scale
   */
  public static calculateScaleByMode(
    currentFitMode: FitMode,
    contentWidth: number,
    contentHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    config: AutoFitConfig = defaultAutoFitConfig,
    scaleRange?: ScaleRange,
  ): { fitMode: FitMode; scale: number } {
    if (currentFitMode === 'auto') {
      // If auto mode, use auto-fit
      return this.calculateAutoFitScale(
        contentWidth,
        contentHeight,
        viewportWidth,
        viewportHeight,
        config,
        scaleRange,
      );
    } else {
      // If manually selected mode, compute scale directly
      // (fall back to internal defaults when scaleRange is not passed)
      const scale = this.clampScale(
        this.calculateFitScale(
          currentFitMode,
          contentWidth,
          contentHeight,
          viewportWidth,
          viewportHeight
        ),
        scaleRange?.minScale,
        scaleRange?.maxScale,
      );
      return { fitMode: currentFitMode, scale };
    }
  }

  /**
   * Get the fit mode suggestion for the current screen
   * @param config Auto-fit configuration
   * @returns Fit mode
   */
  public static getCurrentScreenFitMode(config: AutoFitConfig = defaultAutoFitConfig): FitMode {
    if (typeof window === 'undefined') {
      return 'contain'; // Default to proportional fit
    }
    const aspectRatio = window.innerWidth / window.innerHeight;
    return this.autoSelectFitMode(aspectRatio, config);
  }

  /**
   * Determine whether the screen is portrait
   * @returns Whether portrait
   */
  public static isPortrait(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.innerWidth < window.innerHeight;
  }

  /**
   * Determine whether the screen is wide
   * @param threshold Wide-screen threshold, default 1.5
   * @returns Whether wide-screen
   */
  public static isWideScreen(threshold: number = 1.5): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.innerWidth / window.innerHeight >= threshold;
  }
}
