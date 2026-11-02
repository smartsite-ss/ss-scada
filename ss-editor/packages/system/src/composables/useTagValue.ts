// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef } from 'vue';
import { ScadaDataManager } from '@scada-editor/core';
import { useWsStore } from '../stores/ws.store';

/** Minimal graphic properties required by useTagValue (callers may pass a superset) */
export interface TagValueProps {
  tagId: string;
  tagName?: string;
  deviceCode?: string;
  deviceName?: string;
  decimalPlaces?: number;
}

/**
 * Single-tag real-time value composable: unified management of
 * subscription + real-time refresh + disconnect compensation + rebinding + EventBus fallback + decimal formatting.
 * Reused by all single-variable graphics such as tag-variable / tag-value and industrial components,
 * replacing their duplicated subscription boilerplate.
 */
export function useTagValue(
  props: TagValueProps,
  options?: {
    /** Non-WS channel (runtime) fallback value source, defaults to ScadaDataManager.getTagValue */
    fallbackGetter?: (tagId: string) => unknown;
  },
): {
  currentValue: ComputedRef<unknown>;
  displayValue: ComputedRef<string>;
  bindTitle: ComputedRef<string>;
} {
  const wsStore = useWsStore();
  const fallbackGetter =
    options?.fallbackGetter ?? ((tagId: string) => ScadaDataManager.getTagValue(tagId) ?? null);

  /** Fallback refresh version: runtime EventBus / HTTP polling channels trigger via tagValueChanged */
  const localVersion = ref(0);

  const currentValue = computed<unknown>(() => {
    void wsStore.tagFlushVersion;
    void localVersion.value;
    if (!props.tagId) return null;

    const wsValue = wsStore.getTagValue(props.tagId);
    if (wsValue !== null && wsValue !== undefined) return wsValue;

    return fallbackGetter(props.tagId) ?? null;
  });

  const displayValue = computed(() => formatValue(currentValue.value, props.decimalPlaces));

  const bindTitle = computed(() =>
    props.tagId ? `${props.deviceName || props.deviceCode || ''} · ${props.tagName || props.tagId}` : '',
  );

  let unsubscribeEventBus: (() => void) | null = null;
  /** Tags registered (attempted) to wsStore, used to unsubscribe/add when bindings change */
  let registeredTagId: string | null = null;

  /** Sync wsStore subscriptions: unsubscribe old tags and register new ones (subscribeTags is dropped while disconnected; compensated by isConnected) */
  function syncSubscription() {
    const next = props.tagId || null;
    if (registeredTagId && registeredTagId !== next) {
      wsStore.unsubscribeTags([registeredTagId]);
    }
    if (next && next !== registeredTagId && wsStore.isConnected) {
      wsStore.subscribeTags([next]);
    }
    registeredTagId = next;
  }

  onMounted(() => {
    syncSubscription();
    // Runtime / non-WS channel fallback: listen to the global EventBus tagValueChanged
    unsubscribeEventBus = ScadaDataManager.eventBus.on('tagValueChanged', (event) => {
      const payload = event.payload as { tagId?: string } | undefined;
      if (payload?.tagId === props.tagId) {
        localVersion.value++;
      }
    });
  });

  // Compensating subscription after the first connection is established: edit-mode graphics may mount before wsStore finishes connecting
  watch(
    () => wsStore.isConnected,
    (connected) => {
      if (!connected) return;
      if (props.tagId) wsStore.subscribeTags([props.tagId]);
    },
  );

  // Binding change (rebind variable): sync subscriptions
  watch(
    () => props.tagId,
    () => syncSubscription(),
  );

  onUnmounted(() => {
    if (registeredTagId) {
      wsStore.unsubscribeTags([registeredTagId]);
    }
    registeredTagId = null;
    unsubscribeEventBus?.();
  });

  return { currentValue, displayValue, bindTitle };
}

/** Format the real-time value by decimal places; booleans and non-numeric values (strings) are returned as-is, empty values return a placeholder */
function formatValue(raw: unknown, decimalPlaces: number | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '--';
  if (typeof raw === 'boolean') return String(raw);
  const num = Number(raw);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    return num.toFixed(decimalPlaces ?? 2);
  }
  return String(raw);
}
