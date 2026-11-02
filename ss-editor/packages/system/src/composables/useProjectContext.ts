// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref } from 'vue';
import { projectApi } from '../api/modules/project.api';

/** Global default project ID (module-level singleton, shared across components) */
const defaultProjectId = ref<string | null>(null);

/** Whether a load has been attempted (avoids duplicate requests) */
let loaded = false;

/** In-flight load promise (prevents concurrent requests) */
let loadingPromise: Promise<void> | null = null;

export function useProjectContext() {
  /** Load the default project configuration (idempotent; the request fires only the first time) */
  async function loadDefault(): Promise<string | null> {
    if (loaded) return defaultProjectId.value;
    if (loadingPromise) {
      await loadingPromise;
      return defaultProjectId.value;
    }

    loadingPromise = (async () => {
      try {
        const res = await projectApi.getDefaultProject();
        defaultProjectId.value = res.data?.projectId || null;
      } catch {
        defaultProjectId.value = null;
      } finally {
        loaded = true;
        loadingPromise = null;
      }
    })();

    await loadingPromise;
    return defaultProjectId.value;
  }

  /** Set the default project and update the local cache */
  async function setDefaultProject(projectId: string): Promise<void> {
    await projectApi.setDefaultProject(projectId);
    defaultProjectId.value = projectId;
  }

  /** Clear the default project */
  async function clearDefaultProject(): Promise<void> {
    await projectApi.clearDefaultProject();
    defaultProjectId.value = null;
  }

  return { defaultProjectId, loadDefault, setDefaultProject, clearDefaultProject };
}
