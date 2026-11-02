// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Backend connection status monitoring
 *
 * Maintains a connection state machine by probing the health check endpoint on a timer:
 *   online → offline → recovering → online
 *
 * - The request interceptor calls markOffline() on Network Error
 * - In offline state, probes GET /api/v1/system/health every 5s
 * - Probe success → recovering → triggers RequestQueue.flush()
 * - Consecutive successes → online → stops polling
 */

export type ConnectionStatus = 'online' | 'offline' | 'recovering';

type StatusChangeListener = (status: ConnectionStatus) => void;
type RecoverListener = () => void;

const POLL_INTERVAL = 5000; // probe every 5 seconds
const PROBE_TIMEOUT = 3000; // probe timeout 3 seconds
const HEALTH_URL = '/api/v1/system/health';

export class ConnectionMonitor {
  private status: ConnectionStatus = 'online';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private statusListeners: StatusChangeListener[] = [];
  private recoverListeners: RecoverListener[] = [];

  /** Current state */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Whether offline */
  isOffline(): boolean {
    return this.status === 'offline';
  }

  /** Mark as offline (called by the request interceptor on Network Error) */
  markOffline(): void {
    if (this.status !== 'offline') {
      this.setStatus('offline');
      this.startPolling();
    }
  }

  /** Mark as online (triggered by a successful request) */
  markOnline(): void {
    if (this.status !== 'online') {
      this.setStatus('online');
      this.stopPolling();
    }
  }

  /** Register a state change listener */
  onStatusChange(cb: StatusChangeListener): void {
    this.statusListeners.push(cb);
  }

  /** Register a recovery listener (fires when the state becomes recovering, used to trigger queue flush) */
  onRecover(cb: RecoverListener): void {
    this.recoverListeners.push(cb);
  }

  /** Start the health check polling */
  startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => this.probe(), POLL_INTERVAL);
    // Probe once immediately
    this.probe();
  }

  /** Stop polling */
  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Probe the backend health check endpoint */
  private async probe(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT);

      const response = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        // Probe success → recovering → notify recovery
        if (this.status === 'offline') {
          this.setStatus('recovering');
          this.notifyRecover();
          // After recovering, wait briefly before switching back to online
          setTimeout(() => this.setStatus('online'), 1000);
        }
      }
    } catch {
      // Probe failed, keep the current state
      if (this.status === 'recovering') {
        this.setStatus('offline');
      }
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((cb) => {
      try {
        cb(status);
      } catch {
        // Ignore listener errors
      }
    });
  }

  private notifyRecover(): void {
    this.recoverListeners.forEach((cb) => {
      try {
        cb();
      } catch {
        // Ignore recovery listener errors
      }
    });
  }

  /** Destroy (clear timers and listeners) */
  destroy(): void {
    this.stopPolling();
    this.statusListeners = [];
    this.recoverListeners = [];
  }
}

/** Global singleton */
export const connectionMonitor = new ConnectionMonitor();
