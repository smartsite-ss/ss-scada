// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import type { IEvent, IEventAction, IEventCondition, EventContext, EventType } from '@scada-editor/plugin-sdk';
import type { IGraphic } from '@scada-editor/plugin-sdk';

/**
 * Event debounce config (ms)
 */
const DEBOUNCE_CONFIG: Partial<Record<EventType, number>> = {
  click: 0,
  dblclick: 0,
  mouseenter: 300,
  mouseleave: 300,
  vnodeMounted: 0,
  vnodeBeforeMount: 0,
};

/**
 * Action executor interface
 * Allows injecting different runtime (edit mode / runtime mode) action implementations
 */
export interface ActionExecutor {
  /** Execute a custom script */
  executeScript(script: string, context: EventContext): void | Promise<void>;
  /** Call an API */
  callApi(target: string, value: any, context: EventContext): void | Promise<void>;
  /** Execute a built-in script method */
  executeBuiltinScript(target: string, value: any, context: EventContext): void;
  /** Show a graphic */
  showGraphic(target: string): void;
  /** Hide a graphic */
  hideGraphic(target: string): void;
  /** Modify a property */
  changeProperty(target: string, value: any): void;
  /** Navigate to a page */
  navigateTo(target: string): void;
  /** Show a toast */
  showAlert(value: any): void;
}

/**
 * Default no-op executor (edit mode; does not perform actual actions)
 */
const NOOP_EXECUTOR: ActionExecutor = {
  executeScript() {},
  callApi() {},
  executeBuiltinScript() {},
  showGraphic() {},
  hideGraphic() {},
  changeProperty() {},
  navigateTo() {},
  showAlert() {},
};

/**
 * EventExecutionEngine — event interaction engine
 *
 * Responsibilities:
 * 1. Register/unregister DOM event listeners for graphics
 * 2. Manage Vue lifecycle events (vnodeMounted / vnodeBeforeMount)
 * 3. Condition evaluation (AND logic)
 * 4. Action dispatch (8 action types)
 * 5. High-frequency event debouncing
 *
 * Edit mode and runtime mode differentiate behavior by injecting different ActionExecutors
 */
export class EventExecutionEngine {
  private static instance: EventExecutionEngine;

  /** Registered DOM event listener references (for cleanup) */
  private _domListeners: Map<string, Array<{ type: EventType; element: HTMLElement; handler: EventListener }>> = new Map();

  /** Debounce timer */
  private _debounceTimers: Map<string, number> = new Map();

  /** Action executor */
  private _executor: ActionExecutor = NOOP_EXECUTOR;

  /** Debug mode */
  private _debug = false;

  static getInstance(): EventExecutionEngine {
    if (!EventExecutionEngine.instance) {
      EventExecutionEngine.instance = new EventExecutionEngine();
    }
    return EventExecutionEngine.instance;
  }

  /**
   * Set the action executor
   * - Edit mode: inject NOOP_EXECUTOR or a log-only executor
   * - Runtime mode: inject the actual action executor
   */
  setExecutor(executor: Partial<ActionExecutor>): void {
    this._executor = { ...NOOP_EXECUTOR, ...executor };
  }

  /** Enable/disable debug mode */
  setDebug(enabled: boolean): void {
    this._debug = enabled;
  }

  /**
   * Register all event listeners for a graphic
   * Called after the runtime graphic is mounted
   */
  registerGraphicEvents(graphic: IGraphic, element: HTMLElement): void {
    const graphicId = graphic.id;
    // Clean up old listeners first
    this.unregisterGraphicEvents(graphicId);

    const eventHandlers = graphic.events?.eventHandlers;
    if (!eventHandlers) return;

    const listeners: Array<{ type: EventType; element: HTMLElement; handler: EventListener }> = [];

    for (const [eventType, eventDef] of Object.entries(eventHandlers)) {
      const evt = eventDef as IEvent;
      if (!evt || !evt.actions || evt.actions.length === 0) continue;

      const typedEventType = eventType as EventType;

      if (typedEventType === 'vnodeMounted' || typedEventType === 'vnodeBeforeMount') {
        // Lifecycle events do not register DOM listeners; they are triggered by Vue component hooks
        continue;
      }

      const handler = this._createDOMHandler(graphic, evt, typedEventType);
      const domEventType = this._toDOMEventType(typedEventType);
      if (domEventType) {
        element.addEventListener(domEventType, handler);
        listeners.push({ type: typedEventType, element, handler });
      }
    }

    this._domListeners.set(graphicId, listeners);
    this._log(`[EventEngine] Registered ${listeners.length} DOM listeners for graphic "${graphicId}"`);
  }

  /**
   * Unregister all event listeners of a graphic
   */
  unregisterGraphicEvents(graphicId: string): void {
    const listeners = this._domListeners.get(graphicId);
    if (listeners) {
      for (const { type, element, handler } of listeners) {
        const domEventType = this._toDOMEventType(type);
        if (domEventType) {
          element.removeEventListener(domEventType, handler);
        }
      }
      this._domListeners.delete(graphicId);
    }
    // Clean up the debounce timer
    const timerKey = `${graphicId}:debounce`;
    const timer = this._debounceTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this._debounceTimers.delete(timerKey);
    }
  }

  /**
   * Trigger lifecycle events (vnodeMounted / vnodeBeforeMount)
   * Called by Vue component hooks
   */
  triggerLifecycleEvent(graphic: IGraphic, eventType: 'vnodeMounted' | 'vnodeBeforeMount'): void {
    const eventHandlers = graphic.events?.eventHandlers;
    if (!eventHandlers) return;

    const eventDef = eventHandlers[eventType] as IEvent | undefined;
    if (!eventDef || !eventDef.actions || eventDef.actions.length === 0) return;

    this._log(`[EventEngine] Triggering lifecycle event "${eventType}" for graphic "${graphic.id}"`);

    const context = this._buildContext(graphic, eventType, {});
    this._executeActions(eventDef.actions, context);
  }

  /**
   * Evaluate the condition list (AND logic)
   * All conditions must be satisfied to return true
   */
  evaluateConditions(conditions: IEventCondition[], context: EventContext): boolean {
    if (!conditions || conditions.length === 0) return true;

    return conditions.every((cond) => {
      const actualValue = this._getNestedValue(context, cond.field);
      return this._compareValues(actualValue, cond.operator, cond.value);
    });
  }

  /**
   * Execute the action list
   */
  executeActions(actions: IEventAction[], context: EventContext): void {
    this._executeActions(actions, context);
  }

  // ─── Private methods ───

  /** Create a DOM event handler (with debouncing) */
  private _createDOMHandler(
    graphic: IGraphic,
    eventDef: IEvent,
    eventType: EventType,
  ): EventListener {
    return (domEvent: Event) => {
      const debounceMs = DEBOUNCE_CONFIG[eventType] ?? 0;

      const execute = () => {
        const context = this._buildContext(graphic, eventType, domEvent);
        this._executeActions(eventDef.actions, context);
      };

      if (debounceMs > 0) {
        const key = `${graphic.id}:debounce`;
        const existing = this._debounceTimers.get(key);
        if (existing) clearTimeout(existing);
        this._debounceTimers.set(key, window.setTimeout(execute, debounceMs));
      } else {
        execute();
      }
    };
  }

  /** Build the event execution context */
  private _buildContext(graphic: IGraphic, eventType: EventType, domEvent: any): EventContext {
    return {
      graphic: {
        id: graphic.id,
        type: graphic.type,
        config: graphic.config,
        customProps: graphic.config?.customProps || {},
      },
      event: {
        type: eventType,
        timestamp: Date.now(),
        payload: domEvent
          ? {
              clientX: domEvent.clientX,
              clientY: domEvent.clientY,
              pageX: domEvent.pageX,
              pageY: domEvent.pageY,
              target: domEvent.target,
            }
          : {},
      },
      graphics: [],
      dataSource: (graphic as any).dataSource,
    };
  }

  /** Execute the action list */
  private _executeActions(actions: IEventAction[], context: EventContext): void {
    for (const action of actions) {
      try {
        // Condition evaluation
        if (action.conditions && action.conditions.length > 0) {
          if (!this.evaluateConditions(action.conditions, context)) {
            this._log(`[EventEngine] Conditions not met for action "${action.id}", skipping`);
            continue;
          }
        }

        this._dispatchAction(action, context);
      } catch (err) {
        console.error(`[EventEngine] Error executing action "${action.id}":`, err);
      }
    }
  }

  /** Dispatch a single action */
  private _dispatchAction(action: IEventAction, context: EventContext): void {
    this._log(`[EventEngine] Dispatching action "${action.actionType}" (id: ${action.id})`);

    switch (action.actionType) {
      case 'customScript':
        if (action.script) {
          this._executor.executeScript(action.script, context);
        }
        break;

      case 'api':
        this._executor.callApi(action.target, action.value, context);
        break;

      case 'script':
        this._executor.executeBuiltinScript(action.target, action.value, context);
        break;

      case 'show':
        this._executor.showGraphic(action.target);
        break;

      case 'hide':
        this._executor.hideGraphic(action.target);
        break;

      case 'change':
        this._executor.changeProperty(action.target, action.value);
        break;

      case 'navigate':
        this._executor.navigateTo(action.target);
        break;

      case 'alert':
        this._executor.showAlert(action.value);
        break;

      default:
        this._log(`[EventEngine] Unknown action type: "${action.actionType}"`);
    }
  }

  /** Get a nested property value */
  private _getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }

  /** Compare values */
  private _compareValues(actual: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'equal': return actual === expected;
      case 'notEqual': return actual !== expected;
      case 'greaterThan': return Number(actual) > Number(expected);
      case 'lessThan': return Number(actual) < Number(expected);
      case 'greaterThanOrEqual': return Number(actual) >= Number(expected);
      case 'lessThanOrEqual': return Number(actual) <= Number(expected);
      case 'contains': return String(actual).includes(String(expected));
      case 'notContains': return !String(actual).includes(String(expected));
      default: return false;
    }
  }

  /** EventType → DOM event name mapping */
  private _toDOMEventType(eventType: EventType): string | null {
    switch (eventType) {
      case 'click': return 'click';
      case 'dblclick': return 'dblclick';
      case 'mouseenter': return 'mouseenter';
      case 'mouseleave': return 'mouseleave';
      case 'vnodeMounted':
      case 'vnodeBeforeMount':
        return null; // lifecycle events do not map to DOM events
      default: return null;
    }
  }

  private _log(message: string): void {
    if (this._debug) {
      console.debug(message);
    }
  }
}