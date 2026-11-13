// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Module,
  MiddlewareConsumer,
  NestModule,
  OnModuleInit,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, TypeOrmModuleOptions, getRepositoryToken } from '@nestjs/typeorm';
import {
  AuthModule,
  UserModule,
  WebSocketModule,
  EventBusModule,
  CacheModule,
  HealthModule,
  MetricsModule,
  ConnectionModule,
  RateLimitGuard,
  OperationLogInterceptor,
  DeviceStateModule,
  AiModule,
  DatabaseModule,
  PathModule,
  RedisModule,
  RoleService,
  UserService,
  SessionService,
  createAllBackendTools,
  AgentOrchestratorService,
  SystemEventModule,
  EventLogModule,
  AuditLoggerModule,
  WechatAuthModule,
  WechatSubscribeMessageModule,
} from '@ss-node/ss-core';
import {
  DeviceModule,
  DeviceService,
  DeviceDiagnosticService,
  DeviceDataService,
} from '@ss-node/ss-device';
import { ProjectModule, ProjectService } from '@ss-node/ss-project';
import {
  AlarmModule,
  AlarmService,
  AlarmStatisticsService,
  AlarmSuppressionService,
} from '@ss-node/ss-alarm';
import { ModbusCollectorModule } from '@ss-node/ss-collector-modbus';
import { S7CollectorModule } from '@ss-node/ss-collector-s7';
import { VirtualCollectorModule } from '@ss-node/ss-collector-virtual';
import { MqttCollectorModule } from '@ss-node/ss-collector-mqtt';
import { OpcUaCollectorModule } from '@ss-node/ss-collector-opcua';
import {
  PipelineModule,
  PluginModule,
  PluginExplorerService,
  PluginManagerService,
  PROVIDER_SCANNER,
  OfflineCacheService,
  PipelineMetricsService,
  CollectorDiagnosticsService,
  DiagnosticsModule,
} from '@ss-node/ss-collector-sdk';
import { DataModule, DataQueryService } from '@ss-node/ss-storage-influx';
import { Influxdb3StorageModule } from '@ss-node/ss-storage-influx3';
import { TdengineStorageModule } from '@ss-node/ss-storage-tdengine';
import {
  SystemModule,
  OperationLog,
  KnowledgeService,
  HealthService,
  DeviceTemplateService,
  DictionaryLoaderService,
  UserAdminService,
  OperationLogService,
  BackupService,
  DatabaseService,
  SystemConfigService,
  SystemMenuConfigService,
  SystemRestartService,
  BaseServicesService,
} from '@ss-node/ss-system';
import { DatatagModule, DataTagService } from '@ss-node/ss-datatag';
import { ReportModule, ReportService } from '@ss-node/ss-report';
import { ScriptModule, ScriptService } from '@ss-node/ss-script';
import { DataSourceModule, DbConnectionService } from '@ss-node/ss-datasource';
import { DataExportModule, DataExportService } from './export/data-export.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CollectorModule } from './collector/collector.module';
import { I18nModule, ResponseI18nInterceptor, I18nMiddleware } from '@ss-node/ss-i18n';
import { VersionController } from './version/version.controller';
import { VersionMiddleware } from './version/version.middleware';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Product mode types
 * - full:  integrated deployment (all ss-scada + ss-data capabilities)
 * - scada: ss-scada standalone deployment (configuration editing/runtime only)
 * - data:  ss-data standalone deployment (data platform / system management only)
 */
export type ProductMode = 'full' | 'scada' | 'data';

/**
 * Get the current product mode
 * Controlled by the APP_PRODUCT_MODE environment variable; defaults to full (for compatibility)
 */
export function getProductMode(): ProductMode {
  const mode = (process.env.APP_PRODUCT_MODE || 'full').toLowerCase();
  if (mode === 'scada' || mode === 'data') {
    return mode;
  }
  return 'full';
}

/**
 * Initialize the project root directory and set it on the global env var SS_NODE_ROOT
 *
 * Project root definition:
 * - dev mode:  ss-services/ss-node/ (the relative-path base for .env.base / .env.dev)
 * - prod mode: ss-run/ss/services/ss-node/ (the relative-path base for .env)
 *
 * This file lives in apps/ss-node-server/src/ (or dist/); going up 3 levels to
 * ss-services/ss-node/ is stable. After setting process.env.SS_NODE_ROOT, every service
 * under packages can resolve the project root via PathResolverService without relying on
 * __dirname traversal.
 *
 * Must be called before ConfigModule.forRoot() so SS_NODE_ROOT is available when env files load.
 */
function initProjectRoot(): string {
  if (process.env.SS_NODE_ROOT) return process.env.SS_NODE_ROOT;

  const projectRoot =
    process.env.NODE_ENV === 'production'
      ? process.cwd()
      : path.resolve(__dirname, '..', '..', '..');
  process.env.SS_NODE_ROOT = projectRoot;
  return projectRoot;
}

// Initialize immediately at module load (before ConfigModule.forRoot)
const SS_NODE_ROOT = initProjectRoot();

function getDatabaseConfig(configService: ConfigService): TypeOrmModuleOptions {
  const dbType = configService.get<string>('DB_TYPE') || 'sqlite';

  if (dbType === 'mysql') {
    return {
      type: 'mysql',
      host: configService.get<string>('DATABASE_HOST') || 'localhost',
      port: configService.get<number>('DATABASE_PORT') || 3306,
      username: configService.get<string>('DATABASE_USER') || 'root',
      password: configService.get<string>('DATABASE_PASSWORD') || '',
      database: configService.get<string>('DATABASE_NAME') || 'smart_scada',
      charset: 'utf8mb4',
      autoLoadEntities: true,
      synchronize: false,
      logging: false,
    };
  }

  const dbPath = configService.get<string>('DATABASE_PATH') || './data/ss-node.db';
  // Use the SS_NODE_ROOT set by initProjectRoot() as the path-resolution base,
  // keeping it consistent with the PathResolverService of each package service.
  // - dev mode:  SS_NODE_ROOT = ss-services/ss-node/
  // - prod mode: SS_NODE_ROOT = ss-run/ss/services/ss-node/
  const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(SS_NODE_ROOT, dbPath);

  // CODE-08: disable synchronize in production to avoid the data risk and startup cost of auto-altering table schema on every boot
  // (dev keeps true so entity changes apply quickly; production should use migrations)
  const isProduction = process.env.NODE_ENV === 'production';
  // CODE-06: configure SQLite PRAGMA via extra.pragma, applying to every connection in the pool
  // (the original main.ts used ds.query('PRAGMA ...') which only affects a single connection, so the cache_size optimization had no real effect)
  // cache_size=-16000 ~= 16MB, which suits a 1.8GB low-memory machine better than 64MB
  const sqlitePragma = [
    'journal_mode=WAL',
    'synchronous=NORMAL',
    'cache_size=-16000',
    'temp_store=MEMORY',
  ];

  return {
    type: 'sqlite',
    database: absoluteDbPath,
    autoLoadEntities: true,
    synchronize: !isProduction,
    // Authoritative entry for schema changes: keep glob consistent with data-source.ts (used by TypeORM CLI),
    // so that `npm run migration:*` and runMigrations at startup see the same set of migrations
    migrations: [path.resolve(__dirname, 'migrations', '*{.ts,.js}')],
    migrationsTableName: 'migrations',
    logging: false,
    extra: {
      busyTimeout: 10000,
      // CODE-06: the sqlite3 driver supports a pragma array, auto-executed on every new pooled connection
      pragma: sqlitePragma,
    },
  };
}

/**
 * Build the env file load paths
 * Priority (production deploy): process.cwd()/.env (single file with all config)
 * Priority (dev): .env.local (local overrides, not committed) -> .env.{productMode} -> .env.base
 * Compatibility: if APP_PRODUCT_MODE is unset, fall back to .env.{APP_ENV|dev} + .env.base
 *
 * .env.local purpose: holds local secrets (e.g. WeChat mini-program APPID/SECRET). It is
 * covered by .gitignore (.env.local rule) and has the highest priority (first file in the
 * dotenv array wins).
 */
function buildEnvFilePaths(): string[] {
  // Production deploy: the .env file lives in the service directory (process.cwd()), generated by publish-node.bat
  if (process.env.NODE_ENV === 'production') {
    const cwdEnv = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(cwdEnv)) {
      return [cwdEnv];
    }
  }

  // Use the SS_NODE_ROOT set by initProjectRoot() (dev mode = ss-services/ss-node/)
  const projectRoot = SS_NODE_ROOT;
  const productMode = getProductMode();

  // .env.local local override file (loaded only if present; secrets are not committed)
  const localEnv = path.resolve(projectRoot, '.env.local');
  const localEnvPaths = fs.existsSync(localEnv) ? [localEnv] : [];

  // Product mode configured: load .env.local + .env.{mode} + .env.base
  if (process.env.APP_PRODUCT_MODE) {
    return [
      ...localEnvPaths,
      path.resolve(projectRoot, `.env.${productMode}`),
      path.resolve(projectRoot, '.env.base'),
    ];
  }

  // No product mode configured: load .env.local + .env.{APP_ENV|dev} + .env.base
  return [
    ...localEnvPaths,
    path.resolve(projectRoot, `.env.${process.env.APP_ENV || 'dev'}`),
    path.resolve(projectRoot, '.env.base'),
  ];
}

// Product mode (computed once at module load)
const PRODUCT_MODE = getProductMode();

// Startup log: explicitly mark the current product mode
if (require.main === module || process.env.NODE_ENV !== 'test') {
  // Print only when the application main process boots, to avoid test-env noise
  try {
    // eslint-disable-next-line no-console
    console.log(`\n[SS-Platform] Product Mode: ${PRODUCT_MODE}\n`);
  } catch {
    // Ignore log errors
  }
}

/**
 * Shared modules (registered in every product mode)
 * Include: config, database, auth, user, project, WebSocket, i18n, EventBus, cache, health check
 */
const sharedModules: any[] = [
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: buildEnvFilePaths(),
    expandVariables: true,
  }),
  // CODE-11: Throttler config now reads env vars, aligned with RATE_LIMIT_MAX / RATE_LIMIT_TTL_MS in .env
  // Default ttl=60s / limit=100 (conservative); production can relax via .env (e.g. RATE_LIMIT_MAX=6000)
  ThrottlerModule.forRoot([
    {
      ttl: Number(process.env.RATE_LIMIT_TTL_MS) || 60000,
      limit: Number(process.env.RATE_LIMIT_MAX) || 100,
    },
  ]),
  TypeOrmModule.forRootAsync({
    imports: [ConfigModule],
    useFactory: (configService: ConfigService) => getDatabaseConfig(configService),
    inject: [ConfigService],
  }),
  I18nModule.forRoot({
    fallbackLanguage: 'zh-CN',
    // Use the SS_NODE_ROOT set by initProjectRoot() as the path-resolution base
    // dev mode:  SS_NODE_ROOT = ss-services/ss-node/ -> packages/ss-sdk/src/i18n/
    // prod mode: SS_NODE_ROOT = ss-run/ss/services/ss-node/ -> cwd/i18n/
    loaderPath:
      process.env.NODE_ENV === 'production'
        ? path.resolve(SS_NODE_ROOT, 'i18n')
        : path.resolve(SS_NODE_ROOT, 'packages', 'ss-sdk', 'src', 'i18n'),
  }),
  EventBusModule,
  DatabaseModule,
  PathModule,
  CacheModule,
  HealthModule,
  ConnectionModule,
  // S-M02: independent audit-log channel (global module, must register before AuthModule)
  AuditLoggerModule,
  AuthModule,
  // WechatAuthModule moved out of sharedModules into conditional registration (see WECHAT_LOGIN_ENABLED below)
  // Subscription-message module (@Global): provides mini-program subscription-message channel and preference APIs, injected @Optional by the alarm dispatcher
  WechatSubscribeMessageModule,
  UserModule,
  ProjectModule,
  WebSocketModule,
  RedisModule,
  SystemEventModule,
  EventLogModule,
];

/**
 * ss-scada specific modules (registered in full + scada modes)
 * Include: graphic plugin storage
 */
const scadaModules: any[] = [DiscoveryModule, PluginModule.forRoot({ autoDiscover: true })];

/**
 * ss-data specific modules (registered in full + data modes)
 * Include: device, alarm, collector, storage, protocol, system management, data tag, report, script, data source, AI
 *
 * CODE-07: AiModule is imported conditionally based on AI_ENABLED.
 * When AI is off (AI_ENABLED !== 'true'), AiModule is not loaded, saving memory and startup time;
 * correspondingly, the BACKEND_TOOLS_INIT provider is also gated (to avoid injecting the
 * unavailable AgentOrchestratorService).
 */
const AI_ENABLED = process.env.AI_ENABLED === 'true';
// Master switch for WeChat QR-code login: when off, WechatAuthModule is not registered and the frontend learns the state via /auth/features
const WECHAT_LOGIN_ENABLED = process.env.WECHAT_LOGIN_ENABLED === 'true';

const dataModules: any[] = [
  DeviceStateModule,
  MetricsModule,
  DeviceModule,
  AlarmModule,
  DataModule,
  // Time-series storage adapter layer: register InfluxDB 3 Core / TDengine adapters (routed by STORAGE_DEFAULT_ENGINE / per-project override)
  Influxdb3StorageModule,
  TdengineStorageModule,
  PipelineModule,
  CollectorModule,
  DiagnosticsModule,
  ModbusCollectorModule,
  S7CollectorModule,
  VirtualCollectorModule,
  MqttCollectorModule,
  OpcUaCollectorModule,
  SystemModule,
  DatatagModule,
  ReportModule,
  ScriptModule,
  DataSourceModule,
  DataExportModule,
  DashboardModule,
  // CODE-07: AiModule loads only when AI_ENABLED=true
  ...(AI_ENABLED ? [AiModule] : []),
];

@Module({
  imports: [
    ...sharedModules,
    // The WeChat QR-code login module registers only when WECHAT_LOGIN_ENABLED=true
    // When off, WechatAuthController does not exist and /auth/wechat/* endpoints return 404
    ...(WECHAT_LOGIN_ENABLED ? [WechatAuthModule] : []),
    // scada mode: load shared + scada-specific modules
    // full mode:  load shared + scada + data modules
    ...(PRODUCT_MODE !== 'data' ? scadaModules : []),
    // data mode:  load shared + data-specific modules
    // full mode:  load shared + scada + data modules
    ...(PRODUCT_MODE !== 'scada' ? dataModules : []),
  ],
  controllers: [VersionController],
  providers: [
    ...(PRODUCT_MODE !== 'data'
      ? [
          PluginExplorerService,
          {
            provide: PROVIDER_SCANNER,
            useFactory: (discoveryService: DiscoveryService) => ({
              getProviders: () => discoveryService.getProviders(),
            }),
            inject: [DiscoveryService],
          },
        ]
      : []),
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseI18nInterceptor,
    },
    // Operation-log interceptor: register only when OPERATION_LOG_ENABLED !== 'false'
    ...(process.env.OPERATION_LOG_ENABLED !== 'false'
      ? [
          {
            provide: APP_INTERCEPTOR,
            useFactory: (operationLogRepo: any) => {
              const interceptor = new OperationLogInterceptor();
              interceptor.setRepository(operationLogRepo);
              return interceptor;
            },
            inject: [getRepositoryToken(OperationLog)],
          },
        ]
      : []),
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    // P2-T01: register backend MCP tools (replace stub with real implementation)
    // CODE-07: register only when AI_ENABLED=true - this factory injects AgentOrchestratorService (provided by AiModule),
    // so when AI is off and AiModule is not loaded, this must also be skipped, otherwise DI fails at startup.
    ...(AI_ENABLED
      ? [
          {
            provide: 'BACKEND_TOOLS_INIT',
            useFactory: (
              orchestrator: AgentOrchestratorService,
              deviceService: DeviceService,
              alarmService: AlarmService,
              alarmStatsService: AlarmStatisticsService,
              alarmSuppressionService: AlarmSuppressionService,
              dataQueryService: DataQueryService,
              knowledgeService: KnowledgeService,
        healthService: HealthService,
        deviceTemplateService: DeviceTemplateService,
        dictLoaderService: DictionaryLoaderService,
        dbConnectionService: DbConnectionService,
        projectService: ProjectService,
        reportService: ReportService,
        scriptService: ScriptService,
        datatagService: DataTagService,
        // Batches E-I: newly added services
        userAdminService: UserAdminService,
        userService: UserService,
        roleService: RoleService,
        sessionService: SessionService,
        operationLogService: OperationLogService,
        menuConfigService: SystemMenuConfigService,
        deviceDiagnosticService: DeviceDiagnosticService,
        deviceDataService: DeviceDataService,
        pluginManagerService: PluginManagerService,
        pipelineMetricsService: PipelineMetricsService,
        offlineCacheService: OfflineCacheService,
        collectorDiagnosticsService: CollectorDiagnosticsService,
        baseServicesService: BaseServicesService,
        systemConfigService: SystemConfigService,
        systemRestartService: SystemRestartService,
        dataExportService: DataExportService,
        databaseService: DatabaseService,
        backupService: BackupService,
      ) => {
        const tools = createAllBackendTools({
          // Original services
          deviceService,
          alarmService: {
            getRecords: (projectId, limit) => alarmService.getRecords(projectId, limit),
            getRules: (projectId) => alarmService.findAllRules(projectId),
            createRule: (projectId, dto) => alarmService.createRule(projectId, dto as any),
            addSuppressionRule: (_projectId, dto) => {
              const id = (alarmSuppressionService as any).addRule({
                id: '',
                name: dto.type || 'suppression',
                type: dto.type as any,
                targetIds: [...(dto.childRuleIds || []), ...(dto.devices || [])],
                suppressAlarms: true,
                suppressNotifications: true,
                startTime: dto.duration ? new Date() : undefined,
                endTime: dto.duration
                  ? new Date(Date.now() + (dto.duration as number) * 1000)
                  : undefined,
              });
              return Promise.resolve({ id });
            },
          } as any,
          alarmStatisticsService: alarmStatsService,
          dataQueryService: {
            queryTimeRange: (query) => dataQueryService.queryTimeRange(query),
            aggregate: (tagId, startTime, endTime, type) =>
              dataQueryService.aggregate(tagId, startTime, endTime, type as any),
            getTagStats: (tagId, startTime, endTime) =>
              dataQueryService.getTagStats(tagId, startTime, endTime),
            queryTrend: (params) =>
              dataQueryService.queryTrendData({
                tagIds: params.tagIds,
                startTime: new Date(params.startTime),
                endTime: new Date(params.endTime),
                maxPoints: params.maxPoints,
                projectId: params.projectId,
                interpolation: params.interpolation as any,
                interval: params.interval,
              }),
            exportTrend: async (tagIds, startTime, endTime, projectId, format) => {
              const fmt = (format || 'csv').toLowerCase();
              if (fmt === 'json' && tagIds.length > 1) {
                const result = await (dataQueryService as any).exportBatchJson(
                  tagIds,
                  new Date(startTime),
                  new Date(endTime),
                  projectId,
                );
                const filePath = path.join(os.tmpdir(), result.filename);
                fs.writeFileSync(filePath, result.json, 'utf-8');
                return { filePath, fileName: result.filename };
              }
              if (fmt === 'json') {
                const result = await dataQueryService.exportJson(
                  tagIds[0],
                  new Date(startTime),
                  new Date(endTime),
                  projectId,
                );
                const filePath = path.join(os.tmpdir(), result.filename);
                fs.writeFileSync(filePath, result.json, 'utf-8');
                return { filePath, fileName: result.filename };
              }
              // csv (default) - single tag
              const result = await dataQueryService.exportCsv(
                tagIds[0],
                new Date(startTime),
                new Date(endTime),
                projectId,
              );
              const filePath = path.join(os.tmpdir(), result.filename);
              fs.writeFileSync(filePath, result.csv, 'utf-8');
              return { filePath, fileName: result.filename };
            },
          } as any,
          knowledgeService,
          healthService,
          templateService: deviceTemplateService as any,
          deviceCreateService: {
            createDevice: (dto, projectId) => deviceService.create(dto as any, projectId),
          },
          dictService: dictLoaderService as any,
          // Newly added services
          dbConnectionService: {
            findAll: (projectId) => dbConnectionService.findAll(projectId),
            create: (projectId, dto) => dbConnectionService.create(projectId, dto as any),
            test: (projectId, id) => dbConnectionService.test(projectId, id),
            getTables: (projectId, id) => dbConnectionService.getTables(projectId, id),
            getColumns: (projectId, id, tableName) =>
              dbConnectionService.getColumns(projectId, id, tableName),
            executeQuery: (projectId, id, sql) =>
              dbConnectionService.executeQuery(projectId, id, sql),
          },
          projectService: {
            findAll: (userId, query) => projectService.findAll(userId, query as any),
            findOne: (id, userId) => projectService.findOne(id, userId),
            exportProjectZip: (projectId, userId, opts) =>
              projectService.exportProjectZip(projectId, userId, opts),
            importProjectZip: (filePath, userId, overwrite) =>
              projectService
                .importProjectZip(fs.readFileSync(filePath), userId, { overwrite })
                .then((r) => ({
                  data: { projectId: r.project.projectId, projectName: r.project.projectName },
                  warnings: r.warnings,
                })),
            getManageInfo: (projectId) => projectService.getManageInfo(projectId),
            diagnose: (projectId) =>
              projectService.diagnoseProject(projectId).then((r) => ({
                health: r.health,
                resources: r.resources as Record<string, string>,
                issues: r.issues,
              })),
            initResources: (projectId, resources) =>
              projectService.initProjectResources(projectId, resources).then((r) => ({
                health: r.initialized.length > 0 ? 'healthy' : 'degraded',
                resources: {} as Record<string, string>,
                issues: r.warnings,
                initialized: r.initialized,
                skipped: r.skipped,
              })),
          },
          reportService: {
            generateDailyReport: (projectId, date) =>
              reportService.generateDailyReport(projectId, date),
            generateMonthlyReport: (projectId, month) =>
              reportService.generateMonthlyReport(projectId, month),
            generateCustomReport: (projectId, config) =>
              reportService.generateCustomReport(projectId, config as any),
            generateAlarmReport: (projectId, config) =>
              reportService.generateAlarmReport(projectId, config as any),
            generateTrendReport: (projectId, config) =>
              reportService.generateTrendReport(projectId, config as any),
            exportReport: (reportId, format) => reportService.exportReport(reportId, format as any),
            queryReports: (projectId, query) => reportService.queryReports(projectId, query as any),
            saveReportConfig: (projectId, config) =>
              reportService.saveReportConfig(projectId, config as any),
            getSchedules: (projectId) => reportService.getScheduledExports(projectId),
            createSchedule: (projectId, schedule) =>
              reportService.scheduleReportExport(projectId, {
                templateId: schedule.templateId,
                cronExpression: schedule.cronExpression,
                exportFormat: schedule.exportFormat as any,
                enabled: schedule.enabled,
              }),
          },
          datatagService: {
            findAll: (projectId, query) => datatagService.findAll(projectId, query as any),
            update: (id, dto) => datatagService.update(id, dto as any),
            batchUpdate: (ids, dto) => datatagService.batchUpdate(ids, dto),
          },
          scriptService: {
            getApiFunctions: () => scriptService.getApiFunctions(),
            create: (dto) => scriptService.create(dto as any),
            executeScript: (id, projectId) => scriptService.executeScript(id, projectId) as any,
          },
          // ──────────── Batch E: alarm handling & operations (7 tools) ────────────
          alarmOpsService: {
            acknowledge: (recordId, userId, projectId) =>
              alarmService.acknowledgeAlarm(recordId, userId, projectId),
            batchAcknowledge: (ids, userId, projectId) =>
              alarmService.batchAcknowledge(ids, userId, projectId),
            clear: (recordId, userId, projectId) =>
              alarmService.clearAlarm(recordId, userId, projectId),
            shelve: (recordId, duration, userId, projectId) =>
              (alarmService as any).shelveAlarm(recordId, userId, String(duration), projectId),
            getStatistics: (projectId) => alarmStatsService.getStatistics(projectId),
            toggleRule: (ruleId, enabled, projectId) =>
              enabled
                ? alarmService.enableRule(ruleId, projectId)
                : alarmService.disableRule(ruleId, projectId),
            getSuppressionRules: (_projectId) =>
              Promise.resolve((alarmSuppressionService as any).getRules?.() ?? []),
          },
          // ──────────── Batch F: device ops management (6 tools) ────────────
          deviceOpsService: {
            update: (id, dto, projectId) => deviceService.update(id, dto as any, projectId),
            remove: (id, projectId) => deviceService.remove(id, projectId),
            moveDevice: (id, targetGroupId, projectId) =>
              deviceService.moveDevice(id, targetGroupId, projectId),
            writeTagValue: (deviceId, tagId, value, projectId) =>
              deviceDataService.updateLatestValue(tagId, deviceId, value, 'good', projectId),
          },
          deviceGroupService: {
            getGroups: (projectId) => deviceService.findAllGroups(projectId),
            getGroupTree: (projectId) => deviceService.getGroupTree(projectId),
            createGroup: (projectId, dto) => deviceService.createGroup(projectId, dto as any),
            updateGroup: (projectId, groupId, dto) =>
              deviceService.updateGroup(projectId, groupId, dto as any),
            deleteGroup: (projectId, groupId) => deviceService.removeGroup(projectId, groupId),
          },
          deviceDiagnosticService: {
            ping: (deviceId, host, port) =>
              (deviceDiagnosticService as any).ping(deviceId, host, port),
            readTag: (deviceId, params) =>
              (deviceDiagnosticService as any).readTag({ deviceId, ...params }),
            writeTag: (deviceId, params) =>
              (deviceDiagnosticService as any).writeTag({ deviceId, ...params }),
            scanAddresses: (deviceId, params) =>
              (deviceDiagnosticService as any).scanAddresses({ deviceId, ...params }),
            runDiagnostic: (deviceId, action, params) =>
              (deviceDiagnosticService as any).runDiagnostic({ id: deviceId, ...params }, action),
          },
          // ──────────── Batch G: user permission management (5 tools) ────────────
          userService: {
            findAll: (query) => userAdminService.listUsers(query as any),
            adminCreateUser: (dto) => userService.createUser(dto as any),
            adminUpdateUser: (id, dto) => userAdminService.updateUserRole(id, (dto as any).role),
            toggleUserStatus: (id, isActive) => userAdminService.toggleUserStatus(id, isActive),
            resetPassword: (id) => userAdminService.resetPassword(id),
            deleteUser: (id) => userAdminService.deleteUser(id),
            assignRole: (id, roleId) => userAdminService.updateUserRole(id, roleId as any),
          },
          roleService: {
            findAll: () => roleService.findAll(),
            findById: (id) => roleService.findById(id),
            create: (dto) => roleService.create(dto as any),
            update: (id, dto) => roleService.update(id, dto as any),
            delete: (id) => roleService.delete(id),
            getProjectAuths: (roleId) => (roleService as any).getPermissions(roleId),
            setProjectAuths: (roleId, auths) =>
              (roleService as any).setPermissions
                ? (roleService as any).setPermissions(roleId, auths)
                : Promise.reject(new Error('当前版本暂不支持设置项目权限')),
            getDeviceAuths: (roleId, projectId) =>
              (roleService as any).getDevicePermissions
                ? (roleService as any).getDevicePermissions(roleId, projectId)
                : Promise.resolve([]),
            setDeviceAuths: (roleId, projectId, auths) =>
              (roleService as any).setDevicePermissions
                ? (roleService as any).setDevicePermissions(roleId, projectId, auths)
                : Promise.reject(new Error('当前版本暂不支持设置设备权限')),
          },
          sessionService: {
            getUserSessions: (userId) => sessionService.getUserSessions(userId),
            forceLogout: (sessionId) => sessionService.forceLogout(sessionId),
            logoutAllExcept: (userId, currentSessionId) =>
              sessionService.logoutAllExcept(userId, currentSessionId),
            getLoginHistory: (userId) => sessionService.getLoginHistory(userId),
          },
          operationLogService: {
            query: (query) => operationLogService.query(query as any),
            getStats: () => operationLogService.getStats(),
            cleanupExpired: () => operationLogService.cleanupExpired(),
          },
          menuService: {
            getMenu: (subsystem) => menuConfigService.getMenu(subsystem),
            createMenuItem: (item, parentId) =>
              menuConfigService.createMenuItem(item, parentId ?? null),
            updateMenuItem: (id, item, parentId) =>
              menuConfigService.updateMenuItem(id, item, parentId),
            deleteMenuItem: (id) => menuConfigService.deleteMenuItem(id),
            getMenuButtons: () => menuConfigService.getMenuButtons(),
            updateMenuButtons: (buttons) => menuConfigService.updateMenuButtons(buttons),
          },
          // ──────────── Batch H: collector & service ops (7 tools) ────────────
          pluginManagerService: {
            listPlugins: (query) =>
              (pluginManagerService as any).listPluginsWithRuntime(query as any),
            activate: (protocol) => pluginManagerService.activate(protocol),
            deactivate: (protocol) => pluginManagerService.deactivate(protocol),
            getPluginStatus: (protocol) =>
              (pluginManagerService as any).getPluginStatus
                ? (pluginManagerService as any).getPluginStatus(protocol)
                : (pluginManagerService as any).listPluginsWithRuntime({ protocol }),
            healthCheck: () => pluginManagerService.healthCheck(),
            hotReload: (protocol) => pluginManagerService.hotReload(protocol),
            rollback: (protocol) => pluginManagerService.rollback(protocol),
            getMonitorData: (protocol) => pluginManagerService.getMonitorData(protocol),
            validateChannelConfig: (protocol, config) =>
              pluginManagerService.validateChannelConfig(protocol, config),
            getPluginConfig: (protocol) =>
              (pluginManagerService as any).getPluginConfig
                ? (pluginManagerService as any).getPluginConfig(protocol)
                : Promise.resolve(null),
            updatePluginConfig: (protocol, config) =>
              pluginManagerService.updatePluginConfig(protocol, config as any),
          },
          pipelineDiagService: {
            getMetricsSnapshot: () => pipelineMetricsService.getMetricsSnapshot(),
            getStepTimingStats: () =>
              (pipelineMetricsService as any).getStepTimingStats
                ? (pipelineMetricsService as any).getStepTimingStats()
                : (pipelineMetricsService as any).getTimingStats
                  ? (pipelineMetricsService as any).getTimingStats()
                  : {},
            getTimingBreakdowns: (limit) =>
              (pipelineMetricsService as any).getTimingBreakdowns
                ? (pipelineMetricsService as any).getTimingBreakdowns(limit)
                : (pipelineMetricsService as any).getBreakdowns
                  ? (pipelineMetricsService as any).getBreakdowns(limit)
                  : [],
            getDiagnosticInfo: () =>
              (pipelineMetricsService as any).getDiagnosticInfo
                ? (pipelineMetricsService as any).getDiagnosticInfo()
                : (pipelineMetricsService as any).getDiagnosticInfo
                  ? (pipelineMetricsService as any).getDiagnosticInfo()
                  : {},
          },
          offlineCacheService: {
            getBufferStats: () => offlineCacheService.getBufferStats(),
            flush: (maxBatch) => offlineCacheService.flush(maxBatch),
            clear: () => offlineCacheService.clear(),
          },
          collectorDiagService: {
            runFullDiagnosis: (deviceId) => collectorDiagnosticsService.runFullDiagnosis(deviceId),
            checkTagReadability: (tagId) => collectorDiagnosticsService.checkTagReadability(tagId),
            checkPluginHealth: (protocol) =>
              collectorDiagnosticsService.checkPluginHealth(protocol),
          },
          baseServicesService: {
            getAllStatus: () => baseServicesService.getAllStatus(),
            getStatus: (name) => baseServicesService.getStatus(name),
            start: (name) => baseServicesService.start(name),
            stop: (name) => baseServicesService.stop(name),
            restart: (name) => baseServicesService.restart(name),
            getLogs: (name, limit) => baseServicesService.getLogs(name, limit),
          },
          influxAdminService: {
            checkSetupStatus: () => (baseServicesService as any).checkInfluxSetupStatus(),
            checkHealth: () => (baseServicesService as any).checkInfluxHealth(),
            getConfig: () => (baseServicesService as any).getInfluxConfig(),
            listBuckets: () => (baseServicesService as any).listInfluxBuckets(),
            setup: (options) => (baseServicesService as any).setupInfluxDB(options),
          },
          systemConfigService: {
            getAllWithMeta: () => systemConfigService.getAllWithMeta(),
            get: (key) => systemConfigService.get(key),
            setWithMeta: (key, value, options) =>
              systemConfigService.setWithMeta(key, value, options as any),
            getRestartRequired: () => systemConfigService.getRestartRequired(),
            triggerRestart: (username) => systemRestartService.triggerRestart(username),
            getRestartStatus: () => systemRestartService.getRestartStatus(),
          },
          // ──────────── Batch I: data governance & backup (5 tools) ────────────
          dataExportService: {
            exportCsv: (tagId, startTime, endTime) =>
              (dataExportService as any).exportCsv?.(tagId, startTime, endTime) ??
              (dataExportService as any).exportCSV({ tagId, startTime, endTime }),
            exportJson: (tagId, startTime, endTime) =>
              (dataExportService as any).exportJson?.(tagId, startTime, endTime) ??
              Promise.reject(new Error('当前版本暂不支持 JSON 导出')),
            exportBatchJson: (tagIds, startTime, endTime, projectId) =>
              (dataExportService as any).exportBatchJson?.(tagIds, startTime, endTime, projectId) ??
              Promise.reject(new Error('当前版本暂不支持批量 JSON 导出')),
            exportToResult: (filters) => (dataExportService as any).exportToResult(filters),
          },
          databaseService: {
            getAllDatabasesStatus: () => databaseService.getAllDatabasesStatus(),
            checkSystemIntegrity: () => databaseService.checkSystemIntegrity(),
            checkProjectIntegrity: (projectName) =>
              databaseService.checkProjectIntegrity(projectName),
            vacuumSystem: () => databaseService.vacuumSystem(),
            vacuumProject: (projectName) => databaseService.vacuumProject(projectName),
          },
          backupService: {
            listBackups: (dbType) => backupService.listBackups(dbType),
            getBackupStats: () => backupService.getBackupStats(),
            getBackupLogs: (query) => backupService.getBackupLogs(query as any),
            createSystemBackup: (backupType, operator) =>
              backupService.createSystemBackup(backupType, operator),
            createProjectBackup: (projectName, backupType, operator) =>
              backupService.createProjectBackup(projectName, backupType, operator),
            deleteBackup: (filename) => backupService.deleteBackup(filename),
            restoreBackup: (filename) => backupService.restoreBackup(filename),
            restoreProjectBackup: (filename, projectName) =>
              backupService.restoreProjectBackup(filename, projectName),
            cleanupExpired: (dbType, days) => backupService.cleanupExpired(dbType, days),
            getBackupConfig: () => backupService.getBackupConfig(),
            saveBackupConfig: (config) => backupService.saveBackupConfig(config),
          },
        } as any);
        orchestrator.injectBackendTools(tools);
        Logger.log(
          `P2-T01: Registered ${tools.length} backend MCP tools (data query / devices / alarms / knowledge base / health check / templates / device creation / dictionaries / external databases / project management / trends / diagnostics / reports / tags / scripts / alarm handling / device ops / user permissions / collector ops / data governance & backup)`,
          'BackendTools',
        );
      },
      inject: [
        AgentOrchestratorService,
        DeviceService,
        AlarmService,
        AlarmStatisticsService,
        AlarmSuppressionService,
        DataQueryService,
        KnowledgeService,
        HealthService,
        DeviceTemplateService,
        DictionaryLoaderService,
        DbConnectionService,
        ProjectService,
        ReportService,
        ScriptService,
        DataTagService,
        // Batches E-I: newly added services
        UserAdminService,
        UserService,
        RoleService,
        SessionService,
        OperationLogService,
        SystemMenuConfigService,
        DeviceDiagnosticService,
        DeviceDataService,
        PluginManagerService,
        PipelineMetricsService,
        OfflineCacheService,
        CollectorDiagnosticsService,
        BaseServicesService,
        SystemConfigService,
        SystemRestartService,
        DataExportService,
        DatabaseService,
        BackupService,
      ],
    },
        ]
      : []),
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  private readonly logger = new Logger('AppModule');

  // CODE-07: BACKEND_TOOLS_INIT is now a conditional provider (registered only when AI_ENABLED=true),
  // so its injection must be marked @Optional() to avoid a startup error when AI is off (NestFactory throws on a missing non-optional dependency)
  constructor(@Optional() @Inject('BACKEND_TOOLS_INIT') _toolsInit: void) {
    this.logger.log(`Product Mode: ${PRODUCT_MODE}`);
    this.logger.log(
      `Modules loaded: shared(13) + ${
        PRODUCT_MODE !== 'data' ? 'scada(1)' : 'scada(0)'
      } + ${PRODUCT_MODE !== 'scada' ? `data(${dataModules.length})` : 'data(0)'}`,
    );
    this.logger.log(
      `Operation Log: ${process.env.OPERATION_LOG_ENABLED !== 'false' ? 'enabled' : 'disabled'}`,
    );
    this.logger.log(`AI Module: ${AI_ENABLED ? 'enabled' : 'disabled'}`);
    this.logger.log(`Wechat Login: ${WECHAT_LOGIN_ENABLED ? 'enabled' : 'disabled'}`);
  }

  onModuleInit() {
    // Base services (shared + business modules) initialized
    // Use console.log to stay consistent with the startup-phase logs in main.ts
    console.log(`[Startup] ✅ Base services (shared/business modules) initialized`);
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, VersionMiddleware, I18nMiddleware).forRoutes('*');
  }
}
