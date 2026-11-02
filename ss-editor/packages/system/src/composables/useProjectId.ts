// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { computed } from 'vue';
import { useProjectStore } from '../stores/project.store';

/**
 * Extract the current project ID uniformly.
 * Prefers the Pinia current project; falls back to the editor route /editor/:projectId.
 */
export function useProjectId() {
  const projectStore = useProjectStore();
  return computed(() => {
    const fromStore = projectStore.currentProject?.projectId;
    if (fromStore) return fromStore;
    const match = window.location.pathname.match(/\/editor\/([^/]+)/);
    return match ? match[1] : '';
  });
}
