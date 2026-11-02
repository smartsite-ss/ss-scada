// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, onUnmounted, type Ref } from 'vue';
import { useWsStore } from '@scada-editor/system';

/**
 * useWsTagSubscription — Unified WebSocket tag subscription management
 *
 * Extracted from the duplicated wsStore call patterns in
 * PreviewCanvas / TagSourceSelector / DataSourceConfigDialog:
 * 1. Connect on demand via connect(projectId)
 * 2. subscribeTags(tagIds) + tracking of the tagIds subscribed by this component
 * 3. Automatically unsubscribeTags on unmount to release reference counts
 *
 * Note: wsStore manages connection and subscription state, BindingManager manages graphicId↔tagId property mapping;
 * their responsibilities differ. This composable only unifies the wsStore call entry point and does not affect BindingManager.
 */
export function useWsTagSubscription(projectId: Ref<string> | string) {
  const wsStore = useWsStore();
  /** List of tag IDs subscribed by this component (unsubscribed on unmount) */
  const subscribedTagIds = ref<string[]>([]);

  function resolveProjectId(): string {
    return typeof projectId === 'string' ? projectId : projectId.value;
  }

  /**
   * Ensure the WebSocket is connected to the specified project; connect automatically if not.
   */
  async function ensureConnected(): Promise<void> {
    const pid = resolveProjectId();
    if (!pid) return;
    if (!wsStore.isConnected || wsStore.subscribedProjectId !== pid) {
      await wsStore.connect(pid);
    }
  }

  /**
   * Subscribe to the specified tags and track the subscription list (for later unsubscription).
   * Subscribing to the same tag repeatedly is safe (wsStore deduplicates internally).
   */
  async function subscribe(tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return;
    await ensureConnected();
    wsStore.subscribeTags(tagIds);
    const merged = new Set([...subscribedTagIds.value, ...tagIds]);
    subscribedTagIds.value = [...merged];
  }

  /**
   * Unsubscribe from the specified tag (removes it from this component's tracking list).
   */
  function unsubscribe(tagIds: string[]): void {
    if (tagIds.length === 0) return;
    wsStore.unsubscribeTags(tagIds);
    const removeSet = new Set(tagIds);
    subscribedTagIds.value = subscribedTagIds.value.filter((id) => !removeSet.has(id));
  }

  /**
   * Unsubscribe from all tags subscribed by this component.
   */
  function unsubscribeAll(): void {
    if (subscribedTagIds.value.length > 0) {
      wsStore.unsubscribeTags(subscribedTagIds.value);
      subscribedTagIds.value = [];
    }
  }

  /**
   * Get a tag's real-time value (read from wsStore.tagValues).
   */
  function getTagValue(tagId: string): { value: unknown; quality: string; timestamp: number } | null {
    const entry = wsStore.tagValues.get(tagId);
    if (!entry) return null;
    return {
      value: entry.value,
      quality: entry.quality,
      timestamp: entry.timestamp,
    };
  }

  // Automatically release subscriptions when the component unmounts
  onUnmounted(() => {
    unsubscribeAll();
  });

  return {
    wsStore,
    subscribedTagIds,
    ensureConnected,
    subscribe,
    unsubscribe,
    unsubscribeAll,
    getTagValue,
  };
}
