// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ConnectionStatus } from '../api/connection-monitor';
import { connectionMonitor } from '../api/connection-monitor';
import { requestQueue } from '../api/request-queue';

/**
 * Connection state store
 *
 * Globally manages the backend connection state and the pending-retry request count.
 * State changes are driven by ConnectionMonitor; ConnectionBanner consumes the state to render the UI.
 */
export const useConnectionStore = defineStore('connection', () => {
  const status = ref<ConnectionStatus>('online');
  const lastOfflineAt = ref<number | null>(null);
  const pendingRequests = ref(0);

  const isOffline = computed(() => status.value === 'offline');
  const isRecovering = computed(() => status.value === 'recovering');
  const hasPending = computed(() => pendingRequests.value > 0);

  function setStatus(s: ConnectionStatus): void {
    if (s === 'offline' && status.value !== 'offline') {
      lastOfflineAt.value = Date.now();
    }
    status.value = s;
  }

  function setPendingCount(n: number): void {
    pendingRequests.value = n;
  }

  // Initialization: listen to ConnectionMonitor state changes
  connectionMonitor.onStatusChange((s) => {
    setStatus(s);
  });

  // Listen to queue size changes
  requestQueue.onSizeChange((stats) => {
    setPendingCount(stats.size);
  });

  return {
    status,
    lastOfflineAt,
    pendingRequests,
    isOffline,
    isRecovering,
    hasPending,
    setStatus,
    setPendingCount,
  };
});
