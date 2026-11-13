// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import AppLayout from '../layouts/AppLayout.vue';
import { isDebugSkipAuth, PermissionCodes } from '@scada-editor/system';

//CODE-13: EditorView/PreviewView changed to dynamic import to avoid editor code (including three.js usage)
//Included in the main bundle, so the landing page's first screen no longer downloads the entire editor (the main index.js has been significantly reduced from 3.3MB)
const EditorView = () => import('../views/EditorView.vue').then((m) => m.default);
const PreviewView = () => import('../views/PreviewView.vue').then((m) => m.default);

type PermissionCode = (typeof PermissionCodes)[keyof typeof PermissionCodes];

/**
 * Product mode type
 * - full:  Integrated deployment (full capabilities of ss-scada + ss-data)
 * - scada: ss-scada standalone deployment (configuration editing/running only)
 * - data:  ss-data independent deployment (data mid-end/system management only)*/
type ProductMode = 'full' | 'scada' | 'data';

/**
 * Validate and return a valid product mode
 * Avoid setting VITE_PRODUCT_MODE in .env to an invalid string (e.g., 'undefined')
 * This results in neither route branch being executed, which in turn triggers the "No match found" alert.*/
function resolveProductMode(mode: unknown): ProductMode {
  if (mode === 'full' || mode === 'scada' || mode === 'data') {
    return mode;
  }
  return 'full';
}

/** Current product mode (injected by Vite at build time, defaults to full compatibility with the current state)*/
const PRODUCT_MODE: ProductMode = resolveProductMode(import.meta.env.VITE_PRODUCT_MODE);

//──────── Routing Groups (Dynamically Grouped by Product Mode) ────────

/** Shared Route (All Modes Loaded): Login Page*/
const sharedRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    //CODE-15: Import directly from the LoginView.vue file, bypassing the @scada-editor/system barrel.
    //The original import('@scada-editor/system').then(m => m.LoginView) would cause the barrel to export 40+ views
    //However, all system views are packed into the same chunk, causing the login page to download the entire system management code.
    //After direct file import, only LoginView and its static dependencies (tree-shakeable) are included in the login page chunk.
    component: () => import('@scada-editor/system/views/LoginView.vue').then((m: any) => m.default),
    meta: { guest: true },
  },
];

/** ss-scada routing (full + scada mode loading): editor, preview*/
const scadaRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AppLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: '/system',
      },
      {
        path: 'editor',
        name: 'editor',
        component: EditorView,
      },
      {
        path: 'editor/:projectId',
        name: 'editor-project',
        component: EditorView,
      },
      {
        path: 'editor/template/:canvasTemplateId',
        name: 'editor-canvas-template',
        component: EditorView,
      },
      {
        path: 'test-config',
        name: 'test-config',
        component: () => import('@scada-editor/editor').then(m => m.ConfigTestPage),
      },
    ],
  },
  {
    path: '/preview',
    name: 'preview',
    component: PreviewView,
  },
  {
    //Option B: Dedicated route for H5 iframe preview, reusing the same PreviewView.
    //The backend buildPreviewUrl generates ${SCADA_SHELL_BASE_URL}/preview, so the path is /mobile-preview/preview,
    //Fully equivalent to the management end /preview, with only path isolation, facilitating direct H5 connection without affecting management end operations.
    //PreviewView already supports ?ticket= one-time ticket redemption Bearer (cross-origin iframe authentication),
    //Plugins are loaded from the same-origin /plugins/. Plugin updates only require a standard release from the admin side, without the need to reissue the shell.
    path: '/mobile-preview/preview',
    name: 'mobile-preview',
    component: PreviewView,
  },
];

/** ss-data routing (full + data mode loading): System Management*/
const dataRoutes: RouteRecordRaw[] = [
  {
    path: '/system',
    component: () => import('@scada-editor/editor').then((m: any) => m.SystemLayout),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'system-home',
        component: () => import('@scada-editor/system').then((m: any) => m.SystemHomeView),
        meta: { titleKey: 'system.nav.overview' },
      },
      {
        path: 'projects',
        name: 'projects',
        component: () => import('@scada-editor/system').then((m: any) => m.ProjectListView),
        meta: { titleKey: 'system.nav.projects' },
      },
      {
        path: 'projects/:projectId/manage',
        name: 'project-manage',
        component: () => import('@scada-editor/system').then((m: any) => m.ProjectManageView),
        meta: { titleKey: 'system.projectManage.title' },
      },
      {
        path: 'page-management',
        name: 'page-management',
        component: () => import('@scada-editor/system').then((m: any) => m.PageManagementView),
        meta: { titleKey: 'system.nav.pageManagement' },
      },
      {
        path: 'preview/:pageName',
        name: 'system-preview',
        component: () => import('@scada-editor/system').then((m: any) => m.PagePreviewTabView),
        meta: { titleKey: 'system.nav.preview' },
      },
      {
        path: 'devices',
        name: 'devices',
        component: () => import('@scada-editor/system').then((m: any) => m.DeviceListView),
        meta: { titleKey: 'system.nav.devices' },
      },
      {
        path: 'devices/:deviceId',
        name: 'device-detail',
        component: () => import('@scada-editor/system').then((m: any) => m.DeviceDetailView),
        meta: { titleKey: 'system.routes.deviceDetail' },
      },
      {
        path: 'device-monitor',
        name: 'device-monitor',
        component: () => import('@scada-editor/system').then((m: any) => m.DeviceMonitorView),
        meta: { titleKey: 'system.nav.deviceMonitor' },
      },
      {
        path: 'plugins',
        name: 'plugins',
        component: () => import('@scada-editor/system').then((m: any) => m.PluginListView),
        meta: { titleKey: 'system.nav.plugins' },
      },
      {
        path: 'plugins/:protocol',
        name: 'plugin-detail',
        component: () => import('@scada-editor/system').then((m: any) => m.PluginDetailView),
        meta: { titleKey: 'system.routes.pluginDetail' },
      },
      {
        path: 'plugins/:protocol/monitor',
        name: 'plugin-monitor',
        component: () => import('@scada-editor/system').then((m: any) => m.PluginMonitorView),
        meta: { titleKey: 'system.routes.pluginMonitor' },
      },
      {
        path: 'pipeline-metrics',
        name: 'pipeline-metrics',
        component: () => import('@scada-editor/system').then((m: any) => m.PipelineMetricsView),
        meta: { titleKey: 'system.nav.pipelineMetrics' },
      },
      {
        path: 'alarms',
        name: 'alarms',
        component: () => import('@scada-editor/system').then((m: any) => m.AlarmListView),
        meta: { titleKey: 'system.nav.alarms' },
      },
      {
        path: 'realtime-alarms',
        name: 'realtime-alarms',
        component: () => import('@scada-editor/system').then((m: any) => m.RealtimeAlarmView),
        meta: { titleKey: 'system.nav.realtimeAlarms' },
      },
      {
        path: 'alarm-statistics',
        name: 'alarm-statistics',
        component: () => import('@scada-editor/system').then((m: any) => m.AlarmStatisticsView),
        meta: { titleKey: 'system.routes.alarmStatistics' },
      },
      {
        path: 'scripts',
        name: 'scripts',
        component: () => import('@scada-editor/system').then((m: any) => m.ScriptListView),
        meta: { titleKey: 'system.nav.scripts' },
      },
      {
        path: 'reports',
        name: 'reports',
        component: () => import('@scada-editor/system').then((m: any) => m.ReportsView),
        meta: { titleKey: 'system.nav.reports' },
      },
      {
        path: 'control-logs',
        name: 'control-logs',
        component: () => import('@scada-editor/system').then((m: any) => m.ControlLogsView),
        meta: { titleKey: 'system.nav.controlLogs' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@scada-editor/system').then((m: any) => m.SettingsView),
        meta: { titleKey: 'system.settings.title' },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@scada-editor/system').then((m: any) => m.UserListView),
        meta: { titleKey: 'system.nav.users' },
      },
      {
        path: 'roles',
        name: 'roles',
        component: () => import('@scada-editor/system').then((m: any) => m.RoleListView),
        meta: { titleKey: 'system.nav.roles' },
      },
      {
        path: 'positions',
        name: 'positions',
        component: () => import('@scada-editor/system').then((m: any) => m.PositionListView),
        meta: { titleKey: 'system.nav.positions' },
      },
      {
        path: 'menus',
        name: 'menus',
        component: () => import('@scada-editor/system').then((m: any) => m.MenuManageView),
        meta: { titleKey: 'system.nav.menus' },
      },
      {
        path: 'dict',
        name: 'dict',
        component: () => import('@scada-editor/system').then((m: any) => m.DictView),
        meta: { titleKey: 'system.nav.dict' },
      },
      {
        path: 'notification-channels',
        name: 'notification-channels',
        component: () => import('@scada-editor/system').then((m: any) => m.NotificationChannelView),
        meta: { titleKey: 'system.nav.notificationChannels' },
      },
      {
        path: 'info',
        name: 'info',
        component: () => import('@scada-editor/system').then((m: any) => m.SystemInfoView),
        meta: { titleKey: 'system.nav.info' },
      },
      {
        path: 'health',
        name: 'health',
        component: () => import('@scada-editor/system').then((m: any) => m.HealthView),
        meta: { titleKey: 'system.nav.health' },
      },
      {
        path: 'database-ops',
        name: 'database-ops',
        component: () => import('@scada-editor/system').then((m: any) => m.DatabaseOpsView),
        meta: { titleKey: 'system.nav.databaseOps' },
      },
      {
        path: 'base-services',
        name: 'base-services',
        component: () => import('@scada-editor/system').then((m: any) => m.BaseServicesView),
        meta: { titleKey: 'system.nav.baseServices' },
      },
      {
        path: 'ws-monitor',
        name: 'ws-monitor',
        component: () => import('@scada-editor/system').then((m: any) => m.WebSocketMonitorView),
        meta: { titleKey: 'system.nav.wsMonitor' },
      },
      {
        path: 'ai-config',
        name: 'system-ai-config',
        component: () => import('@scada-editor/system').then((m: any) => m.AiProviderConfigView),
        meta: { titleKey: 'system.nav.aiConfig' },
      },
      {
        path: 'terminal',
        name: 'terminal',
        component: () => import('@scada-editor/system').then((m: any) => m.TerminalView),
        meta: { titleKey: 'system.nav.terminal' },
      },
      {
        path: 'knowledge',
        name: 'knowledge',
        component: () => import('@scada-editor/system').then((m: any) => m.KnowledgeView),
        meta: { titleKey: 'system.nav.knowledge' },
      },
      {
        path: 'gallery',
        name: 'gallery',
        component: () => import('@scada-editor/system').then((m: any) => m.GalleryView),
        meta: { titleKey: 'system.nav.gallery' },
      },
      {
        path: 'templates',
        name: 'templates',
        component: () => import('@scada-editor/system').then((m: any) => m.TemplateListView),
        meta: { titleKey: 'system.nav.deviceTemplates' },
      },
      {
        path: 'canvas-templates',
        name: 'canvas-templates',
        component: () => import('@scada-editor/system').then((m: any) => m.CanvasTemplateAdmin),
        meta: { titleKey: 'system.nav.canvasTemplates' },
      },
      {
        path: 'historical-trend',
        name: 'historical-trend',
        component: () => import('@scada-editor/system').then((m: any) => m.HistoricalTrendView),
        meta: { titleKey: 'system.nav.historicalTrend' },
      },
      {
        path: 'real-time-trend',
        name: 'real-time-trend',
        component: () => import('@scada-editor/system').then((m: any) => m.RealTimeTrendView),
        meta: { titleKey: 'system.nav.realTimeTrend' },
      },
      {
        path: 'timer-config',
        name: 'system-timer-config',
        component: () => import('@scada-editor/system').then((m: any) => m.TimerConfigView),
        meta: { titleKey: 'system.nav.timerConfig' },
      },
      {
        path: 'operation-logs',
        name: 'system-operation-logs',
        component: () => import('@scada-editor/system').then((m: any) => m.OperationLogView),
        meta: { titleKey: 'system.nav.operationLogs' },
      },
      {
        path: 'security-audit-logs',
        name: 'system-security-audit-logs',
        component: () => import('@scada-editor/system').then((m: any) => m.SecurityAuditLogView),
        meta: { titleKey: 'system.nav.securityAuditLogs' },
      },
      {
        path: 'error-logs',
        name: 'system-error-logs',
        component: () => import('@scada-editor/system').then((m: any) => m.ErrorLogView),
        meta: { titleKey: 'system.nav.errorLogs' },
      },
      {
        path: 'permission-audit-logs',
        name: 'system-permission-audit-logs',
        component: () => import('@scada-editor/system').then((m: any) => m.PermissionAuditLogView),
        meta: { titleKey: 'system.nav.permissionAuditLogs' },
      },
      {
        path: 'event-logs',
        name: 'system-event-logs',
        component: () => import('@scada-editor/system').then((m: any) => m.EventLogListView),
        meta: { titleKey: 'system.nav.eventLogs' },
      },
      {
        path: 'app-logs',
        name: 'system-app-logs',
        component: () => import('@scada-editor/system').then((m: any) => m.AppLogView),
        meta: { titleKey: 'system.nav.appLogs' },
      },
    ],
  },
];

//──────── Final Routing Table Based on Product Model Combinations ────────
const routes: RouteRecordRaw[] = [...sharedRoutes];

if (PRODUCT_MODE === 'full' || PRODUCT_MODE === 'scada') {
  routes.push(...scadaRoutes);
}

if (PRODUCT_MODE === 'full' || PRODUCT_MODE === 'data') {
  //In data mode, the root path needs to be redirected to /system
  if (PRODUCT_MODE === 'data') {
    routes.push({
      path: '/',
      redirect: '/system',
    });
  }
  routes.push(...dataRoutes);
}

//──────── Fallback Route: Unmatched paths are redirected to the default home page ────────
//1. Suppress Vue Router "No match found for location with path xxx" warnings
//2. Provide a better user experience (redirect to the homepage) instead of a blank page
//3. The default home page redirects to /system
routes.push({
  path: '/:catchAll(.*)*',
  redirect: '/system',
});

// eslint-disable-next-line no-console
console.log(`[SS-Platform] Frontend Product Mode: ${PRODUCT_MODE}`);

const router = createRouter({
  //The H5 embedded scene is built with VITE_BASE=/scada-preview/. The route base path must be consistent with the deployment base path.
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

//──────── Permission Code Level Route Guard (Option B Enhancement) ────────

/** Routing path → Permission code mapping (used for fine-grained permission verification)*/
const ROUTE_PERMISSIONS: Record<string, PermissionCode> = {
  '/system/projects': PermissionCodes.PROJECT_VIEW,
  '/system/projects/': PermissionCodes.PROJECT_VIEW,
  '/system/page-management': PermissionCodes.PROJECT_VIEW,
  '/system/preview': PermissionCodes.PROJECT_VIEW,
  '/system/devices': PermissionCodes.DEVICE_VIEW,
  '/system/device-monitor': PermissionCodes.DEVICE_VIEW,
  '/system/plugins': PermissionCodes.PLUGIN_VIEW,
  '/system/alarms': PermissionCodes.ALARM_VIEW,
  '/system/realtime-alarms': PermissionCodes.ALARM_VIEW,
  '/system/scripts': PermissionCodes.SCRIPT_VIEW,
  '/system/script-templates': PermissionCodes.SCRIPT_VIEW,
  '/system/reports': PermissionCodes.REPORT_VIEW,
  '/system/control-logs': PermissionCodes.REPORT_VIEW,
  '/system/templates': PermissionCodes.TEMPLATE_VIEW,
  '/system/canvas-templates': PermissionCodes.TEMPLATE_VIEW,
  '/system/settings': PermissionCodes.SYSTEM_SETTINGS,
  '/system/dict': PermissionCodes.SYSTEM_DICT,
  '/system/info': PermissionCodes.SYSTEM_INFO,
  '/system/health': PermissionCodes.SYSTEM_INFO,
  '/system/database-ops': PermissionCodes.SYSTEM_SETTINGS,
  '/system/base-services': PermissionCodes.SYSTEM_BASE_SERVICES,
  '/system/ws-monitor': PermissionCodes.SYSTEM_SETTINGS,
  '/system/ai-config': PermissionCodes.SYSTEM_CONFIG,
  '/system/terminal': PermissionCodes.SYSTEM_SETTINGS,
  '/system/menus': PermissionCodes.SYSTEM_MENU_CONFIG,
  '/system/notification-channels': PermissionCodes.SYSTEM_CONFIG,
  '/system/users': PermissionCodes.SYSTEM_USER_VIEW,
  '/system/roles': PermissionCodes.SYSTEM_ROLE_VIEW,
  '/system/positions': PermissionCodes.POSITION_VIEW,
  '/system/historical-trend': PermissionCodes.HISTORICAL_TREND_VIEW,
  '/system/real-time-trend': PermissionCodes.REALTIME_TREND_VIEW,
  '/system/timer-config': PermissionCodes.SYSTEM_SETTINGS,
  '/system/operation-logs': PermissionCodes.SYSTEM_OPERATION_LOG,
  '/system/error-logs': PermissionCodes.SYSTEM_OPERATION_LOG,
  '/system/permission-audit-logs': PermissionCodes.SYSTEM_OPERATION_LOG,
  '/system/app-logs': PermissionCodes.SYSTEM_SETTINGS,
};

/** Check if the user has an access code to access the specified path*/
function canAccessByPermission(path: string, userPermissions: PermissionCode[]): boolean {
  //Non-/system path allowed
  if (!path.startsWith('/system')) return true;
  //The home page (/system or /system/) is always accessible
  if (path === '/system' || path === '/system/') return true;
  //Admin has ALL permissions
  if (userPermissions.includes(PermissionCodes.ALL)) return true;

  const requiredCode = ROUTE_PERMISSIONS[path];
  if (requiredCode) {
    return userPermissions.includes(requiredCode);
  }
  //The details page (e.g., /system/devices/:id) matches the parent route
  for (const [routePath, code] of Object.entries(ROUTE_PERMISSIONS)) {
    if (path.startsWith(routePath + '/')) {
      return userPermissions.includes(code);
    }
  }
  //Paths not configured in the mapping are allowed by default
  return true;
}

router.beforeEach(async (to, _from, next) => {
  //Determine the default home page based on the product model
  const defaultHome = '/system';

  if (isDebugSkipAuth()) {
    if (to.meta.guest) {
      next(defaultHome);
      return;
    }
    next();
    return;
  }

  //S-C03: No longer read the token from localStorage; instead, use isAuthenticated from the auth store.
  //(The token is managed through an HttpOnly cookie, which cannot be read by JavaScript. The front end only maintains the authentication status flag.)
  const { useAuthStore }: any = await import('@scada-editor/system');
  const authStore = useAuthStore();

  //Accessing a page that requires authentication: If the session has not been restored, try restore (via Cookie) first.
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    if (!authStore.sessionRestored) {
      await authStore.restoreSession();
    }
    //Still not verified after restore → Go to login
    if (!authStore.isAuthenticated) {
      next('/login');
      return;
    }
  }

  //Authenticated access to guest page (e.g., login page) → Redirect to homepage
  if (to.meta.guest && authStore.isAuthenticated) {
    next(defaultHome);
    return;
  }

  if (to.meta.requiresAuth && authStore.isAuthenticated) {
    try {
      //Fallback: In very rare cases, the token exists but the user is not loaded (e.g., hot reload loses state).
      if (!authStore.user) {
        await authStore.restoreSession();
        if (!authStore.isAuthenticated) {
          next('/login');
          return;
        }
      }
      //Permission Check (Only /system Path)
      //v7.2: Switch to using the user's actual permissions (loaded from the backend roleEntity),
      //No longer use the local ROLE_PERMISSIONS[role] to look up by role (self-created roles such as test are not in the local table,
      //It will be determined that there is no permission, causing the page to fail to open.)
      if (to.path.startsWith('/system') && authStore.user) {
        //Ensure that the menu has been loaded from the backend (menu display is filtered by menuIds)
        const { useMenuStore }: any = await import('@scada-editor/system');
        const menuStore = useMenuStore();
        if (!menuStore.loaded) {
          await menuStore.loadMenu();
        }
        //Permission Code Level Verification: Use the user's actual permission code (authStore.permissions)
        const userPerms = (authStore.permissions || []) as PermissionCode[];
        if (!canAccessByPermission(to.path, userPerms)) {
          next('/system');
          return;
        }
      }
    } catch {
      next('/login');
      return;
    }
  }

  next();
});

//──────── Browser tab title changes dynamically with the module ────────
//- /system  → SS-DATA          (SS-DATA Data Mid-end)
//- /editor  → SS-SCADA Editor  (SS-SCADA Configuration Editor)
//- /preview → SS-SCADA Editor  (SS-SCADA Configuration Runner, part of the SCADA subsystem along with the editor)
//- /login   → SS-SCADA Editor  (default fallback, <title> consistent with the initial  in index.html)
//Design purpose: Users can distinguish at a glance which subsystem they are currently in when switching between multiple tabs.
router.afterEach((to) => {
  //to.path only contains the path part (query is in to.query), so both /system and /system/xxx can be matched
  if (to.path === '/system' || to.path.startsWith('/system/')) {
    document.title = 'SS-DATA';
  } else {
    document.title = 'SS-SCADA Editor';
  }
});

export default router;