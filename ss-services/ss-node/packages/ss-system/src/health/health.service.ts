// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PathResolverService } from '@ss-node/ss-core';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export interface HealthProbeResult {
  status: 'pass' | 'warn' | 'error';
  message?: string;
  latencyMs: number;
  /** Optional extra details */
  details?: Record<string, any>;
}

/** Disk partition info */
export interface DiskPartitionInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
  totalFormatted: string;
  freeFormatted: string;
  usedFormatted: string;
  status: 'normal' | 'warning' | 'critical';
}

export interface DetailedHealth {
  status: 'ok' | 'degraded' | 'error';
  checks: Record<string, HealthProbeResult>;
  uptime: number;
  memory: { total: number; free: number; used: number; usagePercent: number };
  memoryThresholds: { warnPercent: number; criticalPercent: number };
  cpuLoad: number[];
  nodeVersion: string;
  platform: string;
  hostname: string;
  pid: number;
  /** Disk partition details: app directory, data directory, backup directory */
  disks: {
    appDir: DiskPartitionInfo;
    dataDir: DiskPartitionInfo;
    backupDir: DiskPartitionInfo;
  };
  diskThresholds: { warnPercent: number; criticalPercent: number };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {}

  /** Simple health check - LB liveness probe */
  getSimple(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /** Detailed health check */
  async getDetailed(): Promise<DetailedHealth> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const checks: Record<string, HealthProbeResult> = {};

    // DB probe
    const dbResult = await this.probeDatabase();
    checks.database = dbResult;

    // InfluxDB probe (stub)
    const influxResult = await this.probeInfluxDB();
    checks.influxdb = influxResult;

    // Memory probe
    const memStart = Date.now();
    const memWarnPercent = this.getMemoryWarnPercent();
    const memCriticalPercent = this.getMemoryCriticalPercent();
    const memUsagePercent = Math.round((usedMem / totalMem) * 10000) / 100;
    checks.memory = {
      status:
        memUsagePercent >= memCriticalPercent
          ? 'error'
          : memUsagePercent >= memWarnPercent
            ? 'warn'
            : 'pass',
      message: `Used: ${Math.round(usedMem / 1024 / 1024)}MB / ${Math.round(totalMem / 1024 / 1024)}MB (${memUsagePercent}%)`,
      latencyMs: Date.now() - memStart,
    };

    // Disk probe
    const diskResult = await this.probeDisk();
    checks.disk = diskResult;

    let overallStatus: 'ok' | 'degraded' | 'error' = 'ok';
    const checkValues = Object.values(checks);
    if (checkValues.some((c) => c.status === 'error')) overallStatus = 'error';
    else if (checkValues.some((c) => c.status === 'warn')) overallStatus = 'degraded';

    // Disk details
    const disks = await this.getDiskPartitions();
    // If disk usage exceeds the threshold, degrade the overall status
    for (const disk of Object.values(disks)) {
      if (disk.status === 'critical') overallStatus = 'error';
      else if (disk.status === 'warning' && overallStatus === 'ok') overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      checks,
      uptime: process.uptime(),
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usagePercent: memUsagePercent,
      },
      memoryThresholds: { warnPercent: memWarnPercent, criticalPercent: memCriticalPercent },
      cpuLoad: os.loadavg(),
      nodeVersion: process.version,
      platform: process.platform,
      hostname: os.hostname(),
      pid: process.pid,
      disks,
      diskThresholds: {
        warnPercent: this.getDiskWarnPercent(),
        criticalPercent: this.getDiskCriticalPercent(),
      },
    };
  }

  /** K8s liveness probe */
  getLiveness(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** K8s readiness probe */
  async getReadiness(): Promise<{
    status: string;
    checks: string[];
    details?: Record<string, any>;
  }> {
    const dbOk = await this.probeDatabase();
    const memOk = os.freemem() > 50 * 1024 * 1024;

    const checks: string[] = [];
    const details: Record<string, any> = {};

    if (dbOk.status !== 'error') checks.push('database');
    else details.database = dbOk.message;

    if (memOk) checks.push('memory');
    else details.memory = 'Low memory';

    return {
      status: checks.length >= 2 ? 'ok' : 'error',
      checks,
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  }

  /** Get disk partition details (app directory, data directory, backup directory) */
  async getDiskPartitions(): Promise<{
    appDir: DiskPartitionInfo;
    dataDir: DiskPartitionInfo;
    backupDir: DiskPartitionInfo;
  }> {
    // appDir uses the project root, consistent with the dataDir/backupDir baselines
    const appDir = this.getProjectRoot();
    const dataDir = this.resolveDataDir();
    const backupDir = this.resolveBackupDir();

    return {
      appDir: await this.getDiskInfo(appDir),
      dataDir: await this.getDiskInfo(dataDir),
      backupDir: await this.getDiskInfo(backupDir),
    };
  }

  /** Get disk usage info for a given path */
  private async getDiskInfo(dirPath: string): Promise<DiskPartitionInfo> {
    const warnPercent = this.getDiskWarnPercent();
    const criticalPercent = this.getDiskCriticalPercent();

    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      const stats = fs.statfsSync(dirPath);
      const totalBytes = stats.bsize * stats.blocks;
      const freeBytes = stats.bsize * stats.bavail;
      const usedBytes = totalBytes - freeBytes;
      const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;

      const status: 'normal' | 'warning' | 'critical' =
        usagePercent >= criticalPercent
          ? 'critical'
          : usagePercent >= warnPercent
            ? 'warning'
            : 'normal';

      return {
        path: dirPath,
        totalBytes,
        freeBytes,
        usedBytes,
        usagePercent,
        totalFormatted: this.formatBytes(totalBytes),
        freeFormatted: this.formatBytes(freeBytes),
        usedFormatted: this.formatBytes(usedBytes),
        status,
      };
    } catch (error) {
      this.logger.warn(`Failed to get disk info for ${dirPath}: ${(error as Error).message}`);
      return {
        path: dirPath,
        totalBytes: 0,
        freeBytes: 0,
        usedBytes: 0,
        usagePercent: 0,
        totalFormatted: 'N/A',
        freeFormatted: 'N/A',
        usedFormatted: 'N/A',
        status: 'normal',
      };
    }
  }

  // ==================== Threshold reading ====================

  private getMemoryWarnPercent(): number {
    return parseInt(process.env.MEMORY_WARN_PERCENT || '70', 10);
  }

  private getMemoryCriticalPercent(): number {
    return parseInt(process.env.MEMORY_CRITICAL_PERCENT || '85', 10);
  }

  private getDiskWarnPercent(): number {
    return parseInt(process.env.DISK_WARN_PERCENT || '70', 10);
  }

  private getDiskCriticalPercent(): number {
    return parseInt(process.env.DISK_CRITICAL_PERCENT || '85', 10);
  }

  // ==================== Path resolution ====================

  /**
   * Get the absolute path of the ss-services/ss-node project root
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node (this file lives in packages/ss-system/dist/health/)
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *
   * Kept consistent with app.module.ts getDatabaseConfig() and backup.service.ts getProjectRoot().
   */
  private getProjectRoot(): string {
    return this.pathResolver.getProjectRoot();
  }

  private resolvePath(p: string): string {
    return this.pathResolver.resolve(p);
  }

  private resolveDataDir(): string {
    const dataDir = this.configService.get<string>('DATA_DIR') || process.env.DATA_DIR || './data';
    return this.resolvePath(dataDir);
  }

  private resolveBackupDir(): string {
    if (process.env.BACKUP_DIR) {
      return this.resolvePath(process.env.BACKUP_DIR);
    }
    return path.join(this.getProjectRoot(), 'backups');
  }

  // ==================== Probes ====================

  /** Database probe */
  private async probeDatabase(): Promise<HealthProbeResult> {
    const start = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'pass', message: 'Connected', latencyMs: Date.now() - start };
    } catch (error) {
      return { status: 'error', message: (error as Error).message, latencyMs: Date.now() - start };
    }
  }

  /** InfluxDB probe — real connection check */
  private async probeInfluxDB(): Promise<HealthProbeResult> {
    const start = Date.now();

    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';
    const org = process.env.INFLUXDB_ORG || 'ss-org';
    const bucket = process.env.INFLUXDB_BUCKET || 'ss_node_data';

    // TOKEN not configured → warn (InfluxDB not enabled, but not a fault)
    if (!token) {
      return {
        status: 'warn',
        message: 'InfluxDB not configured (INFLUXDB_TOKEN is empty)',
        latencyMs: Date.now() - start,
        details: { url, org, bucket, perProjectBuckets: true },
      };
    }

    try {
      // Use the InfluxDB /health endpoint to check connectivity (built into InfluxDB 2.x, no auth required)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${url}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;

      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        const info: Record<string, any> = { url, org, bucket, perProjectBuckets: true, latencyMs };

        // Try querying the bucket count
        try {
          const bucketsResp = await fetch(`${url}/api/v2/buckets?org=${encodeURIComponent(org)}`, {
            headers: { Authorization: `Token ${token}` },
            signal: AbortSignal.timeout(3000),
          });
          if (bucketsResp.ok) {
            const bucketsData = await bucketsResp.json();
            info.bucketCount = bucketsData.buckets?.length ?? 0;
          }
        } catch {
          // A bucket-list query failure does not affect the main probe result
        }

        return {
          status: 'pass',
          message: `InfluxDB ${body.version || 'OK'} (v${body.commit?.slice(0, 7) || '?'})`,
          latencyMs,
          details: info,
        };
      }

      return {
        status: 'error',
        message: `InfluxDB /health returned ${response.status}`,
        latencyMs,
        details: { url, org, bucket },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        message: errorMsg.includes('abort') ? 'InfluxDB health check timed out' : errorMsg,
        latencyMs: Date.now() - start,
        details: { url, org, bucket, error: errorMsg },
      };
    }
  }

  /** Disk probe */
  private async probeDisk(): Promise<HealthProbeResult> {
    const start = Date.now();
    try {
      // Use the project root as the disk probe path, consistent with getDiskPartitions()
      const diskPath = this.getProjectRoot();
      if (fs.existsSync(diskPath)) {
        const info = await this.getDiskInfo(diskPath);
        return {
          status:
            info.status === 'critical' ? 'error' : info.status === 'warning' ? 'warn' : 'pass',
          message: `Used: ${info.usedFormatted} / ${info.totalFormatted} (${info.usagePercent}%)`,
          latencyMs: Date.now() - start,
        };
      }
      return { status: 'warn', message: 'Disk path not accessible', latencyMs: Date.now() - start };
    } catch (error) {
      return { status: 'error', message: (error as Error).message, latencyMs: Date.now() - start };
    }
  }

  // ==================== Utilities ====================

  private formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }
}
