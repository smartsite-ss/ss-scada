// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Unified error handler
 *
 * Handles all errors uniformly in the axios response interceptor, dispatching by error type.
 *
 * **Filter mode**: when the network is disconnected, all requests (including GET) are automatically enqueued to await backend recovery,
 * without rejecting to the view layer. The view layer need not be aware of network errors.
 * Connection status is displayed globally by ConnectionBanner.
 *
 * Error dispatch strategy:
 * - Network disconnection → mark offline + enqueue all requests (only requests marked _noRetry reject immediately)
 * - 5xx server errors → retryable requests (POST/PUT/PATCH/DELETE) are enqueued
 * - Timeout → retryable requests are enqueued
 * - 401 auth errors → pass through (handled by the existing token refresh logic)
 * - 4xx business errors → extract the i18n message for display + reject
 */

import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { i18n } from '@scada-editor/core';
import { connectionMonitor } from './connection-monitor';
import { requestQueue } from './request-queue';
import { mapErrorCodeToI18n } from './error-codes';
import { showError } from '../utils/messageBox';

const RETRYABLE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Marker fields extended on AxiosError */
export interface ErrorHandlerMarkers {
  /** The ErrorHandler already showed the error toast; the view layer must not show another popup */
  _errorHandled?: boolean;
}

/**
 * Determine a network error: no response or a response status of 0 (behavior of some proxies/browsers)
 * Also matches common axios network error message / code values
 */
function isNetworkError(error: AxiosError): boolean {
  if (error.response) {
    // Some proxies return a fake response with status=0 when the target is unreachable
    return error.response.status === 0;
  }
  // No response object → check message / code
  const msg = error.message || '';
  return (
    msg === 'Network Error' ||
    msg.includes('Network Error') ||
    msg.includes('network') ||
    error.code === 'ERR_NETWORK' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ERR_CONNECTION_REFUSED' ||
    error.code === 'ERR_PROXY_CONNECTION_FAILED'
  );
}

/**
 * Determine whether a request should be intercepted by the queue (used by the request interceptor)
 * Only requests marked _noRetry (e.g. login) are not intercepted and sent directly
 */
export function shouldQueueRequest(config?: InternalAxiosRequestConfig): boolean {
  if (!config) return false;
  return !(config as any)._noRetry;
}

export class ErrorHandler {
  /**
   * Handle an axios error
   *
   * **Filter mode core**:
   * - On network disconnection, all requests (including GET) are enqueued to await recovery, not rejected to the view layer
   * - Only requests marked `_noRetry` reject immediately
   * - Connection status is displayed globally by ConnectionBanner; no per-view handling needed
   */
  handle(error: AxiosError): Promise<any> {
    // 1. Network disconnection → enqueue all requests, do not reject to the view layer
    if (isNetworkError(error)) {
      connectionMonitor.markOffline();

      // Only requests marked _noRetry (e.g. login) reject immediately
      if (error.config && (error.config as any)._noRetry) {
        this.markHandled(error);
        showError(i18n.global.t('error.network'));
        return Promise.reject(error);
      }

      // All other requests (GET/POST/PUT/DELETE) are enqueued and auto-resent once the backend recovers
      if (error.config) {
        return this.enqueueRequest(error.config);
      }

      // Extreme case with no config: do not reject, mark offline and wait for recovery
      return new Promise(() => {});
    }

    // 2. Timeout → enqueue retryable requests
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      if (this.isRetryable(error.config)) {
        return this.enqueueRequest(error.config!);
      }
      this.markHandled(error);
      showError(i18n.global.t('error.timeout'));
      return Promise.reject(error);
    }

    // 3. Server 5xx error → enqueue retryable requests
    if (error.response && error.response.status >= 500) {
      if (this.isRetryable(error.config)) {
        return this.enqueueRequest(error.config!);
      }
      const msg = this.extractMessage(error.response?.data);
      this.markHandled(error);
      showError(msg);
      return Promise.reject(error);
    }

    // 4. Auth error 401 → pass through (handled by the existing token refresh logic)
    if (error.response?.status === 401) {
      return Promise.reject(error);
    }

    // 5. Business error 4xx → show the error message (requests marked _silent reject silently without a popup)
    if (error.response && error.response.status >= 400) {
      if ((error.config as any)?._silent) {
        return Promise.reject(error);
      }
      const msg = this.extractMessage(error.response?.data);
      this.markHandled(error);
      showError(msg);
      return Promise.reject(error);
    }

    // 6. Fallback: do not show the raw error.message (usually English technical info),
    //    uniformly show the user-friendly message translated via i18n
    this.markHandled(error);
    showError(i18n.global.t('error.unknown'));
    return Promise.reject(error);
  }

  /** Determine whether a request is retryable (only POST/PUT/PATCH/DELETE, for timeout/5xx scenarios) */
  private isRetryable(config?: InternalAxiosRequestConfig): boolean {
    if (!config) return false;
    if ((config as any)._noRetry) return false;
    const method = (config.method || '').toUpperCase();
    return RETRYABLE_METHODS.includes(method);
  }

  /** Enqueue a request, returning a Promise controlled by the queue */
  private enqueueRequest(config: InternalAxiosRequestConfig): Promise<any> {
    return new Promise((resolve, reject) => {
      const enqueued = requestQueue.enqueue(config, resolve, reject);
      if (!enqueued) {
        // Queue is full
        showError(i18n.global.t('connection.queueFull'));
        reject(new Error('QUEUE_FULL'));
      }
    });
  }

  /** Extract a displayable message from the error response body (prefer the i18n key for the error code) */
  private extractMessage(data: any): string {
    if (!data) return i18n.global.t('error.unknown');

    // Prefer the i18n key for the error code
    if (data.code) {
      const i18nKey = mapErrorCodeToI18n(data.code);
      if (i18nKey) {
        return i18n.global.t(i18nKey);
      }
    }

    // Validation error details
    if (Array.isArray(data.details) && data.details.length > 0) {
      const first = data.details[0];
      if (first?.message) return first.message;
    }

    return data.message || i18n.global.t('error.unknown');
  }

  /** Mark the error as handled so the view layer knows whether to show another popup */
  private markHandled(error: AxiosError): void {
    (error as any)._errorHandled = true;
  }
}

/** Global singleton */
export const errorHandler = new ErrorHandler();
