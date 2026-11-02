// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { ExpressionTrigger } from '../types/script.types';
import { ScriptEngine } from './ScriptEngine';

/**
 * Expression trigger
 * Parses conditions from expressions; triggers scripts when tag value changes satisfy the condition
 */
export class ExpressionTriggerManager {
  private static instance: ExpressionTriggerManager;
  private triggers: Map<string, ExpressionTrigger> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private engine: ScriptEngine;
  private eventBus: any = null;
  private dataChangeUnsubscribe: (() => void) | null = null;

  constructor() {
    this.engine = ScriptEngine.getInstance();
  }

  static getInstance(): ExpressionTriggerManager {
    if (!ExpressionTriggerManager.instance) {
      ExpressionTriggerManager.instance = new ExpressionTriggerManager();
    }
    return ExpressionTriggerManager.instance;
  }

  /**
   * Set the event bus, used to auto-subscribe to data:changed events
   */
  setEventBus(bus: any): void {
    this.eventBus = bus;
    this.subscribeToDataChange();
  }

  /**
   * Register an expression trigger
   */
  register(config: Omit<ExpressionTrigger, 'lastEvaluatedAt' | 'lastTriggeredAt'>): ExpressionTrigger {
    const trigger: ExpressionTrigger = {
      ...config,
      lastEvaluatedAt: undefined,
      lastTriggeredAt: undefined,
    };
    this.triggers.set(trigger.id, trigger);
    return trigger;
  }

  /** Unregister a trigger */
  unregister(triggerId: string): void {
    this.triggers.delete(triggerId);
    const timer = this.debounceTimers.get(triggerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.debounceTimers.delete(triggerId);
    }
  }

  /**
   * When a tag value changes, evaluate all matching triggers
   */
  evaluate(tagId: string, tagValue: any): void {
    for (const trigger of this.triggers.values()) {
      if (!trigger.enabled) continue;
      if (!trigger.tagIds.includes(tagId)) continue;

      trigger.lastEvaluatedAt = Date.now();

      // Debounce handling
      const existingTimer = this.debounceTimers.get(trigger.id);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        this.debounceTimers.delete(trigger.id);
        if (this.evaluateExpression(trigger.expression, tagValue)) {
          trigger.lastTriggeredAt = Date.now();
          this.engine.executeAsync(trigger.scriptId, 'expression').catch((err) => {
            console.error(`ExpressionTrigger: script ${trigger.scriptId} execution failed:`, err);
          });
        }
      }, trigger.debounceMs);

      this.debounceTimers.set(trigger.id, timer);
    }
  }

  /**
   * Auto-subscribe to data:changed events; triggers with tagIds config are automatically listened
   * When trigger.type === 'datachange', a data change listener is auto-registered
   */
  private subscribeToDataChange(): void {
    if (!this.eventBus) return;

    // Cancel the previous subscription
    this.dataChangeUnsubscribe?.();

    this.dataChangeUnsubscribe = this.eventBus.on?.('data:changed', (payload: any) => {
      const { tagId, value } = payload ?? {};
      if (tagId === undefined) return;

      // Find all triggers matching this tagId
      for (const trigger of this.triggers.values()) {
        if (!trigger.enabled) continue;
        if (!trigger.tagIds.includes(tagId)) continue;

        trigger.lastEvaluatedAt = Date.now();

        // Debounce handling
        const existingTimer = this.debounceTimers.get(trigger.id);
        if (existingTimer !== undefined) {
          clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
          this.debounceTimers.delete(trigger.id);
          if (this.evaluateExpression(trigger.expression, value)) {
            trigger.lastTriggeredAt = Date.now();
            this.engine.executeAsync(trigger.scriptId, 'datachange').catch((err) => {
              console.error(`ExpressionTrigger[datachange]: script ${trigger.scriptId} failed:`, err);
            });
          }
        }, trigger.debounceMs);

        this.debounceTimers.set(trigger.id, timer);
      }
    });
  }

  /**
   * Evaluate whether an expression satisfies the condition
   * Example: expression = "value > 80" → pass { value: 85 } → true
   */
  private evaluateExpression(expression: string, tagValue: any): boolean {
    try {
      const fn = new Function('value', `return ${expression}`);
      return Boolean(fn(tagValue));
    } catch {
      return false;
    }
  }

  /** Get all triggers */
  getAll(): ExpressionTrigger[] {
    return Array.from(this.triggers.values());
  }

  /** Cleanup */
  destroy(): void {
    this.dataChangeUnsubscribe?.();
    this.dataChangeUnsubscribe = null;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.triggers.clear();
  }
}