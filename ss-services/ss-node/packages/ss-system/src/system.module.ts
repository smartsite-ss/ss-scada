// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { ErrorLog, SystemConfig, OperationLog, Menu, MenuButton, BackupLog } from './entities/system.entity';
import { TrendQueryScheme } from './entities/trend-query-scheme.entity';
import { DeviceTemplateService } from './template/device-template.service';
import { DeviceTemplateController } from './template/device-template.controller';
import { TemplateLoaderService } from './template/template-loader.service';
import { TemplateIndexService } from './template/template-index.service';
import { TemplateDiffService } from './template/template-diff.service';
import { TemplateInitService } from './template/template-init.service';
import { DictionaryLoaderService } from './dict/dictionary-loader.service';
import { DictionaryController } from './dict/dictionary.controller';
import { Device } from '@ss-node/ss-device/entities/device.entity';
import { DataTag } from '@ss-node/ss-device/entities/data-tag.entity';

// Phase 1 - P0
import { OperationLogService } from './operation-log/operation-log.service';
import { OperationLogController } from './operation-log/operation-log.controller';
import { HealthService } from './health/health.service';
import { HealthController } from './health/health.controller';

// Phase 2 - P1
import { ErrorLogService } from './error-log/error-log.service';
import { ErrorLogController } from './error-log/error-log.controller';
import { SystemConfigService } from './config/system-config.service';
import { SystemConfigController } from './config/system-config.controller';
import { SystemMenuConfigService } from './config/system-menu-config.service';
import { SystemMenuController } from './config/system-menu.controller';
import { MenuI18nService } from './config/menu-i18n.service';
import { SystemInfoService } from './info/system-info.service';
import { SystemInfoController } from './info/system-info.controller';

// Phase 3 - P2
import { BackupService } from './backup/backup.service';
import { BackupController } from './backup/backup.controller';
import { DatabaseService } from './backup/database.service';
import { DatabaseController } from './backup/database.controller';
import { ResourceMonitorService } from './monitor/resource-monitor.service';
import { ResourceMonitorController } from './monitor/resource-monitor.controller';
import { LogViewerService } from './log-viewer/log-viewer.service';
import { LogViewerController } from './log-viewer/log-viewer.controller';
import { UserAdminService } from './admin/user-admin.service';
import { UserAdminController } from './admin/user-admin.controller';

// Phase 3 - P3
import { SetupService } from './setup/setup.service';
import { SetupController } from './setup/setup.controller';
import { SystemI18nService } from './i18n/system-i18n.service';
import { UpgradeService } from './upgrade/upgrade.service';
import { UpgradeController } from './upgrade/upgrade.controller';
import { TerminalService } from './terminal/terminal.service';
import { TerminalGateway } from './terminal/terminal.gateway';

// Phase 4 - Base services management
import { BaseServicesService } from './base-services/base-services.service';
import { BaseServicesController } from './base-services/base-services.controller';
import { BaseServiceEntity } from './base-services/base-service.entity';

// Phase 5 - System config management and restart
import { SystemRestartService } from './restart/system-restart.service';

// Phase 6 - Knowledge base (pure-file approach)
import { KnowledgeModule } from './knowledge/knowledge.module';

// Phase 9 - Gallery management (pure-file approach)
import { GalleryModule } from './gallery/gallery.module';

// Phase 7 - Scheduled task config management
import { TimerConfigService } from './timer-config/timer-config.service';
import { TimerConfigController } from './timer-config/timer-config.controller';

// Phase 8 - Trend query scheme saving
import { TrendQuerySchemeService } from './trend-query-scheme/trend-query-scheme.service';
import { TrendQuerySchemeController } from './trend-query-scheme/trend-query-scheme.controller';

// Core imports
import { EventBusModule, WebSocketModule, User } from '@ss-node/ss-core';
import { I18nService } from '@ss-node/ss-i18n';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ErrorLog,
      SystemConfig,
      OperationLog,
      Menu,
      MenuButton,
      BackupLog,
      Device,
      DataTag,
      User,
      BaseServiceEntity,
      TrendQueryScheme,
    ]),
    EventBusModule,
    WebSocketModule,
    // Phase 6 - Knowledge base
    KnowledgeModule,
    // Phase 9 - Gallery management
    GalleryModule,
  ],
  controllers: [
    SystemController,
    DeviceTemplateController,
    DictionaryController,
    // Phase 1
    OperationLogController,
    HealthController,
    // Phase 2
    ErrorLogController,
    SystemConfigController,
    SystemMenuController,
    SystemInfoController,
    // Phase 3
    BackupController,
    DatabaseController,
    ResourceMonitorController,
    LogViewerController,
    UserAdminController,
    SetupController,
    UpgradeController,
    // Phase 4
    BaseServicesController,
    // Phase 7 - Scheduled task config management
    TimerConfigController,
    // Phase 8 - Trend query scheme saving
    TrendQuerySchemeController,
  ],
  providers: [
    SystemService,
    DeviceTemplateService,
    TemplateLoaderService,
    TemplateIndexService,
    TemplateDiffService,
    TemplateInitService,
    DictionaryLoaderService,
    // Phase 1
    OperationLogService,
    HealthService,
    // Phase 2
    ErrorLogService,
    SystemConfigService,
    SystemMenuConfigService,
    MenuI18nService,
    SystemInfoService,
    // Phase 3
    BackupService,
    DatabaseService,
    ResourceMonitorService,
    LogViewerService,
    UserAdminService,
    SetupService,
    SystemI18nService,
    UpgradeService,
    TerminalService,
    TerminalGateway,
    // Phase 4
    BaseServicesService,
    // Phase 5 - System config management and restart
    SystemRestartService,
    // Phase 7 - Scheduled task config management
    TimerConfigService,
    // Phase 8 - Trend query scheme saving
    TrendQuerySchemeService,
    // Core services
    I18nService,
  ],
  exports: [
    SystemService,
    DeviceTemplateService,
    TemplateLoaderService,
    TemplateIndexService,
    TemplateDiffService,
    DictionaryLoaderService,
    // Phase 1
    OperationLogService,
    HealthService,
    // Phase 2
    ErrorLogService,
    SystemConfigService,
    MenuI18nService,
    SystemInfoService,
    // Phase 3
    BackupService,
    DatabaseService,
    ResourceMonitorService,
    LogViewerService,
    UserAdminService,
    SetupService,
    SystemI18nService,
    UpgradeService,
    TerminalService,
    TerminalGateway,
    // Phase 4
    BaseServicesService,
    // Menu config management (for AI Agent MCP tool injection)
    SystemMenuConfigService,
    // Phase 5 - System config management and restart
    SystemRestartService,
    // Phase 7 - Scheduled task config management
    TimerConfigService,
    TypeOrmModule,
    // Phase 6 - Knowledge base module export (for app.module to inject KnowledgeService)
    KnowledgeModule,
    // Phase 9 - Gallery management module export
    GalleryModule,
  ],
})
export class SystemModule {}
