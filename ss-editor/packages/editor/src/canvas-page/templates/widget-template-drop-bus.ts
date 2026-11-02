// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Component template drag-drop event bus
 *
 * Decouples the canvas (useDragDrop) from the component template panel (WidgetTemplatePanel):
 * when the canvas drop detects `application/x-widget-template`, it broadcasts the template id
 * and canvas logical coordinates via emitWidgetTemplateDrop; the panel subscribes and completes
 * reading/variable assignment/instantiation.
 */

export interface WidgetTemplateDropPayload {
  templateId: string;
  /** Canvas logical coordinates (already converted, without grid snapping) */
  logicalPos: { x: number; y: number };
}

export const WIDGET_TEMPLATE_MIME = 'application/x-widget-template';

type DropHandler = (payload: WidgetTemplateDropPayload) => void;

const handlers = new Set<DropHandler>();

export function emitWidgetTemplateDrop(payload: WidgetTemplateDropPayload): void {
  handlers.forEach((h) => {
    try {
      h(payload);
    } catch (err) {
      console.error('[WidgetTemplateDropBus] handler 执行失败', err);
    }
  });
}

/** Subscribe to drop events; returns an unsubscribe function */
export function onWidgetTemplateDrop(handler: DropHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
