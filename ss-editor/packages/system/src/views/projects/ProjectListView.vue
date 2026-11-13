<template>
  <div class="project-list">
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">
          {{ $t('system.projects.title') }}
        </h1>
        <span
          v-if="!loading"
          class="project-count"
        >{{ $t('system.projects.projectCount', { count: store.pagination.total }) }}</span>
      </div>
      <!-- Enable-state filter dropdown: left of the search box; frontend filters current-page projects -->
      <div class="filter-bar">
        <select
          v-model="enabledFilter"
          class="filter-select"
          :title="$t('system.projects.filterByEnabled')"
        >
          <option value="all">
            {{ $t('system.projects.filterAll') }}
          </option>
          <option value="enabled">
            {{ $t('system.projects.enabled') }}
          </option>
          <option value="disabled">
            {{ $t('system.projects.disabled') }}
          </option>
        </select>
      </div>
      <div class="search-bar">
        <svg
          class="search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        ><circle
          cx="11"
          cy="11"
          r="8"
        /><line
          x1="21"
          y1="21"
          x2="16.65"
          y2="16.65"
        /></svg>
        <input
          v-model="keyword"
          type="text"
          :placeholder="$t('system.projects.searchPlaceholder')"
          class="search-input"
          @keyup.enter="handleSearch"
        >
      </div>
      <div class="header-actions">
        <button
          class="btn btn-secondary"
          :disabled="store.loading"
          :title="$t('system.projects.refresh')"
          @click="handleRefresh"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :class="{ spinning: store.loading }"
          ><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
          {{ $t('system.projects.refresh') }}
        </button>
        <button
          class="btn btn-primary"
          @click="openCreateDialog"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          ><line
            x1="12"
            y1="5"
            x2="12"
            y2="19"
          /><line
            x1="5"
            y1="12"
            x2="19"
            y2="12"
          /></svg>
          {{ $t('system.projects.newProject') }}
        </button>
      </div>
    </div>

    <SsLoading
      v-if="store.loading"
      :text="$t('system.projects.loading')"
      size="small"
    />

    <div
      v-else-if="store.error"
      class="error-state"
    >
      <p>{{ store.error }}</p>
      <button
        class="btn btn-secondary"
        @click="handleSearch"
      >
        {{ $t('system.projects.retry') }}
      </button>
    </div>

    <div
      v-else-if="!store.hasProjects"
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
      ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
      <h3>{{ $t('system.projects.noProjects') }}</h3>
      <p>{{ $t('system.projects.noProjectsDesc') }}</p>
      <button
        class="btn btn-primary"
        @click="openCreateDialog"
      >
        {{ $t('system.projects.newProject') }}
      </button>
    </div>

    <div
      v-else
      class="project-grid"
    >
      <div
        v-for="project in displayProjects"
        :key="project.projectId"
        class="project-card"
        :class="[
          'accent-' + getAccentColor(project.projectName),
          { 'is-recent': isRecentlyUpdated(project.updatedAt), 'is-disabled': !project.enabled, 'is-enabled': project.enabled },
        ]"
        @click="openProject(project.projectId)"
      >
        <!-- Cover image: large display; when no image, use theme-color gradient + initial -->
        <div class="card-cover">
          <img
            v-if="project.image"
            :src="projectApi.getImageUrl(project.projectId)"
            class="card-cover-img"
            :alt="project.projectName"
          >
          <div
            v-else
            class="card-cover-fallback"
            :class="'cover-accent-' + getAccentColor(project.projectName)"
          >
            <span class="cover-initial">{{ getInitial(project.projectName) }}</span>
          </div>
          <!-- Disabled-status badge: when a project is not enabled, no acquisition and not shown in the device tree/monitoring -->
          <span
            v-if="!project.enabled"
            class="cover-chip cover-chip-disabled"
            :title="$t('system.projects.disabledHint')"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            ><circle
              cx="12"
              cy="12"
              r="10"
            /><line
              x1="4.93"
              y1="4.93"
              x2="19.07"
              y2="19.07"
            /></svg>
            {{ $t('system.projects.disabled') }}
          </span>
          <!-- Enable badge: project is being collected -->
          <span
            v-else
            class="cover-chip cover-chip-enabled"
            :title="$t('system.projects.enabledHint')"
          >
            <span class="enabled-dot" />
            {{ $t('system.projects.enabled') }}
          </span>
          <!-- Recently-updated badge -->
          <span
            v-if="isRecentlyUpdated(project.updatedAt)"
            class="cover-chip cover-chip-recent"
          >
            <span class="recent-dot" />
            {{ $t('system.projects.recentlyUpdated') }}
          </span>
          <!-- Default-project badge -->
          <span
            v-if="defaultProjectId === project.projectId"
            class="cover-chip cover-chip-default"
            :title="$t('system.projects.isDefault')"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
            ><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
          </span>
        </div>
        <div class="card-header">
          <div class="card-title-wrap">
            <h3
              class="card-title"
              :title="project.projectName"
            >
              {{ project.projectName }}
            </h3>
            <div class="card-subtitle">
              <span
                v-if="project.updatedAt"
                class="card-time"
              >{{ formatRelativeTime(project.updatedAt) }}</span>
            </div>
          </div>
          <div class="card-actions">
            <!-- Quick enable/disable toggle: disabling a project stops acquisition immediately; enabling starts it immediately -->
            <button
              class="btn-icon"
              :class="{ 'btn-icon-warning': project.enabled }"
              :title="project.enabled ? $t('system.projects.disable') : $t('system.projects.enable')"
              @click.stop="handleToggleEnabled(project)"
            >
              <svg
                v-if="project.enabled"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ><circle
                cx="12"
                cy="12"
                r="10"
              /><line
                x1="4.93"
                y1="4.93"
                x2="19.07"
                y2="19.07"
              /></svg>
              <svg
                v-else
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
            </button>
            <button
              class="btn-icon"
              :title="$t('system.projects.edit')"
              @click.stop="openEditDialog(project)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              ><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </button>
            <button
              class="btn-icon btn-icon-danger"
              :title="$t('system.projects.delete')"
              @click.stop="confirmDelete(project)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              ><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            </button>
          </div>
        </div>
        <p
          v-if="project.description"
          class="card-desc"
          :title="project.description"
        >
          {{ project.description }}
        </p>
        <p
          v-else
          class="card-desc placeholder"
        >
          {{ $t('system.projects.noDescription') }}
        </p>
        <!-- Stats area: page count + folder size + version -->
        <div class="card-stats">
          <div class="stat-item">
            <span class="stat-value">{{ project.pageCount ?? 0 }}</span>
            <span class="stat-label">{{ $t('system.projects.pages') }}</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-item">
            <span class="stat-value">{{ formatFileSize(project.folderSize) }}</span>
            <span class="stat-label">{{ $t('system.projects.folderSize') }}</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-item">
            <span class="stat-value">{{ project.version || $t('system.projects.noVersion') }}</span>
            <span class="stat-label">{{ $t('system.projects.versionLabel') }}</span>
          </div>
        </div>
        <!-- Resource path: concise reference info -->
        <div
          v-if="project.projectPath || project.databasePath"
          class="card-resources"
          :title="(project.projectPath || '') + '\n' + (project.databasePath || '')"
        >
          <div
            v-if="project.projectPath"
            class="resource-item"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            ><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            <span class="resource-value">{{ shortenPath(project.projectPath) }}</span>
          </div>
          <div
            v-if="project.databasePath"
            class="resource-item"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            ><ellipse
              cx="12"
              cy="5"
              rx="9"
              ry="3"
            /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
            <span class="resource-value">{{ shortenPath(project.databasePath) }}</span>
          </div>
        </div>
        <div class="card-footer">
          <button
            class="btn btn-sm btn-ghost btn-manage"
            @click.stop="handleManage(project.projectId)"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            ><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line
              x1="8"
              y1="13"
              x2="16"
              y2="13"
            /><line
              x1="8"
              y1="17"
              x2="16"
              y2="17"
            /></svg>
            {{ $t('system.projects.manage') }}
          </button>
          <button
            class="btn btn-sm btn-ghost btn-default"
            :class="{ 'is-active': defaultProjectId === project.projectId }"
            :title="defaultProjectId === project.projectId ? $t('system.projects.isDefault') : $t('system.projects.setDefault')"
            @click.stop="handleSetDefault(project.projectId)"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              :stroke="defaultProjectId === project.projectId ? 'var(--primary)' : 'currentColor'"
              stroke-width="2"
              stroke-linecap="round"
            ><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            {{ defaultProjectId === project.projectId ? $t('system.projects.isDefaultShort') : $t('system.projects.setDefault') }}
          </button>
          <button
            class="btn btn-sm btn-primary btn-open"
            @click.stop="openProject(project.projectId)"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            ><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line
              x1="10"
              y1="14"
              x2="21"
              y2="3"
            /></svg>
            {{ $t('system.projects.openEditor') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="store.hasProjects && store.pagination.totalPages > 1"
      class="pagination"
    >
      <button
        class="btn btn-secondary btn-sm"
        :disabled="store.pagination.page <= 1"
        @click="goToPage(store.pagination.page - 1)"
      >
        {{ $t('system.projects.prevPage') }}
      </button>
      <span class="page-info">
        {{ store.pagination.page }} / {{ store.pagination.totalPages }}
      </span>
      <button
        class="btn btn-secondary btn-sm"
        :disabled="!store.hasMore"
        @click="goToPage(store.pagination.page + 1)"
      >
        {{ $t('system.projects.nextPage') }}
      </button>
    </div>

    <div
      v-if="showCreateDialog"
      class="modal-overlay"
      @click.self="closeCreateDialog"
    >
      <div class="modal">
        <div class="modal-header">
          <h2>{{ editingProject ? $t('system.projects.editProject') : $t('system.projects.newProject') }}</h2>
          <button
            class="modal-close"
            @click="closeCreateDialog"
          >
            &times;
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">{{ $t('system.projects.coverImage') }}</label>
            <div class="image-upload-area">
              <div
                v-if="imagePreview"
                class="image-preview-wrapper"
              >
                <img
                  :src="imagePreview"
                  class="image-preview"
                  alt="cover"
                >
                <button
                  type="button"
                  class="image-remove-btn"
                  :title="$t('system.projects.removeImage')"
                  @click="handleImageRemove"
                >
                  &times;
                </button>
              </div>
              <label
                v-else
                class="image-upload-placeholder"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
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
                /><path d="M21 15l-5-5L5 21" /></svg>
                <span>{{ $t('system.projects.uploadImageHint') }}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  class="image-file-input"
                  @change="handleImageSelect"
                >
              </label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('system.projects.name') }} <span class="required">*</span></label>
            <input
              v-model="form.name"
              type="text"
              class="form-input"
              :class="{ 'form-input-disabled': editingProject }"
              :placeholder="$t('system.projects.namePlaceholder')"
              :disabled="!!editingProject"
              maxlength="100"
              @keyup.enter="handleSubmit"
            >
            <p
              v-if="editingProject"
              class="form-hint"
            >
              {{ $t('system.projects.nameReadonly') }}
            </p>
            <p
              v-else
              class="form-hint"
            >
              {{ $t('system.projects.nameHint') }}
            </p>
          </div>
          <div
            v-if="!editingProject"
            class="form-group"
          >
            <label class="form-label">{{ $t('system.projects.code') }}</label>
            <input
              v-model="form.pid"
              type="text"
              class="form-input"
              :placeholder="$t('system.projects.codePlaceholder')"
              maxlength="64"
            >
            <p class="form-hint">
              {{ $t('system.projects.codeHint') }}
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('system.projects.version') }}</label>
            <input
              v-model="form.version"
              type="text"
              class="form-input"
              :placeholder="$t('system.projects.versionPlaceholder')"
              maxlength="64"
            >
            <p class="form-hint">
              {{ $t('system.projects.versionHint') }}
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('system.projects.address') }}</label>
            <input
              v-model="form.address"
              type="text"
              class="form-input"
              :placeholder="$t('system.projects.addressPlaceholder')"
              maxlength="200"
            >
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">{{ $t('system.projects.longitude') }}</label>
              <input
                v-model="form.longitude"
                type="text"
                class="form-input"
                :placeholder="$t('system.projects.longitudePlaceholder')"
                maxlength="20"
              >
            </div>
            <div class="form-group">
              <label class="form-label">{{ $t('system.projects.latitude') }}</label>
              <input
                v-model="form.latitude"
                type="text"
                class="form-input"
                :placeholder="$t('system.projects.latitudePlaceholder')"
                maxlength="20"
              >
            </div>
          </div>
          <!-- Map point selection: pop up a map to pick lat/lng; after confirmation, auto reverse-geocode to fill the address -->
          <div class="geocode-row">
            <button
              type="button"
              class="btn btn-secondary btn-sm btn-geocode"
              :disabled="geocoding"
              @click="showMapPicker = true"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle
                cx="12"
                cy="10"
                r="3"
              /></svg>
              {{ $t('system.projects.mapPickBtn') }}
            </button>
            <span
              v-if="geocoding"
              class="geocode-hint"
            >{{ $t('system.projects.geocoding') }}</span>
            <span
              v-else-if="geocodeHint"
              class="geocode-hint"
              :class="{ 'hint-success': geocodeOk, 'hint-error': !geocodeOk }"
            >{{ geocodeHint }}</span>
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('system.projects.owner') }}</label>
            <input
              v-model="form.owner"
              type="text"
              class="form-input"
              :placeholder="$t('system.projects.ownerPlaceholder')"
              maxlength="64"
            >
          </div>
          <div class="form-group">
            <label class="form-label">{{ $t('system.projects.description') }}</label>
            <textarea
              v-model="form.description"
              class="form-input form-textarea"
              :placeholder="$t('system.projects.descPlaceholder')"
              rows="3"
            />
          </div>
          <!-- Enable switch: new entries default to disabled; acquisition starts only after enabling; toggle takes effect immediately -->
          <div class="form-group form-group-switch">
            <label class="form-label">{{ $t('system.projects.enabledLabel') }}</label>
            <div class="switch-row">
              <label class="switch">
                <input
                  v-model="form.enabled"
                  type="checkbox"
                >
                <span class="switch-slider" />
              </label>
              <span class="switch-label">
                {{ form.enabled ? $t('system.projects.enabled') : $t('system.projects.disabled') }}
              </span>
            </div>
            <p class="form-hint">
              {{ $t('system.projects.enabledFormHint') }}
            </p>
          </div>
          <p
            v-if="formSuccess"
            class="form-success"
          >
            {{ formSuccess }}
          </p>
          <p
            v-if="formError"
            class="form-error"
          >
            {{ formError }}
          </p>
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-secondary"
            @click="closeCreateDialog"
          >
            {{ $t('system.projects.cancel') }}
          </button>
          <button
            class="btn btn-primary"
            :disabled="submitting"
            @click="handleSubmit"
          >
            {{ submitting ? $t('system.projects.submitting') : (editingProject ? $t('system.projects.save') : $t('system.projects.create')) }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="showDeleteDialog"
      class="modal-overlay"
      @click.self="closeDeleteDialog"
    >
      <div class="modal modal-sm">
        <div class="modal-header">
          <h2>{{ $t('system.projects.confirmDelete') }}</h2>
          <button
            class="modal-close"
            @click="closeDeleteDialog"
          >
            &times;
          </button>
        </div>
        <div class="modal-body">
          <p>{{ $t('system.projects.confirmDeleteDesc') }} "<strong>{{ deletingProject?.projectName }}</strong>"？</p>
          <p class="warning-text">
            {{ $t('system.projects.deleteWarning') }}
          </p>
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-secondary"
            @click="closeDeleteDialog"
          >
            {{ $t('system.projects.cancel') }}
          </button>
          <button
            class="btn btn-danger"
            :disabled="submitting"
            @click="handleDelete"
          >
            {{ submitting ? $t('system.projects.deleting') : $t('system.projects.confirmDeleteBtn') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Map point-selection dialog -->
    <MapPickerDialog
      v-model:visible="showMapPicker"
      :initial-lng="form.longitude"
      :initial-lat="form.latitude"
      @select="handleMapSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from '@scada-editor/core';
import { useProjectStore } from '../../stores/project.store';
import { useProjectContext } from '../../composables/useProjectContext';
import { projectApi } from '../../api/modules/project.api';
import type { Project } from '../../types/api';
import { SsLoading } from '@scada-editor/shared';
import MapPickerDialog from './MapPickerDialog.vue';

const router = useRouter();
const store = useProjectStore();
const { t } = useI18n();
const { defaultProjectId, setDefaultProject: setDefault, clearDefaultProject: clearDefault, loadDefault } = useProjectContext();

const keyword = ref('');

/**
 * Enabled-state filter
 * - 'all'      : show all projects (default)
 * - 'enabled'  : show only enabled projects
 * - 'disabled' : show only disabled projects
 *
 * The backend GET /projects does not yet support an enabled filter param, so filtering is done on the current page data on the frontend.
 * The filter remains effective when paging, preserving the user's filter context.
 */
type EnabledFilter = 'all' | 'enabled' | 'disabled';
const enabledFilter = ref<EnabledFilter>('all');

/**
 * Project list filtered by enabled state
 * Filtered on the frontend directly from store.projects, avoiding changes to the backend API and store signature
 */
const displayProjects = computed<Project[]>(() => {
  if (enabledFilter.value === 'all') return store.projects;
  if (enabledFilter.value === 'enabled') return store.projects.filter((p) => p.enabled);
  return store.projects.filter((p) => !p.enabled);
});
const showCreateDialog = ref(false);
const showDeleteDialog = ref(false);
const showMapPicker = ref(false);
const editingProject = ref<Project | null>(null);
const deletingProject = ref<Project | null>(null);
const submitting = ref(false);
const formError = ref('');
const formSuccess = ref('');
const loading = ref(false);
/** The project cover image file chosen by the user (staged when creating, uploaded after submit) */
const imageFile = ref<File | null>(null);
/** Image preview URL (object URL when creating, backend URL when editing) */
const imagePreview = ref('');
/** Reverse geocoding loading state */
const geocoding = ref(false);
/** Reverse geocoding result hint */
const geocodeHint = ref('');
/** Whether reverse geocoding succeeded (used for hint styling) */
const geocodeOk = ref(false);
const form = ref({
  name: '',
  pid: '',
  version: '1.0.0',
  address: '',
  longitude: '',
  latitude: '',
  owner: '',
  description: '',
  /** Enabled state: new entries default to disabled (false); data acquisition starts only after manual enable */
  enabled: false,
});

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/** Relative time: just now / N minutes ago / N hours ago / N days ago / absolute date */
function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return '';
  const diff = Date.now() - ts;
  const ONE_DAY = 86400000;
  if (diff < 0 || diff >= ONE_DAY * 7) return formatDate(dateStr);
  if (diff < 60000) return t('system.projects.justNow');
  if (diff < 3600000) {
    return t('system.projects.minutesAgo', { n: Math.floor(diff / 60000) });
  }
  if (diff < ONE_DAY) {
    return t('system.projects.hoursAgo', { n: Math.floor(diff / 3600000) });
  }
  return t('system.projects.daysAgo', { n: Math.floor(diff / ONE_DAY) });
}

/** Determine whether recently updated (within 24h) — a business activity metric */
function isRecentlyUpdated(dateStr?: string): boolean {
  if (!dateStr) return false;
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return false;
  return Date.now() - ts < 86400000;
}

/** Get the first letter of a project name (prefer the English initial, otherwise the first Chinese character) */
function getInitial(name: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  return trimmed.charAt(0).toUpperCase();
}

/** Pick the theme color by project-name hash (6 variants, 0-5) */
function getAccentColor(name: string): number {
  if (!name) return 0;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 6;
}

/** Shorten a long path, keeping only the last 2 directory levels */
function shortenPath(p?: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-2).join('/');
}

/** Format file size: bytes → KB/MB/GB adaptive */
function formatFileSize(bytes?: number): string {
  if (bytes == null || bytes < 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  // B shows an integer; the rest keep 1 decimal place
  return idx === 0 ? `${val} ${units[idx]}` : `${val.toFixed(1)} ${units[idx]}`;
}

function openProject(projectId: string) {
  const route = router.resolve(`/editor/${projectId}`);
  window.open(route.href, '_blank');
}

function openCreateDialog() {
  editingProject.value = null;
  form.value = {
    name: '',
    pid: '',
    version: '1.0.0',
    address: '',
    longitude: '',
    latitude: '',
    owner: '',
    description: '',
    // New projects default to disabled; data acquisition starts only after manual enable
    enabled: false,
  };
  imageFile.value = null;
  imagePreview.value = '';
  formError.value = '';
  geocodeHint.value = '';
  showCreateDialog.value = true;
}

function openEditDialog(project: Project) {
  editingProject.value = project;
  form.value = {
    name: project.projectName,
    pid: project.projectId || '',
    version: project.version || '1.0.0',
    address: project.address || '',
    longitude: project.longitude || '',
    latitude: project.latitude || '',
    owner: project.owner || '',
    description: project.description || '',
    // Compatible with old projectinfo.json lacking the enabled field, defaulting to disabled
    enabled: project.enabled ?? false,
  };
  imageFile.value = null;
  imagePreview.value = project.image ? projectApi.getImageUrl(project.projectId) : '';
  formError.value = '';
  geocodeHint.value = '';
  showCreateDialog.value = true;
}

function closeCreateDialog() {
  showCreateDialog.value = false;
  editingProject.value = null;
  // Release object URL to avoid memory leaks
  if (imageFile.value && imagePreview.value.startsWith('blob:')) {
    URL.revokeObjectURL(imagePreview.value);
  }
  imageFile.value = null;
  imagePreview.value = '';
}

/** Handle image file selection */
function handleImageSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // Validate file type
  if (!file.type.startsWith('image/')) {
    formError.value = t('system.projects.errorImageType');
    input.value = '';
    return;
  }
  // Validate file size (10MB)
  if (file.size > 10 * 1024 * 1024) {
    formError.value = t('system.projects.errorImageSize');
    input.value = '';
    return;
  }
  // Release the old object URL
  if (imageFile.value && imagePreview.value.startsWith('blob:')) {
    URL.revokeObjectURL(imagePreview.value);
  }
  imageFile.value = file;
  imagePreview.value = URL.createObjectURL(file);
  formError.value = '';
}

/** Remove the selected image */
function handleImageRemove() {
  if (imageFile.value && imagePreview.value.startsWith('blob:')) {
    URL.revokeObjectURL(imagePreview.value);
  }
  imageFile.value = null;
  imagePreview.value = '';
}

/**
 * Reverse geocoding: call OSM Nominatim with lat/lng to get the address name.
 * Public endpoint is rate-limited to 1 req/s and is only for manual triggers; accept-language=zh-CN returns a Chinese address.
 * Data © OpenStreetMap contributors, under the ODbL license.
 */
async function reverseGeocode() {
  const lng = form.value.longitude.trim();
  const lat = form.value.latitude.trim();
  if (!lng || !lat) {
    geocodeOk.value = false;
    geocodeHint.value = t('system.projects.geocodeNeedCoords');
    return;
  }
  const decimalRe = /^-?\d+(\.\d+)?$/;
  if (!decimalRe.test(lng) || !decimalRe.test(lat)) {
    geocodeOk.value = false;
    geocodeHint.value = t('system.projects.errorLatLng');
    return;
  }
  geocoding.value = true;
  geocodeHint.value = '';
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=zh-CN&zoom=18`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data && data.display_name) {
      // display_name is a full address string, truncated to the field max length 200
      const name = String(data.display_name).slice(0, 200);
      form.value.address = name;
      geocodeOk.value = true;
      geocodeHint.value = t('system.projects.geocodeSuccess');
    } else {
      geocodeOk.value = false;
      geocodeHint.value = t('system.projects.geocodeNoResult');
    }
  } catch {
    geocodeOk.value = false;
    geocodeHint.value = t('system.projects.geocodeFailed');
  } finally {
    geocoding.value = false;
  }
}

/** Map point-selection confirm callback: fill lat/lng and auto-trigger reverse geocoding to fetch the address */
function handleMapSelect(lng: number, lat: number) {
  // Keep 6 decimals, strip trailing zeros
  form.value.longitude = String(Number(lng.toFixed(6)));
  form.value.latitude = String(Number(lat.toFixed(6)));
  // Auto-fetch the address name after point selection
  void reverseGeocode();
}

function confirmDelete(project: Project) {
  deletingProject.value = project;
  showDeleteDialog.value = true;
}

function closeDeleteDialog() {
  showDeleteDialog.value = false;
  deletingProject.value = null;
}

async function handleSubmit() {
  formError.value = '';
  formSuccess.value = '';
  if (!form.value.name.trim()) {
    formError.value = t('system.projects.errorNameEmpty');
    return;
  }
  // Project code format validation (only when code is filled on create)
  if (!editingProject.value && form.value.pid.trim()) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(form.value.pid.trim())) {
      formError.value = t('system.projects.errorPidInvalid');
      return;
    }
  }
  // Lat/lng format validation (decimal numbers)
  const lng = form.value.longitude.trim();
  const lat = form.value.latitude.trim();
  const decimalRe = /^-?\d+(\.\d+)?$/;
  if ((lng && !decimalRe.test(lng)) || (lat && !decimalRe.test(lat))) {
    formError.value = t('system.projects.errorLatLng');
    return;
  }

  submitting.value = true;
  try {
    if (editingProject.value) {
      await store.updateProject(editingProject.value.projectId, {
        description: form.value.description.trim() || undefined,
        version: form.value.version.trim() || undefined,
        address: form.value.address.trim() || undefined,
        longitude: form.value.longitude.trim() || undefined,
        latitude: form.value.latitude.trim() || undefined,
        owner: form.value.owner.trim() || undefined,
        enabled: form.value.enabled,
      });
      // On edit: if the user selected a new image, upload it to the server
      if (imageFile.value) {
        await projectApi.uploadImage(editingProject.value.projectId, imageFile.value);
      }
      formSuccess.value = t('system.projects.successSaved');
      setTimeout(() => {
        closeCreateDialog();
      }, 1500);
    } else {
      const project = await store.createProject({
        projectName: form.value.name.trim(),
        projectId: form.value.pid.trim() || undefined,
        version: form.value.version.trim() || undefined,
        address: form.value.address.trim() || undefined,
        longitude: form.value.longitude.trim() || undefined,
        latitude: form.value.latitude.trim() || undefined,
        owner: form.value.owner.trim() || undefined,
        description: form.value.description.trim() || undefined,
        enabled: form.value.enabled,
      });
      if (project) {
        // On create: upload the image after the project is created successfully (if any)
        if (imageFile.value) {
          try {
            await projectApi.uploadImage(project.projectId, imageFile.value);
          } catch (imgErr) {
            // Image upload failure does not block the project creation flow; only a hint is shown
            console.warn('Project image upload failed:', imgErr);
          }
        }
        closeCreateDialog();
        router.push(`/editor/${project.projectId}`);
        return;
      }
    }
  } catch (e: any) {
    formError.value = editingProject.value
      ? t('system.projects.errorSaveFailed')
      : (e?.response?.data?.message || t('system.projects.errorGeneric'));
  } finally {
    submitting.value = false;
  }
}

async function handleDelete() {
  if (!deletingProject.value) return;

  submitting.value = true;
  try {
    await store.deleteProject(deletingProject.value.projectId);
    closeDeleteDialog();
  } catch (e: any) {
    formError.value = e?.response?.data?.message || t('system.projects.errorDelete');
  } finally {
    submitting.value = false;
  }
}

function handleSearch() {
  store.fetchProjects(1, 20, keyword.value || undefined, true);
}

function handleRefresh() {
  store.fetchProjects(store.pagination.page, store.pagination.pageSize, keyword.value || undefined, true);
}

function goToPage(page: number) {
  store.fetchProjects(page, store.pagination.pageSize, keyword.value || undefined, true);
}

function handleManage(projectId: string) {
  router.push(`/system/projects/${projectId}/manage`);
}

async function handleSetDefault(projectId: string) {
  // Toggle: clear if already default, otherwise set as default
  if (defaultProjectId.value === projectId) {
    await clearDefault();
  } else {
    await setDefault(projectId);
  }
}

/**
 * Toggle a project's enabled state
 *
 * Enable → the backend immediately starts data acquisition for all devices of the project
 * Disable → the backend immediately stops acquisition tasks for all devices and hides them from the device tree/monitoring
 */
async function handleToggleEnabled(project: Project) {
  const targetEnabled = !project.enabled;
  try {
    await store.toggleProjectEnabled(project.projectId, targetEnabled);
  } catch (e: any) {
    formError.value = e?.response?.data?.message || t('system.projects.errorToggleEnabled');
    // Error hint auto-clears after 3 seconds
    setTimeout(() => { formError.value = ''; }, 3000);
  }
}

onMounted(() => {
  // The project management page loads all projects (including disabled) for switching the enabled state
  store.fetchProjects(1, 20, undefined, true);
  loadDefault();
});
</script>

<style scoped>
.project-list {
  padding: 20px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.spinning {
  animation: spin 0.8s linear infinite;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.project-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.search-bar {
  position: relative;
  flex: 1;
  max-width: 360px;
  margin: 0 auto;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--border);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 6px 10px 6px 32px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.search-input::placeholder {
  color: var(--border);
}

.search-input:focus {
  border-color: var(--primary);
}

/* ── Enabled-state filter dropdown ── */
.filter-bar {
  flex-shrink: 0;
}

.filter-select {
  height: 32px;
  padding: 0 28px 0 10px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-sizing: border-box;
  /* Use a theme-color arrow instead of the native dropdown arrow for cross-platform visual consistency */
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a7a7a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 12px;
}

.filter-select:hover {
  border-color: var(--primary);
}

.filter-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 20%, transparent);
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--text-secondary);
  gap: 12px;
}

.empty-state svg {
  color: var(--border-light);
  margin-bottom: 8px;
}

.empty-state h3 {
  font-size: 18px;
  color: var(--text-secondary);
  margin: 0;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-light);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

/* Theme color is provided by .cover-accent-N (cover gradient background); see cover style below */

.project-card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  padding: 14px 14px 12px;
  cursor: pointer;
  transition: border-color 0.25s, box-shadow 0.25s, transform 0.25s;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.project-card:hover {
  border-color: var(--primary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}

/* Recent-update card: left theme-color glow emphasizes business activity */
.project-card.is-recent {
  border-color: color-mix(in srgb, var(--status-success) 40%, var(--border-light));
}
.project-card.is-recent::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 3px;
  background: var(--status-success);
  opacity: 0.6;
}

/* Disabled project card: overall desaturated + left red glow bar, indicating the project is not collected/not shown in the device tree */
.project-card.is-disabled {
  opacity: 0.65;
  filter: saturate(0.6);
}
.project-card.is-disabled::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 3px;
  background: var(--status-warning);
  opacity: 0.7;
  z-index: 1;
}
.project-card.is-disabled:hover {
  opacity: 0.85;
  filter: saturate(0.85);
}

.project-card:hover .card-actions {
  opacity: 1;
}

/* ===== Cover image: compact layout — small image + gradient fallback ===== */
.card-cover {
  position: relative;
  height: 88px;
  /* Negative margin to fill the card width (breaking the card padding), top flush with the card's top edge */
  margin: -14px -14px 12px;
  overflow: hidden;
  background: var(--border-light);
}

.card-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.4s ease;
}

.project-card:hover .card-cover-img {
  transform: scale(1.05);
}

.card-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-initial {
  font-size: 36px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  letter-spacing: 1px;
  user-select: none;
}

/* Cover gradient background (6 theme colors, more saturated than the avatar for large areas) */
.cover-accent-0 { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 55%, black)); }
.cover-accent-1 { background: linear-gradient(135deg, var(--status-success), color-mix(in srgb, var(--status-success) 55%, black)); }
.cover-accent-2 { background: linear-gradient(135deg, var(--status-warning), color-mix(in srgb, var(--status-warning) 55%, black)); }
.cover-accent-3 { background: linear-gradient(135deg, var(--status-error), color-mix(in srgb, var(--status-error) 55%, black)); }
.cover-accent-4 { background: linear-gradient(135deg, var(--status-info, var(--primary)), color-mix(in srgb, var(--status-info, var(--primary)) 55%, black)); }
.cover-accent-5 { background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 55%, black)); }

/* Cover badge (semi-transparent pill, overlaid on the cover's top-right/top-left) */
.cover-chip {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.3;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(6px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  letter-spacing: 0.2px;
}

.cover-chip-recent {
  /* Put the recently-updated badge at the bottom-left to avoid overlapping the enable/disable badge at the top-left */
  bottom: 6px;
  left: 6px;
  color: var(--status-success);
}

/* Disabled-status badge: top-left, orange-red filled background + white text, strong contrast */
.cover-chip-disabled {
  top: 6px;
  left: 6px;
  color: #fff;
  background: var(--status-warning);
  border: 1px solid color-mix(in srgb, var(--status-warning) 70%, white);
}

/* Enable badge: top-left, green filled background + white text, indicating the project is being collected */
.cover-chip-enabled {
  top: 6px;
  left: 6px;
  color: #fff;
  background: var(--status-success);
  border: 1px solid color-mix(in srgb, var(--status-success) 70%, white);
}

.enabled-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
  animation: pulse 2s ease-in-out infinite;
}

.cover-chip-default {
  top: 6px;
  right: 6px;
  color: var(--primary);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.card-title-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.35;
}

.card-subtitle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-time {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.75;
}

.recent-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--status-success);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.card-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.btn-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: 5px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: var(--border-light);
  color: var(--text);
}

.btn-icon-danger:hover {
  background: var(--status-error);
  border-color: var(--status-error);
  color: var(--text);
}

/* Enable-state toggle button: highlighted in warning color when currently enabled, hinting that clicking will stop acquisition */
.btn-icon-warning {
  color: var(--status-warning);
  border-color: color-mix(in srgb, var(--status-warning) 40%, var(--border-light));
}

.btn-icon-warning:hover {
  background: var(--status-warning);
  border-color: var(--status-warning);
  color: var(--text);
}

.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 8px 0;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  min-height: 17px;
}

.card-desc.placeholder {
  color: var(--border);
  font-style: italic;
  opacity: 0.7;
}

/* ===== Stats area: compact ===== */
.card-stats {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 8px;
  padding: 6px 8px;
  background: var(--background, var(--border-light));
  border-radius: 7px;
  border: 1px solid var(--border-light);
}

.stat-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.stat-label {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.75;
  letter-spacing: 0.3px;
}

.stat-divider {
  width: 1px;
  height: 22px;
  background: var(--border-light);
  margin: 0 6px;
  flex-shrink: 0;
}

.card-resources {
  margin-top: auto;
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  color: var(--text-secondary);
  overflow: hidden;
  opacity: 0.55;
  transition: opacity 0.2s;
}

.project-card:hover .resource-item {
  opacity: 0.8;
}

.resource-item svg {
  flex-shrink: 0;
  color: var(--border);
}

.resource-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 9px;
}

.card-footer {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-light);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-light);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--border-light);
  color: var(--text);
  border-color: var(--border);
}

.btn-manage {
  flex: 1;
  justify-content: center;
}

.btn-open {
  flex: 1.5;
  justify-content: center;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--surface);
}

.page-info {
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 70px;
  text-align: center;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1.4;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary);
  color: var(--text);
}

.btn-primary:hover:not(:disabled) {
  background: var(--button-hover);
}

.btn-secondary {
  background: var(--border-light);
  color: var(--text);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--border);
}

.btn-danger {
  background: var(--status-error);
  color: var(--text);
}

.btn-danger:hover:not(:disabled) {
  background: var(--status-error);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  width: 480px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.modal-sm {
  width: 400px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 0;
}

.modal-header h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.modal-close:hover {
  color: var(--text);
}

.modal-body {
  padding: 14px 20px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 14px;
}

.form-group {
  margin-bottom: 10px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-row .form-group {
  flex: 1;
  min-width: 0;
}

/* Reverse-geocoding button row */
.geocode-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.btn-geocode {
  flex-shrink: 0;
}

.geocode-hint {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.geocode-hint.hint-success {
  color: var(--status-success);
}

.geocode-hint.hint-error {
  color: var(--status-error);
}

/* Project cover image upload area */
.image-upload-area {
  width: 100%;
}

.image-preview-wrapper {
  position: relative;
  width: 100%;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-secondary);
}

.image-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-remove-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.image-remove-btn:hover {
  background: rgba(0, 0, 0, 0.85);
}

.image-upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 120px;
  border: 2px dashed var(--border);
  border-radius: 8px;
  background: var(--surface-secondary);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
  font-size: 12px;
}

.image-upload-placeholder:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.image-file-input {
  display: none;
}

.form-label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.required {
  color: var(--status-error);
}

.form-input {
  width: 100%;
  padding: 7px 10px;
  background: var(--background);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-input::placeholder {
  color: var(--border);
}

.form-input:focus {
  border-color: var(--primary);
}

.form-input-disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: var(--border-light);
}

.form-hint {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0 0;
}

/* ===== Enabled-state switch (toggle switch) ===== */
.form-group-switch {
  padding: 8px 10px;
  background: var(--background, var(--border-light));
  border: 1px solid var(--border-light);
  border-radius: 7px;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

/* Slider: unselected = grey to the left, selected = green to the right */
.switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--border);
  border-radius: 20px;
  transition: background 0.25s;
}

.switch-slider::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  left: 3px;
  bottom: 3px;
  background: var(--text);
  border-radius: 50%;
  transition: transform 0.25s;
}

.switch input:checked + .switch-slider {
  background: var(--status-success);
}

.switch input:checked + .switch-slider::before {
  transform: translateX(16px);
}

.switch-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
}

.form-textarea {
  resize: vertical;
  min-height: 50px;
}

.form-success {
  color: var(--status-success);
  font-size: 12px;
  margin: -6px 0 0 0;
}

.form-error {
  color: var(--status-error);
  font-size: 12px;
  margin: -6px 0 0 0;
}

.warning-text {
  color: var(--status-warning);
  font-size: 13px;
  margin: 8px 0 0 0;
}
</style>