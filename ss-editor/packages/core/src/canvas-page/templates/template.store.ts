// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Page template management — Pinia Store (two levels: system-level + project-level)
 *
 * Prefer reading/writing JSON files via the backend API:
 *   system-level → /api/v1/canvas-templates
 *   project-level → /api/v1/projects/{projectId}/canvas-templates
 * Falls back to hard-coded built-in templates + localStorage when the API is unavailable.
 */

import { defineStore } from 'pinia';
import type { TemplateCategory, PageTemplate } from './types';
import { TEMPLATE_CATEGORIES } from './types';
import { BUILTIN_TEMPLATES } from './builtin-templates';

const LS_KEY = 'ss-canvas-page-templates';
const API_BASE = '/api/v1/canvas-templates';

let currentProjectId: string | null = null;

export const useTemplateStore = defineStore('canvas-page-template', {
  state: () => ({
    /** System-level templates (built-in + user-promoted) */
    systemTemplates: [] as PageTemplate[],
    /** Project-level templates */
    projectTemplates: [] as PageTemplate[],
    selectedCategory: 'all' as TemplateCategory | 'all',
    searchKeyword: '',
    isLoading: false,
    /** Template apply mode: reference | copy */
    configMode: 'reference' as 'reference' | 'copy',
  }),

  getters: {
    /** Built-in system templates */
    builtinTemplates(state): PageTemplate[] {
      return state.systemTemplates.filter(t => t.source === 'builtin');
    },
    /** System user templates (non-built-in) */
    systemUserTemplates(state): PageTemplate[] {
      return state.systemTemplates.filter(t => t.source === 'user');
    },
    /** All templates: project templates first, then system templates */
    allTemplates(state): PageTemplate[] {
      return [...state.projectTemplates, ...state.systemTemplates];
    },
    /** Templates filtered by category */
    filteredTemplates(state): PageTemplate[] {
      let templates = state.selectedCategory === 'all'
        ? this.allTemplates
        : this.allTemplates.filter(t => t.category === state.selectedCategory);

      if (state.searchKeyword) {
        const keyword = state.searchKeyword.toLowerCase();
        templates = templates.filter(t =>
          t.name.toLowerCase().includes(keyword) ||
          (t.description && t.description.toLowerCase().includes(keyword)) ||
          (t.tags && t.tags.some(tag => tag.toLowerCase().includes(keyword)))
        );
      }
      return templates;
    },
    categories(): typeof TEMPLATE_CATEGORIES { return TEMPLATE_CATEGORIES; },
    /** Whether user templates exist */
    hasUserTemplates(state): boolean {
      return state.projectTemplates.length > 0 || state.systemTemplates.some(t => t.source === 'user');
    },
  },

  actions: {
    // ─── Config ───

    /** Get backend template config (apply mode) */
    async fetchConfig() {
      try {
        const res = await fetch(`${API_BASE}/config`);
        if (res.ok) {
          const data = await res.json();
          if (data.templateMode === 'reference' || data.templateMode === 'copy') {
            this.configMode = data.templateMode;
          }
        }
      } catch {
        // Keep default value 'reference'
      }
    },

    // ─── Project context ───

    /** Set the current project ID so subsequent operations (save, promote, etc.) use the correct project-level API path */
    setCurrentProjectId(projectId: string | null) {
      currentProjectId = projectId;
    },

    // ─── Loading ───

    /** Load the two template levels (prefer API, fall back to localStorage) */
    async loadTemplates(projectId?: string) {
      if (projectId) currentProjectId = projectId;
      this.isLoading = true;
      try {
        const [systemResult, projectResult] = await Promise.all([
          this.fetchFromApi(API_BASE).catch(() => null),
          projectId ? this.fetchFromApi(`/api/v1/projects/${projectId}/canvas-templates`).catch(() => null) : null,
          this.fetchConfig(),
        ]);

        if (systemResult) {
          this.systemTemplates = systemResult;
        } else {
          console.warn('[TemplateStore] 系统模板 API 不可用，使用本地数据降级');
          this.systemTemplates = [...BUILTIN_TEMPLATES];
          this.loadUserTemplatesFromLocalStorage();
        }

        this.projectTemplates = projectResult || [];
        console.log('[TemplateStore] loadTemplates 完成 →', {
          projectId: projectId || '(未传)',
          currentProjectId,
          systemCount: this.systemTemplates.length,
          projectCount: this.projectTemplates.length,
          selectedCategory: this.selectedCategory,
          projectTemplates: this.projectTemplates.map(t => ({ id: t.id, name: t.name, category: t.category })),
        });
      } finally {
        this.isLoading = false;
      }
    },

    /** Load only system templates (for the system management page) */
    async loadSystemTemplates() {
      this.isLoading = true;
      try {
        const result = await this.fetchFromApi(API_BASE);
        this.systemTemplates = result;
      } catch {
        console.warn('[TemplateStore] 系统模板 API 不可用');
        this.systemTemplates = [...BUILTIN_TEMPLATES];
        this.loadUserTemplatesFromLocalStorage();
      } finally {
        this.isLoading = false;
      }
    },

    loadUserTemplatesFromLocalStorage() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this.systemTemplates = [...this.systemTemplates, ...parsed.filter((t: PageTemplate) => t.source !== 'builtin')];
          }
        }
      } catch (error) {
        console.warn('[TemplateStore] 加载用户模板失败:', error);
      }
    },

    persistUserTemplatesToLocalStorage() {
      try {
        const userTemplates = this.systemTemplates.filter(t => t.source === 'user');
        localStorage.setItem(LS_KEY, JSON.stringify(userTemplates));
      } catch (error) {
        console.warn('[TemplateStore] 保存用户模板失败:', error);
      }
    },

    // ─── Filtering ───

    setCategory(category: TemplateCategory | 'all') { this.selectedCategory = category; },
    setSearchKeyword(keyword: string) { this.searchKeyword = keyword; },

    // ─── Query ───

    findTemplate(templateId: string): PageTemplate | undefined {
      return this.allTemplates.find(t => t.id === templateId);
    },

    /** Whether the template is project-level */
    isProjectTemplate(templateId: string): boolean {
      return this.projectTemplates.some(t => t.id === templateId);
    },

    // ─── Create/Save ───

    /** Save as template (defaults to project-level, otherwise system-level) */
    async saveAsTemplate(
      templateInfo: {
        name: string;
        description?: string;
        category?: TemplateCategory;
        icon?: string;
        pageConfig: PageTemplate['pageConfig'];
        graphics: unknown[];
        tags?: string[];
      },
      saveToSystem = false,
    ): Promise<PageTemplate | null> {
      const template: PageTemplate = {
        id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: templateInfo.name,
        description: templateInfo.description,
        category: templateInfo.category || 'custom',
        icon: templateInfo.icon,
        source: 'user',
        author: 'current-user',
        version: '1.0.0',
        pageConfig: templateInfo.pageConfig,
        graphics: templateInfo.graphics,
        tags: templateInfo.tags,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const apiPath = saveToSystem || !currentProjectId
        ? API_BASE
        : `/api/v1/projects/${currentProjectId}/canvas-templates`;

      try {
        const res = await fetch(apiPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(template),
        });
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        if (result.success && result.data) {
          if (saveToSystem || !currentProjectId) {
            this.systemTemplates.unshift(result.data);
          } else {
            this.projectTemplates.unshift(result.data);
          }
          return result.data;
        }
        throw new Error('API 返回异常');
      } catch (error) {
        console.warn('[TemplateStore] API 保存失败，降级到 localStorage:', error);
        this.systemTemplates.unshift(template);
        this.persistUserTemplatesToLocalStorage();
        return template;
      }
    },

    /** Duplicate template */
    async duplicateTemplate(templateId: string): Promise<PageTemplate | null> {
      const source = this.allTemplates.find(t => t.id === templateId);
      if (!source) return null;

      const isProject = this.isProjectTemplate(templateId);
      return this.saveAsTemplate({
        name: `${source.name} (副本)`,
        description: source.description,
        category: source.category,
        icon: source.icon,
        pageConfig: { ...source.pageConfig },
        graphics: JSON.parse(JSON.stringify(source.graphics)),
        tags: source.tags ? [...source.tags] : [],
      }, !isProject);
    },

    /** Promote a project template to system level */
    async promoteToSystem(templateId: string): Promise<PageTemplate | null> {
      if (!currentProjectId) return null;
      try {
        const res = await fetch(
          `/api/v1/projects/${currentProjectId}/canvas-templates/${templateId}/promote`,
          { method: 'POST' }
        );
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        if (result.success && result.data) {
          this.systemTemplates.unshift(result.data);
          return result.data;
        }
        return null;
      } catch (error) {
        console.warn('[TemplateStore] 提升模板失败:', error);
        return null;
      }
    },

    // ─── Update ───

    async updateTemplate(templateId: string, updates: Partial<PageTemplate>): Promise<boolean> {
      const isProject = this.isProjectTemplate(templateId);
      const apiPath = isProject && currentProjectId
        ? `/api/v1/projects/${currentProjectId}/canvas-templates`
        : API_BASE;

      try {
        const res = await fetch(`${apiPath}/${templateId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error(await res.text());
        const result = await res.json();
        if (result.success && result.data) {
          const target = isProject ? this.projectTemplates : this.systemTemplates;
          const idx = target.findIndex(t => t.id === templateId);
          if (idx !== -1) target[idx] = result.data;
          return true;
        }
        throw new Error('API 返回异常');
      } catch (error) {
        console.warn('[TemplateStore] API 更新失败，降级到 localStorage:', error);
        const target = isProject ? this.projectTemplates : this.systemTemplates;
        const template = target.find(t => t.id === templateId);
        if (!template) return false;
        Object.assign(template, updates, { updatedAt: Date.now() });
        if (!isProject) this.persistUserTemplatesToLocalStorage();
        return true;
      }
    },

    async renameTemplate(templateId: string, newName: string): Promise<boolean> {
      return this.updateTemplate(templateId, { name: newName });
    },

    // ─── Delete ───

    async deleteTemplate(templateId: string): Promise<boolean> {
      const isProject = this.isProjectTemplate(templateId);
      const apiPath = isProject && currentProjectId
        ? `/api/v1/projects/${currentProjectId}/canvas-templates`
        : API_BASE;

      try {
        const res = await fetch(`${apiPath}/${templateId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        if (isProject) {
          this.projectTemplates = this.projectTemplates.filter(t => t.id !== templateId);
        } else {
          this.systemTemplates = this.systemTemplates.filter(t => t.id !== templateId);
        }
        return true;
      } catch (error) {
        console.warn('[TemplateStore] API 删除失败，降级到 localStorage:', error);
        if (isProject) {
          this.projectTemplates = this.projectTemplates.filter(t => t.id !== templateId);
        } else {
          this.systemTemplates = this.systemTemplates.filter(t => t.id !== templateId);
          this.persistUserTemplatesToLocalStorage();
        }
        return true;
      }
    },

    // ─── Export/Import ───

    async exportTemplate(templateId: string): Promise<string | null> {
      const template = this.allTemplates.find(t => t.id === templateId);
      if (!template) return null;

      const isProject = this.isProjectTemplate(templateId);
      const apiPath = isProject && currentProjectId
        ? `/api/v1/projects/${currentProjectId}/canvas-templates`
        : API_BASE;

      if (template.source === 'user') {
        try {
          const res = await fetch(`${apiPath}/${templateId}/export`);
          if (res.ok) return await res.text();
        } catch { /* fallback */ }
      }

      const serialized = { ...template, source: 'user' as const, id: undefined, thumbnail: undefined, createdAt: undefined, updatedAt: undefined };
      return JSON.stringify(serialized, null, 2);
    },

    async importTemplate(json: string): Promise<PageTemplate | null> {
      try {
        let raw: any;
        try { raw = JSON.parse(json); } catch { return null; }

        if (!raw.name || !raw.pageConfig || !Array.isArray(raw.graphics)) {
          console.warn('[TemplateStore] 导入的模板数据格式无效');
          return null;
        }

        const apiPath = currentProjectId
          ? `/api/v1/projects/${currentProjectId}/canvas-templates`
          : API_BASE;

        try {
          const res = await fetch(`${apiPath}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ json }),
          });
          if (res.ok) {
            const result = await res.json();
            if (result.success && result.data) {
              if (currentProjectId) {
                this.projectTemplates.unshift(result.data);
              } else {
                this.systemTemplates.unshift(result.data);
              }
              return result.data;
            }
          }
        } catch { /* fallback */ }

        const template: PageTemplate = {
          id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: raw.name, description: raw.description || '', category: raw.category || 'custom',
          icon: raw.icon, source: 'user', author: raw.author || 'imported',
          version: raw.version || '1.0.0', pageConfig: raw.pageConfig, graphics: raw.graphics,
          tags: raw.tags || [], createdAt: Date.now(), updatedAt: Date.now(),
        };
        this.systemTemplates.unshift(template);
        this.persistUserTemplatesToLocalStorage();
        return template;
      } catch (error) {
        console.warn('[TemplateStore] 导入模板失败:', error);
        return null;
      }
    },

    // ─── Internal utils ───

    async fetchFromApi(url: string): Promise<PageTemplate[]> {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      // Compatible with both the global TransformInterceptor wrapper { code, data, message }
      // and the bare { success, templates } format
      const result = raw.data || raw;
      if (!result.success || !Array.isArray(result.templates)) throw new Error('API 返回格式异常');
      return result.templates as PageTemplate[];
    },

    async refresh() { await this.loadTemplates(currentProjectId ?? undefined); },
  },
});
