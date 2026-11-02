// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// System menu configuration — centralization, i18n and permission control
// DB-as-single-source-of-truth: menu structure is stored only in the backend sys_menus table; the frontend fetches it via API.
// This file keeps only type definitions, permission codes and role-permission mappings; no built-in menu defaults.

/** System role enum (aligned with the backend UserRole) */
export type SystemRole = 'admin' | 'user' | 'viewer';

/** System menu item */
export interface SystemMenuItem {
  /** Unique identifier, corresponds to the route name (e.g. 'projects') */
  id: string;
  /** i18n translation key, used by $t(key) to get the display text */
  labelKey: string;
  /** Route path relative to /system ('' means /system, '/projects' means /system/projects) */
  path: string;
  /** Icon name, mapped to the SystemMenuIcon component */
  icon: string;
  /** Sub-menu items (optional) */
  children?: SystemMenuItem[];
  /** Required permission roles; undefined/null means accessible to all users */
  roles?: SystemRole[];
  /** Whether to show in the top-bar navigation (default true) */
  showInTopbar?: boolean;
  /** Whether to show in the sidebar (default true) */
  showInSidebar?: boolean;
  /** Whether it is a detail page (not shown in menus, but the route exists), e.g. device-detail */
  isDetail?: boolean;
  /** Sort weight; smaller numbers come first */
  order?: number;
  /** Subsystem identifier; NULL/undefined means a global menu (visible in all subsystems) */
  subsystem?: string | null;
}

// ──────────── Permission code system (Plan B enhancement) ────────────

/**
 * Permission code enum
 * Format: {module}:{operation}
 * Used for button/action-level fine-grained permission control
 */
export const PermissionCodes = {
  // Project management
  PROJECT_CREATE: 'project:create',
  PROJECT_EDIT: 'project:edit',
  PROJECT_DELETE: 'project:delete',
  PROJECT_VIEW: 'project:view',
  PROJECT_CONFIG: 'project:config',

  // Device management
  DEVICE_CREATE: 'device:create',
  DEVICE_EDIT: 'device:edit',
  DEVICE_DELETE: 'device:delete',
  DEVICE_VIEW: 'device:view',
  DEVICE_IMPORT: 'device:import',
  DEVICE_EXPORT: 'device:export',
  DEVICE_CONNECT: 'device:connect',

  // Device group management
  DEVICE_GROUP_CREATE: 'device_group:create',
  DEVICE_GROUP_EDIT: 'device_group:edit',
  DEVICE_GROUP_DELETE: 'device_group:delete',
  DEVICE_GROUP_VIEW: 'device_group:view',

  // Data tag management
  DATATAG_CREATE: 'datatag:create',
  DATATAG_EDIT: 'datatag:edit',
  DATATAG_DELETE: 'datatag:delete',
  DATATAG_VIEW: 'datatag:view',
  DATATAG_IMPORT: 'datatag:import',
  DATATAG_EXPORT: 'datatag:export',
  DATATAG_WRITE: 'datatag:write',

  // Collection management
  PLUGIN_CREATE: 'plugin:create',
  PLUGIN_EDIT: 'plugin:edit',
  PLUGIN_DELETE: 'plugin:delete',
  PLUGIN_VIEW: 'plugin:view',
  PLUGIN_CONFIG: 'plugin:config',

  // Alarm center
  ALARM_VIEW: 'alarm:view',
  ALARM_ACK: 'alarm:ack',
  ALARM_CONFIGURE: 'alarm:configure',
  ALARM_RULE_VIEW: 'alarm:rule:view',
  ALARM_RULE_CREATE: 'alarm:rule:create',
  ALARM_RULE_EDIT: 'alarm:rule:edit',
  ALARM_RULE_DELETE: 'alarm:rule:delete',

  // Script management
  SCRIPT_CREATE: 'script:create',
  SCRIPT_EDIT: 'script:edit',
  SCRIPT_DELETE: 'script:delete',
  SCRIPT_EXECUTE: 'script:execute',
  SCRIPT_VIEW: 'script:view',

  // Data reports
  REPORT_CREATE: 'report:create',
  REPORT_EDIT: 'report:edit',
  REPORT_DELETE: 'report:delete',
  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',

  // Template management
  TEMPLATE_CREATE: 'template:create',
  TEMPLATE_EDIT: 'template:edit',
  TEMPLATE_DELETE: 'template:delete',
  TEMPLATE_IMPORT: 'template:import',
  TEMPLATE_EXPORT: 'template:export',
  TEMPLATE_VIEW: 'template:view',

  // System management
  SYSTEM_SETTINGS: 'system:settings',
  SYSTEM_DICT: 'system:dict',
  SYSTEM_INFO: 'system:info',
  SYSTEM_MENU: 'system:menu',
  SYSTEM_MENU_CONFIG: 'system:menu:config',
  SYSTEM_CONFIG: 'system:config',
  SYSTEM_AUDIT: 'system:audit',
  SYSTEM_BASE_SERVICES: 'system:base_services',
  SYSTEM_OPERATION_LOG: 'system:operation_log',

  // User management (added in v6.0, enhanced in v7.0)
  USER_CREATE: 'system:user:create',
  USER_EDIT: 'system:user:edit',
  USER_DELETE: 'system:user:delete',
  USER_VIEW: 'system:user:view',
  SYSTEM_USER_CREATE: 'system:user:create',
  SYSTEM_USER_EDIT: 'system:user:edit',
  SYSTEM_USER_DELETE: 'system:user:delete',
  SYSTEM_USER_VIEW: 'system:user:view',

  // Role management (added in v6.0, enhanced in v7.0)
  ROLE_CREATE: 'system:role:create',
  ROLE_EDIT: 'system:role:edit',
  ROLE_DELETE: 'system:role:delete',
  ROLE_VIEW: 'system:role:view',
  SYSTEM_ROLE_CREATE: 'system:role:create',
  SYSTEM_ROLE_EDIT: 'system:role:edit',
  SYSTEM_ROLE_DELETE: 'system:role:delete',
  SYSTEM_ROLE_VIEW: 'system:role:view',

  // Position management (added in v6.0)
  POSITION_CREATE: 'system:position:create',
  POSITION_EDIT: 'system:position:edit',
  POSITION_DELETE: 'system:position:delete',
  POSITION_VIEW: 'system:position:view',

  // General
  ALL: '*:*',

  // Historical trends
  HISTORICAL_TREND_VIEW: 'trend:view',
  // Real-time trends
  REALTIME_TREND_VIEW: 'trend:realtime:view',
} as const;

export type PermissionCode = (typeof PermissionCodes)[keyof typeof PermissionCodes];

/**
 * Role → default permission code mapping
 *
 * @deprecated v8.0: the DB is the single source of truth for permission codes; ROLE_PERMISSIONS serves only as a reference for backend seed data
 *             and is no longer used for frontend runtime permission checks. Kept for test code.
 */
export const ROLE_PERMISSIONS: Record<SystemRole, PermissionCode[]> = {
  admin: [PermissionCodes.ALL],

  user: [
    // device:*
    PermissionCodes.DEVICE_CREATE, PermissionCodes.DEVICE_EDIT,
    PermissionCodes.DEVICE_DELETE, PermissionCodes.DEVICE_VIEW,
    PermissionCodes.DEVICE_IMPORT, PermissionCodes.DEVICE_EXPORT,
    PermissionCodes.DEVICE_CONNECT,
    // device_group:*
    PermissionCodes.DEVICE_GROUP_CREATE, PermissionCodes.DEVICE_GROUP_EDIT,
    PermissionCodes.DEVICE_GROUP_DELETE, PermissionCodes.DEVICE_GROUP_VIEW,
    // datatag:view
    PermissionCodes.DATATAG_VIEW,
    // plugin:*
    PermissionCodes.PLUGIN_CREATE, PermissionCodes.PLUGIN_EDIT,
    PermissionCodes.PLUGIN_DELETE, PermissionCodes.PLUGIN_VIEW,
    PermissionCodes.PLUGIN_CONFIG,
    // alarm:*
    PermissionCodes.ALARM_VIEW, PermissionCodes.ALARM_ACK,
    PermissionCodes.ALARM_RULE_VIEW, PermissionCodes.ALARM_RULE_CREATE,
    PermissionCodes.ALARM_RULE_EDIT, PermissionCodes.ALARM_RULE_DELETE,
    // script:*
    PermissionCodes.SCRIPT_CREATE, PermissionCodes.SCRIPT_EDIT,
    PermissionCodes.SCRIPT_DELETE, PermissionCodes.SCRIPT_EXECUTE,
    PermissionCodes.SCRIPT_VIEW,
    // report:*
    PermissionCodes.REPORT_VIEW, PermissionCodes.REPORT_CREATE,
    PermissionCodes.REPORT_EDIT, PermissionCodes.REPORT_DELETE,
    PermissionCodes.REPORT_EXPORT,
    // template:*
    PermissionCodes.TEMPLATE_CREATE, PermissionCodes.TEMPLATE_EDIT,
    PermissionCodes.TEMPLATE_DELETE, PermissionCodes.TEMPLATE_IMPORT,
    PermissionCodes.TEMPLATE_EXPORT, PermissionCodes.TEMPLATE_VIEW,
    // system:info
    PermissionCodes.SYSTEM_INFO,
    // Historical trends
    PermissionCodes.HISTORICAL_TREND_VIEW,
    // Real-time trends
    PermissionCodes.REALTIME_TREND_VIEW,
  ],

  viewer: [
    PermissionCodes.DEVICE_VIEW,
    PermissionCodes.DEVICE_GROUP_VIEW,
    PermissionCodes.DATATAG_VIEW,
    PermissionCodes.PLUGIN_VIEW,
    PermissionCodes.ALARM_VIEW,
    PermissionCodes.SCRIPT_VIEW,
    PermissionCodes.REPORT_VIEW,
    PermissionCodes.TEMPLATE_VIEW,
    PermissionCodes.SYSTEM_INFO,
    // Historical trends
    PermissionCodes.HISTORICAL_TREND_VIEW,
    // Real-time trends
    PermissionCodes.REALTIME_TREND_VIEW,
  ],
};