// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Homepage dashboard aggregation service (module 02)
 *
 * Single aggregation query: device five-state stats (reuses DeviceService) + today's alarm severity counts (SQL aggregation)
 * + active unacknowledged alarm count; results carry a 30s in-memory cache to avoid repeated aggregation queries from the
 * mini-program's high-frequency onShow.
 */
import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ProjectDatabaseService } from '@ss-node/ss-core';
import { DeviceService } from '@ss-node/ss-device';
import { AlarmRecord, AlarmLevel, AlarmStatus } from '@ss-node/ss-alarm';

/** Server-side aggregation cache TTL (ms) */
const DASHBOARD_CACHE_TTL_MS = 30_000;

/** Dashboard aggregation summary (consistent with DashboardSummary in the mini-program's dashboard.api.ts contract) */
export interface DashboardSummary {
  deviceTotal: number;
  deviceOnlineCount: number;
  deviceOfflineCount: number;
  deviceConnectingCount: number;
  deviceDegradedCount: number;
  deviceErrorCount: number;
  totalTagCount: number;
  /** Total alarms today (from local-timezone midnight) */
  todayAlarmTotalCount: number;
  /** Today's alarm counts by severity */
  todayAlarmCountByLevel: Record<AlarmLevel, number>;
  /** Current active unacknowledged alarm count (for the badge) */
  activeUnacknowledgedAlarmCount: number;
  /** Aggregation timestamp (ms, used to mark cache freshness) */
  generatedAt: number;
}

interface CacheEntry {
  summary: DashboardSummary;
  cachedAt: number;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly dbMode: string;

  constructor(
    private readonly deviceService: DeviceService,
    @Inject(getRepositoryToken(AlarmRecord))
    private readonly alarmRecordRepo: Repository<AlarmRecord>,
    @Optional()
    private readonly projectDbService?: ProjectDatabaseService,
    private readonly configService?: ConfigService,
  ) {
    this.dbMode = this.configService?.get<string>('PROJECT_DB_MODE', 'isolated') ?? 'isolated';
  }

  /**
   * Get the dashboard aggregation summary
   * @param forceRefresh when true, bypass the cache and re-aggregate (pull-to-refresh scenario)
   * @param roleId the role ID (passed through to device stats for authorization filtering)
   */
  async getSummary(
    projectId: string,
    forceRefresh: boolean = false,
    roleId?: string,
  ): Promise<DashboardSummary> {
    if (!forceRefresh) {
      const entry = this.cache.get(projectId);
      if (entry && Date.now() - entry.cachedAt < DASHBOARD_CACHE_TTL_MS) {
        return entry.summary;
      }
    }

    const summary = await this.aggregate(projectId, roleId);
    this.cache.set(projectId, { summary, cachedAt: Date.now() });
    return summary;
  }

  private async aggregate(projectId: string, roleId?: string): Promise<DashboardSummary> {
    const [deviceStats, alarmAggregation] = await Promise.all([
      this.deviceService.getDeviceStats(projectId, roleId),
      this.aggregateAlarms(projectId),
    ]);

    return {
      deviceTotal: deviceStats.total,
      deviceOnlineCount: deviceStats.online,
      deviceOfflineCount: deviceStats.offline,
      deviceConnectingCount: deviceStats.connecting,
      deviceDegradedCount: deviceStats.degraded,
      deviceErrorCount: deviceStats.error,
      totalTagCount: deviceStats.totalTags,
      todayAlarmTotalCount: alarmAggregation.todayTotal,
      todayAlarmCountByLevel: alarmAggregation.todayByLevel,
      activeUnacknowledgedAlarmCount: alarmAggregation.activeUnacknowledged,
      generatedAt: Date.now(),
    };
  }

  /**
   * Single aggregation query: today's severity counts + active unacknowledged count are computed on the database side,
   * avoiding pulling alarm records into memory (same aggregation pattern as AlarmStatisticsService)
   */
  private async aggregateAlarms(projectId: string): Promise<{
    todayTotal: number;
    todayByLevel: Record<AlarmLevel, number>;
    activeUnacknowledged: number;
  }> {
    const repo = await this.getRepo(projectId);
    const startOfToday = this.getStartOfToday();

    const raw = await repo
      .createQueryBuilder('r')
      .select(
        `SUM(CASE WHEN r.createdAt >= :startOfToday THEN 1 ELSE 0 END)`,
        'todayTotal',
      )
      .addSelect(
        `SUM(CASE WHEN r.createdAt >= :startOfToday AND r.level = :info THEN 1 ELSE 0 END)`,
        'todayInfo',
      )
      .addSelect(
        `SUM(CASE WHEN r.createdAt >= :startOfToday AND r.level = :warning THEN 1 ELSE 0 END)`,
        'todayWarning',
      )
      .addSelect(
        `SUM(CASE WHEN r.createdAt >= :startOfToday AND r.level = :error THEN 1 ELSE 0 END)`,
        'todayError',
      )
      .addSelect(
        `SUM(CASE WHEN r.createdAt >= :startOfToday AND r.level = :critical THEN 1 ELSE 0 END)`,
        'todayCritical',
      )
      .addSelect(
        `SUM(CASE WHEN r.status = :active THEN 1 ELSE 0 END)`,
        'activeUnacknowledged',
      )
      .where('r.projectId = :projectId', { projectId })
      .setParameters({
        startOfToday: startOfToday.toISOString(),
        info: AlarmLevel.INFO,
        warning: AlarmLevel.WARNING,
        error: AlarmLevel.ERROR,
        critical: AlarmLevel.CRITICAL,
        active: AlarmStatus.ACTIVE,
      })
      .getRawOne<Record<string, string | number>>();

    const num = (key: string) => Number(raw?.[key]) || 0;

    return {
      todayTotal: num('todayTotal'),
      todayByLevel: {
        [AlarmLevel.INFO]: num('todayInfo'),
        [AlarmLevel.WARNING]: num('todayWarning'),
        [AlarmLevel.ERROR]: num('todayError'),
        [AlarmLevel.CRITICAL]: num('todayCritical'),
      },
      activeUnacknowledged: num('activeUnacknowledged'),
    };
  }

  /** Local-timezone midnight today (consistent with the mini-program's "today" definition) */
  private getStartOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  /** Project-isolated-database mode: take the per-project independent database's AlarmRecord repository (same pattern as AlarmStatisticsService) */
  private async getRepo(projectId: string): Promise<Repository<AlarmRecord>> {
    if (this.dbMode === 'isolated' && this.projectDbService) {
      const ds = await this.projectDbService.getSystemDb(projectId);
      return ds.getRepository(AlarmRecord);
    }
    return this.alarmRecordRepo;
  }
}
