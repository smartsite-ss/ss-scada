// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  ReportType,
  ReportStatus,
  ReportData,
  ReportSummary,
  ReportItem,
  ReportChart,
  ReportConfig,
  ExportFormat,
} from './report.entity';
import { DataQueryService, AggregationType } from '@ss-node/ss-storage-influx';
import { AlarmService, AlarmRecord } from '@ss-node/ss-alarm';
import { AlarmLevel, AlarmStatus, DeviceStatus, PaginatedResult } from '@ss-node/ss-sdk';
import { DeviceService, DataTag } from '@ss-node/ss-device';
import { PathResolverService } from '@ss-node/ss-core';

/** Cached reports (for the export feature) */
interface CachedReport {
  id: string;
  type: ReportType;
  projectId: string;
  date?: string;
  month?: string;
  dateRange?: string;
  config?: Record<string, unknown>;
  generatedAt: string;
  data: ReportData;
}

/** Saved report configs */
interface SavedReportConfig {
  id: string;
  projectId: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  createdAt: string;
}

/** Stored report templates */
interface StoredReportTemplate {
  id: string;
  projectId: string;
  name: string;
  type: ReportType;
  config: ReportConfig | null;
  createdAt: string;
  updatedAt: string;
}

/** Stored scheduled-export tasks */
interface StoredReportSchedule {
  id: string;
  projectId: string;
  templateId: string | null;
  cronExpression: string;
  exportFormat: ExportFormat;
  enabled: boolean;
  lastRunAt: Date | null;
  lastExportPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Scheduled-export execution history */
interface ExportHistoryEntry {
  id: string;
  projectId: string;
  scheduleId: string;
  templateId: string | null;
  reportId: string | null;
  exportPath: string | null;
  status: 'success' | 'failed';
  errorMessage: string | null;
  executedAt: string;
}

type Granularity = 'hour' | 'day' | 'month';

/** Alarm summary data */
interface AlarmSummaryData {
  totalAlarms: number;
  byLevel: Record<string, number>;
  byDevice: Record<string, number>;
  responseTimeAvg: number;
  ackRate: number;
}

/** Trend summary data */
interface TrendSummaryData {
  anomalyCount: number;
  anomalyRate: number;
  trendDirection: 'up' | 'down' | 'stable';
}

@Injectable()
export class ReportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportService.name);

  private readonly CHART_COLORS = [
    '#4CAF50',
    '#2196F3',
    '#FF9800',
    '#9C27B0',
    '#F44336',
    '#00BCD4',
  ];

  private readonly CACHE_MAX_SIZE = 100;

  /** Scheduler check interval (ms) - checks cron matches every 60 seconds */
  private readonly SCHEDULER_INTERVAL_MS = 60 * 1000;

  /** Report cache: for the export feature and report queries */
  private readonly reportCache = new Map<string, CachedReport>();

  /** Report-config store */
  private readonly savedConfigs = new Map<string, SavedReportConfig[]>();

  /** Report-template store: templateId -> template */
  private readonly templates = new Map<string, StoredReportTemplate>();

  /** Scheduled-export task store: scheduleId -> task */
  private readonly schedules = new Map<string, StoredReportSchedule>();

  /** Scheduled-export execution history */
  private readonly exportHistory: ExportHistoryEntry[] = [];

  /** Scheduler timer reference */
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pathResolver: PathResolverService,
    @Optional() private readonly dataQueryService?: DataQueryService,
    @Optional() private readonly alarmService?: AlarmService,
    @Optional() private readonly deviceService?: DeviceService,
  ) {}

  // ==================== Lifecycle hooks ====================

  async onModuleInit(): Promise<void> {
    this.startScheduler();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopScheduler();
  }

  // ==================== Daily report generation ====================

  async generateDailyReport(projectId: string, date: string): Promise<Record<string, unknown>> {
    this.logger.log(`Generating daily report for project ${projectId} on ${date}`);

    const startTime = new Date(`${date}T00:00:00.000`);
    const endTime = new Date(`${date}T23:59:59.999`);

    const summary = await this.buildRealSummary(projectId, startTime, endTime);
    const items = await this.buildDailyItems(projectId, startTime, endTime);
    const charts = await this.buildTimeSeriesCharts(projectId, startTime, endTime, 'hour');

    const report: CachedReport = {
      id: this.generateReportId(),
      type: ReportType.DAILY,
      projectId,
      date,
      generatedAt: new Date().toISOString(),
      data: { summary, items, charts },
    };

    this.cacheReport(report);

    return { ...report } as Record<string, unknown>;
  }

  // ==================== Monthly report generation ====================

  async generateMonthlyReport(projectId: string, month: string): Promise<Record<string, unknown>> {
    this.logger.log(`Generating monthly report for project ${projectId} on ${month}`);

    const [year, monthNum] = month.split('-').map(Number);
    const startTime = new Date(year, monthNum - 1, 1, 0, 0, 0, 0);
    const endTime = new Date(year, monthNum, 0, 23, 59, 59, 999);

    const summary = await this.buildRealSummary(projectId, startTime, endTime);
    const items = await this.buildMonthlyItems(projectId, startTime, endTime);
    const charts = await this.buildMonthlyAlarmCharts(
      projectId,
      startTime,
      endTime,
      year,
      monthNum,
    );

    const report: CachedReport = {
      id: this.generateReportId(),
      type: ReportType.MONTHLY,
      projectId,
      month,
      generatedAt: new Date().toISOString(),
      data: { summary, items, charts },
    };

    this.cacheReport(report);

    return { ...report } as Record<string, unknown>;
  }

  // ==================== Custom reports ====================

  async generateCustomReport(
    projectId: string,
    config: {
      startDate: string;
      endDate: string;
      metrics?: string[];
      tagIds?: string[];
      deviceIds?: string[];
      granularity?: Granularity;
    },
  ): Promise<Record<string, unknown>> {
    this.logger.log(
      `Generating custom report for project ${projectId} from ${config.startDate} to ${config.endDate}`,
    );

    const startTime = new Date(`${config.startDate}T00:00:00.000`);
    const endTime = new Date(`${config.endDate}T23:59:59.999`);
    const granularity = config.granularity ?? 'day';
    const metrics = config.metrics ?? ['avg', 'max', 'min'];

    // Resolve the tagIds to query
    const tagIds = await this.resolveTagIds(projectId, config.tagIds, config.deviceIds);

    // Query historical-data statistics
    const items = await this.buildCustomItems(tagIds, startTime, endTime, metrics);
    const charts = await this.buildCustomCharts(tagIds, startTime, endTime, granularity);
    const summary = await this.buildRealSummary(projectId, startTime, endTime);

    const report: CachedReport = {
      id: this.generateReportId(),
      type: ReportType.CUSTOM,
      projectId,
      dateRange: `${config.startDate} ~ ${config.endDate}`,
      config: {
        timeRange: { start: config.startDate, end: config.endDate },
        metrics,
        tagIds: config.tagIds ?? [],
        deviceIds: config.deviceIds ?? [],
        granularity,
      },
      generatedAt: new Date().toISOString(),
      data: { summary, items, charts },
    };

    this.cacheReport(report);

    return { ...report } as Record<string, unknown>;
  }

  // ==================== Alarm report ====================

  async generateAlarmReport(
    projectId: string,
    config: {
      startDate: string;
      endDate: string;
      levels?: string[];
      deviceIds?: string[];
    },
  ): Promise<Record<string, unknown>> {
    this.logger.log(
      `Generating alarm report for project ${projectId} from ${config.startDate} to ${config.endDate}`,
    );

    const startTime = new Date(`${config.startDate}T00:00:00.000`);
    const endTime = new Date(`${config.endDate}T23:59:59.999`);

    // Get alarm records
    const allRecords = await this.fetchAlarmRecords(projectId);
    // Filter by tagIds only when deviceIds are specified; otherwise do not filter devices
    const tagIdsSet =
      config.deviceIds && config.deviceIds.length > 0
        ? new Set(await this.resolveTagIds(projectId, undefined, config.deviceIds))
        : undefined;
    const filteredRecords = this.filterAlarmRecords(
      allRecords,
      startTime,
      endTime,
      config.levels,
      tagIdsSet,
    );

    const alarmSummary = this.buildAlarmSummaryData(filteredRecords);
    const items = this.buildAlarmItems(filteredRecords);
    const charts = this.buildAlarmCharts(filteredRecords, startTime, endTime);

    const report: CachedReport = {
      id: this.generateReportId(),
      type: ReportType.ALARM,
      projectId,
      dateRange: `${config.startDate} ~ ${config.endDate}`,
      config: {
        timeRange: { start: config.startDate, end: config.endDate },
      },
      generatedAt: new Date().toISOString(),
      data: {
        summary: {
          totalDevices: 0,
          onlineDevices: 0,
          offlineDevices: 0,
          avgDataQuality: 0,
          ...alarmSummary,
        } as unknown as ReportSummary,
        items,
        charts,
      },
    };

    this.cacheReport(report);

    return { ...report } as Record<string, unknown>;
  }

  // ==================== Trend report ====================

  async generateTrendReport(
    projectId: string,
    config: {
      startDate: string;
      endDate: string;
      tagIds: string[];
      granularity?: Granularity;
    },
  ): Promise<Record<string, unknown>> {
    this.logger.log(
      `Generating trend report for project ${projectId} from ${config.startDate} to ${config.endDate}`,
    );

    const startTime = new Date(`${config.startDate}T00:00:00.000`);
    const endTime = new Date(`${config.endDate}T23:59:59.999`);
    const granularity = config.granularity ?? 'day';

    const charts = await this.buildTrendCharts(config.tagIds, startTime, endTime, granularity);
    const trendSummary = await this.buildTrendSummary(config.tagIds, startTime, endTime);

    const report: CachedReport = {
      id: this.generateReportId(),
      type: ReportType.TREND,
      projectId,
      dateRange: `${config.startDate} ~ ${config.endDate}`,
      config: {
        timeRange: { start: config.startDate, end: config.endDate },
        tagIds: config.tagIds,
        granularity,
      },
      generatedAt: new Date().toISOString(),
      data: {
        summary: {
          totalDevices: 0,
          onlineDevices: 0,
          offlineDevices: 0,
          totalAlarms: 0,
          avgDataQuality: 0,
          ...trendSummary,
        } as unknown as ReportSummary,
        items: [],
        charts,
      },
    };

    this.cacheReport(report);

    return { ...report } as Record<string, unknown>;
  }

  // ==================== Report export ====================

  async exportReport(
    reportId: string,
    format: 'pdf' | 'excel' | 'html',
  ): Promise<Record<string, unknown>> {
    this.logger.log(`Exporting report ${reportId} as ${format}`);

    const report = this.reportCache.get(reportId);
    if (!report) {
      throw new NotFoundException(`Report ${reportId} not found`);
    }

    const exportsDir = this.ensureExportsDir();
    const timestamp = Date.now();
    let fileExtension: string;
    let fileName: string;
    let filePath: string;

    if (format === 'excel') {
      fileExtension = 'xlsx';
      fileName = `report_${reportId}_${timestamp}.${fileExtension}`;
      filePath = path.resolve(exportsDir, fileName);
      const excelBuffer = this.generateExcel(report);
      fs.writeFileSync(filePath, excelBuffer);
    } else {
      // pdf / html formats: both generate an HTML report file
      // Production should use puppeteer or pdfkit to generate a real PDF
      fileExtension = 'html';
      fileName = `report_${reportId}_${timestamp}.${fileExtension}`;
      filePath = path.resolve(exportsDir, fileName);
      const htmlContent = this.generateHTMLReport(report);
      fs.writeFileSync(filePath, htmlContent, 'utf-8');
    }

    this.logger.log(`Report exported to ${filePath}`);

    return {
      reportId,
      format,
      fileName,
      filePath,
      fileUrl: `/reports/exports/${fileName}`,
      exportedAt: new Date().toISOString(),
      status: ReportStatus.COMPLETED,
    };
  }

  /**
   * Resolve the export file's absolute path (for the controller's res.sendFile):
   * validates the report exists and belongs to the current project, guards the file name with basename against traversal, and throws 404 when the file is missing.
   */
  getExportFileAbsolute(projectId: string, reportId: string, fileName: string): string {
    const report = this.reportCache.get(reportId);
    if (!report || report.projectId !== projectId) {
      throw new NotFoundException(`Report ${reportId} not found in project ${projectId}`);
    }

    const safeFileName = path.basename(fileName);
    if (!safeFileName || safeFileName !== fileName) {
      throw new BadRequestException('Invalid file name');
    }

    const exportsDir = this.ensureExportsDir();
    const filePath = path.resolve(exportsDir, safeFileName);
    if (!filePath.startsWith(exportsDir) || !fs.existsSync(filePath)) {
      throw new NotFoundException(`Export file ${safeFileName} not found`);
    }

    return filePath;
  }

  // ==================== Report query ====================

  async queryReports(
    projectId: string,
    query: {
      type?: ReportType;
      status?: ReportStatus;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ data: Record<string, unknown>[]; pagination: Record<string, number> }> {
    let filtered: CachedReport[] = [];

    for (const report of this.reportCache.values()) {
      if (report.projectId !== projectId) continue;
      if (query.type && report.type !== query.type) continue;
      filtered.push(report);
    }

    // Descending by generation time
    filtered.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const data = filtered
      .slice(start, start + pageSize)
      .map((r) => ({ ...r }) as Record<string, unknown>);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 0,
      },
    };
  }

  // ==================== Save report config ====================

  async saveReportConfig(
    projectId: string,
    config: { name: string; description?: string; config: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    const saved: SavedReportConfig = {
      id: `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      name: config.name,
      description: config.description ?? '',
      config: config.config,
      createdAt: new Date().toISOString(),
    };

    const configs = this.savedConfigs.get(projectId) ?? [];
    configs.push(saved);
    this.savedConfigs.set(projectId, configs);

    return { ...saved } as Record<string, unknown>;
  }

  async getReportConfigs(projectId: string): Promise<Record<string, unknown>[]> {
    const configs = this.savedConfigs.get(projectId) ?? [];
    return configs.map((c) => ({ ...c }) as Record<string, unknown>);
  }

  // ==================== Delete report config ====================

  async deleteReportConfig(projectId: string, configId: string): Promise<void> {
    const configs = this.savedConfigs.get(projectId);
    if (!configs) {
      throw new NotFoundException(`Report config ${configId} not found in project ${projectId}`);
    }
    const index = configs.findIndex((c) => c.id === configId);
    if (index === -1) {
      throw new NotFoundException(`Report config ${configId} not found in project ${projectId}`);
    }
    configs.splice(index, 1);
    this.savedConfigs.set(projectId, configs);
  }

  // ==================== Report-template CRUD ====================

  async createTemplate(
    projectId: string,
    config: {
      name: string;
      type: ReportType;
      config?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const now = new Date().toISOString();
    const template: StoredReportTemplate = {
      id: this.generateTemplateId(),
      projectId,
      name: config.name,
      type: config.type,
      config: (config.config as ReportConfig) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.templates.set(template.id, template);
    this.logger.log(`Created report template ${template.id} for project ${projectId}`);
    return { ...template } as Record<string, unknown>;
  }

  async updateTemplate(
    projectId: string,
    templateId: string,
    config: {
      name?: string;
      type?: ReportType;
      config?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const template = this.templates.get(templateId);
    if (!template || template.projectId !== projectId) {
      throw new NotFoundException(
        `Report template ${templateId} not found in project ${projectId}`,
      );
    }
    if (config.name !== undefined) template.name = config.name;
    if (config.type !== undefined) template.type = config.type;
    if (config.config !== undefined) template.config = config.config as ReportConfig;
    template.updatedAt = new Date().toISOString();
    this.templates.set(templateId, template);
    this.logger.log(`Updated report template ${templateId}`);
    return { ...template } as Record<string, unknown>;
  }

  async deleteTemplate(projectId: string, templateId: string): Promise<void> {
    const template = this.templates.get(templateId);
    if (!template || template.projectId !== projectId) {
      throw new NotFoundException(
        `Report template ${templateId} not found in project ${projectId}`,
      );
    }
    this.templates.delete(templateId);
    // Also clear the templateId of scheduled tasks referencing this template
    for (const schedule of this.schedules.values()) {
      if (schedule.templateId === templateId) {
        schedule.templateId = null;
        schedule.updatedAt = new Date().toISOString();
      }
    }
    this.logger.log(`Deleted report template ${templateId}`);
  }

  async getTemplates(
    projectId: string,
    query?: { type?: ReportType },
  ): Promise<Record<string, unknown>[]> {
    const result: StoredReportTemplate[] = [];
    for (const template of this.templates.values()) {
      if (template.projectId !== projectId) continue;
      if (query?.type && template.type !== query.type) continue;
      result.push(template);
    }
    // Descending by creation time
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return result.map((t) => ({ ...t }) as Record<string, unknown>);
  }

  async getTemplate(projectId: string, templateId: string): Promise<Record<string, unknown>> {
    const template = this.templates.get(templateId);
    if (!template || template.projectId !== projectId) {
      throw new NotFoundException(
        `Report template ${templateId} not found in project ${projectId}`,
      );
    }
    return { ...template } as Record<string, unknown>;
  }

  // ==================== Scheduled export ====================

  async scheduleReportExport(
    projectId: string,
    config: {
      templateId?: string;
      cronExpression: string;
      exportFormat: ExportFormat;
      enabled?: boolean;
    },
  ): Promise<Record<string, unknown>> {
    // Validate the cron-expression format
    if (!this.isValidCronExpression(config.cronExpression)) {
      throw new Error(`Invalid cron expression: ${config.cronExpression}`);
    }
    // If a template is specified, validate it exists and belongs to the project
    if (config.templateId) {
      const template = this.templates.get(config.templateId);
      if (!template || template.projectId !== projectId) {
        throw new NotFoundException(
          `Report template ${config.templateId} not found in project ${projectId}`,
        );
      }
    }
    const now = new Date().toISOString();
    const schedule: StoredReportSchedule = {
      id: this.generateScheduleId(),
      projectId,
      templateId: config.templateId ?? null,
      cronExpression: config.cronExpression,
      exportFormat: config.exportFormat,
      enabled: config.enabled ?? true,
      lastRunAt: null,
      lastExportPath: null,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(schedule.id, schedule);
    this.logger.log(
      `Scheduled report export ${schedule.id} (cron=${config.cronExpression}, format=${config.exportFormat})`,
    );
    return { ...schedule } as Record<string, unknown>;
  }

  async unscheduleReportExport(scheduleId: string): Promise<void> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      throw new NotFoundException(`Report schedule ${scheduleId} not found`);
    }
    this.schedules.delete(scheduleId);
    this.logger.log(`Unscheduled report export ${scheduleId}`);
  }

  async getScheduledExports(projectId: string): Promise<Record<string, unknown>[]> {
    const result: StoredReportSchedule[] = [];
    for (const schedule of this.schedules.values()) {
      if (schedule.projectId !== projectId) continue;
      result.push(schedule);
    }
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return result.map((s) => ({ ...s }) as Record<string, unknown>);
  }

  /** Query scheduled-export execution history */
  getExportHistory(projectId: string, limit = 100): ExportHistoryEntry[] {
    return this.exportHistory
      .filter((h) => h.projectId === projectId)
      .slice(-limit)
      .reverse();
  }

  // ==================== Private helpers: data queries ====================

  /** Build the real device and alarm summaries */
  private async buildRealSummary(
    projectId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ReportSummary> {
    let totalDevices = 0;
    let onlineDevices = 0;
    let offlineDevices = 0;
    let totalAlarms = 0;

    // Device statistics
    if (this.deviceService) {
      try {
        const devices = await this.deviceService.findAll(projectId, {
          page: 1,
          pageSize: 100000,
        });
        totalDevices = devices.pagination.total;
        for (const device of devices.data) {
          if (device.status === DeviceStatus.ONLINE || device.status === DeviceStatus.CONNECTING) {
            onlineDevices++;
          } else {
            offlineDevices++;
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to query devices for summary: ${(error as Error).message}`);
      }
    }

    // Alarm statistics
    if (this.alarmService) {
      try {
        const records = await this.alarmService.getRecords(projectId, 100000);
        totalAlarms = records.filter((r) => {
          const t = r.createdAt.getTime();
          return t >= startTime.getTime() && t <= endTime.getTime();
        }).length;
      } catch (error) {
        this.logger.warn(`Failed to query alarms for summary: ${(error as Error).message}`);
      }
    }

    // Average data quality (based on the latest values' quality field)
    let avgDataQuality = 0;
    if (this.dataQueryService && this.deviceService) {
      try {
        const tags = await this.getTagsForProject(projectId);
        if (tags.length > 0) {
          const tagIds = tags.slice(0, 200).map((t) => t.id);
          const latestMap = await this.dataQueryService.batchQueryLatest(tagIds);
          const qualities: number[] = [];
          for (const [, value] of latestMap) {
            if (value !== null && value !== undefined) {
              qualities.push(100);
            }
          }
          avgDataQuality =
            qualities.length > 0
              ? qualities.reduce((a, b) => a + b, 0) / qualities.length / 100
              : 0;
        }
      } catch (error) {
        this.logger.warn(`Failed to query data quality: ${(error as Error).message}`);
      }
    }

    return {
      totalDevices,
      onlineDevices,
      offlineDevices,
      totalAlarms,
      avgDataQuality: Math.round(avgDataQuality * 100) / 100,
    };
  }

  /** Build daily-report metric items */
  private async buildDailyItems(
    projectId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ReportItem[]> {
    const items: ReportItem[] = [];

    // Device online rate
    if (this.deviceService) {
      try {
        const devices = await this.deviceService.findAll(projectId, {
          page: 1,
          pageSize: 100000,
        });
        const total = devices.pagination.total;
        const online = devices.data.filter(
          (d) => d.status === DeviceStatus.ONLINE || d.status === DeviceStatus.CONNECTING,
        ).length;
        items.push({
          label: '设备在线率',
          value: total > 0 ? Math.round((online / total) * 1000) / 10 : 0,
          unit: '%',
          trend: 'stable',
        });
        items.push({
          label: '设备总数',
          value: total,
          trend: 'stable',
        });
      } catch (error) {
        this.logger.warn(`Failed to build daily device items: ${(error as Error).message}`);
      }
    }

    // Alarm count
    if (this.alarmService) {
      try {
        const records = await this.alarmService.getRecords(projectId, 100000);
        const dayAlarms = records.filter((r) => {
          const t = r.createdAt.getTime();
          return t >= startTime.getTime() && t <= endTime.getTime();
        }).length;
        items.push({
          label: '当日告警次数',
          value: dayAlarms,
          trend: 'stable',
        });
      } catch (error) {
        this.logger.warn(`Failed to build daily alarm items: ${(error as Error).message}`);
      }
    }

    // Data-collection point count
    if (this.dataQueryService) {
      try {
        const tags = await this.getTagsForProject(projectId);
        if (tags.length > 0) {
          const sampleTagIds = tags.slice(0, 10).map((t) => t.id);
          let totalPoints = 0;
          for (const tagId of sampleTagIds) {
            const stats = await this.dataQueryService.getTagStats(tagId, startTime, endTime);
            totalPoints += stats.count;
          }
          // Estimate the total
          const estimatedTotal =
            tags.length > 0 ? Math.round((totalPoints / sampleTagIds.length) * tags.length) : 0;
          items.push({
            label: '数据采集点数（估算）',
            value: estimatedTotal,
            trend: 'stable',
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to build daily data items: ${(error as Error).message}`);
      }
    }

    // Return basic info when there is no data
    if (items.length === 0) {
      items.push({
        label: '报表生成状态',
        value: '无可用数据源',
        trend: 'stable',
      });
    }

    return items;
  }

  /** Build monthly-report metric items */
  private async buildMonthlyItems(
    projectId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ReportItem[]> {
    const items: ReportItem[] = [];

    // Monthly cumulative alarm count
    if (this.alarmService) {
      try {
        const records = await this.alarmService.getRecords(projectId, 100000);
        const monthAlarms = records.filter((r) => {
          const t = r.createdAt.getTime();
          return t >= startTime.getTime() && t <= endTime.getTime();
        }).length;
        items.push({
          label: '月累计告警数',
          value: monthAlarms,
          trend: 'stable',
        });
      } catch (error) {
        this.logger.warn(`Failed to build monthly alarm items: ${(error as Error).message}`);
      }
    }

    // Monthly average device online rate
    if (this.deviceService) {
      try {
        const devices = await this.deviceService.findAll(projectId, {
          page: 1,
          pageSize: 100000,
        });
        const total = devices.pagination.total;
        const online = devices.data.filter(
          (d) => d.status === DeviceStatus.ONLINE || d.status === DeviceStatus.CONNECTING,
        ).length;
        items.push({
          label: '月平均在线率',
          value: total > 0 ? Math.round((online / total) * 1000) / 10 : 0,
          unit: '%',
          trend: 'stable',
        });
      } catch (error) {
        this.logger.warn(`Failed to build monthly device items: ${(error as Error).message}`);
      }
    }

    if (items.length === 0) {
      items.push({
        label: '报表生成状态',
        value: '无可用数据源',
        trend: 'stable',
      });
    }

    return items;
  }

  /** Build time-series charts (for daily/monthly reports) */
  private async buildTimeSeriesCharts(
    projectId: string,
    startTime: Date,
    endTime: Date,
    granularity: Granularity,
  ): Promise<ReportChart[]> {
    const charts: ReportChart[] = [];

    if (!this.dataQueryService) {
      return charts;
    }

    try {
      const tags = await this.getTagsForProject(projectId);
      if (tags.length === 0) {
        return charts;
      }

      // Take the first 3 tags with numeric values for the trend chart
      const sampleTags = tags.slice(0, 3);
      const windowMs = this.granularityToWindowMs(granularity);
      const labels: string[] = [];
      const datasets: { label: string; data: number[]; color?: string }[] = [];

      for (let i = 0; i < sampleTags.length; i++) {
        const tag = sampleTags[i];
        try {
          const windowed = await this.dataQueryService.aggregateWindow(
            tag.id,
            startTime,
            endTime,
            windowMs,
            AggregationType.AVG,
          );
          if (i === 0) {
            for (const point of windowed) {
              labels.push(this.formatTimeLabel(point.interval, granularity));
            }
          }
          datasets.push({
            label: tag.name || tag.id,
            data: windowed.map((w) => Math.round(w.value * 100) / 100),
            color: this.CHART_COLORS[i % this.CHART_COLORS.length],
          });
        } catch (error) {
          this.logger.warn(`Failed to query trend for tag ${tag.id}: ${(error as Error).message}`);
        }
      }

      if (datasets.length > 0) {
        charts.push({
          type: 'line',
          title: `${granularity === 'hour' ? '小时' : '日'}数据趋势`,
          labels: labels.length > 0 ? labels : [startTime.toISOString(), endTime.toISOString()],
          datasets,
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to build time series charts: ${(error as Error).message}`);
    }

    return charts;
  }

  /** Build the monthly alarm-distribution chart */
  private async buildMonthlyAlarmCharts(
    projectId: string,
    startTime: Date,
    endTime: Date,
    year: number,
    monthNum: number,
  ): Promise<ReportChart[]> {
    const charts: ReportChart[] = [];

    if (!this.alarmService) {
      return charts;
    }

    try {
      const records = await this.alarmService.getRecords(projectId, 100000);
      const monthRecords = records.filter((r) => {
        const t = r.createdAt.getTime();
        return t >= startTime.getTime() && t <= endTime.getTime();
      });

      const daysInMonth = new Date(year, monthNum, 0).getDate();
      const dailyCounts = new Array(daysInMonth).fill(0);

      for (const record of monthRecords) {
        const day = record.createdAt.getDate();
        if (day >= 1 && day <= daysInMonth) {
          dailyCounts[day - 1]++;
        }
      }

      charts.push({
        type: 'bar',
        title: '月度告警分布',
        labels: Array.from({ length: daysInMonth }, (_, i) => `${i + 1}日`),
        datasets: [{ label: '告警数', data: dailyCounts }],
      });
    } catch (error) {
      this.logger.warn(`Failed to build monthly alarm charts: ${(error as Error).message}`);
    }

    return charts;
  }

  /** Build custom-report metric items */
  private async buildCustomItems(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    metrics: string[],
  ): Promise<ReportItem[]> {
    const items: ReportItem[] = [];

    if (!this.dataQueryService || tagIds.length === 0) {
      return items;
    }

    try {
      for (const tagId of tagIds.slice(0, 50)) {
        const stats = await this.dataQueryService.getTagStats(tagId, startTime, endTime);
        for (const metric of metrics) {
          let value: number | string = 0;
          let unit: string | undefined;
          switch (metric) {
            case 'avg':
              value = Math.round(stats.avg * 100) / 100;
              break;
            case 'max':
              value = Math.round(stats.max * 100) / 100;
              break;
            case 'min':
              value = Math.round(stats.min * 100) / 100;
              break;
            case 'sum':
              value = Math.round(stats.sum * 100) / 100;
              break;
            case 'count':
              value = stats.count;
              break;
            default:
              value = 0;
          }
          items.push({
            label: `${tagId} - ${metric}`,
            value,
            unit,
            trend: 'stable',
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to build custom items: ${(error as Error).message}`);
    }

    return items;
  }

  /** Build custom-report charts */
  private async buildCustomCharts(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    granularity: Granularity,
  ): Promise<ReportChart[]> {
    return this.buildTrendCharts(tagIds, startTime, endTime, granularity);
  }

  /** Build trend charts */
  private async buildTrendCharts(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
    granularity: Granularity,
  ): Promise<ReportChart[]> {
    const charts: ReportChart[] = [];

    if (!this.dataQueryService || tagIds.length === 0) {
      return charts;
    }

    const windowMs = this.granularityToWindowMs(granularity);
    const labels: string[] = [];
    const datasets: { label: string; data: number[]; color?: string }[] = [];

    for (let i = 0; i < tagIds.length; i++) {
      const tagId = tagIds[i];
      try {
        const windowed = await this.dataQueryService.aggregateWindow(
          tagId,
          startTime,
          endTime,
          windowMs,
          AggregationType.AVG,
        );
        if (i === 0) {
          for (const point of windowed) {
            labels.push(this.formatTimeLabel(point.interval, granularity));
          }
        }
        datasets.push({
          label: tagId,
          data: windowed.map((w) => Math.round(w.value * 100) / 100),
          color: this.CHART_COLORS[i % this.CHART_COLORS.length],
        });
      } catch (error) {
        this.logger.warn(`Failed to query trend for tag ${tagId}: ${(error as Error).message}`);
      }
    }

    if (datasets.length > 0) {
      charts.push({
        type: 'line',
        title: '多标签趋势对比',
        labels: labels.length > 0 ? labels : [startTime.toISOString(), endTime.toISOString()],
        datasets,
      });
    }

    return charts;
  }

  /** Build the trend summary */
  private async buildTrendSummary(
    tagIds: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<TrendSummaryData> {
    let anomalyCount = 0;
    let trendDirection: 'up' | 'down' | 'stable' = 'stable';

    if (!this.dataQueryService || tagIds.length === 0) {
      return { anomalyCount, anomalyRate: 0, trendDirection };
    }

    try {
      const duration = endTime.getTime() - startTime.getTime();
      const midTime = new Date(startTime.getTime() + duration / 2);

      let firstHalfAvg = 0;
      let secondHalfAvg = 0;
      let totalPoints = 0;
      let anomalyPoints = 0;

      for (const tagId of tagIds) {
        const firstStats = await this.dataQueryService.getTagStats(tagId, startTime, midTime);
        const secondStats = await this.dataQueryService.getTagStats(tagId, midTime, endTime);

        firstHalfAvg += firstStats.avg;
        secondHalfAvg += secondStats.avg;
        totalPoints += firstStats.count + secondStats.count;

        // Anomaly detection: values outside the min/max range count as anomalies (simple heuristic)
        const allStats = await this.dataQueryService.getTagStats(tagId, startTime, endTime);
        if (allStats.max > firstStats.avg * 2 || allStats.min < firstStats.avg * 0.5) {
          anomalyPoints++;
        }
      }

      if (tagIds.length > 0) {
        firstHalfAvg /= tagIds.length;
        secondHalfAvg /= tagIds.length;
      }

      // Trend direction
      const changePercent =
        firstHalfAvg !== 0 ? ((secondHalfAvg - firstHalfAvg) / Math.abs(firstHalfAvg)) * 100 : 0;
      if (changePercent > 5) {
        trendDirection = 'up';
      } else if (changePercent < -5) {
        trendDirection = 'down';
      }

      anomalyCount = anomalyPoints;
      const anomalyRate = totalPoints > 0 ? anomalyPoints / totalPoints : 0;

      return {
        anomalyCount,
        anomalyRate: Math.round(anomalyRate * 100) / 100,
        trendDirection,
      };
    } catch (error) {
      this.logger.warn(`Failed to build trend summary: ${(error as Error).message}`);
      return { anomalyCount, anomalyRate: 0, trendDirection };
    }
  }

  // ==================== Private helpers: alarm data processing ====================

  /** Get alarm records */
  private async fetchAlarmRecords(projectId: string): Promise<AlarmRecord[]> {
    if (!this.alarmService) {
      return [];
    }
    try {
      return await this.alarmService.getRecords(projectId, 100000);
    } catch (error) {
      this.logger.warn(`Failed to fetch alarm records: ${(error as Error).message}`);
      return [];
    }
  }

  /** Filter alarm records */
  private filterAlarmRecords(
    records: AlarmRecord[],
    startTime: Date,
    endTime: Date,
    levels?: string[],
    tagIds?: Set<string>,
  ): AlarmRecord[] {
    const startMs = startTime.getTime();
    const endMs = endTime.getTime();
    const levelsSet = levels ? new Set(levels) : undefined;

    return records.filter((r) => {
      // Time-range filter
      const t = r.createdAt.getTime();
      if (t < startMs || t > endMs) return false;

      // Level filter
      if (levelsSet && !levelsSet.has(r.level)) return false;

      // Device filter (associated via tagId)
      if (tagIds && tagIds.size > 0) {
        const ruleTagId = r.rule?.tagId;
        if (!ruleTagId || !tagIds.has(ruleTagId)) return false;
      }

      return true;
    });
  }

  /** Build the alarm summary data */
  private buildAlarmSummaryData(records: AlarmRecord[]): AlarmSummaryData {
    const byLevel: Record<string, number> = {};
    const byDevice: Record<string, number> = {};
    let acknowledged = 0;
    let totalResponseTime = 0;
    let responseCount = 0;

    for (const record of records) {
      // Statistics by level
      byLevel[record.level] = (byLevel[record.level] || 0) + 1;

      // Statistics by device (using tagId as a proxy for the device identity)
      const deviceId = record.rule?.tagId ?? 'unknown';
      byDevice[deviceId] = (byDevice[deviceId] || 0) + 1;

      // Acknowledgement-rate statistics
      if (
        record.status === AlarmStatus.ACKNOWLEDGED ||
        record.status === AlarmStatus.CLEARED ||
        record.acknowledgedAt
      ) {
        acknowledged++;
      }

      // Response-time statistics
      if (record.acknowledgedAt) {
        const responseTime = record.acknowledgedAt.getTime() - record.createdAt.getTime();
        totalResponseTime += responseTime;
        responseCount++;
      }
    }

    return {
      totalAlarms: records.length,
      byLevel,
      byDevice,
      responseTimeAvg: responseCount > 0 ? Math.round(totalResponseTime / responseCount / 1000) : 0,
      ackRate: records.length > 0 ? Math.round((acknowledged / records.length) * 100) / 100 : 0,
    };
  }

  /** Build alarm-report metric items */
  private buildAlarmItems(records: AlarmRecord[]): ReportItem[] {
    const items: ReportItem[] = [];
    const levelCounts: Record<string, number> = {};

    for (const record of records) {
      levelCounts[record.level] = (levelCounts[record.level] || 0) + 1;
    }

    const levelOrder = [AlarmLevel.CRITICAL, AlarmLevel.ERROR, AlarmLevel.WARNING, AlarmLevel.INFO];

    for (const level of levelOrder) {
      if (levelCounts[level] !== undefined) {
        items.push({
          label: `${level} 级别告警数`,
          value: levelCounts[level],
          trend: 'stable',
        });
      }
    }

    // Unknown level
    for (const [level, count] of Object.entries(levelCounts)) {
      if (!levelOrder.includes(level as AlarmLevel)) {
        items.push({
          label: `${level} 级别告警数`,
          value: count,
          trend: 'stable',
        });
      }
    }

    if (items.length === 0) {
      items.push({
        label: '告警总数',
        value: 0,
        trend: 'stable',
      });
    }

    return items;
  }

  /** Build alarm charts */
  private buildAlarmCharts(records: AlarmRecord[], startTime: Date, endTime: Date): ReportChart[] {
    const charts: ReportChart[] = [];

    // Pie chart: alarm-level distribution
    const levelCounts: Record<string, number> = {};
    for (const record of records) {
      levelCounts[record.level] = (levelCounts[record.level] || 0) + 1;
    }

    const levelLabels = Object.keys(levelCounts);
    const levelData = levelLabels.map((l) => levelCounts[l]);

    if (levelLabels.length > 0) {
      charts.push({
        type: 'pie',
        title: '告警级别分布',
        labels: levelLabels,
        datasets: [{ label: '告警数', data: levelData }],
      });
    }

    // Line chart: alarm time trend (by day)
    const duration = endTime.getTime() - startTime.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const dayCount = Math.max(1, Math.ceil(duration / dayMs));
    const dailyCounts: number[] = new Array(dayCount).fill(0);
    const dailyLabels: string[] = [];

    for (let i = 0; i < dayCount; i++) {
      const day = new Date(startTime.getTime() + i * dayMs);
      dailyLabels.push(day.toISOString().substring(0, 10));
    }

    for (const record of records) {
      const dayIndex = Math.floor((record.createdAt.getTime() - startTime.getTime()) / dayMs);
      if (dayIndex >= 0 && dayIndex < dayCount) {
        dailyCounts[dayIndex]++;
      }
    }

    charts.push({
      type: 'line',
      title: '告警时间趋势',
      labels: dailyLabels,
      datasets: [{ label: '告警数', data: dailyCounts }],
    });

    return charts;
  }

  // ==================== Private helpers: tag and device resolution ====================

  /** Resolve the tagIds to query */
  private async resolveTagIds(
    projectId: string,
    tagIds?: string[],
    deviceIds?: string[],
  ): Promise<string[]> {
    // Prefer directly provided tagIds
    if (tagIds && tagIds.length > 0) {
      return tagIds;
    }

    // If deviceIds are provided, query those devices' tags
    if (deviceIds && deviceIds.length > 0 && this.deviceService) {
      try {
        const result = await this.deviceService.searchTags(
          projectId,
          undefined,
          undefined,
          1,
          100000,
        );
        const deviceIdSet = new Set(deviceIds);
        return result.data.filter((tag) => deviceIdSet.has(tag.deviceId)).map((tag) => tag.id);
      } catch (error) {
        this.logger.warn(`Failed to resolve tagIds by deviceIds: ${(error as Error).message}`);
        return [];
      }
    }

    // If neither is provided, query all tags in the project
    if (this.deviceService) {
      try {
        const result = await this.deviceService.searchTags(
          projectId,
          undefined,
          undefined,
          1,
          100000,
        );
        return result.data.map((tag) => tag.id);
      } catch (error) {
        this.logger.warn(`Failed to resolve all tagIds: ${(error as Error).message}`);
        return [];
      }
    }

    return [];
  }

  /** Get all tags under a project */
  private async getTagsForProject(projectId: string): Promise<DataTag[]> {
    if (!this.deviceService) {
      return [];
    }
    try {
      const result: PaginatedResult<DataTag> = await this.deviceService.searchTags(
        projectId,
        undefined,
        undefined,
        1,
        100000,
      );
      return result.data;
    } catch (error) {
      this.logger.warn(`Failed to get tags for project: ${(error as Error).message}`);
      return [];
    }
  }

  // ==================== Private helpers: utility functions ====================

  /** Cache a report */
  private cacheReport(report: CachedReport): void {
    this.reportCache.set(report.id, report);

    // Limit the cache size
    if (this.reportCache.size > this.CACHE_MAX_SIZE) {
      const oldestKey = this.reportCache.keys().next().value;
      if (oldestKey) {
        this.reportCache.delete(oldestKey);
      }
    }
  }

  /** Generate a report ID */
  private generateReportId(): string {
    return `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Generate a report-template ID */
  private generateTemplateId(): string {
    return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Generate a scheduled-export task ID */
  private generateScheduleId(): string {
    return `sch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Generate a history-record ID */
  private generateHistoryId(): string {
    return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ==================== Scheduler ====================

  /** Start the scheduler */
  startScheduler(): void {
    if (this.schedulerTimer) {
      return;
    }
    this.schedulerTimer = setInterval(() => {
      this.tickSchedules(new Date()).catch((err) => {
        this.logger.error(`Scheduler tick failed: ${(err as Error).message}`);
      });
    }, this.SCHEDULER_INTERVAL_MS);
    this.logger.log('Report export scheduler started');
  }

  /** Stop the scheduler */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      this.logger.log('Report export scheduler stopped');
    }
  }

  /**
   * Check all enabled scheduled tasks and run the export for tasks matching the current time.
   * Public method so tests can trigger it manually.
   */
  async tickSchedules(now: Date): Promise<void> {
    for (const schedule of this.schedules.values()) {
      if (!schedule.enabled) continue;
      if (!this.matchCron(schedule.cronExpression, now)) continue;
      // Avoid duplicate runs within the same minute
      if (
        schedule.lastRunAt &&
        now.getTime() - schedule.lastRunAt.getTime() < this.SCHEDULER_INTERVAL_MS
      ) {
        continue;
      }
      await this.executeScheduledExport(schedule);
    }
  }

  /** Run a single scheduled export */
  private async executeScheduledExport(schedule: StoredReportSchedule): Promise<void> {
    this.logger.log(`Executing scheduled export ${schedule.id}`);
    const template = schedule.templateId ? this.templates.get(schedule.templateId) : undefined;
    let reportId: string | null = null;
    let exportPath: string | null = null;
    try {
      const report = await this.generateReportFromTemplate(schedule.projectId, template);
      reportId = (report as { id?: string }).id ?? null;
      if (!reportId) {
        throw new Error('Generated report has no id');
      }
      const exportResult = await this.exportReport(reportId, schedule.exportFormat);
      exportPath = (exportResult as { filePath?: string }).filePath ?? null;
      schedule.lastRunAt = new Date();
      schedule.lastExportPath = exportPath;
      schedule.updatedAt = new Date().toISOString();
      this.schedules.set(schedule.id, schedule);
      this.recordExportHistory(schedule, reportId, exportPath, 'success', null);
      this.logger.log(`Scheduled export ${schedule.id} completed: ${exportPath}`);
    } catch (error) {
      const errorMessage = (error as Error).message;
      schedule.lastRunAt = new Date();
      schedule.updatedAt = new Date().toISOString();
      this.schedules.set(schedule.id, schedule);
      this.recordExportHistory(schedule, reportId, exportPath, 'failed', errorMessage);
      this.logger.error(`Scheduled export ${schedule.id} failed: ${errorMessage}`);
    }
  }

  /** Generate a report from a template, returning the generated report object */
  private async generateReportFromTemplate(
    projectId: string,
    template?: StoredReportTemplate,
  ): Promise<Record<string, unknown>> {
    const today = new Date();
    const todayStr = today.toISOString().substring(0, 10);
    const currentMonth = today.toISOString().substring(0, 7);

    if (!template) {
      // Generate the current day's daily report by default when there is no template
      return this.generateDailyReport(projectId, todayStr);
    }

    const config = template.config ?? ({} as ReportConfig);
    const startDate = config.timeRange?.start ?? todayStr;
    const endDate = config.timeRange?.end ?? todayStr;

    switch (template.type) {
      case ReportType.DAILY:
        return this.generateDailyReport(projectId, startDate);
      case ReportType.MONTHLY:
        return this.generateMonthlyReport(projectId, startDate.substring(0, 7) || currentMonth);
      case ReportType.CUSTOM:
        return this.generateCustomReport(projectId, {
          startDate,
          endDate,
          metrics: config.metrics,
          tagIds: config.tagIds,
          deviceIds: config.deviceIds,
          granularity: config.granularity,
        });
      case ReportType.ALARM:
        return this.generateAlarmReport(projectId, {
          startDate,
          endDate,
          levels: config.alarmLevels,
          deviceIds: config.deviceIds,
        });
      case ReportType.TREND:
        return this.generateTrendReport(projectId, {
          startDate,
          endDate,
          tagIds: config.tagIds ?? [],
          granularity: config.granularity,
        });
      default:
        return this.generateDailyReport(projectId, todayStr);
    }
  }

  /** Record export history */
  private recordExportHistory(
    schedule: StoredReportSchedule,
    reportId: string | null,
    exportPath: string | null,
    status: 'success' | 'failed',
    errorMessage: string | null,
  ): void {
    this.exportHistory.push({
      id: this.generateHistoryId(),
      projectId: schedule.projectId,
      scheduleId: schedule.id,
      templateId: schedule.templateId,
      reportId,
      exportPath,
      status,
      errorMessage,
      executedAt: new Date().toISOString(),
    });
    // Limit the history-record count
    if (this.exportHistory.length > 1000) {
      this.exportHistory.splice(0, this.exportHistory.length - 1000);
    }
  }

  // ==================== Cron-expression parsing ====================

  /** Validate whether a cron expression is legal (5 fields) */
  private isValidCronExpression(cronExpr: string): boolean {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    return parts.every((part) => this.isValidCronField(part));
  }

  /** Validate a single cron field */
  private isValidCronField(field: string): boolean {
    if (field === '*' || field === '?') return true;
    // Handle comma separation
    if (field.includes(',')) {
      return field.split(',').every((f) => this.isValidCronField(f));
    }
    // Handle steps a-b/n or */n
    if (field.includes('/')) {
      const [range, stepStr] = field.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return false;
      return this.isValidCronField(range);
    }
    // Handle ranges a-b
    if (field.includes('-')) {
      const [start, end] = field.split('-');
      const s = parseInt(start, 10);
      const e = parseInt(end, 10);
      return !isNaN(s) && !isNaN(e) && s <= e;
    }
    // Single number
    const num = parseInt(field, 10);
    return !isNaN(num);
  }

  /** Decide whether a given date matches a cron expression */
  private matchCron(cronExpr: string, date: Date): boolean {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return false;
    const [minField, hourField, domField, monthField, dowField] = parts;
    return (
      this.matchCronField(minField, date.getMinutes(), 0, 59) &&
      this.matchCronField(hourField, date.getHours(), 0, 23) &&
      this.matchCronField(domField, date.getDate(), 1, 31) &&
      this.matchCronField(monthField, date.getMonth() + 1, 1, 12) &&
      this.matchCronField(dowField, date.getDay(), 0, 7)
    );
  }

  /** Match a single cron field */
  private matchCronField(field: string, value: number, min: number, max: number): boolean {
    if (field === '*' || field === '?') return true;
    // Handle comma separation
    if (field.includes(',')) {
      return field.split(',').some((f) => this.matchCronField(f, value, min, max));
    }
    // Handle steps a-b/n or */n
    if (field.includes('/')) {
      const [range, stepStr] = field.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return false;
      let start: number;
      let end: number;
      if (range === '*' || range === '?') {
        start = min;
        end = max;
      } else if (range.includes('-')) {
        const [s, e] = range.split('-').map((n) => parseInt(n, 10));
        start = s;
        end = e;
      } else {
        start = parseInt(range, 10);
        end = max;
      }
      if (isNaN(start) || isNaN(end)) return false;
      if (value < start || value > end) return false;
      return (value - start) % step === 0;
    }
    // Handle ranges a-b
    if (field.includes('-')) {
      const [start, end] = field.split('-').map((n) => parseInt(n, 10));
      if (isNaN(start) || isNaN(end)) return false;
      return value >= start && value <= end;
    }
    // Single number (in day-of-week both 0 and 7 mean Sunday)
    const num = parseInt(field, 10);
    if (isNaN(num)) return false;
    if (min === 0 && max === 7) {
      if (num === 7) return value === 0 || value === 7;
      if (num === 0) return value === 0 || value === 7;
    }
    return value === num;
  }

  /** Granularity to time window (ms) */
  private granularityToWindowMs(granularity: Granularity): number {
    switch (granularity) {
      case 'hour':
        return 60 * 60 * 1000;
      case 'day':
        return 24 * 60 * 60 * 1000;
      case 'month':
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return 24 * 60 * 60 * 1000;
    }
  }

  /** Format a time label */
  private formatTimeLabel(isoString: string, granularity: Granularity): string {
    const date = new Date(isoString);
    switch (granularity) {
      case 'hour':
        return `${date.getHours()}:00`;
      case 'day':
        return `${date.getMonth() + 1}-${date.getDate()}`;
      case 'month':
        return `${date.getFullYear()}-${date.getMonth() + 1}`;
      default:
        return isoString;
    }
  }

  /** Ensure the export directory exists */
  private ensureExportsDir(): string {
    // Use DATA_DIR/exports, consistent with the dev/prod config
    // Previously used process.cwd()/data/exports; in dev mode cwd = apps/ss-node-server,
    // scattering export files into apps/ss-node-server/data/exports, inconsistent with prod mode
    const dataDir = process.env.DATA_DIR || './data';
    const exportsDir = path.resolve(this.resolvePath(dataDir), 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }
    return exportsDir;
  }

  /**
   * Resolve a relative path to an absolute path
   *
   * Relative-path base:
   * - dev mode: __dirname up 4 levels = ss-services/ss-node (this file lives in packages/ss-report/dist/)
   *   DATA_DIR in .env.dev is resolved relative to ss-services/ss-node
   * - production: process.cwd() = ss-run/ss/services/ss-node
   *   DATA_DIR=../../data in .env is resolved relative to that directory
   *
   * Kept consistent with app.module.ts getDatabaseConfig() and backup.service.ts getProjectRoot().
   */
  private resolvePath(p: string): string {
    return this.pathResolver.resolve(p);
  }

  /** Generate CSV content */
  private generateCSV(report: CachedReport): string {
    const lines: string[] = [];

    // Title info
    lines.push(`报表类型,${report.type}`);
    lines.push(`项目ID,${report.projectId}`);
    if (report.date) lines.push(`日期,${report.date}`);
    if (report.month) lines.push(`月份,${report.month}`);
    if (report.dateRange) lines.push(`时间范围,${report.dateRange}`);
    lines.push(`生成时间,${report.generatedAt}`);
    lines.push('');

    // Summary
    if (report.data.summary) {
      lines.push('=== 摘要 ===');
      const summary = report.data.summary;
      const summaryEntries: string[] = [];
      for (const [key, value] of Object.entries(summary)) {
        summaryEntries.push(`${key},${this.formatCSVValue(value)}`);
      }
      lines.push(...summaryEntries);
      lines.push('');
    }

    // Metric items
    if (report.data.items && report.data.items.length > 0) {
      lines.push('=== 指标项 ===');
      lines.push('标签,值,单位,趋势,变化百分比');
      for (const item of report.data.items) {
        lines.push(
          [
            this.formatCSVValue(item.label),
            this.formatCSVValue(item.value),
            this.formatCSVValue(item.unit ?? ''),
            this.formatCSVValue(item.trend ?? ''),
            this.formatCSVValue(item.changePercent ?? ''),
          ].join(','),
        );
      }
      lines.push('');
    }

    // Chart data
    if (report.data.charts && report.data.charts.length > 0) {
      lines.push('=== 图表数据 ===');
      for (const chart of report.data.charts) {
        lines.push(`图表: ${chart.title} (${chart.type})`);
        lines.push(['时间', ...chart.datasets.map((d) => d.label)].join(','));
        for (let i = 0; i < chart.labels.length; i++) {
          const row = [chart.labels[i]];
          for (const dataset of chart.datasets) {
            row.push(String(dataset.data[i] ?? ''));
          }
          lines.push(row.join(','));
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /** Format a CSV value */
  private formatCSVValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      const str = JSON.stringify(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /** Generate an Excel (.xlsx) file - using Office Open XML format */
  private generateExcel(report: CachedReport): Buffer {
    const sharedStrings: string[] = [];
    const stringMap = new Map<string, number>();

    const getSi = (value: string): number => {
      const existing = stringMap.get(value);
      if (existing !== undefined) return existing;
      const idx = sharedStrings.length;
      sharedStrings.push(value);
      stringMap.set(value, idx);
      return idx;
    };

    // Ensure empty strings have an index
    if (!stringMap.has('')) {
      getSi('');
    }

    const escapeXml = (str: string): string =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const rows: string[][] = [];

    // Title info
    rows.push(['报表类型', String(report.type)]);
    rows.push(['项目ID', report.projectId]);
    if (report.date) rows.push(['日期', report.date]);
    if (report.month) rows.push(['月份', report.month]);
    if (report.dateRange) rows.push(['时间范围', report.dateRange]);
    rows.push(['生成时间', report.generatedAt]);
    rows.push(['', '']);

    // Summary
    if (report.data.summary) {
      rows.push(['=== 摘要 ===', '']);
      for (const [key, value] of Object.entries(report.data.summary)) {
        rows.push([key, String(value)]);
      }
      rows.push(['', '']);
    }

    // Metric items
    if (report.data.items && report.data.items.length > 0) {
      rows.push(['=== 指标项 ===', '', '', '', '']);
      rows.push(['标签', '值', '单位', '趋势', '变化百分比']);
      for (const item of report.data.items) {
        rows.push([
          item.label,
          String(item.value),
          String(item.unit ?? ''),
          String(item.trend ?? ''),
          String(item.changePercent ?? ''),
        ]);
      }
      rows.push(['', '', '', '', '']);
    }

    // Chart data
    if (report.data.charts && report.data.charts.length > 0) {
      for (const chart of report.data.charts) {
        rows.push([`图表: ${chart.title} (${chart.type})`, '']);
        const headerRow = [
          chart.labels.length > 0 ? '时间' : '',
          ...chart.datasets.map((d) => d.label),
        ];
        rows.push(headerRow);
        const maxLen = Math.max(chart.labels.length, ...chart.datasets.map((d) => d.data.length));
        for (let i = 0; i < maxLen; i++) {
          const row: string[] = [chart.labels[i] ?? ''];
          for (const dataset of chart.datasets) {
            row.push(String(dataset.data[i] ?? ''));
          }
          rows.push(row);
        }
        rows.push(['', '']);
      }
    }

    // Build the sheet XML
    let sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    sheetXml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    sheetXml += '<sheetData>';

    const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let r = 0; r < rows.length; r++) {
      sheetXml += `<row r="${r + 1}">`;
      for (let c = 0; c < rows[r].length; c++) {
        const colLetter = colLetters[c] || String.fromCharCode(64 + c);
        const cellRef = `${colLetter}${r + 1}`;
        const value = rows[r][c];
        const si = getSi(value);
        sheetXml += `<c r="${cellRef}" t="s"><v>${si}</v></c>`;
      }
      sheetXml += '</row>';
    }

    sheetXml += '</sheetData></worksheet>';

    // Build the shared-strings XML
    let sstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    sstXml += `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`;
    for (const str of sharedStrings) {
      sstXml += `<si><t xml:space="preserve">${escapeXml(str)}</t></si>`;
    }
    sstXml += '</sst>';

    // Build the XML files
    const contentTypesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    const relsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    const workbookXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>';

    const wbRelsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const stylesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '</styleSheet>';

    // Assemble the ZIP file
    const files: { name: string; data: Buffer }[] = [
      { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf-8') },
      { name: '_rels/.rels', data: Buffer.from(relsXml, 'utf-8') },
      { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf-8') },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRelsXml, 'utf-8') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf-8') },
      { name: 'xl/sharedStrings.xml', data: Buffer.from(sstXml, 'utf-8') },
      { name: 'xl/styles.xml', data: Buffer.from(stylesXml, 'utf-8') },
    ];

    return this.createZipBuffer(files);
  }

  /** Generate an HTML report file */
  private generateHTMLReport(report: CachedReport): string {
    const typeLabels: Record<string, string> = {
      daily: '日报',
      monthly: '月报',
      custom: '自定义报表',
      alarm: '告警报表',
      trend: '趋势报表',
    };

    const typeLabel = typeLabels[report.type] || report.type;
    const title = report.date
      ? `${typeLabel} — ${report.date}`
      : report.month
        ? `${typeLabel} — ${report.month}`
        : report.dateRange
          ? `${typeLabel} — ${report.dateRange}`
          : typeLabel;

    let summaryRows = '';
    if (report.data.summary) {
      for (const [key, value] of Object.entries(report.data.summary)) {
        summaryRows += `<tr><td>${this.escapeHtml(key)}</td><td>${this.escapeHtml(String(value))}</td></tr>`;
      }
    }

    let itemsRows = '';
    if (report.data.items && report.data.items.length > 0) {
      const headerCells = ['标签', '值', '单位', '趋势', '变化百分比']
        .map((h) => `<th>${h}</th>`)
        .join('');
      itemsRows += `<tr>${headerCells}</tr>`;
      for (const item of report.data.items) {
        itemsRows += `<tr>
          <td>${this.escapeHtml(item.label)}</td>
          <td>${this.escapeHtml(String(item.value))}</td>
          <td>${this.escapeHtml(String(item.unit ?? ''))}</td>
          <td>${this.escapeHtml(String(item.trend ?? ''))}</td>
          <td>${this.escapeHtml(String(item.changePercent ?? ''))}</td>
        </tr>`;
      }
    }

    let chartsHtml = '';
    if (report.data.charts && report.data.charts.length > 0) {
      for (const chart of report.data.charts) {
        chartsHtml += `<h3>${this.escapeHtml(chart.title)} (${chart.type})</h3>`;
        chartsHtml += '<table><thead><tr>';
        chartsHtml += '<th>时间</th>';
        for (const ds of chart.datasets) {
          chartsHtml += `<th>${this.escapeHtml(ds.label)}</th>`;
        }
        chartsHtml += '</tr></thead><tbody>';
        const maxLen = Math.max(chart.labels.length, ...chart.datasets.map((d) => d.data.length));
        for (let i = 0; i < maxLen; i++) {
          chartsHtml += '<tr>';
          chartsHtml += `<td>${this.escapeHtml(String(chart.labels[i] ?? ''))}</td>`;
          for (const ds of chart.datasets) {
            chartsHtml += `<td>${this.escapeHtml(String(ds.data[i] ?? ''))}</td>`;
          }
          chartsHtml += '</tr>';
        }
        chartsHtml += '</tbody></table>';
      }
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Microsoft YaHei', Arial, sans-serif; color: #333; padding: 40px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 24px; border-bottom: 2px solid #4CAF50; padding-bottom: 12px; margin-bottom: 24px; }
    h2 { font-size: 18px; color: #4CAF50; margin: 24px 0 12px; }
    h3 { font-size: 16px; margin: 16px 0 8px; }
    .meta { color: #888; font-size: 14px; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; font-weight: bold; }
    tr:nth-child(even) { background: #fafafa; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  <div class="meta">
    <p>项目ID: ${this.escapeHtml(report.projectId)} | 报表类型: ${typeLabel} | 生成时间: ${report.generatedAt}</p>
  </div>

  <h2>摘要</h2>
  <table><thead><tr><th>指标</th><th>值</th></tr></thead><tbody>${summaryRows}</tbody></table>

  <h2>指标详情</h2>
  <table><thead>${itemsRows}</thead></table>

  <h2>图表数据</h2>
  ${chartsHtml}

  <div class="footer">
    <p>© Smart SCADA 报表系统 — 自动生成于 ${report.generatedAt}</p>
    <p>注：此文件为 HTML 格式报表。如需 PDF 格式，建议在生产环境中使用 puppeteer 或 pdfkit 生成。</p>
  </div>
</body>
</html>`;
  }

  /** Escape HTML special characters */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Create a ZIP file Buffer (stored mode, no compression) */
  private createZipBuffer(files: { name: string; data: Buffer }[]): Buffer {
    const chunks: Buffer[] = [];
    const centralDirEntries: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
      const nameBuf = Buffer.from(file.name, 'utf-8');
      const data = file.data;
      const crc = this.crc32(data);

      // Local file header
      const localHeader = Buffer.alloc(30 + nameBuf.length);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0x0800, 6); // UTF-8
      localHeader.writeUInt16LE(0, 8); // stored
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(data.length, 18);
      localHeader.writeUInt32LE(data.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);
      nameBuf.copy(localHeader, 30);

      chunks.push(localHeader);
      chunks.push(data);

      // Central directory entry
      const cdEntry = Buffer.alloc(46 + nameBuf.length);
      cdEntry.writeUInt32LE(0x02014b50, 0);
      cdEntry.writeUInt16LE(20, 4);
      cdEntry.writeUInt16LE(20, 6);
      cdEntry.writeUInt16LE(0x0800, 8);
      cdEntry.writeUInt16LE(0, 10);
      cdEntry.writeUInt16LE(0, 12);
      cdEntry.writeUInt16LE(0, 14);
      cdEntry.writeUInt32LE(crc, 16);
      cdEntry.writeUInt32LE(data.length, 20);
      cdEntry.writeUInt32LE(data.length, 24);
      cdEntry.writeUInt16LE(nameBuf.length, 28);
      cdEntry.writeUInt16LE(0, 30);
      cdEntry.writeUInt16LE(0, 32);
      cdEntry.writeUInt16LE(0, 34);
      cdEntry.writeUInt16LE(0, 36);
      cdEntry.writeUInt32LE(0, 38);
      cdEntry.writeUInt32LE(offset, 42);
      nameBuf.copy(cdEntry, 46);

      centralDirEntries.push(cdEntry);
      offset += 30 + nameBuf.length + data.length;
    }

    const centralDir = Buffer.concat(centralDirEntries);
    const centralDirOffset = offset;

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);

    chunks.push(centralDir);
    chunks.push(eocd);

    return Buffer.concat(chunks);
  }

  /** CRC32 checksum computation */
  private crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 1) {
          crc = (crc >>> 1) ^ 0xedb88320;
        } else {
          crc = crc >>> 1;
        }
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
