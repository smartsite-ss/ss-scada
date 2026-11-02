// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { GraphicData, GraphicContext, IGraphicDataReceiver, DataPointMap } from '../types/graphic-data.types';
import type { QualityCode } from '../types/quality.types';
import type { DataInputPayload, DataAction } from '../types/pipeline.types';
import { ScriptEngine } from '../engine/ScriptEngine';

/**
 * EventBus interface - decouples BindingManager from the EventBus implementation's circular dependency
 */
export interface ScadaEventBusLike {
  on(eventType: string, callback: (event: { payload: unknown }) => void): () => void;
  off(eventType: string, callback: (event: { payload: unknown }) => void): void;
}

/**
 * Tag subscription handler interface - decouples the core/system circular dependency
 * Injected by the upper layer (e.g. the system module)
 */
export interface TagSubscriptionHandler {
  subscribeTags(tagIds: string[]): void;
  unsubscribeTags(tagIds: string[]): void;
}

/**
 * GraphicStore accessor interface - decouples BindingManager from graphic.store's circular dependency
 * Injected by the upper layer (e.g. main.ts), avoiding TDZ errors caused by barrel exports
 */
export interface GraphicStoreAccessor {
  applyProperty(graphicId: string, propertyPath: string, value: any): void;
  applyQualityIndicator(graphicId: string, quality: string): void;
  bindData(graphicId: string, dataSource: string, dataField: string): void;
  unbindData(graphicId: string): void;
  /** Get the graphic instance (to call onDataInput, Phase 15.2 full data pipeline integration) */
  getGraphicInstance?(graphicId: string): { onDataInput?(payload: DataInputPayload): void } | undefined;
}

export interface TagBinding {
  graphicId: string;
  tagId: string;
  tagName: string;
  propertyPath: string;
  bindingMode: 'simple' | 'expression';
  expression?: string;
  format?: string;
}

export interface BindingSnapshot {
  graphicId: string;
  bindings: TagBinding[];
}

export class BindingManager {
  private static instance: BindingManager;
  /** Tag subscription handler - injected by the upper layer, avoiding circular dependencies */
  private static _tagHandler: TagSubscriptionHandler | null = null;
  /** GraphicStore accessor - injected by the upper layer, avoiding circular dependencies */
  private static _graphicStore: GraphicStoreAccessor | null = null;
  /** EventBus unsubscribe function */
  private static _unsubscribeEventBus: (() => void) | null = null;
  private bindings = new Map<string, TagBinding[]>();
  private tagReferenceCount = new Map<string, number>();
  private _receivers: Map<string, IGraphicDataReceiver> = new Map();
  private _graphicContexts: Map<string, GraphicContext> = new Map();

  /** Set the tag subscription handler (called by the system module at init) */
  static setTagHandler(handler: TagSubscriptionHandler | null): void {
    BindingManager._tagHandler = handler;
  }

  /** Set the GraphicStore accessor (called by main.ts at init, resolving circular dependencies) */
  static setGraphicStore(store: GraphicStoreAccessor | null): void {
    BindingManager._graphicStore = store;
  }

  /** Get the GraphicStore accessor (used by DataPipelineBridge when constructing DriverScriptAPI) */
  static getGraphicStore(): GraphicStoreAccessor | null {
    return BindingManager._graphicStore;
  }

  /** Set EventBus (called by ScadaDataManager at init, unifying data dispatch) */
  static setEventBus(eventBus: ScadaEventBusLike | null): void {
    // Cancel the old listener first
    if (BindingManager._unsubscribeEventBus) {
      BindingManager._unsubscribeEventBus();
      BindingManager._unsubscribeEventBus = null;
    }

    if (eventBus) {
      const callback = (event: { payload: unknown }) => {
        const payload = event.payload as Record<string, unknown> | undefined;
        if (payload?.tagId && payload?.value !== undefined) {
          const tagId = payload.tagId as string;
          const quality = (payload.quality as string) || 'good';
          const value = payload.value;
          BindingManager.getInstance().handleDataUpdate(tagId, value, quality as QualityCode);
        }
      };
      BindingManager._unsubscribeEventBus = eventBus.on('tagValueChanged', callback);
    }
  }

  static getInstance(): BindingManager {
    if (!BindingManager.instance) {
      BindingManager.instance = new BindingManager();
    }
    return BindingManager.instance;
  }

  static resetInstance(): void {
    BindingManager.instance = null as unknown as BindingManager;
  }

  registerReceiver(graphicId: string, receiver: IGraphicDataReceiver, context: GraphicContext): void {
    this._receivers.set(graphicId, receiver);
    this._graphicContexts.set(graphicId, context);
  }

  unregisterReceiver(graphicId: string): void {
    this._receivers.delete(graphicId);
    this._graphicContexts.delete(graphicId);
  }

  onDataInput(graphicId: string, data: GraphicData): void {
    const receiver = this._receivers.get(graphicId);
    const context = this._graphicContexts.get(graphicId);
    if (receiver && context) {
      receiver.onDataInput(data, context);
    }
  }

  onBatchDataInput(dataMap: DataPointMap): void {
    for (const [tagId, dataPoint] of Object.entries(dataMap)) {
      const graphicBindings = this.getBindingsByTagId(tagId);
      for (const binding of graphicBindings) {
        this.onDataInput(binding.graphicId, dataPoint);
        this.handleDataUpdate(tagId, dataPoint.value as any, dataPoint.quality);
      }
    }
  }

  getReceiver(graphicId: string): IGraphicDataReceiver | undefined {
    return this._receivers.get(graphicId);
  }

  getGraphicContext(graphicId: string): GraphicContext | undefined {
    return this._graphicContexts.get(graphicId);
  }

  bind(
    graphicId: string,
    tagId: string,
    tagName: string,
    propertyPath: string | string[],
    options?: { bindingMode?: 'simple' | 'expression'; expression?: string; format?: string },
  ): void {
    // Supports propertyPath arrays: one tag bound to multiple graphic properties simultaneously
    // Internally expanded into multiple single-path bind calls; reference counting manages each path independently
    if (Array.isArray(propertyPath)) {
      for (const path of propertyPath) {
        this.bind(graphicId, tagId, tagName, path, options);
      }
      return;
    }

    const binding: TagBinding = {
      graphicId,
      tagId,
      tagName,
      propertyPath,
      bindingMode: options?.bindingMode || 'simple',
      expression: options?.expression,
      format: options?.format,
    };

    let graphicBindings = this.bindings.get(graphicId);
    if (!graphicBindings) {
      graphicBindings = [];
      this.bindings.set(graphicId, graphicBindings);
    }

    const existingIndex = graphicBindings.findIndex(
      (b) => b.tagId === tagId && b.propertyPath === propertyPath,
    );
    if (existingIndex >= 0) {
      graphicBindings[existingIndex] = binding;
    } else {
      graphicBindings.push(binding);
    }

    const refCount = this.tagReferenceCount.get(tagId) || 0;
    this.tagReferenceCount.set(tagId, refCount + 1);

    if (refCount === 0) {
      BindingManager._tagHandler?.subscribeTags([tagId]);
    }

    this.updateGraphicDataSource(graphicId, binding);
  }

  unbind(graphicId: string, tagId?: string, propertyPath?: string): void {
    const graphicBindings = this.bindings.get(graphicId);
    if (!graphicBindings) return;

    let removedBindings: TagBinding[] = [];

    if (tagId && propertyPath) {
      const idx = graphicBindings.findIndex(
        (b) => b.tagId === tagId && b.propertyPath === propertyPath,
      );
      if (idx >= 0) {
        removedBindings = graphicBindings.splice(idx, 1);
      }
    } else if (tagId) {
      removedBindings = graphicBindings.filter((b) => b.tagId === tagId);
      this.bindings.set(
        graphicId,
        graphicBindings.filter((b) => b.tagId !== tagId),
      );
    } else {
      removedBindings = [...graphicBindings];
      graphicBindings.length = 0;
    }

    for (const binding of removedBindings) {
      const refCount = this.tagReferenceCount.get(binding.tagId) || 0;
      if (refCount <= 1) {
        this.tagReferenceCount.delete(binding.tagId);
        const otherGraphicsHaveTag = Array.from(this.bindings.values()).some(
          (bList) => bList.some((b) => b.tagId === binding.tagId),
        );
        if (!otherGraphicsHaveTag) {
          BindingManager._tagHandler?.unsubscribeTags([binding.tagId]);
        }
      } else {
        this.tagReferenceCount.set(binding.tagId, refCount - 1);
      }
    }

    if (graphicBindings.length === 0) {
      this.bindings.delete(graphicId);
      this.clearGraphicDataSource(graphicId);
    }
  }

  /**
   * Compensating subscription: re-issue subscriptions for all currently bound tags.
   *
   * subscribeTags is silently dropped when WS is not connected (see ws.store),
   * while bind()'s internal reference count has already incremented, so it would not re-trigger the subscription;
   * this method is called after the "disconnected → connected" transition to re-issue lost subscriptions.
   */
  resyncTagSubscriptions(): void {
    const tagIds = Array.from(this.tagReferenceCount.keys());
    if (tagIds.length > 0) {
      BindingManager._tagHandler?.subscribeTags(tagIds);
    }
  }

  unbindAll(): void {
    const allTagIds = new Set<string>();
    this.tagReferenceCount.forEach((_, tagId) => allTagIds.add(tagId));

    if (allTagIds.size > 0) {
      BindingManager._tagHandler?.unsubscribeTags(Array.from(allTagIds));
    }

    this.bindings.clear();
    this.tagReferenceCount.clear();
    this._receivers.clear();
    this._graphicContexts.clear();
  }

  handleDataUpdate(tagId: string, value: any, quality: QualityCode): void {
    const graphicStore = BindingManager._graphicStore;
    if (!graphicStore) return;

    for (const [graphicId, graphicBindings] of this.bindings.entries()) {
      for (const binding of graphicBindings) {
        if (binding.tagId !== tagId) continue;

        let resolvedValue: any = value;

        if (binding.bindingMode === 'expression' && binding.expression) {
          resolvedValue = this.evaluateExpression(binding.expression, value);
        }

        if (binding.format) {
          resolvedValue = this.formatValue(resolvedValue, binding.format);
        }

        // Prefer the onDataInput full pipeline (Phase 15.2)
        // onDataInput internally calls setProperty/setStyle/setAlarmVisual/setQualityVisual
        const graphicInstance = graphicStore.getGraphicInstance?.(graphicId);
        if (graphicInstance?.onDataInput) {
          const payload = this._buildDataInputPayload(binding, resolvedValue, quality, tagId);
          graphicInstance.onDataInput(payload);
        } else {
          // fallback: applyProperty directly (backward compatible, when the graphic does not implement onDataInput)
          graphicStore.applyProperty(graphicId, binding.propertyPath, resolvedValue);
          if (quality !== 'good') {
            graphicStore.applyQualityIndicator(graphicId, quality);
          }
        }
      }
    }
  }

  /**
   * Build the DataInputPayload (Phase 15.2)
   * Converts a simple binding's propertyPath into a DataAction,
   * letting data go through the onDataInput → setProperty/setStyle full path.
   */
  private _buildDataInputPayload(
    binding: TagBinding,
    value: any,
    quality: QualityCode,
    tagId: string,
  ): DataInputPayload {
    const action = this._parsePropertyPathToAction(binding.propertyPath, value);
    return {
      source: `binding:${tagId}`,
      value,
      actions: action ? [action] : [],
      quality,
    };
  }

  /**
   * Parse a propertyPath into a DataAction
   * - config.customProps.text → { type: 'setProperty', target: 'text', value }
   * - config.style.borderColor → { type: 'setStyle', target: 'borderColor', value }
   * - Other paths → null (the caller falls back to applyProperty)
   */
  private _parsePropertyPathToAction(propertyPath: string, value: any): DataAction | null {
    if (propertyPath.startsWith('config.customProps.')) {
      const target = propertyPath.substring('config.customProps.'.length);
      return { type: 'setProperty', target, value };
    }
    if (propertyPath.startsWith('config.style.')) {
      const target = propertyPath.substring('config.style.'.length);
      return { type: 'setStyle', target, value };
    }
    return null;
  }

  handleBatchUpdate(updates: Array<{ tagId: string; value: any; quality: string }>): void {
    for (const update of updates) {
      this.handleDataUpdate(update.tagId, update.value, update.quality as QualityCode);
    }
  }

  getGraphicBindings(graphicId: string): TagBinding[] {
    return this.bindings.get(graphicId) || [];
  }

  getBindingsSnapshot(): BindingSnapshot[] {
    return Array.from(this.bindings.entries()).map(([graphicId, bindings]) => ({
      graphicId,
      bindings: [...bindings],
    }));
  }

  hasBinding(graphicId: string): boolean {
    const bindings = this.bindings.get(graphicId);
    return bindings !== undefined && bindings.length > 0;
  }

  getBoundTagIds(graphicId: string): string[] {
    return (this.bindings.get(graphicId) || []).map((b) => b.tagId);
  }

  private updateGraphicDataSource(graphicId: string, binding: TagBinding): void {
    BindingManager._graphicStore?.bindData(graphicId, binding.tagName, binding.propertyPath);
  }

  private clearGraphicDataSource(graphicId: string): void {
    BindingManager._graphicStore?.unbindData(graphicId);
  }

  private evaluateExpression(expression: string, value: any): any {
    // Go through ScriptEngine.evaluateExpression uniformly, enabling sandbox isolation (intercepting BLOCKED_GLOBALS + step limit)
    return ScriptEngine.getInstance().evaluateExpression(expression, value);
  }

  private formatValue(value: any, format: string): string {
    if (typeof value === 'number') {
      switch (format) {
        case 'number':
          return value.toString();
        case 'currency':
          return `¥${value.toFixed(2)}`;
        case 'percent':
          return `${(value * 100).toFixed(1)}%`;
        case 'decimal_1':
          return value.toFixed(1);
        case 'decimal_2':
          return value.toFixed(2);
        default:
          return value.toString();
      }
    }
    return String(value);
  }

  getBindingsByTagId(tagId: string): TagBinding[] {
    const result: TagBinding[] = [];
    for (const graphicBindings of this.bindings.values()) {
      for (const binding of graphicBindings) {
        if (binding.tagId === tagId) {
          result.push(binding);
        }
      }
    }
    return result;
  }

  getBindingsByGraphicId(graphicId: string): TagBinding[] {
    return this.getGraphicBindings(graphicId);
  }
}