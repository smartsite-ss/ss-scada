// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as winston from 'winston';
import { PathResolverService, getLogConfig, createPluginLogger, LogConfig } from '@ss-node/ss-core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessMetrics {
  /** Heap memory used (MB) */
  heapUsed: number;
  /** Total heap memory size (MB) */
  heapTotal: number;
  /** Process resident memory (MB) */
  rss: number;
  /** Process CPU time (microseconds) */
  cpuUser: number;
  cpuSystem: number;
  /** System CPU usage (%, estimated from the delta between two calls) */
  cpuUsage: number;
  /** Process uptime in seconds */
  uptime: number;
}

export interface MonitorData {
  protocol: string;
  /** Process performance metrics */
  metrics: ProcessMetrics;
  /** Process info */
  processName: string;
  processId: number;
  /** Thread ID (worker_thread mode only) */
  threadId?: number;
  isolationMode: string;
  /** Recent collection logs (up to MAX_LOG_LINES lines) */
  logs: string[];
  /** Log file path */
  logFilePath: string;
}

export interface ClearLogsResult {
  cleared: boolean;
  logFilePath: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/**
 * Plugin monitoring service
 *
 * - collect Node.js process memory/CPU metrics
 * - record collection logs in per-protocol directories, split by date
 * - log file format: {logsDir}/plugins/{protocol}/{protocol}-{YYYY-MM-DD}.log
 *
 * Log writes use the Winston DailyRotateFile transport (created by LoggerFactory):
 * - rotate by day + by size (LOG_MAX_SIZE)
 * - old files are auto gzip-compressed (zippedArchive)
 * - files beyond LOG_MAX_FILES are auto-deleted (oldest first)
 */
@Injectable()
export class PluginMonitorService {
  private readonly logger = new Logger(PluginMonitorService.name);

  /** Unified logging config (LOG_DIR / LOG_MAX_SIZE / LOG_MAX_FILES / LOG_LEVEL) */
  private readonly logConfig: LogConfig;

  /** Lazily-created per-protocol Winston logger cache */
  private readonly pluginLoggers = new Map<string, winston.Logger>();

  /** Maximum number of log lines returned in monitoring */
  private readonly MAX_LOG_LINES = 200;

  /** Last CPU snapshot, used to compute usage-rate changes */
  private lastCpuSnapshot: { timestamp: number; usage: NodeJS.CpuUsage } | null = null;

  constructor(private readonly pathResolver: PathResolverService) {
    this.logConfig = getLogConfig();
  }

  /**
   * Get the absolute path of the ss-services/ss-node project root (used as fallback)
   * Kept consistent with plugin-config.service.ts and plugin-discovery.service.ts.
   */
  private getProjectRoot(): string {
    return this.pathResolver.getProjectRoot();
  }

  // -----------------------------------------------------------------------
  //  Process metrics
  // -----------------------------------------------------------------------

  getProcessMetrics(): ProcessMetrics {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    // CPU usage: compute the proportion based on the time delta
    let cpuUsage = 0;
    const now = Date.now();
    if (this.lastCpuSnapshot) {
      const elapsedMs = now - this.lastCpuSnapshot.timestamp;
      if (elapsedMs > 0) {
        const cpuDiffUser = cpu.user - this.lastCpuSnapshot.usage.user;
        const cpuDiffSystem = cpu.system - this.lastCpuSnapshot.usage.system;
        const totalCpuUs = cpuDiffUser + cpuDiffSystem;
        // Convert to percentage (elapsedMs is milliseconds, cpu is microseconds)
        cpuUsage = (totalCpuUs / 1000 / elapsedMs / os.cpus().length) * 100;
      }
    }
    this.lastCpuSnapshot = { timestamp: now, usage: cpu };

    return {
      heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      cpuUser: cpu.user,
      cpuSystem: cpu.system,
      cpuUsage: Math.round(cpuUsage * 100) / 100,
      uptime: Math.round(process.uptime()),
    };
  }

  // -----------------------------------------------------------------------
  //  Collection logs (per-protocol directory, split by time)
  // -----------------------------------------------------------------------

  /** Get (or lazily create) the Winston logger for the specified protocol */
  private getPluginLogger(protocol: string): winston.Logger {
    let logger = this.pluginLoggers.get(protocol);
    if (!logger) {
      logger = createPluginLogger(this.logConfig, protocol);
      this.pluginLoggers.set(protocol, logger);
    }
    return logger;
  }

  /** Get the log directory path */
  getPluginLogDir(protocol: string): string {
    return path.join(this.logConfig.logDir, 'plugins', protocol);
  }

  /** Get today's log file path */
  getPluginLogFile(protocol: string): string {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dir = this.getPluginLogDir(protocol);
    return path.join(dir, `${protocol}-${yyyy}-${mm}-${dd}.log`);
  }

  /**
   * Write one collection log entry
   *
   * Switched to Winston DailyRotateFile: rotated by day + by size, old files gzip-compressed.
   * File path: {logDir}/plugins/{protocol}/{protocol}-{YYYY-MM-DD}.log
   */
  writeLog(protocol: string, level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string): void {
    try {
      const winstonLevel =
        level.toLowerCase() === 'debug'
          ? 'debug'
          : level.toLowerCase() === 'warn'
            ? 'warn'
            : level.toLowerCase() === 'error'
              ? 'error'
              : 'info';
      this.getPluginLogger(protocol).log(winstonLevel, message);
    } catch (err) {
      this.logger.error(`Failed to write log [${protocol}]: ${(err as Error).message}`);
    }
  }

  /**
   * Read the most recent N log lines
   */
  readLogs(protocol: string, tail?: number): string[] {
    const limit = tail || this.MAX_LOG_LINES;
    const filePath = this.getPluginLogFile(protocol);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim() !== '');
      return lines.slice(-limit);
    } catch (err) {
      this.logger.error(`Failed to read logs [${protocol}]: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Clear the current log file
   */
  clearLogs(protocol: string): ClearLogsResult {
    const filePath = this.getPluginLogFile(protocol);

    if (!fs.existsSync(filePath)) {
      return { cleared: true, logFilePath: filePath, message: '日志文件不存在或已清空' };
    }

    try {
      // Do not remove the file, only clear its content (keep the file handle)
      fs.writeFileSync(filePath, '', 'utf-8');
      this.logger.log(`Logs cleared for plugin: ${protocol}`);
      return { cleared: true, logFilePath: filePath, message: '日志已清空' };
    } catch (err) {
      return {
        cleared: false,
        logFilePath: filePath,
        message: `清空失败: ${(err as Error).message}`,
      };
    }
  }

  /** Get full monitoring data */
  getMonitorData(protocol: string, isolationMode: string = 'in_process'): MonitorData {
    return {
      protocol,
      metrics: this.getProcessMetrics(),
      processName: `node (main: ${protocol})`,
      processId: process.pid,
      isolationMode,
      logs: this.readLogs(protocol),
      logFilePath: this.getPluginLogFile(protocol),
    };
  }
}
