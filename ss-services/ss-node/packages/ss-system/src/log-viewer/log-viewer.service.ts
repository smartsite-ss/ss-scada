// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

export interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  raw: string;
}

export interface LogFilter {
  level?: string;
  module?: string;
  keyword?: string;
  lines?: number;
}

@Injectable()
export class LogViewerService {
  private readonly logger = new Logger(LogViewerService.name);
  private readonly logDir: string;
  private sseClients: Subject<LogEntry>[] = [];

  constructor(private readonly pathResolver: PathResolverService) {
    // Use path.resolve to match exactly the Winston write path in main.ts
    // LOG_DIR is usually configured via .env (${DATA_DIR}/logs); the fallback uses the project root
    this.logDir = process.env.LOG_DIR
      ? this.pathResolver.resolve(process.env.LOG_DIR)
      : path.join(this.pathResolver.getProjectRoot(), 'logs');
  }

  private getProjectRoot(): string {
    return this.pathResolver.getProjectRoot();
  }

  /** SSE real-time log push */
  subscribeToLogs(filter: LogFilter = {}): Observable<LogEntry> {
    const subject = new Subject<LogEntry>();
    this.sseClients.push(subject);

    // Send the 20 most recent log lines on connect
    this.getRecentLogs(filter, 20)
      .then((logs) => {
        for (const log of logs) {
          subject.next(log);
        }
      })
      .catch((err) => {
        this.logger.warn(`Failed to fetch recent logs for SSE client: ${err.message}`);
      });

    // Watch the main log file (combined.log) for changes to implement real-time push
    let watcher: fs.FSWatcher | null = null;
    const primaryLog = this.getPrimaryLogFile();
    if (primaryLog) {
      let lastSize = 0;
      try {
        lastSize = fs.statSync(primaryLog).size;
      } catch {
        /* File may not exist yet */
      }

      try {
        watcher = fs.watch(primaryLog, (eventType) => {
          if (eventType !== 'change') return;
          try {
            const newStat = fs.statSync(primaryLog);
            if (newStat.size > lastSize) {
              // Read the newly added bytes
              const stream = fs.createReadStream(primaryLog, {
                encoding: 'utf-8',
                start: lastSize,
                end: newStat.size,
              });
              const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
              rl.on('line', (line) => {
                const entry = this.parseLogLine(line);
                if (entry && this.matchesFilter(entry, filter)) {
                  subject.next(entry);
                }
              });
              lastSize = newStat.size;
            } else if (newStat.size < lastSize) {
              // File was truncated or rotated
              lastSize = 0;
            }
          } catch {
            /* Ignore read exceptions */
          }
        });
      } catch (err) {
        this.logger.warn(`Failed to watch log file: ${(err as Error).message}`);
      }
    }

    return subject.asObservable().pipe(
      finalize(() => {
        // Clean up the watcher and client list when the client disconnects
        if (watcher) watcher.close();
        this.sseClients = this.sseClients.filter((c) => c !== subject);
      }),
    );
  }

  /**
   * Get the main log file that SSE watches for real-time push.
   *
   * Priority:
   * 1. New directory layout: app/app-YYYY-MM-DD.log (Winston DailyRotateFile's log for the day, all levels)
   * 2. Legacy directory layout: combined.log (Winston File transport)
   * 3. Fall back to the most recent .log file
   */
  private getPrimaryLogFile(): string | null {
    // 1. New directory layout: app/app-YYYY-MM-DD.log
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const todayAppLog = path.join(this.logDir, 'app', `app-${yyyy}-${mm}-${dd}.log`);
    if (fs.existsSync(todayAppLog)) return todayAppLog;

    // 2. Legacy directory layout: combined.log
    const combinedPath = path.join(this.logDir, 'combined.log');
    if (fs.existsSync(combinedPath)) return combinedPath;

    // 3. Fall back to the most recent .log file
    const files = this.getLogFiles();
    if (files.length > 0) return path.join(this.logDir, files[files.length - 1]);
    return null;
  }

  /** Push a log entry */
  pushLog(entry: LogEntry): void {
    for (const client of this.sseClients) {
      try {
        client.next(entry);
      } catch {
        // client disconnected
      }
    }
    // Clean up disconnected clients
    this.sseClients = this.sseClients.filter((c) => !c.closed);
  }

  /** Query logs (reads the main log file first: app/app-YYYY-MM-DD.log or combined.log) */
  async getRecentLogs(filter: LogFilter = {}, lines: number = 100): Promise<LogEntry[]> {
    const results: LogEntry[] = [];

    // Prefer the main log file (Winston main log, contains all levels)
    const primaryLog = this.getPrimaryLogFile();
    if (primaryLog) {
      const fileLines = await this.readLastLines(primaryLog, lines * 2);
      for (const line of fileLines) {
        const entry = this.parseLogLine(line);
        if (entry && this.matchesFilter(entry, filter)) {
          results.push(entry);
        }
      }
    }

    // If the main log file has too little data, fall back to reading other log files (excluding the already-read main log)
    if (results.length < lines) {
      // Consistent with getLogFiles(): unified forward slashes for easy comparison
      const primaryRel = primaryLog
        ? path.relative(this.logDir, primaryLog).split(path.sep).join('/')
        : '';
      const logFiles = this.getLogFiles().filter(
        (f) => f !== 'combined.log' && f !== primaryRel,
      );
      for (const file of logFiles.slice(-3)) {
        const filePath = path.join(this.logDir, file);
        if (!fs.existsSync(filePath)) continue;

        const fileLines = await this.readLastLines(filePath, lines);
        for (const line of fileLines) {
          const entry = this.parseLogLine(line);
          if (entry && this.matchesFilter(entry, filter)) {
            results.push(entry);
          }
        }
      }
    }

    return results.slice(-lines);
  }

  /** List log files (recursively scans the app/ error/ plugins/ subdirectories, returns relative paths)
   *
   * The returned relative paths uniformly use forward slash `/` as separator (cross-platform consistent, URL safe),
   * making frontend display and download-URL assembly easier. Also skips winston-daily-rotate-file's
   * hidden audit files (starting with `.`, e.g. `.xxxxx-audit.json`).
   */
  getLogFiles(): string[] {
    try {
      if (!fs.existsSync(this.logDir)) return [];
      const results: string[] = [];
      const scan = (dir: string, base: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          // Skip hidden files (winston rotation's .xxxxx-audit.json etc.)
          if (entry.name.startsWith('.')) continue;
          const full = path.join(dir, entry.name);
          const rel = path.relative(base, full).split(path.sep).join('/');
          if (entry.isDirectory()) {
            scan(full, base);
          } else if (entry.name.endsWith('.log') || entry.name.endsWith('.log.gz')) {
            results.push(rel);
          }
        }
      };
      scan(this.logDir, this.logDir);
      return results.sort();
    } catch {
      return [];
    }
  }

  /** Get a log file's absolute path.
   *
   * Accepts relative paths with forward or backslashes (from getLogFiles' return value or frontend download requests),
   * resolves them to absolute paths, and enforces that the result stays inside logDir to prevent path-traversal attacks.
   */
  getLogFilePath(filename: string): string {
    if (!filename || typeof filename !== 'string') {
      throw new Error('Filename is required');
    }
    // Unify to forward slashes before normalize, avoiding Windows backslash interference
    const cleaned = filename.replace(/\\/g, '/');
    const normalizedLogDir = path.resolve(this.logDir);
    const filePath = path.resolve(normalizedLogDir, cleaned);

    // Path-traversal protection: the resolved path must still be inside logDir
    if (filePath !== normalizedLogDir && !filePath.startsWith(normalizedLogDir + path.sep)) {
      throw new Error(`Invalid log file path: ${filename}`);
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Log file not found: ${filename}`);
    }
    return filePath;
  }

  private async readLastLines(filePath: string, maxLines: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      try {
        const fileSize = fs.statSync(filePath).size;

        // Large-file optimization: read only the tail of the file, avoiding reading the entire GB-scale file and timing out
        // Estimate ~500 bytes per line, read maxLines * 2 * 500 bytes, at least 64KB, at most 4MB
        const tailBytes = Math.min(Math.max(maxLines * 1000, 65536), 4 * 1024 * 1024);
        const start = Math.max(0, fileSize - tailBytes);
        const isPartialRead = start > 0; // when reading from mid-file, the first line may be incomplete

        const rl = readline.createInterface({
          input: fs.createReadStream(filePath, { encoding: 'utf-8', start, end: fileSize }),
          crlfDelay: Infinity,
        });

        let isFirstLine = true;
        rl.on('line', (line) => {
          // When reading from mid-file, skip the first incomplete line
          if (isPartialRead && isFirstLine) {
            isFirstLine = false;
            return;
          }
          isFirstLine = false;
          lines.push(line);
          if (lines.length > maxLines) {
            lines.shift();
          }
        });

        rl.on('close', () => resolve(lines));
        rl.on('error', reject);
      } catch (error) {
        resolve([]);
      }
    });
  }

  private parseLogLine(line: string): LogEntry | null {
    if (!line || !line.trim()) return null;
    try {
      // Try JSON format first (Winston File transport output)
      const parsed = JSON.parse(line);
      // Winston's level may be "log" (NestJS Logger.log mapping); normalize to "info"
      const rawLevel = parsed.level || parsed.level || 'info';
      const level = rawLevel === 'log' ? 'info' : rawLevel;
      return {
        timestamp: parsed.timestamp || parsed.time || new Date().toISOString(),
        level,
        module: parsed.context || parsed.module || '',
        message: parsed.message || parsed.msg || '',
        raw: line,
      };
    } catch {
      // Try plain text format: [TIMESTAMP] [LEVEL] [MODULE] message
      // Match the Winston Console transport's printf format:
      // "2026/07/24 09:03:13     LOG [ChildProcessExecutor] message"
      const winstonMatch = line.match(
        /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\w+)\s+\[([^\]]+)\]\s*(.*)$/,
      );
      if (winstonMatch) {
        const level = winstonMatch[2].toLowerCase().replace('log', 'info');
        return {
          timestamp: winstonMatch[1].replace(/\//g, '-'),
          level,
          module: winstonMatch[3],
          message: winstonMatch[4],
          raw: line,
        };
      }
      // Match the ISO timestamp format: 2026-07-24T01:03:14.068Z [info] [Module] message
      const isoMatch = line.match(
        /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s\]]*)\s+\[?(\w+)\]?\s*\[?([^\]]+)\]?\s*(.*)$/,
      );
      if (isoMatch) {
        return {
          timestamp: isoMatch[1],
          level: isoMatch[2].toLowerCase(),
          module: isoMatch[3],
          message: isoMatch[4],
          raw: line,
        };
      }
      // Unparseable lines are returned as plain text
      return {
        timestamp: new Date().toISOString(),
        level: 'info',
        module: '',
        message: line,
        raw: line,
      };
    }
  }

  private matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
    if (filter.level && entry.level !== filter.level) return false;
    if (filter.module && !entry.module.includes(filter.module)) return false;
    if (
      filter.keyword &&
      !entry.message.includes(filter.keyword) &&
      !entry.raw.includes(filter.keyword)
    )
      return false;
    return true;
  }
}
