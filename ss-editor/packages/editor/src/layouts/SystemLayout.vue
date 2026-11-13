<template>
  <EditorThemeProvider>
    <div
      class="system-layout"
      :style="layoutStyle"
    >
      <header class="system-topbar">
        <div class="topbar-left">
          <img
            :src="logoUrl"
            class="topbar-logo"
            alt="SS"
            width="28"
            height="28"
          >
          <span class="topbar-brand">SMART DATA</span>
          <nav class="topbar-nav">
            <a
              v-for="item in topbarMenuItems"
              :key="item.id"
              class="topbar-nav-item"
              :class="{ 'topbar-nav-item--active': isActive(item) }"
              @click.prevent="handleMenuClick(item)"
            >
              {{ $t(item.labelKey) }}
            </a>
          </nav>
        </div>
        <div class="topbar-right">
          <!-- Theme switch -->
          <div class="theme-switcher">
            <button
              class="topbar-btn theme-btn"
              :title="$t('system.settings.selectTheme')"
              @click="toggleThemeDropdown"
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
              ><circle
                cx="12"
                cy="12"
                r="5"
              /><line
                x1="12"
                y1="1"
                x2="12"
                y2="3"
              /><line
                x1="12"
                y1="21"
                x2="12"
                y2="23"
              /><line
                x1="4.22"
                y1="4.22"
                x2="5.64"
                y2="5.64"
              /><line
                x1="18.36"
                y1="18.36"
                x2="19.78"
                y2="19.78"
              /><line
                x1="1"
                y1="12"
                x2="3"
                y2="12"
              /><line
                x1="21"
                y1="12"
                x2="23"
                y2="12"
              /><line
                x1="4.22"
                y1="19.78"
                x2="5.64"
                y2="18.36"
              /><line
                x1="18.36"
                y1="5.64"
                x2="19.78"
                y2="4.22"
              /></svg>
            </button>
            <div
              v-if="showThemeDropdown"
              class="theme-dropdown-menu"
            >
              <button
                v-for="theme in availableThemes"
                :key="theme"
                class="theme-dropdown-item"
                :class="{ active: currentTheme === theme }"
                @click="switchTheme(theme)"
              >
                <span>{{ themeIconMap[theme] || '◉' }}</span>
                <span>{{ $t(`system.layout.theme.${themeNameToCamel(theme)}`) }}</span>
              </button>
            </div>
          </div>

          <router-link
            :to="knowledgeLink"
            class="topbar-btn"
            :title="$t('system.nav.knowledge')"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><circle
              cx="12"
              cy="11"
              r="1.2"
            /><path d="M10.5 8.5a1.5 1.5 0 0 1 3 0c0 1-1.5 1.2-1.5 2" /></svg>
          </router-link>
          <router-link
            to="/editor"
            class="topbar-btn"
            :title="$t('system.layout.editor')"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ><rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="2"
              ry="2"
            /><line
              x1="3"
              y1="9"
              x2="21"
              y2="9"
            /><line
              x1="9"
              y1="21"
              x2="9"
              y2="9"
            /></svg>
            <span class="topbar-btn-label">{{ $t('system.layout.editor') }}</span>
          </router-link>
          <div class="topbar-divider" />
          <div
            class="topbar-user-info"
            :title="$t('system.layout.userSettings')"
            @click="showProfileDialog = true"
          >
            <div class="topbar-user-avatar">
              {{ userInitial }}
            </div>
            <span class="topbar-user-name">{{ authStore.user?.displayName || authStore.user?.username || $t('system.layout.user') }}</span>
            <svg
              class="topbar-user-chevron"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            ><polyline points="6 9 12 15 18 9" /></svg>
          </div>
          <button
            class="topbar-btn topbar-btn--logout"
            :title="$t('system.layout.logout')"
            @click="handleLogout"
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
            ><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line
              x1="21"
              y1="12"
              x2="9"
              y2="12"
            /></svg>
          </button>
        </div>
      </header>

      <ConnectionBanner />

      <div class="system-body">
        <aside
          class="sidebar"
          :class="{ 'sidebar--collapsed': sidebarCollapsed }"
        >
          <nav class="sidebar-nav">
            <template
              v-for="item in sidebarMenuItems"
              :key="item.id"
            >
              <div class="nav-item-row">
                <a
                  class="nav-item"
                  :class="{ 'nav-item--active': isActive(item) }"
                  :title="sidebarCollapsed ? $t(item.labelKey) : undefined"
                  @click.prevent="handleMenuClick(item)"
                >
                  <span class="nav-icon">
                    <SystemMenuIcon
                      :name="item.icon"
                      size="18"
                    />
                  </span>
                  <span
                    class="nav-label"
                    :class="{ 'nav-label--hidden': sidebarCollapsed }"
                  >{{ $t(item.labelKey) }}</span>
                </a>

                <!-- Submenu expand/collapse button -->
                <button
                  v-if="item.children?.length && !sidebarCollapsed"
                  class="nav-sub-toggle"
                  :class="{ 'nav-sub-toggle--expanded': expandedMenus.has(item.id) }"
                  @click.stop="toggleSubmenu(item.id)"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  ><polyline points="6 9 12 15 18 9" /></svg>
                </button>
              </div>

              <!-- Submenu (with collapse animation) -->
              <div
                v-if="item.children?.length && !sidebarCollapsed"
                class="nav-sub-wrapper"
                :class="{ 'nav-sub-wrapper--expanded': expandedMenus.has(item.id) }"
              >
                <div class="nav-sub-items">
                  <a
                    v-for="child in item.children"
                    :key="child.id"
                    class="nav-sub-item"
                    :class="{ 'nav-sub-item--active': route.path === `/system${child.path}` }"
                    @click.prevent="handleMenuClick(child)"
                  >
                    <span class="nav-sub-icon">
                      <SystemMenuIcon
                        :name="child.icon"
                        size="14"
                      />
                    </span>
                    {{ $t(child.labelKey) }}
                  </a>
                </div>
              </div>
            </template>
          </nav>

          <!-- Sidebar collapse button -->
          <button
            class="sidebar-collapse-btn"
            :title="sidebarCollapsed ? $t('system.layout.expandSidebar') : $t('system.layout.collapseSidebar')"
            @click="toggleSidebar"
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
              :class="{ 'rotate-180': sidebarCollapsed }"
            ><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        </aside>

        <main class="main-content">
          <!-- Tab bar -->
          <div class="system-tab-bar">
            <div
              v-for="tab in tabs"
              :key="tab.key"
              class="system-tab-item"
              :class="{ 'system-tab-item--active': tab.key === activeTabKey, 'system-tab-item--pinned': tab.pinned }"
              @click="switchTab(tab)"
              @contextmenu.prevent="onTabContextMenu($event, tab)"
            >
              <span
                v-if="tab.pinned"
                class="system-tab-pin-icon"
                title="固定标签"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                ><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" /></svg>
              </span>
              <span class="system-tab-title">{{ tab.labelKey ? $t(tab.labelKey) : tab.title }}</span>
              <button
                v-if="tabs.length > 1 && !tab.pinned"
                class="system-tab-close"
                @click.stop="closeTab(tab)"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                ><line
                  x1="18"
                  y1="6"
                  x2="6"
                  y2="18"
                /><line
                  x1="6"
                  y1="6"
                  x2="18"
                  y2="18"
                /></svg>
              </button>
            </div>
          </div>
          <!-- Right-click menu -->
          <Teleport to="body">
            <div
              v-if="contextMenu.visible"
              class="tab-context-menu"
              :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
            >
              <button
                class="context-menu-item"
                :class="{ 'context-menu-item--disabled': contextMenu.tab?.pinned }"
                :disabled="contextMenu.tab?.pinned"
                @click="handleContextClose"
              >
                {{ $t('system.layout.tabClose') }}
              </button>
              <button
                class="context-menu-item"
                @click="closeRightTabs(contextMenu.tab!)"
              >
                {{ $t('system.layout.tabCloseRight') }}
              </button>
              <button
                class="context-menu-item"
                @click="closeOtherTabs(contextMenu.tab!)"
              >
                {{ $t('system.layout.tabCloseOthers') }}
              </button>
              <button
                class="context-menu-item"
                @click="closeAllTabs()"
              >
                {{ $t('system.layout.tabCloseAll') }}
              </button>
            </div>
          </Teleport>
          <!-- Tab page content -->
          <div class="system-tab-content">
            <router-view v-slot="{ Component, route: _route }">
              <keep-alive>
                <component
                  :is="Component"
                  :key="_route.path"
                />
              </keep-alive>
            </router-view>
          </div>
        </main>
      </div>

      <!-- AI assistant floating panel (controlled by system config) -->
      <FloatingAiPanel v-if="aiAssistantVisible" />
      <!-- User profile dialog -->
      <UserProfileDialog
        :visible="showProfileDialog"
        @close="showProfileDialog = false"
      />
    </div>
  </EditorThemeProvider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore, useMenuStore, ConnectionBanner } from '@scada-editor/system';
import type { SystemMenuItem } from '@scada-editor/system';
import { themeManager, useTheme, useConfigStore, useI18n, getJsonCookie, setJsonCookie } from '@scada-editor/core';
import FloatingAiPanel from '../components/ai-assistant/FloatingAiPanel.vue';
import UserProfileDialog from '../common/UserProfileDialog.vue';
import EditorThemeProvider from '../common/theme/ThemeProvider.vue';
import SystemMenuIcon from '../common/SystemMenuIcon.vue';
import logoUrl from '../assets/logo.svg';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const menuStore = useMenuStore();
const configStore = useConfigStore();
const { switchTheme: useThemeSwitch, availableThemes } = useTheme();
const { t: _t } = useI18n();

const showThemeDropdown = ref(false);
const sidebarCollapsed = ref(false);
const showProfileDialog = ref(false);
const currentTheme = computed(() => configStore.ui?.theme ?? 'dark');

// Submenu collapse/expand state: records the currently expanded parent menu id
const expandedMenus = ref<Set<string>>(new Set());

function toggleSubmenu(id: string) {
  const next = new Set(expandedMenus.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedMenus.value = next;
}

// AI assistant floating panel visibility toggle (controlled by system config)
const aiAssistantVisible = computed(() => configStore.ui?.aiAssistantVisible !== false);

// Layout config — responsive style
const layoutStyle = computed(() => ({
  '--header-height': `${configStore.ui?.headerHeight ?? 60}px`,
  '--sidebar-width': `${configStore.ui?.sidebarWidth ?? 200}px`,
  '--sidebar-collapsed-width': '56px',
}));

// Menu filtered by role menuIds (v7.1: replaces filterByRole; admin sees all, non-admin filtered by menuIds)
const filteredMenu = computed(() =>
  menuStore.filterByMenuIds(menuStore.items, authStore.menuIds, authStore.isAdmin),
);

// Menu items (excluding detail pages and hidden items) — must be defined before all watch to avoid TDZ
const sidebarMenuItems = computed(() =>
  filteredMenu.value.filter(item => item.showInSidebar !== false && !item.isDetail),
);

const topbarMenuItems = computed(() =>
  filteredMenu.value.filter(item => item.showInTopbar !== false && !item.isDetail),
);

// Knowledge-base link (carries the current route path as context for routing to the matching article)
const knowledgeLink = computed(() => ({
  path: '/system/knowledge',
  query: route.path.startsWith('/system') ? { path: route.path } : {},
}));

// Auto-expand the parent of the currently active submenu on route change
watch(() => route.path, () => {
  const next = new Set(expandedMenus.value);
  for (const item of sidebarMenuItems.value) {
    if (item.children?.length) {
      const isChildActive = item.children.some(child => route.path === `/system${child.path}`);
      if (isChildActive) {
        next.add(item.id);
      }
    }
  }
  expandedMenus.value = next;
}, { immediate: true });

/** Determine whether a menu item is active */
function isActive(item: SystemMenuItem): boolean {
  // Parent with a submenu: highlighted when any child matches
  if (item.children?.length) {
    return item.children.some(child => route.path === `/system${child.path}`);
  }
  // Top-level menu: exact match
  if (item.path === '') return route.path === '/system';
  return route.path === `/system${item.path}` || route.path.startsWith(`/system${item.path}/`);
}

// ==================== Tab management ====================

interface SystemTab {
  key: string;       // Unique id = path
  path: string;      // Route path (e.g. /system, /system/devices)
  title: string;     // Translated titles
  labelKey: string;  // i18n key
  pinned?: boolean;  // Pinned tab (cannot be closed)
}

const OVERVIEW_PATH = '/system';
const OVERVIEW_KEY = 'system.nav.overview';
const TABS_COOKIE_KEY = 'ss-system-tabs';

interface SavedTabsState {
  paths: string[];       // Opened tab paths (excluding pinned)
  activePath: string;    // Currently active tab path
}

const tabs = ref<SystemTab[]>([]);
const activeTabKey = ref<string>('/system');

/** Get or create a tab by path */
function getOrCreateTab(path: string, labelKey: string): SystemTab {
  const key = path;
  let tab = tabs.value.find(t => t.key === key);
  if (!tab) {
    tab = {
      key,
      path,
      title: _t(labelKey),
      labelKey,
    };
    tabs.value = [...tabs.value, tab];
  }
  return tab;
}

/** Click a menu item: open or switch to the corresponding tab */
function handleMenuClick(item: SystemMenuItem) {
  const path = `/system${item.path}`;
  const tab = getOrCreateTab(path, item.labelKey);
  activeTabKey.value = tab.key;
  router.push(path);
}

/** Switch tab */
function switchTab(tab: SystemTab) {
  activeTabKey.value = tab.key;
  if (route.path !== tab.path) {
    router.push(tab.path);
  }
}

/** Close tab */
function closeTab(tab: SystemTab) {
  if (tab.pinned) return; // Pinned tabs cannot be closed
  const idx = tabs.value.findIndex(t => t.key === tab.key);
  if (idx === -1) return;

  const newTabs = [...tabs.value];
  newTabs.splice(idx, 1);
  tabs.value = newTabs;

  // If the closed tab is the active one, switch to an adjacent tab
  if (activeTabKey.value === tab.key) {
    const newActive = newTabs[Math.min(idx, newTabs.length - 1)];
    if (newActive) {
      activeTabKey.value = newActive.key;
      router.push(newActive.path);
    }
  }
}

// ==================== Tab persistence (Cookie) ====================

/** Save current tab state to Cookie */
function saveTabsToCookie() {
  const nonPinnedTabs = tabs.value.filter(t => !t.pinned);
  const state: SavedTabsState = {
    paths: nonPinnedTabs.map(t => t.path),
    activePath: activeTabKey.value,
  };
  setJsonCookie(TABS_COOKIE_KEY, state);
}

/** Restore tab state from Cookie */
function restoreTabsFromCookie(): boolean {
  const saved = getJsonCookie<SavedTabsState>(TABS_COOKIE_KEY);
  if (!saved || !saved.paths || saved.paths.length === 0) return false;

  // Rebuild the tab list
  const restoredTabs: SystemTab[] = [
    {
      key: OVERVIEW_PATH,
      path: OVERVIEW_PATH,
      title: _t(OVERVIEW_KEY),
      labelKey: OVERVIEW_KEY,
      pinned: true,
    },
  ];

  for (const path of saved.paths) {
    if (path === OVERVIEW_PATH) continue; // overview is already fixed-added
    const resolved = router.resolve(path);
    const titleKey = (resolved.meta?.titleKey as string) || '';
    let title = titleKey ? _t(titleKey) : path;
    const previewMatch = path.match(/^\/system\/preview\/(.+)$/);
    if (previewMatch) {
      title = `${_t('system.nav.preview')}-${decodeURIComponent(previewMatch[1])}`;
    }
    restoredTabs.push({
      key: path,
      path,
      title,
      labelKey: previewMatch ? '' : titleKey,
    });
  }

  tabs.value = restoredTabs;

  // Navigate to the last activated tab
  const activePath = saved.activePath;
  if (activePath && activePath !== route.path) {
    activeTabKey.value = activePath;
    router.push(activePath);
  } else {
    activeTabKey.value = activePath || OVERVIEW_PATH;
  }
  return true;
}

// ==================== Right-click menu ====================

interface TabContextMenu {
  visible: boolean;
  x: number;
  y: number;
  tab: SystemTab | null;
}

const contextMenu = ref<TabContextMenu>({
  visible: false,
  x: 0,
  y: 0,
  tab: null,
});

function onTabContextMenu(event: MouseEvent, tab: SystemTab) {
  event.preventDefault();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    tab,
  };
}

function hideContextMenu() {
  contextMenu.value.visible = false;
}

/** Close all tabs to the right */
function closeRightTabs(tab: SystemTab) {
  const idx = tabs.value.findIndex(t => t.key === tab.key);
  if (idx === -1) return;
  tabs.value = tabs.value.filter((t, i) => i <= idx || t.pinned);
  // If the active tab is closed, switch to the current tab
  if (!tabs.value.some(t => t.key === activeTabKey.value)) {
    activeTabKey.value = tab.key;
    router.push(tab.path);
  }
  hideContextMenu();
}

/** Close other tabs (keep current and pinned tabs) */
function closeOtherTabs(tab: SystemTab) {
  tabs.value = tabs.value.filter(t => t.key === tab.key || t.pinned);
  if (activeTabKey.value !== tab.key) {
    activeTabKey.value = tab.key;
    router.push(tab.path);
  }
  hideContextMenu();
}

/** Close all tabs (keep pinned tabs) */
function closeAllTabs() {
  tabs.value = tabs.value.filter(t => t.pinned);
  const pinned = tabs.value[0];
  if (pinned && activeTabKey.value !== pinned.key) {
    activeTabKey.value = pinned.key;
    router.push(pinned.path);
  }
  hideContextMenu();
}

/** Right-click menu click "关闭" */
function handleContextClose() {
  if (contextMenu.value.tab) {
    closeTab(contextMenu.value.tab);
  }
  hideContextMenu();
}

function handleClickOutside(event: MouseEvent) {
  const themeSwitcher = document.querySelector('.theme-switcher');
  if (themeSwitcher && !themeSwitcher.contains(event.target as Node)) {
    showThemeDropdown.value = false;
  }
  // Close the right-click menu
  if (contextMenu.value.visible) {
    const menu = document.querySelector('.tab-context-menu');
    if (menu && !menu.contains(event.target as Node)) {
      hideContextMenu();
    }
  }
}

// Try to restore tabs from Cookie (run before route watching to avoid duplicate tab creation)
restoreTabsFromCookie();

// Watch route change: keep tab state synced with the URL
watch(() => route.path, (newPath) => {
  activeTabKey.value = newPath;
  // If the current path is not in tabs, auto-add a tab
  if (!tabs.value.some(t => t.key === newPath)) {
    const matchedRoute = router.resolve(newPath);
    const titleKey = (matchedRoute.meta?.titleKey as string) || 'system.nav.overview';
    const isOverview = newPath === OVERVIEW_PATH;
    // Preview page generates a dynamic title: "预览-PageName"
    let title = _t(titleKey);
    const previewMatch = newPath.match(/^\/system\/preview\/(.+)$/);
    if (previewMatch) {
      const pageName = decodeURIComponent(previewMatch[1]);
      title = `${_t('system.nav.preview')}-${pageName}`;
    }
    tabs.value = [...tabs.value, {
      key: newPath,
      path: newPath,
      title,
      labelKey: previewMatch ? '' : titleKey,
      pinned: isOverview,
    }];
    // First init (page refresh): when the current page is not overview, append the overview pinned tab
    if (tabs.value.length === 1 && !isOverview) {
      tabs.value = [{
        key: OVERVIEW_PATH,
        path: OVERVIEW_PATH,
        title: _t(OVERVIEW_KEY),
        labelKey: OVERVIEW_KEY,
        pinned: true,
      }, ...tabs.value];
    }
  }
}, { immediate: true });

// Auto-save to Cookie on tab change (300ms debounce)
let saveTabsTimer: ReturnType<typeof setTimeout> | null = null;
watch([tabs, activeTabKey], () => {
  if (saveTabsTimer) clearTimeout(saveTabsTimer);
  saveTabsTimer = setTimeout(() => {
    saveTabsToCookie();
  }, 300);
}, { deep: true });

const themeIconMap: Record<string, string> = {
  light: '\u2600\uFE0F',
  dark: '\uD83C\uDF19',
  'high-contrast': '\u2B1C',
  blue: '\uD83D\uDD35',
  'tech-light-blue': '\uD83D\uDD37',
  'tech-dark-blue': '\uD83D\uDD35',
  'blue-light': '\uD83D\uDC8E',
  'blue-dark': '\uD83C\uDF0C',
  'green-tech': '\uD83D\uDC9A',
  'orange-warm': '\uD83D\uDD25',
  enterprise: '\uD83C\uDFE2',
};

function themeNameToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

onMounted(() => {
  const configTheme = configStore.ui?.theme;
  if (configTheme && configTheme !== themeManager.getCurrentThemeName()) {
    themeManager.setTheme(configTheme as any);
  }
  themeManager.applyThemeToDOM();
  document.addEventListener('click', handleClickOutside);
  // Load remote menu (async; default menu is available immediately)
  menuStore.loadMenu();
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  if (saveTabsTimer) clearTimeout(saveTabsTimer);
});

const userInitial = computed(() => {
  const name = authStore.user?.displayName || authStore.user?.username || 'U';
  return name.charAt(0).toUpperCase();
});

async function handleLogout() {
  await authStore.logout();
  router.push('/login');
}

function toggleThemeDropdown() {
  showThemeDropdown.value = !showThemeDropdown.value;
}

function switchTheme(theme: string) {
  useThemeSwitch(theme as any);
  showThemeDropdown.value = false;
}

</script>

<style scoped>
.system-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ===== Top bar ===== */
.system-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--header-height, 60px);
  padding: 0 20px;
  background: var(--header-background);
  color: var(--header-text);
  box-shadow: var(--shadow-small);
  flex-shrink: 0;
  z-index: 10;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar-logo {
  flex-shrink: 0;
  transition: transform 0.3s ease;
}

.topbar-logo:hover {
  transform: rotate(-8deg);
}

.topbar-brand {
  font-size: 16px;
  font-weight: 700;
  color: var(--header-text);
  margin-right: 16px;
  flex-shrink: 0;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, var(--header-text) 0%, var(--primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.topbar-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.topbar-nav-item {
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--header-text);
  opacity: 0.75;
  text-decoration: none;
  transition: all 0.2s ease;
  white-space: nowrap;
  position: relative;
}

.topbar-nav-item:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}

.topbar-nav-item--active {
  opacity: 1;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.12);
}

.topbar-nav-item--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  background: var(--primary, #1a73e8);
  border-radius: 1px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.topbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 6px;
  color: var(--header-text);
  cursor: pointer;
  text-decoration: none;
  transition: all 0.2s ease;
  font-size: 13px;
  white-space: nowrap;
}

.topbar-btn:hover {
  background: rgba(255, 255, 255, 0.16);
  transform: translateY(-1px);
}

.topbar-btn:active {
  transform: translateY(0);
}

.topbar-btn-label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.topbar-btn--logout:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--status-error);
}

.topbar-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.15);
}

.topbar-user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 0 8px;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.2s;
}

.topbar-user-info:hover {
  opacity: 1;
}

.topbar-user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark, #1557b0) 100%);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0;
}

.topbar-user-name {
  font-size: 13px;
  color: var(--header-text);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
}

.topbar-user-chevron {
  opacity: 0.4;
  flex-shrink: 0;
}

/* ===== Main body area ===== */
.system-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* ===== Sidebar ===== */
.sidebar {
  width: var(--sidebar-width, 200px);
  min-width: var(--sidebar-width, 200px);
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  user-select: none;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  position: relative;
}

.sidebar--collapsed {
  width: var(--sidebar-collapsed-width, 56px);
  min-width: var(--sidebar-collapsed-width, 56px);
}

.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  overflow-y: auto;
  overflow-x: hidden;
}

.nav-item-row {
  display: flex;
  align-items: center;
  position: relative;
}

.nav-item-row .nav-item {
  flex: 1;
  min-width: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 8px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  transition: all 0.15s;
  white-space: nowrap;
  overflow: hidden;
  position: relative;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.nav-item--active {
  background: rgba(26, 115, 232, 0.12);
  color: var(--primary);
}

.nav-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 16px;
  background: var(--primary);
  border-radius: 0 3px 3px 0;
  opacity: 0;
  transition: opacity 0.2s;
}

.nav-item--active::before {
  opacity: 1;
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.nav-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity 0.2s ease, width 0.2s ease;
}

.nav-label--hidden {
  opacity: 0;
  width: 0;
  display: none;
}

/* Submenu expand/collapse button */
.nav-sub-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s;
}

.nav-item-row:hover .nav-sub-toggle {
  opacity: 0.7;
}

.nav-sub-toggle:hover {
  opacity: 1 !important;
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}

.nav-sub-toggle--expanded svg {
  transform: rotate(180deg);
}

/* Submenu collapse container */
.nav-sub-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.nav-sub-wrapper--expanded {
  grid-template-rows: 1fr;
}

/* Submenu item container */
.nav-sub-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 14px;
  min-height: 0;
}

.nav-sub-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 12.5px;
  transition: all 0.15s;
  white-space: nowrap;
  overflow: hidden;
  position: relative;
}

.nav-sub-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}

.nav-sub-item--active {
  color: var(--primary);
  font-weight: 500;
}

.nav-sub-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.6;
}

.nav-sub-item--active .nav-sub-icon {
  opacity: 1;
}

/* ===== Sidebar collapse button ===== */
.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  margin: 4px 8px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.sidebar-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}

.sidebar-collapse-btn svg {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar-collapse-btn svg.rotate-180 {
  transform: rotate(180deg);
}

/* ===== Main content area ===== */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--background);
}

/* ===== Tab bar ===== */
.system-tab-bar {
  display: flex;
  align-items: stretch;
  height: 36px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  overflow-y: hidden;
  flex-shrink: 0;
}

.system-tab-bar::-webkit-scrollbar {
  height: 2px;
}

.system-tab-bar::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.system-tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 100%;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  border-right: 1px solid var(--border);
  background: transparent;
  transition: background 0.15s, color 0.15s;
  -webkit-user-select: none;
  user-select: none;
  flex-shrink: 0;
}

.system-tab-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.system-tab-item--active {
  color: var(--primary);
  background: var(--background);
  border-bottom: 2px solid var(--primary);
  margin-bottom: -1px;
}

.system-tab-item--active:hover {
  background: var(--background);
  color: var(--primary);
}

.system-tab-title {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.system-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 2px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.system-tab-item:hover .system-tab-close {
  opacity: 1;
}

.system-tab-item--active .system-tab-close {
  opacity: 0.8;
}

.system-tab-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--status-error);
}

/* ===== Tab page content ===== */
.system-tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

/* ===== Pinned tab ===== */
.system-tab-pin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--text-secondary);
  opacity: 0.6;
  flex-shrink: 0;
}

.system-tab-item--pinned {
  padding-left: 8px;
}

/* ===== Right-click menu ===== */
.tab-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tab-context-menu:focus {
  outline: none;
}

.context-menu-item {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 12.5px;
  text-align: left;
  transition: background 0.12s;
}

.context-menu-item:hover:not(:disabled) {
  background: rgba(26, 115, 232, 0.12);
  color: var(--primary);
}

.context-menu-item--disabled,
.context-menu-item:disabled {
  color: var(--text-tertiary);
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== Theme switching ===== */
.theme-switcher {
  position: relative;
  display: flex;
  align-items: center;
}

.theme-btn {
  width: 36px;
  padding: 0 !important;
  justify-content: center;
}

.theme-dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 1000;
  min-width: 140px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.theme-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 13px;
}

.theme-dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.theme-dropdown-item.active {
  background: rgba(26, 115, 232, 0.15);
  color: var(--primary);
}

/* ===== Scrollbar styling ===== */
.sidebar-nav::-webkit-scrollbar {
  width: 3px;
}

.sidebar-nav::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-nav::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.sidebar-nav::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
</style>