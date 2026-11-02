// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// SCADA System Management Package
// Admin feature package: project management, device management, event center, script management, system settings

import { setupSystemLocales } from './locales';

setupSystemLocales();

export { setupSystemLocales };

// View components
export { default as LoginView } from './views/LoginView.vue';
export { default as SystemHomeView } from './views/home/SystemHomeView.vue';
export { default as ProjectListView } from './views/projects/ProjectListView.vue';
export { default as ProjectManageView } from './views/projects/ProjectManageView.vue';
export { default as PageManagementView } from './views/projects/PageManagementView.vue';
export { default as PagePreviewTabView } from './views/projects/PagePreviewTabView.vue';
export { default as DeviceListView } from './views/device/DeviceListView.vue';
export { default as DeviceDetailView } from './views/device/DeviceDetailView.vue';
export { default as DeviceMonitorView } from './views/device/DeviceMonitorView.vue';
export { default as AlarmListView } from './views/alarms/AlarmListView.vue';
export { default as RealtimeAlarmView } from './views/alarms/RealtimeAlarmView.vue';
export { default as ScriptListView } from './views/scripts/ScriptListView.vue';
export { default as ScriptTemplateView } from './views/scripts/ScriptTemplateView.vue';

// ScriptEditor components
export { default as ScriptEditor } from './components/script/ScriptEditor.vue';
export { default as CronEditor } from './components/script/panels/CronEditor.vue';
export { default as EventBindingPanel } from './components/script/panels/EventBindingPanel.vue';
export type {
  ScriptEditorProps,
  ScriptEditorEmits,
  ScriptEditorExpose,
  ScriptCompletionItem,
  EditorDiagnostic,
  TestRunResult,
} from './components/script/ScriptEditor.types';
export type { EventBindingConfig } from './components/script/panels/EventBindingPanel.types';
export { default as ReportsView } from './views/reports/ReportsView.vue';
export { default as ControlLogsView } from './views/reports/ControlLogsView.vue';
export { default as SettingsView } from './views/settings/SettingsView.vue';
export { default as SystemInfoView } from './views/settings/SystemInfoView.vue';
export { default as HealthView } from './views/settings/HealthView.vue';
export { default as DatabaseOpsView } from './views/settings/DatabaseOpsView.vue';
export { default as BaseServicesView } from './views/settings/BaseServicesView.vue';
export { default as WebSocketMonitorView } from './views/settings/WebSocketMonitorView.vue';
export { default as SystemConfigView } from './views/settings/SystemConfigView.vue';
export { default as AiProviderConfigView } from './views/settings/AiProviderConfigView.vue';
export { default as KnowledgeView } from './views/knowledge/KnowledgeView.vue';
export { default as GalleryView } from './views/gallery/GalleryView.vue';
export { default as TerminalView } from './views/settings/TerminalView.vue';
export { default as DictView } from './views/settings/DictView.vue';
export { default as UserListView } from './views/settings/UserListView.vue';
export { default as RoleListView } from './views/settings/RoleListView.vue';
export { default as PositionListView } from './views/settings/PositionListView.vue';
export { default as MenuManageView } from './views/settings/MenuManageView.vue';
export { default as NotificationChannelView } from './views/settings/NotificationChannelView.vue';
export { default as TimerConfigView } from './views/settings/TimerConfigView.vue';
export { default as OperationLogView } from './views/settings/OperationLogView.vue';
export { default as PermissionAuditLogView } from './views/audit/PermissionAuditLogView.vue';
export { default as SecurityAuditLogView } from './views/audit/SecurityAuditLogView.vue';
export { default as EventLogListView } from './views/audit/EventLogListView.vue';
export { default as ErrorLogView } from './views/settings/ErrorLogView.vue';
export { default as AppLogView } from './views/settings/AppLogView.vue';

// Dictionary UI controls
export { default as DictSelector } from './components/dict/DictSelector.vue';
export { default as DictLabel } from './components/dict/DictLabel.vue';
export { default as DictTag } from './components/dict/DictTag.vue';
export { default as ConnectionBanner } from './components/ConnectionBanner.vue';
export { useDict } from './composables/useDict';
export type { SelectOption } from './composables/useDict';

// Device variable binding reuse capabilities (variable selector + common binding UI + binding logic)
export { default as TagVariableSelector } from './components/tag-variable/TagVariableSelector.vue';
export { default as TagBindingEditor } from './components/tag-variable/TagBindingEditor.vue';
export type { SelectableVariable } from './components/tag-variable/types';
export { useProjectId } from './composables/useProjectId';
export { useTagBinding } from './composables/useTagBinding';
export type { TagBindingMode, TagBindingItem, TagBindingOptions } from './composables/useTagBinding';
export { useTagValue } from './composables/useTagValue';
export type { TagValueProps } from './composables/useTagValue';

export { default as TemplateListView } from './views/templates/TemplateListView.vue';
export { default as CanvasTemplateAdmin } from './views/templates/CanvasTemplateAdmin.vue';
export { default as PluginListView } from './views/plugins/PluginListView.vue';
export { default as PluginDetailView } from './views/plugins/PluginDetailView.vue';
export { default as PluginMonitorView } from './views/plugins/PluginMonitorView.vue';
export { default as PipelineMetricsView } from './views/pipeline/PipelineMetricsView.vue';
export { default as AlarmStatisticsView } from './views/alarms/AlarmStatisticsView.vue';
export { default as HistoricalTrendView } from './views/historical-trend/HistoricalTrendView.vue';
export { default as RealTimeTrendView } from './views/historical-trend/RealTimeTrendView.vue';

// API modules
export * from './api/client';
export { getToken, setToken, getRefreshToken, setRefreshToken } from './api/client';
export * from './api/modules';
export { pageApi, projectApi } from './api/modules';
export type { DataSourceConfig, DataSourceRecord } from './api/modules/dataSource.api';
export type { EventLogItem, EventLogQueryParams, EventLogStatus, SubscriberRecord } from './api/types/api';

// Stores
export * from './stores';

// Theme modules
export * from './theme';

// Router configuration (exported separately)
export { systemRouteConfigs, checkAuthToken } from './router';

// Menu configuration (DB-as-single-source-of-truth: menu data comes from the backend API; only permission codes and types are exported here)
export { PermissionCodes, ROLE_PERMISSIONS } from './config/system-menu.config';
export type { SystemMenuItem, SystemRole, PermissionCode } from './config/system-menu.config';

// Permission composables
export { usePermission } from './composables/usePermission';

// Permission directive
export { vPermission } from './directives/v-permission';

// Debug tools
export { isDebugSkipAuth, setDebugSkipAuth, getDebugToken, DEBUG_USER } from './utils/debug';
export type { DebugUser } from './utils/debug';

// Path resolution utilities
export { resolveAssetPath } from './utils/resolveAssetPath';
