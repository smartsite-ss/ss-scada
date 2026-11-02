// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EventType,
  DataPointChangedEvent,
  DeviceStatusChangedEvent,
  AlarmTriggeredEvent,
  AlarmAcknowledgedEvent,
  ConfigChangedEvent,
  ProcessingErrorEvent,
  HealthEvent,
  PluginLifecycleEvent,
} from './event-bus.types';
import { Logger } from '@nestjs/common';

/**
 * emit hook function type
 * - Listens to all event emissions
 * - Used by EventLogService to record event logs (does not block the main flow)
 */
export type EmitHook = (eventType: string, payload: any) => void | Promise<void>;

@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly listeners = new Map<string, Set<(data: any) => void>>();

  /** emit hook collection (used by EventLogService to record event logs) */
  private readonly emitHooks = new Set<EmitHook>();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  onModuleInit(): void {
    this.logger.log('EventBusService initialized');
  }

  onModuleDestroy(): void {
    this.logger.log('EventBusService destroyed');
  }

  emit<T extends EventType>(eventType: T, payload: any): void {
    try {
      // Fire emit hooks first (used by EventLogService to record event logs)
      // Synchronous call; async hooks run in the background; the logId is cached so subscribers can find it
      this.triggerEmitHooks(eventType, payload);
      // Then emit the event to subscribers
      this.eventEmitter.emit(eventType, payload);
      this.logEvent(eventType, payload);
    } catch (error) {
      this.logger.error(`Failed to emit event ${eventType}: ${error.message}`);
    }
  }

  /**
   * Emit an event asynchronously - returns after all async listeners complete
   * Used in scenarios that must ensure listeners finish resource cleanup before continuing (e.g. closing DB connections before project deletion)
   *
   * Note: emit hooks (writing the event log) fire before subscribers and are awaited,
   * so subscribers can find the corresponding logId via findRecentLogId.
   */
  async emitAsync<T extends EventType>(eventType: T, payload: any): Promise<void> {
    try {
      // Fire and await emit hooks first (writes the event log) so subscribers can find the logId
      await this.triggerEmitHooksAsync(eventType, payload);
      // Then run subscribers
      await this.eventEmitter.emitAsync(eventType, payload);
      this.logEvent(eventType, payload);
    } catch (error) {
      this.logger.error(`Failed to emit async event ${eventType}: ${error.message}`);
    }
  }

  /**
   * Register an emit hook - listens to all event emissions
   *
   * Called by EventLogService in onModuleInit to record config-change events.
   * Hooks may be sync or async; failures do not affect the main flow.
   *
   * @returns an unregister function that removes the hook when called
   */
  registerEmitHook(hook: EmitHook): () => void {
    this.emitHooks.add(hook);
    this.logger.debug(`Emit hook registered (total: ${this.emitHooks.size})`);
    return () => {
      this.emitHooks.delete(hook);
    };
  }

  /**
   * Fire all emit hooks (async, does not block the main flow)
   *
   * Used in the synchronous emit() path: hooks may run in the background (e.g. writing the event log),
   * returning without awaiting completion. Subscribers fall back to querying the DB via findRecentLogId.
   */
  private triggerEmitHooks(eventType: string, payload: any): void {
    if (this.emitHooks.size === 0) return;

    for (const hook of this.emitHooks) {
      try {
        const result = hook(eventType, payload);
        // If it is a Promise, catch errors but do not await
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            this.logger.warn(`Emit hook failed: ${err.message}`);
          });
        }
      } catch (err) {
        this.logger.warn(`Emit hook failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Fire all emit hooks and await completion (async)
   *
   * Used in the emitAsync() path: ensures the event log is written before subscribers run,
   * so subscribers can find the logId in the in-memory index via findRecentLogId.
   *
   * A single hook's failure does not affect other hooks; only a warn log is emitted.
   */
  private async triggerEmitHooksAsync(eventType: string, payload: any): Promise<void> {
    if (this.emitHooks.size === 0) return;

    const hookPromises: Promise<void>[] = [];
    for (const hook of this.emitHooks) {
      try {
        const result = hook(eventType, payload);
        if (result && typeof (result as Promise<void>).then === 'function') {
          // Wrap: a single hook's failure does not interrupt other hooks
          hookPromises.push(
            (result as Promise<void>).catch((err) => {
              this.logger.warn(`Emit hook failed: ${(err as Error).message}`);
            }),
          );
        }
      } catch (err) {
        this.logger.warn(`Emit hook failed: ${(err as Error).message}`);
      }
    }
    await Promise.all(hookPromises);
  }

  /**
   * Unified event-log output: prints the event type and key payload fields
   * Uses a plain-text [Event] prefix, consistent with StructuredLogger's [LEVEL]/[context] style,
   * avoiding emoji rendering issues in Windows consoles/log collection systems
   */
  private logEvent(eventType: string, payload: any): void {
    const summary = this.buildPayloadSummary(payload);
    this.logger.log(`[Event] ${eventType}${summary ? ` | ${summary}` : ''}`);
  }

  /**
   * Extract a readable summary from the payload (up to 3 key fields)
   */
  private buildPayloadSummary(payload: any): string {
    if (!payload || typeof payload !== 'object') return '';
    const parts: string[] = [];
    // Common identifier fields
    if (payload.tagId) parts.push(`tag=${payload.tagId}`);
    if (payload.deviceId) parts.push(`device=${payload.deviceId}`);
    if (payload.projectId) parts.push(`project=${payload.projectId}`);
    // Value fields: prefer the already-formatted displayValue, otherwise round numeric values
    if (payload.value !== undefined) {
      const displayVal =
        payload.displayValue ??
        (typeof payload.value === 'number' ? payload.value.toFixed(2) : payload.value);
      parts.push(`value=${displayVal}`);
    }
    if (payload.level) parts.push(`level=${payload.level}`);
    if (payload.status) parts.push(`status=${payload.status}`);
    // Alarm-specific
    if (payload.message && typeof payload.message === 'string') {
      parts.push(`msg=${payload.message.substring(0, 80)}`);
    }
    return parts.slice(0, 4).join(' ');
  }

  emitDataPointChanged(event: DataPointChangedEvent): void {
    this.emit('data_point_changed', event);
  }

  emitDeviceStatusChanged(event: DeviceStatusChangedEvent): void {
    this.emit('device_status_changed', event);
  }

  emitAlarmTriggered(event: AlarmTriggeredEvent): void {
    this.emit('alarm_triggered', event);
  }

  emitAlarmAcknowledged(event: AlarmAcknowledgedEvent): void {
    this.emit('alarm_acknowledged', event);
  }

  emitConfigChanged(event: ConfigChangedEvent): void {
    this.emit('config_changed', event);
  }

  emitProcessingError(event: ProcessingErrorEvent): void {
    this.emit('processing_error', event);
  }

  emitHealthDegraded(event: HealthEvent): void {
    this.emit('health_degraded', event);
  }

  emitHealthRecovered(event: HealthEvent): void {
    this.emit('health_recovered', event);
  }

  // ---- Plugin lifecycle events ----

  emitPluginDiscovered(event: PluginLifecycleEvent): void {
    this.emit('plugin.discovered', event);
  }

  emitPluginRegistered(event: PluginLifecycleEvent): void {
    this.emit('plugin.registered', event);
  }

  emitPluginActivated(event: PluginLifecycleEvent): void {
    this.emit('plugin.activated', event);
  }

  emitPluginDeactivated(event: PluginLifecycleEvent): void {
    this.emit('plugin.deactivated', event);
  }

  emitPluginError(event: PluginLifecycleEvent): void {
    this.emit('plugin.error', event);
  }

  emitPluginUnregistered(event: PluginLifecycleEvent): void {
    this.emit('plugin.unregistered', event);
  }

  emitPluginUpdated(event: PluginLifecycleEvent): void {
    this.emit('plugin.updated', event);
  }

  on<T extends EventType>(eventType: T, handler: (payload: any) => void): void {
    let handlers = this.listeners.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(eventType, handlers);
    }
    handlers.add(handler);
    this.eventEmitter.on(eventType, handler);
    this.logger.debug(`Registered listener for event: ${eventType}`);
  }

  once<T extends EventType>(eventType: T, handler: (payload: any) => void): void {
    this.eventEmitter.once(eventType, handler);
  }

  off<T extends EventType>(eventType: T, handler?: (payload: any) => void): void {
    if (handler) {
      this.listeners.get(eventType)?.delete(handler);
      this.eventEmitter.off(eventType, handler);
    } else {
      this.listeners.delete(eventType);
      this.eventEmitter.removeAllListeners(eventType);
    }
  }

  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.listeners.delete(eventType);
      this.eventEmitter.removeAllListeners(eventType);
    } else {
      this.listeners.clear();
      this.eventEmitter.removeAllListeners();
    }
  }

  getListenerCount(eventType?: string): number {
    if (eventType) {
      return this.listeners.get(eventType)?.size || 0;
    }
    return Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0);
  }
}
