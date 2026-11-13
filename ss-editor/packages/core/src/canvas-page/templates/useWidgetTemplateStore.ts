// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * useWidgetTemplateStore — unified state layer for component templates (Pinia)
 *
 * Follows exactly the same style as useTemplateStore (page templates):
 * - Maintains three layers of component templates: builtin / user / current
 * - Reads/writes JSON files via backend APIs:
 *     System level → /api/v1/widget-templates
 *     Project level → /api/v1/projects/{projectId}/widget-templates
 * - Does not depend on a standalone WidgetTemplateManager class
 *
 * Note: the system-level templateApi (device-templates) is the device template API and is unrelated.
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  WidgetTemplate,
  WidgetTemplateMeta,
  WidgetTemplateVariable,
} from './widget-template.types';

const API_BASE = '/api/v1/widget-templates';

let currentProjectId: string | null = null;

async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function apiPathFor(projectId?: string | null): string {
  return projectId
    ? `/api/v1/projects/${projectId}/widget-templates`
    : API_BASE;
}

interface ListResult {
  success: boolean;
  data: WidgetTemplateMeta[];
  source: 'fs' | 'fallback';
}
interface ReadResult {
  success: boolean;
  data: WidgetTemplate;
  source: 'fs';
}
interface WriteResult {
  success: boolean;
  data: WidgetTemplateMeta;
  message: string;
}

export const useWidgetTemplateStore = defineStore('widgetTemplate', () => {
  const builtinTemplates = ref<WidgetTemplateMeta[]>([]);
  const userTemplates = ref<WidgetTemplateMeta[]>([]);
  const isLoading = ref(false);
  const selectedCategory = ref<string>('all');

  function setCurrentProjectId(projectId: string | null) {
    currentProjectId = projectId;
  }

  async function loadTemplates() {
    isLoading.value = true;
    try {
      const params = new URLSearchParams();
      if (selectedCategory.value !== 'all') {
        params.set('category', selectedCategory.value);
      }
      const qs = params.toString();
      const res = await apiFetch<ListResult>(
        `${API_BASE}${qs ? `?${qs}` : ''}`,
      );
      const all = res.data || [];
      builtinTemplates.value = all.filter((t) => t.source === 'builtin');
      userTemplates.value = all.filter((t) => t.source === 'user');
    } catch (err) {
      console.error('[WidgetTemplateStore] Failed to load widget templates', err);
    } finally {
      isLoading.value = false;
    }
  }

  async function loadProjectTemplates(projectId: string) {
    try {
      const res = await apiFetch<ListResult>(
        apiPathFor(projectId),
      );
      const proj = (res.data || []).map((t) => ({
        ...t,
        source: 'user' as const,
      }));
      userTemplates.value = [...userTemplates.value, ...proj];
    } catch (err) {
      console.error('[WidgetTemplateStore] Failed to load project widget templates', err);
    }
  }

  async function readTemplate(templateId: string): Promise<WidgetTemplate | null> {
    try {
      const res = await apiFetch<ReadResult>(`${API_BASE}/${templateId}`);
      return res.data;
    } catch (err) {
      console.error('[WidgetTemplateStore] Failed to read widget template', err);
      return null;
    }
  }

  async function createWidgetTemplate(
    data: Partial<WidgetTemplate>,
    projectId?: string | null,
  ): Promise<WidgetTemplateMeta | null> {
    try {
      const res = await apiFetch<WriteResult>(apiPathFor(projectId), {
        method: 'POST',
        body: JSON.stringify(data),
      });
      await loadTemplates();
      return res.data;
    } catch (err) {
      console.error('[WidgetTemplateStore] Failed to create widget template', err);
      return null;
    }
  }

  async function updateWidgetTemplate(
    templateId: string,
    data: Partial<WidgetTemplate>,
    projectId?: string | null,
  ): Promise<boolean> {
    try {
      await apiFetch<WriteResult>(`${apiPathFor(projectId)}/${templateId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      await loadTemplates();
      return true;
    } catch (err) {
      console.error('[WidgetTemplateStore] Failed to update widget template', err);
      return false;
    }
  }

  async function deleteWidgetTemplate(
    templateId: string,
    projectId?: string | null,
  ): Promise<boolean> {
    try {
      await apiFetch<{ success: boolean; message: string }>(
        `${apiPathFor(projectId)}/${templateId}`,
        { method: 'DELETE' },
      );
      await loadTemplates();
      return true;
    } catch (err) {
      console.error('[WidgetTemplateStore] Failed to delete widget template', err);
      return false;
    }
  }

  /** Save the draft graphics array as a new component template (system level) */
  async function saveAsWidgetTemplate(params: {
    name: string;
    description?: string;
    category?: string;
    graphics: any[];
    variables?: WidgetTemplateVariable[];
    thumbnail?: string;
  }): Promise<WidgetTemplateMeta | null> {
    return createWidgetTemplate(
      {
        name: params.name,
        description: params.description,
        category: params.category || 'custom',
        author: 'user',
        source: 'user',
        schemaVersion: 2,
        graphics: params.graphics,
        variables: params.variables || [],
        thumbnail: params.thumbnail,
      },
      currentProjectId,
    );
  }

  function setCategory(cat: string) {
    selectedCategory.value = cat;
    loadTemplates();
  }

  function allTemplates() {
    return [...builtinTemplates.value, ...userTemplates.value];
  }

  return {
    builtinTemplates,
    userTemplates,
    isLoading,
    selectedCategory,
    setCurrentProjectId,
    loadTemplates,
    loadProjectTemplates,
    readTemplate,
    createWidgetTemplate,
    updateWidgetTemplate,
    deleteWidgetTemplate,
    saveAsWidgetTemplate,
    setCategory,
    allTemplates,
  };
});
