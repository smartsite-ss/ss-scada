// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

export const VIEWPORT = {
  PADDING: 30,
  SCALE_MIN: 20,
  SCALE_MAX: 300,
  ZOOM_STEP: 1.05,
  /** Preview-mode Ctrl+wheel zoom factor (zoom in) */
  PREVIEW_WHEEL_ZOOM_IN: 1.2,
  /** Preview-mode Ctrl+wheel zoom factor (zoom out, kept as the approximate inverse of the zoom-in factor) */
  PREVIEW_WHEEL_ZOOM_OUT: 0.8,
  FIT_MARGIN: 0.9,
  /** Preview/runtime fit margin: explicitly no margin (edit mode uses PADDING=30; the difference between the two modes is by design, see optimization plan #98 C1) */
  PREVIEW_MARGIN: 0,
  INIT_RETRY_DELAYS: [50, 150, 300],
  /** Preview-mode zero-size retry delay (aligned with edit mode's INIT_RETRY_DELAYS, optimization plan P1-2) */
  PREVIEW_INIT_RETRY_DELAYS: [50, 150, 300],
  /** Preview-mode zero-size fallback retry cap (stops retrying beyond this to avoid an infinite loop) */
  PREVIEW_INIT_MAX_RETRIES: 5,
  /** Bitmap resolution cap: fallback to contain when the widget-mode fitWidth/fitHeight expanded bitmap exceeds it (optimization plan P1-3, aligned with the Canvas/WebGL safe caps) */
  MAX_BITMAP_SIZE: 8192,
  /** Edit-mode canvas scroll layer padding around content (PluginLayerManager padding; different purpose from the JS-layer PADDING but likewise a single constant source, optimization plan P2-4) */
  LAYER_PADDING: 20,
  MOVE_THRESHOLD: 3,
  RESIZE_THRESHOLD: 3,
  DEFAULT_CANVAS_WIDTH: 1920,
  DEFAULT_CANVAS_HEIGHT: 1080,
} as const;

export function calculateFitScale(
  containerWidth: number,
  containerHeight: number,
  pageWidth: number,
  pageHeight: number,
  scaleMin: number = VIEWPORT.SCALE_MIN,
): number {
  const availableW = containerWidth - VIEWPORT.PADDING * 2;
  const availableH = containerHeight - VIEWPORT.PADDING * 2;
  if (availableW <= 0 || availableH <= 0) return 1;
  const scaleX = availableW / pageWidth;
  const scaleY = availableH / pageHeight;
  const rawScale = Math.min(scaleX, scaleY, 1);
  return Math.max(scaleMin / 100, rawScale * VIEWPORT.FIT_MARGIN);
}