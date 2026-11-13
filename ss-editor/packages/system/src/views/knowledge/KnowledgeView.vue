<template>
  <div class="kb-page">
    <!-- ========== Page header ========== -->
    <div class="page-header">
      <h1 class="page-title">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="header-icon"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        {{ $t('system.nav.knowledge') }}
      </h1>
      <div class="header-actions">
        <!-- Product selection -->
        <select
          v-if="products.length > 1"
          v-model="selectedProduct"
          class="product-select"
          @change="onProductChange"
        >
          <option
            v-for="p in products"
            :key="p.id"
            :value="p.id"
          >
            {{ p.nameI18n?.[locale] || p.name }}
          </option>
        </select>
        <!-- Language selection -->
        <select
          v-model="selectedLang"
          class="lang-select"
          @change="onLangChange"
        >
          <option
            v-for="lang in supportedLangs"
            :key="lang"
            :value="lang"
          >
            {{ lang }}
          </option>
        </select>
        <!-- Search -->
        <div class="search-box">
          <input
            v-model="searchQuery"
            class="search-input"
            :placeholder="$t('system.kb.searchPlaceholder')"
            @keyup.enter="doSearch"
          >
          <button
            class="btn btn-sm btn-primary"
            :disabled="searching"
            @click="doSearch"
          >
            {{ $t('common.search') }}
          </button>
          <button
            v-if="searchResults !== null"
            class="btn btn-sm btn-secondary"
            @click="clearSearch"
          >
            {{ $t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ========== Main body ========== -->
    <div class="kb-body">
      <!-- Left directory tree / search results -->
      <aside class="kb-sidebar">
        <div class="sidebar-header">
          <span v-if="searchResults !== null">{{ $t('system.kb.searchResults') }} ({{ searchResults.length }})</span>
          <span v-else>{{ $t('system.kb.contents') }}</span>
        </div>

        <!-- Search result list -->
        <div
          v-if="searchResults !== null"
          class="search-result-list"
        >
          <div
            v-if="searchResults.length === 0"
            class="empty-hint"
          >
            {{ $t('system.kb.noResults') }}
          </div>
          <div
            v-for="r in searchResults"
            :key="r.id"
            class="search-result-item"
            :class="{ active: r.id === currentArticleId }"
            @click="openArticle(r.id)"
          >
            <div class="result-title">
              {{ r.title }}
            </div>
            <div
              class="result-snippet"
              v-html="r.snippet"
            />
            <div class="result-module">
              {{ r.module }}
            </div>
          </div>
        </div>

        <!-- Directory tree -->
        <div
          v-else
          class="tree-list"
        >
          <div
            v-if="tree.length === 0"
            class="empty-hint"
          >
            {{ loading ? $t('common.loading') : $t('system.kb.empty') }}
          </div>
          <template
            v-for="node in flatTree"
            :key="node.id"
          >
            <div
              class="tree-item"
              :class="{
                'tree-folder': node.type === 'folder',
                'tree-article': node.type === 'article',
                active: node.type === 'article' && node.id === currentArticleId,
                fallback: node.fallback,
              }"
              :style="{ paddingLeft: 8 + node.depth * 14 + 'px' }"
              @click="onTreeNodeClick(node)"
            >
              <span
                v-if="node.type === 'folder'"
                class="tree-toggle"
              >{{ expanded.has(node.id) ? '▾' : '▸' }}</span>
              <span
                v-else
                class="tree-dot"
              >·</span>
              <span class="tree-label">{{ node.title }}</span>
              <span
                v-if="node.fallback"
                class="fallback-mini"
                :title="$t('system.kb.fallbackHint')"
              >F</span>
            </div>
          </template>
        </div>
      </aside>

      <!-- Right-side article content -->
      <main class="kb-content">
        <div
          v-if="loadingArticle"
          class="content-empty"
        >
          {{ $t('common.loading') }}
        </div>
        <div
          v-else-if="!article"
          class="content-empty"
        >
          {{ $t('system.kb.selectArticle') }}
        </div>
        <article
          v-else
          class="article"
        >
          <header class="article-header">
            <h2 class="article-title">
              {{ article.title }}
            </h2>
            <div class="article-meta">
              <span
                v-if="article.fallback"
                class="badge badge-warn"
              >
                {{ $t('system.kb.fallbackFrom', { lang: article.requestedLang }) }}
              </span>
              <span class="meta-lang">{{ article.lang }}</span>
              <span class="meta-module">{{ article.module }}</span>
              <span class="meta-updated">{{ formatDate(article.updatedAt) }}</span>
              <button
                v-if="isAdmin"
                class="btn btn-sm btn-primary"
                @click="toggleEdit"
              >
                {{ editing ? $t('common.cancel') : $t('common.edit') }}
              </button>
            </div>
          </header>

          <!-- View mode -->
          <div
            v-if="!editing"
            class="article-content markdown-body"
            v-html="renderedContent"
          />

          <!-- Edit mode -->
          <div
            v-else
            class="article-editor"
          >
            <div class="editor-toolbar">
              <button
                class="btn btn-sm btn-primary"
                :disabled="saving"
                @click="saveEdit"
              >
                {{ $t('common.save') }}
              </button>
              <button
                class="btn btn-sm btn-secondary"
                :disabled="saving"
                @click="insertImage"
              >
                {{ $t('system.kb.insertImage') }}
              </button>
              <span
                v-if="saving"
                class="saving-hint"
              >{{ $t('common.saving') }}</span>
            </div>
            <textarea
              v-model="editContent"
              class="editor-textarea"
              :placeholder="$t('system.kb.editPlaceholder')"
            />
          </div>
        </article>
      </main>
    </div>

    <!-- Image upload dialog -->
    <div
      v-if="imageDialogVisible"
      class="image-dialog-overlay"
      @click.self="imageDialogVisible = false"
    >
      <div class="image-dialog">
        <h3>{{ $t('system.kb.insertImage') }}</h3>
        <input
          ref="imageFileInput"
          type="file"
          accept="image/*"
          class="file-input"
          @change="onImageSelected"
        >
        <div v-if="imageModuleName">
          <label class="dialog-label">{{ $t('system.kb.module') }}</label>
          <input
            v-model="imageModuleName"
            class="dialog-input"
            readonly
          >
        </div>
        <div class="dialog-actions">
          <button
            class="btn btn-sm btn-secondary"
            @click="imageDialogVisible = false"
          >
            {{ $t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { kbApi, DEFAULT_PRODUCT } from '../../api/modules/kb.api';
import type {
  KbTreeNode,
  KbArticle,
  KbSearchResult,
  KbLangsResponse,
  KbProductListItem,
} from '../../api/modules/kb.api';
import { usePermission } from '../../composables/usePermission';
import { showSuccess, showError } from '../../utils/messageBox';
import { useI18n } from '@scada-editor/core';

const { t, locale } = useI18n();
const route = useRoute();
const { isAdmin } = usePermission();

// ===== Status =====
const products = ref<KbProductListItem[]>([]);
const selectedProduct = ref<string>(DEFAULT_PRODUCT);
const supportedLangs = ref<string[]>(['zh-CN']);
const defaultLang = ref('zh-CN');
const selectedLang = ref('zh-CN');
const tree = ref<KbTreeNode[]>([]);
const loading = ref(false);
const loadingArticle = ref(false);
const article = ref<KbArticle | null>(null);
const currentArticleId = ref<string>('');

// Search
const searchQuery = ref('');
const searchResults = ref<KbSearchResult[] | null>(null);
const searching = ref(false);

// Edit
const editing = ref(false);
const editContent = ref('');
const saving = ref(false);

// Tree expand state
const expanded = ref<Set<string>>(new Set());

// Image upload
const imageDialogVisible = ref(false);
const imageFileInput = ref<HTMLInputElement | null>(null);
const imageModuleName = ref('');

// ===== Computed properties =====
/** Flattened directory tree (with depth, supports collapsing) */
const flatTree = computed(() => {
  const result: Array<KbTreeNode & { depth: number }> = [];
  function walk(nodes: KbTreeNode[], depth: number) {
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (node.type === 'folder' && expanded.value.has(node.id) && node.children?.length) {
        walk(node.children, depth + 1);
      }
    }
  }
  walk(tree.value, 0);
  return result;
});

/** Rendered Markdown HTML */
const renderedContent = computed(() => {
  if (!article.value) return '';
  return renderMarkdown(article.value.content, article.value.lang);
});

// ===== Lifecycle =====
onMounted(async () => {
  await loadProducts();
  await loadLangs();
  await loadTree();
  // If the URL has a ?path= param, try route matching then open the corresponding article
  const routePath = route.query.path as string;
  if (routePath) {
    await matchAndOpen(routePath);
  }
});

// ===== Methods =====
async function loadProducts() {
  try {
    const res = await kbApi.getProducts();
    const data = (res as any)?.data ?? (res as any);
    if (data?.products && Array.isArray(data.products)) {
      products.value = data.products;
      if (data.defaultProduct && !selectedProduct.value) {
        selectedProduct.value = data.defaultProduct;
      }
    }
  } catch {
    // Fail silently; use the default product
  }
}

async function loadLangs() {
  try {
    const res = await kbApi.getLangs(selectedProduct.value);
    const data: KbLangsResponse | null = (res as any)?.data ?? (res as any);
    if (data) {
      defaultLang.value = data.defaultLang;
      supportedLangs.value = data.supportedLangs.length ? data.supportedLangs : ['zh-CN'];
      if (!supportedLangs.value.includes(selectedLang.value)) {
        selectedLang.value = data.defaultLang;
      }
    }
  } catch (e) {
    // Fail silently; use the default value
  }
}

async function loadTree() {
  loading.value = true;
  try {
    const res = await kbApi.getTree(selectedProduct.value, selectedLang.value);
    const data = (res as any)?.data ?? (res as any);
    tree.value = Array.isArray(data) ? data : [];
    // Expand all first-level folders by default
    for (const node of tree.value) {
      if (node.type === 'folder') expanded.value.add(node.id);
    }
  } catch (e: any) {
    if (!e._errorHandled) {
      showError(e?.message || t('system.kb.loadFailed'));
    }
    tree.value = [];
  } finally {
    loading.value = false;
  }
}

async function onProductChange() {
  searchResults.value = null;
  article.value = null;
  currentArticleId.value = '';
  expanded.value = new Set();
  await loadLangs();
  await loadTree();
}

async function onLangChange() {
  searchResults.value = null;
  article.value = null;
  currentArticleId.value = '';
  expanded.value = new Set();
  await loadTree();
}

function onTreeNodeClick(node: KbTreeNode & { depth?: number }) {
  if (node.type === 'folder') {
    if (expanded.value.has(node.id)) {
      expanded.value.delete(node.id);
    } else {
      expanded.value.add(node.id);
    }
  } else {
    openArticle(node.id);
  }
}

async function openArticle(id: string) {
  currentArticleId.value = id;
  loadingArticle.value = true;
  editing.value = false;
  try {
    const res = await kbApi.getArticle(id, selectedProduct.value, selectedLang.value);
    const data = (res as any)?.data ?? (res as any);
    if (data) {
      article.value = data;
    } else {
      article.value = null;
      showError(t('system.kb.articleNotFound'));
    }
  } catch (e: any) {
    article.value = null;
    if (!e._errorHandled) {
      showError(e?.message || t('system.kb.loadFailed'));
    }
  } finally {
    loadingArticle.value = false;
  }
}

async function doSearch() {
  if (!searchQuery.value.trim()) return;
  searching.value = true;
  searchResults.value = [];
  try {
    const res = await kbApi.search(searchQuery.value.trim(), selectedProduct.value, selectedLang.value);
    const data = (res as any)?.data ?? (res as any);
    searchResults.value = Array.isArray(data) ? data : [];
  } catch (e: any) {
    if (!e._errorHandled) {
      showError(e?.message || t('system.kb.searchFailed'));
    }
    searchResults.value = [];
  } finally {
    searching.value = false;
  }
}

function clearSearch() {
  searchResults.value = null;
  searchQuery.value = '';
}

async function matchAndOpen(routePath: string) {
  try {
    const res = await kbApi.matchRoute(routePath, selectedProduct.value, selectedLang.value);
    const data = (res as any)?.data ?? (res as any);
    if (data?.articleId) {
      await openArticle(data.articleId);
    } else if (data?.knowledgePath) {
      await openArticle(data.knowledgePath);
    }
  } catch {
    // Silent
  }
}

function toggleEdit() {
  if (editing.value) {
    editing.value = false;
    return;
  }
  if (!article.value) return;
  editContent.value = article.value.content;
  editing.value = true;
}

async function saveEdit() {
  if (!article.value) return;
  saving.value = true;
  try {
    const res = await kbApi.updateArticle(
      article.value.id,
      editContent.value,
      article.value.lang,
      selectedProduct.value,
    );
    const data = (res as any)?.data ?? (res as any);
    if (data) {
      article.value = data;
      editing.value = false;
      showSuccess(t('system.kb.saveSuccess'));
      // Refresh the directory tree (title may have changed)
      await loadTree();
    }
  } catch (e: any) {
    if (!e._errorHandled) {
      showError(e?.message || t('system.kb.saveFailed'));
    }
  } finally {
    saving.value = false;
  }
}

function insertImage() {
  if (!article.value) return;
  imageModuleName.value = article.value.module;
  imageDialogVisible.value = true;
}

async function onImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !article.value) return;
  try {
    const base64 = await fileToBase64(file);
    const res = await kbApi.uploadImage(
      file.name,
      base64,
      article.value.module,
      article.value.lang,
      selectedProduct.value,
    );
    const data = (res as any)?.data ?? (res as any);
    const url = data?.url;
    if (url) {
      // Insert Markdown image syntax at the cursor position
      const markdown = `![${file.name}](${url})`;
      editContent.value = (editContent.value || '') + '\n\n' + markdown + '\n';
      imageDialogVisible.value = false;
      showSuccess(t('system.kb.imageUploaded'));
    }
  } catch (e: any) {
    if (!e._errorHandled) {
      showError(e?.message || t('system.kb.uploadFailed'));
    }
  }
  // Reset the input to allow selecting the same file again
  input.value = '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:image/xxx;base64, prefix
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDate(s: string): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return s;
  }
}

// ===== Simple Markdown rendering =====
/**
 * Render Markdown to HTML.
 * Supports: headings, bold, italic, inline code, code blocks, lists, links, images, blockquotes, horizontal rules, paragraphs.
 * Image relative paths are resolved to the backend /kb/image endpoint.
 */
function renderMarkdown(md: string, lang: string): string {
  if (!md) return '';
  const lines = md.split('\n');
  const html: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let inList = false;
  let listBuffer: string[] = [];
  let paragraphBuffer: string[] = [];

  function flushParagraph() {
    if (paragraphBuffer.length > 0) {
      const text = paragraphBuffer.join(' ');
      if (text.trim()) {
        html.push(`<p>${inlineFormat(text, lang)}</p>`);
      }
      paragraphBuffer = [];
    }
  }
  function flushList() {
    if (listBuffer.length > 0) {
      html.push(`<ul>${listBuffer.map((li) => `<li>${inlineFormat(li, lang)}</li>`).join('')}</ul>`);
      listBuffer = [];
      inList = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Code block
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }
    // Divider
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      flushParagraph();
      flushList();
      html.push('<hr>');
      continue;
    }
    // Title
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineFormat(headingMatch[2], lang)}</h${level}>`);
      continue;
    }
    // Reference
    if (line.trim().startsWith('> ')) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineFormat(line.trim().slice(2), lang)}</blockquote>`);
      continue;
    }
    // List item
    const listMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      inList = true;
      listBuffer.push(listMatch[1]);
      continue;
    }
    // Ordered list
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      inList = true;
      listBuffer.push(olMatch[1]);
      continue;
    }
    // Empty line
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    // Normal paragraph
    if (inList) flushList();
    paragraphBuffer.push(line);
  }
  flushParagraph();
  flushList();
  if (inCodeBlock && codeBuffer.length > 0) {
    html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  }
  return html.join('\n');
}

/** Inline formatting: bold, italic, inline code, links, images */
function inlineFormat(text: string, lang: string): string {
  let result = escapeHtml(text);
  // Image ![alt](url)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    const resolved = resolveImageUrl(url, lang);
    return `<img src="${resolved}" alt="${alt}" loading="lazy" />`;
  });
  // Link [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Bold **text**
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text* or _text_
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');
  // Inline code `code`
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  return result;
}

/** Resolve an image URL: relative path → backend /kb/image endpoint */
function resolveImageUrl(url: string, lang: string): string {
  // Absolute URL (http/https) or data URI used directly
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
    return url;
  }
  // Site absolute path starting with /
  if (url.startsWith('/')) {
    return url;
  }
  // Relative path (e.g. 03-device/images/foo.png) → accessed via the backend /kb/image endpoint
  return kbApi.buildImageUrl(url, lang, selectedProduct.value);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Re-match when the route query.path changes
watch(() => route.query.path, (newPath) => {
  if (newPath && typeof newPath === 'string') {
    matchAndOpen(newPath);
  }
});
</script>

<style scoped>
.kb-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ===== Page header ===== */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.header-icon {
  color: var(--primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.lang-select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.product-select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.product-select:focus,
.lang-select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 26, 115, 232), 0.15);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-input {
  height: 32px;
  width: 220px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
}

.search-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 26, 115, 232), 0.15);
}

/* ===== Generic button ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
  white-space: nowrap;
}

.btn-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.btn-primary {
  background: var(--primary);
  color: var(--text);
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-dark, var(--primary));
  filter: brightness(1.1);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--surface-alt, rgba(255, 255, 255, 0.08));
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--surface-hover, rgba(255, 255, 255, 0.12));
}

/* ===== Main body ===== */
.kb-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* ===== Sidebar ===== */
.kb-sidebar {
  width: 280px;
  min-width: 240px;
  max-width: 320px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tree-list,
.search-result-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.empty-hint {
  padding: 20px 14px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

/* Tree node */
.tree-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: background 0.1s;
  user-select: none;
}

.tree-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.tree-folder {
  font-weight: 600;
}

.tree-article.active {
  background: rgba(var(--primary-rgb, 26, 115, 232), 0.12);
  color: var(--primary);
}

.tree-toggle {
  width: 12px;
  font-size: 10px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.tree-dot {
  width: 12px;
  text-align: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.tree-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fallback-mini {
  font-size: 10px;
  color: var(--status-warning);
  background: color-mix(in srgb, var(--status-warning) 15%, transparent);
  border-radius: 3px;
  padding: 0 4px;
  flex-shrink: 0;
}

.tree-item.fallback {
  opacity: 0.75;
  font-style: italic;
}

/* Search results */
.search-result-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
  border: 1px solid transparent;
}

.search-result-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.search-result-item.active {
  background: rgba(var(--primary-rgb, 26, 115, 232), 0.12);
  border-color: var(--primary);
}

.result-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 4px;
}

.result-snippet {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.result-module {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
  opacity: 0.7;
}

/* ===== Content area ===== */
.kb-content {
  flex: 1;
  overflow-y: auto;
  background: var(--background);
  min-width: 0;
}

.content-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}

.article {
  max-width: 880px;
  margin: 0 auto;
  padding: 28px 36px 60px;
}

.article-header {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.article-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 12px;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.badge-warn {
  background: color-mix(in srgb, var(--status-warning) 15%, transparent);
  color: var(--status-warning);
}

.meta-lang,
.meta-module {
  padding: 2px 8px;
  background: var(--surface-alt, rgba(255, 255, 255, 0.08));
  border-radius: 4px;
}

/* ===== Markdown content ===== */
.markdown-body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 24px 0 12px;
  font-weight: 600;
  color: var(--text);
}

.markdown-body :deep(h1) { font-size: 22px; }
.markdown-body :deep(h2) { font-size: 19px; }
.markdown-body :deep(h3) { font-size: 16px; }
.markdown-body :deep(h4) { font-size: 14px; }

.markdown-body :deep(p) {
  margin: 12px 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 12px 0;
  padding-left: 24px;
}

.markdown-body :deep(li) {
  margin: 4px 0;
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  background: var(--surface-alt, rgba(255, 255, 255, 0.08));
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
}

.markdown-body :deep(pre) {
  margin: 16px 0;
  padding: 14px 16px;
  background: var(--surface-alt, rgba(0, 0, 0, 0.3));
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: none;
  font-size: 13px;
}

.markdown-body :deep(blockquote) {
  margin: 16px 0;
  padding: 8px 16px;
  border-left: 3px solid var(--primary);
  background: rgba(var(--primary-rgb, 26, 115, 232), 0.05);
  color: var(--text-secondary);
}

.markdown-body :deep(a) {
  color: var(--primary);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 12px 0;
}

.markdown-body :deep(hr) {
  margin: 24px 0;
  border: none;
  border-top: 1px solid var(--border);
}

/* ===== Editor ===== */
.article-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.saving-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.editor-textarea {
  width: 100%;
  min-height: 420px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
}

.editor-textarea:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb, 26, 115, 232), 0.15);
}

/* ===== Image upload dialog ===== */
.image-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.image-dialog {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px 24px;
  min-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.image-dialog h3 {
  margin: 0 0 16px;
  font-size: 16px;
  color: var(--text);
}

.dialog-label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.dialog-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-alt, rgba(255, 255, 255, 0.04));
  color: var(--text);
  font-size: 13px;
  margin-bottom: 12px;
}

.file-input {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ===== Scrollbar ===== */
.tree-list::-webkit-scrollbar,
.search-result-list::-webkit-scrollbar,
.kb-content::-webkit-scrollbar {
  width: 6px;
}

.tree-list::-webkit-scrollbar-track,
.search-result-list::-webkit-scrollbar-track,
.kb-content::-webkit-scrollbar-track {
  background: transparent;
}

.tree-list::-webkit-scrollbar-thumb,
.search-result-list::-webkit-scrollbar-thumb,
.kb-content::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.tree-list::-webkit-scrollbar-thumb:hover,
.kb-content::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>
