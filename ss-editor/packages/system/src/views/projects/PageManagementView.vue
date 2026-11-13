<template>
  <div class="page-management">
    <!-- Page header (compact: title + project selector + stats) -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">
          {{ t('system.pageManagement.title') }}
        </h1>
        <span
          v-if="selectedProjectId"
          class="project-badge"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          {{ selectedProjectName }}
        </span>
      </div>

      <!-- Project selector bar -->
      <div class="selector-bar">
        <svg
          class="selector-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
        <select
          v-model="selectedProjectId"
          class="selector-select"
          @change="handleProjectChange"
        >
          <option value="">
            {{ t('system.pageManagement.selectProjectPlaceholder') }}
          </option>
          <option
            v-for="project in projects"
            :key="project.projectId"
            :value="project.projectId"
          >
            {{ project.projectName }}
          </option>
        </select>
        <!-- Manual refresh button: re-fetch the project list, keep the current selection and refresh the page outline -->
        <button
          type="button"
          class="selector-refresh-btn"
          :disabled="projectsLoading"
          :title="t('system.pageManagement.refreshProjects')"
          @click="handleRefreshProjects"
        >
          <svg
            class="selector-refresh-icon"
            :class="{ 'is-spinning': projectsLoading }"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          ><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><polyline points="21 3 21 8 16 8" /></svg>
        </button>
        <span
          v-if="projectsLoading"
          class="selector-loading"
        >
          <div class="spinner-sm" />
          {{ t('system.pageManagement.loadingProjects') }}
        </span>
      </div>

      <!-- Stats bar -->
      <div
        v-if="selectedProjectId && !pagesLoading && totalPageCount > 0"
        class="stats-bar"
      >
        <div class="stat-item">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
          <span>{{ t('system.pageManagement.pageCount', { count: totalPageCount }) }}</span>
        </div>
        <div
          v-if="groups.length > 0"
          class="stat-item"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          <span>{{ t('system.pageManagement.groupCount', { count: groups.length }) }}</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div
      v-if="pagesLoading"
      class="loading-container"
    >
      <div class="spinner" />
      <span>{{ t('system.pageManagement.loadingPages') }}</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="selectedProjectId && totalPageCount === 0"
      class="empty-state"
    >
      <svg
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
        class="empty-icon"
      ><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
      <p class="empty-title">
        {{ t('system.pageManagement.noPages') }}
      </p>
      <p class="empty-desc">
        {{ t('system.pageManagement.noPagesDesc') }}
      </p>
    </div>

    <!-- Page list -->
    <div
      v-else-if="selectedProjectId"
      class="pages-content"
    >
      <!-- Root directory page -->
      <div
        v-if="rootPages.length > 0"
        class="section"
      >
        <h3 class="section-title">
          {{ t('system.pageManagement.rootPages') }}
        </h3>
        <div class="page-grid">
          <div
            v-for="page in rootPages"
            :key="page.id || page.name"
            class="page-card"
          >
            <div
              class="page-preview"
              :style="{ backgroundColor: page.backgroundColor || 'var(--surface-alt)' }"
            >
              <img
                v-if="page.previewSmallUrl"
                :src="getPreviewUrl(page.previewSmallUrl)"
                :alt="page.name"
                class="preview-img"
                @error="onPreviewError($event)"
              >
              <div
                v-else
                class="preview-placeholder"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                ><rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="2"
                /><circle
                  cx="8.5"
                  cy="8.5"
                  r="1.5"
                /><polyline points="21 15 16 10 5 21" /></svg>
                <span>{{ t('system.pageManagement.previewNotAvailable') }}</span>
              </div>
            </div>
            <div class="page-card-body">
              <div class="page-info">
                <span class="page-name">{{ page.name }}</span>
                <div class="page-meta-row">
                  <span
                    v-if="page.width && page.height"
                    class="page-meta"
                  >{{ page.width }}x{{ page.height }}</span>
                  <span class="page-meta">{{ formatDate(page.updatedAt) }}</span>
                </div>
              </div>
              <div class="page-actions">
                <button
                  class="btn btn-sm btn-primary"
                  @click="handleEdit(page)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  ><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  {{ t('system.pageManagement.edit') }}
                </button>
                <button
                  class="btn btn-sm btn-secondary"
                  @click="handlePreview(page)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  ><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line
                    x1="21"
                    y1="3"
                    x2="14"
                    y2="10"
                  /><line
                    x1="3"
                    y1="21"
                    x2="10"
                    y2="14"
                  /></svg>
                  {{ t('system.pageManagement.openPreview') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Group page -->
      <div
        v-for="group in groups"
        :key="group.name"
        class="section"
      >
        <h3 class="section-title">
          {{ t('system.pageManagement.groupLabel') }}: {{ group.name }}
        </h3>
        <div class="page-grid">
          <div
            v-for="page in group.pages"
            :key="page.id || page.name"
            class="page-card"
          >
            <div
              class="page-preview"
              :style="{ backgroundColor: page.backgroundColor || 'var(--surface-alt)' }"
            >
              <img
                v-if="page.previewSmallUrl"
                :src="getPreviewUrl(page.previewSmallUrl)"
                :alt="page.name"
                class="preview-img"
                @error="onPreviewError($event)"
              >
              <div
                v-else
                class="preview-placeholder"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                ><rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="2"
                /><circle
                  cx="8.5"
                  cy="8.5"
                  r="1.5"
                /><polyline points="21 15 16 10 5 21" /></svg>
                <span>{{ t('system.pageManagement.previewNotAvailable') }}</span>
              </div>
            </div>
            <div class="page-card-body">
              <div class="page-info">
                <span class="page-name">{{ page.name }}</span>
                <div class="page-meta-row">
                  <span
                    v-if="page.width && page.height"
                    class="page-meta"
                  >{{ page.width }}x{{ page.height }}</span>
                  <span class="page-meta">{{ formatDate(page.updatedAt) }}</span>
                </div>
              </div>
              <div class="page-actions">
                <button
                  class="btn btn-sm btn-primary"
                  @click="handleEdit(page)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  ><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  {{ t('system.pageManagement.edit') }}
                </button>
                <button
                  class="btn btn-sm btn-secondary"
                  @click="handlePreview(page, group.name)"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  ><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line
                    x1="21"
                    y1="3"
                    x2="14"
                    y2="10"
                  /><line
                    x1="3"
                    y1="21"
                    x2="10"
                    y2="14"
                  /></svg>
                  {{ t('system.pageManagement.openPreview') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- No project selected -->
    <div
      v-else
      class="empty-state"
    >
      <svg
        width="64"
        height="64"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
        class="empty-icon"
      ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
      <p class="empty-title">
        {{ t('system.pageManagement.selectProject') }}
      </p>
      <p class="empty-desc">
        {{ t('system.pageManagement.selectProjectPlaceholder') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '@scada-editor/core';
import { projectApi, pageApi } from '../../api/modules';
import { useProjectContext } from '../../composables/useProjectContext';
import { resolveBackendResourceUrl } from '../../utils/resource-url';
import type { Project } from '../../api/types/api';

const router = useRouter();
const { t } = useI18n();
const { loadDefault } = useProjectContext();

interface OutlinePage {
  id?: string;
  name: string;
  updatedAt: string;
  previewSmallUrl?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  width?: number;
  height?: number;
}

interface OutlineGroup {
  name: string;
  pages: OutlinePage[];
}

const projects = ref<Project[]>([]);
const selectedProjectId = ref('');
const projectsLoading = ref(false);
const pagesLoading = ref(false);

const rootPages = ref<OutlinePage[]>([]);
const groups = ref<OutlineGroup[]>([]);
const totalPageCount = ref(0);

const selectedProjectName = computed(() => {
  const p = projects.value.find((proj) => proj.projectId === selectedProjectId.value);
  return p?.projectName || '';
});

function getPreviewUrl(url: string): string {
  if (!url) return '';
  // The preview image is a backend @Public endpoint: <img> does not go through the fetch/XHR interceptor,
  // On desktop, rewrite to the backend absolute address; otherwise resolution hits the page origin and 404s
  return resolveBackendResourceUrl(url);
}

function onPreviewError(event: Event) {
  const img = event.target as HTMLImageElement;
  img.style.display = 'none';
  const placeholder = img.parentElement?.querySelector('.preview-placeholder') as HTMLElement;
  if (placeholder) placeholder.style.display = 'flex';
}

function formatDate(isoStr: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function loadProjects() {
  projectsLoading.value = true;
  try {
    // Page management is a subpage of project management; it must list all projects (including disabled) to switch and manage
    const res = await projectApi.list({ page: 1, pageSize: 100 }, true);
    projects.value = res.data || [];
  } catch {
    projects.value = [];
  } finally {
    projectsLoading.value = false;
  }
}

async function handleProjectChange() {
  if (!selectedProjectId.value) {
    rootPages.value = [];
    groups.value = [];
    totalPageCount.value = 0;
    return;
  }

  pagesLoading.value = true;
  try {
    const res = await pageApi.getProjectOutline(selectedProjectId.value);
    const inner = (res as any)?.data;
    if (inner && inner.success !== false) {
      rootPages.value = inner.rootPages || [];
      groups.value = inner.groups || [];
      totalPageCount.value = inner.totalPageCount || (rootPages.value.length + groups.value.reduce((sum: number, g: OutlineGroup) => sum + g.pages.length, 0));
    }
  } catch {
    rootPages.value = [];
    groups.value = [];
    totalPageCount.value = 0;
  } finally {
    pagesLoading.value = false;
  }
}

/**
 * Manually refresh the project list
 * - re-fetch the project list
 * - if the previously selected project still exists, keep it selected and refresh its page outline
 * - if it no longer exists, clear the selection and page data
 */
async function handleRefreshProjects() {
  const previouslySelectedId = selectedProjectId.value;
  await loadProjects();
  const stillExists = previouslySelectedId
    ? projects.value.some((p) => p.projectId === previouslySelectedId)
    : false;
  if (stillExists) {
    selectedProjectId.value = previouslySelectedId;
    await handleProjectChange();
  } else if (previouslySelectedId) {
    selectedProjectId.value = '';
    rootPages.value = [];
    groups.value = [];
    totalPageCount.value = 0;
  }
}

function handleEdit(_page: OutlinePage) {
  const project = projects.value.find((p) => p.projectId === selectedProjectId.value);
  if (!project) return;
  const route = router.resolve(`/editor/${project.projectId}`);
  window.open(route.href, '_blank');
}

function handlePreview(page: OutlinePage, groupName?: string) {
  const project = projects.value.find((p) => p.projectId === selectedProjectId.value);
  if (!project) return;
  const query = new URLSearchParams({ projectId: project.projectId });
  if (groupName) query.set('group', groupName);
  // Path params distinguish pages; query carries projectId and group
  router.push(`/system/preview/${encodeURIComponent(page.name)}?${query.toString()}`);
}

onMounted(async () => {
  await loadProjects();
  const defaultId = await loadDefault();
  if (defaultId && !selectedProjectId.value) {
    selectedProjectId.value = defaultId;
    // Needs manual invocation (v-model does not trigger @change)
    handleProjectChange();
  }
});
</script>

<style scoped>
.page-management {
  padding: 24px;
  /* Fill the whole display area; .page-grid auto-fills columns by viewport width */
  width: auto;
}

/* ── Page header (compact: title + project selector + stats) ── */
.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-shrink: 0;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.project-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--primary);
  background: var(--primary-alpha, rgba(var(--primary-rgb, 59 130 246), 0.1));
  border: 1px solid var(--primary);
  border-radius: 20px;
  opacity: 0.7;
}

/* ── Project selector bar ── */
.selector-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  max-width: 420px;
  margin: 0 auto;
}

.selector-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
  z-index: 1;
}

.selector-select {
  width: 100%;
  height: 36px;
  padding: 0 12px 0 36px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s;
  appearance: auto;
  box-sizing: border-box;
}

.selector-select:focus {
  border-color: var(--primary);
}

/* ── Manual refresh button ── */
.selector-refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background-color 0.2s, transform 0.1s;
  flex-shrink: 0;
}

.selector-refresh-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha, rgba(var(--primary-rgb, 59 130 246), 0.05));
}

.selector-refresh-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.selector-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.selector-refresh-icon.is-spinning {
  animation: spin 0.8s linear infinite;
}

.selector-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ── Stats bar ── */
.stats-bar {
  display: flex;
  gap: 16px;
  padding: 6px 14px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  flex-shrink: 0;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ── Section title ── */
.section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

/* ── Page card grid ── */
.page-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.page-card {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
}

.page-card:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  transform: translateY(-1px);
}

/* ── Preview area ── */
.page-preview {
  position: relative;
  width: 100%;
  height: 180px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid var(--border);
}

.preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

/* ── Card content ── */
.page-card-body {
  padding: 14px 16px;
}

.page-info {
  margin-bottom: 12px;
}

.page-name {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-meta {
  font-size: 12px;
  color: var(--text-muted);
}

/* ── Action buttons ── */
.page-actions {
  display: flex;
  gap: 8px;
}

.btn-sm {
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s;
  font-family: inherit;
}

.btn-primary {
  background: var(--primary);
  color: var(--text-on-primary);
  border-color: var(--primary);
}

.btn-primary:hover {
  opacity: 0.88;
}

.btn-secondary {
  background: transparent;
  color: var(--text);
  border-color: var(--border);
}

.btn-secondary:hover {
  background: var(--surface-alt);
  border-color: var(--text-muted);
}

/* ── Loading state ── */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 80px 0;
  color: var(--text-muted);
  font-size: 14px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Empty state ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 80px 0;
  color: var(--text-muted);
}

.empty-icon {
  opacity: 0.35;
}

.empty-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
}

.empty-desc {
  font-size: 13px;
  margin: 0;
}
</style>
