// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getLogConfig } from './logger-factory';
import {
  AuditEvent,
  AuditLogEntry,
  AuditChainVerificationResult,
  AuditLogQueryFilter,
  AuditLogQueryResult,
  AuditLogStats,
} from './audit-logger.types';

/**
 * S-M02: dedicated audit-log channel
 *
 * Security events stored separately, supporting hash-chain tamper protection and compliance review.
 *
 * Directory structure: {logDir}/audit/audit-%DATE%.log
 * Rotation policy: daily + 50m size, historical files gzip-compressed, retained 365 days (compliance requirement).
 *
 * Hash-chain tamper protection:
 *   Each record contains prevHash (the previous record's hash) and hash (the current record's hash).
 *   hash = SHA256(prevHash + canonical_json(timestamp+type+userId+ip+...+prevHash))
 *   The genesis record's prevHash = '0' * 64.
 *   Tampering with any record changes its hash, which in turn mismatches all subsequent records' prevHash.
 *
 * Restart recovery:
 *   After a service restart, the hash is read from the last line of the day's audit log file to resume the chain.
 *   If there is no log file for the day, the chain restarts from the genesis hash.
 */
@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger(AuditLoggerService.name);
  private readonly winstonLogger: winston.Logger;
  /** Hash chain: the previous record's hash */
  private prevHash: string;
  /** Genesis hash (chain starting point) */
  private static readonly GENESIS_HASH = '0'.repeat(64);

  constructor() {
    // 1. Restore prevHash from the day's log first (before creating the winston logger, ensuring the first record links up)
    this.prevHash = this.loadLastHashFromToday();

    // 2. Create the winston audit-log channel
    const config = getLogConfig();
    // Ensure the audit-log directory exists (DailyRotateFile does not auto-create nested directories)
    const auditDir = path.join(config.logDir, 'audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    this.winstonLogger = winston.createLogger({
      level: 'info',
      transports: [
        new DailyRotateFile({
          filename: path.join(config.logDir, 'audit', 'audit-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '50m',
          // Audit logs retained 1 year (compliance requirement), unlike the app/error logs' 14 days
          maxFiles: '365d',
          zippedArchive: true,
          // Do not use winston.format.timestamp() + format.json():
          // winston wraps the passed object inside the message field, losing top-level fields.
          // Instead, printf outputs the message directly (the result of JSON.stringify(entry)),
          // ensuring each file line is a complete audit-entry JSON.
          format: winston.format.printf((info: winston.Logform.TransformableInfo) => info.message as string),
        }),
      ],
    });

    this.logger.log(
      `审计日志通道已初始化 | prevHash=${this.prevHash.slice(0, 16)}... | logDir=${path.join(config.logDir, 'audit')}`,
    );
  }

  /**
   * Record a security-audit event
   *
   * Computes the hash chain synchronously and writes the log file. Callers need not await (fire-and-forget friendly).
   */
  logSecurityEvent(event: AuditEvent): void {
    try {
      // 0. Validate required fields, preventing incomplete entries from breaking the hash chain
      if (!event.type || !event.severity) {
        this.logger.warn(
          `审计事件缺少必填字段，已跳过 | type="${event.type}" severity="${event.severity}"`,
        );
        return;
      }

      // 1. Build the audit entry (without hash, used for hash computation)
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        type: event.type,
        severity: event.severity,
        userId: event.userId,
        username: event.username,
        ip: event.ip,
        userAgent: event.userAgent,
        details: event.details,
        prevHash: this.prevHash,
        hash: '', // placeholder, computed in the next step
      };

      // 2. Compute the current entry's hash = SHA256(prevHash + canonical_json(entry_without_hash))
      const hashInput = this.canonicalString(entry);
      entry.hash = crypto.createHash('sha256').update(hashInput, 'utf-8').digest('hex');

      // 3. Update prevHash in memory, preparing for the next record
      this.prevHash = entry.hash;

      // 4. Write the log file
      // Pass the JSON string as message, output directly via the printf format
      // Ensures each file line is a complete audit-entry JSON (not wrapped by winston)
      this.winstonLogger.info(JSON.stringify(entry));
    } catch (err) {
      // Audit-log write failures must not affect the business flow; only log the error
      this.logger.error(
        `审计日志写入失败 | type="${event.type}" error="${(err as Error).message}"`,
      );
    }
  }

  /**
   * Verify the hash-chain integrity of a given day's audit logs
   *
   * Used to detect tampering during security review.
   * If a record is modified, its hash changes, causing subsequent records' prevHash to mismatch.
   *
   * @param date date string (YYYY-MM-DD), defaults to today
   * @returns the verification result
   */
  verifyChain(date?: string): AuditChainVerificationResult {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const config = getLogConfig();
    const auditFile = path.join(config.logDir, 'audit', `audit-${targetDate}.log`);

    if (!fs.existsSync(auditFile)) {
      return {
        valid: true,
        totalEntries: 0,
        brokenAtIndex: null,
        date: targetDate,
      };
    }

    const content = fs.readFileSync(auditFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Chain starting point: for the day's first record, prevHash should be the genesis hash or the previous day's last hash
    // Simplified here: the first record's prevHash should match what the file records; we verify the chain relation
    let expectedPrevHash: string | null = null;
    let entryIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      entryIndex = i + 1;
      let entry: AuditLogEntry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        return {
          valid: false,
          totalEntries: lines.length,
          brokenAtIndex: entryIndex,
          brokenReason: 'JSON 解析失败（文件可能被损坏）',
          date: targetDate,
        };
      }

      // Defensive check: treat missing prevHash or hash fields as corrupted
      if (!entry.prevHash || !entry.hash) {
        return {
          valid: false,
          totalEntries: lines.length,
          brokenAtIndex: entryIndex,
          brokenReason: `记录缺少哈希链字段（prevHash=${entry.prevHash ? '存在' : '缺失'}, hash=${entry.hash ? '存在' : '缺失'}）`,
          date: targetDate,
        };
      }

      // First record: initialize expectedPrevHash
      if (expectedPrevHash === null) {
        expectedPrevHash = entry.prevHash;
      }

      // Verify that prevHash matches the previous record's hash
      if (entry.prevHash !== expectedPrevHash) {
        return {
          valid: false,
          totalEntries: lines.length,
          brokenAtIndex: entryIndex,
          brokenReason: `prevHash 不匹配：期望 ${(expectedPrevHash || '').slice(0, 16)}...，实际 ${entry.prevHash.slice(0, 16)}...`,
          date: targetDate,
        };
      }

      // Recompute the hash to verify
      const recomputedHash = crypto
        .createHash('sha256')
        .update(this.canonicalString({ ...entry, hash: '' }), 'utf-8')
        .digest('hex');

      if (recomputedHash !== entry.hash) {
        return {
          valid: false,
          totalEntries: lines.length,
          brokenAtIndex: entryIndex,
          brokenReason: `hash 不匹配：记录可能被篡改（期望 ${recomputedHash.slice(0, 16)}...，实际 ${entry.hash.slice(0, 16)}...）`,
          date: targetDate,
        };
      }

      // Update expectedPrevHash to the current entry's hash
      expectedPrevHash = entry.hash;
    }

    return {
      valid: true,
      totalEntries: lines.length,
      brokenAtIndex: null,
      date: targetDate,
    };
  }

  /**
   * Query audit-log entries with pagination
   *
   * Supports two query modes:
   *   1. Time-range mode (startTime/endTime): scans all audit files in the range, filtering by timestamp
   *   2. Single-day mode (date): reads the given day's (default today) audit log file
   *
   * Filters by condition then returns paginated (descending, newest first).
   *
   * @param filter query filter conditions
   * @returns the paginated result
   */
  findEntries(filter: AuditLogQueryFilter = {}): AuditLogQueryResult {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 20;

    const config = getLogConfig();
    const auditDir = path.join(config.logDir, 'audit');

    // Determine the list of dates to scan
    let dates: string[];
    let startDateStr: string;
    let endDateStr: string;

    if (filter.startTime || filter.endTime) {
      // Time-range mode: parse startTime/endTime and generate the date list
      const today = new Date().toISOString().split('T')[0];
      startDateStr = filter.startTime ? filter.startTime.split('T')[0] : today;
      endDateStr = filter.endTime ? filter.endTime.split('T')[0] : today;
      dates = this.enumerateDates(startDateStr, endDateStr);
    } else {
      // Single-day mode
      const targetDate = filter.date || new Date().toISOString().split('T')[0];
      startDateStr = endDateStr = targetDate;
      dates = [targetDate];
    }

    // Collect entries from all date files
    const filtered: AuditLogEntry[] = [];
    for (const dateStr of dates) {
      const auditFile = path.join(auditDir, `audit-${dateStr}.log`);
      if (!fs.existsSync(auditFile)) continue;

      const content = fs.readFileSync(auditFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        let entry: AuditLogEntry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue; // skip unparseable lines
        }

        // Defensive handling: old records may lack type/severity fields; normalize to 'unknown'
        if (!entry.type) (entry as any).type = 'unknown';
        if (!entry.severity) (entry as any).severity = 'unknown';
        if (!entry.timestamp) entry.timestamp = 'unknown';

        // Time-range filtering (needed only in time-range mode; single-day mode files are already that day)
        if (filter.startTime || filter.endTime) {
          if (entry.timestamp !== 'unknown') {
            const entryTime = new Date(entry.timestamp).getTime();
            if (filter.startTime && entryTime < new Date(filter.startTime).getTime()) continue;
            if (filter.endTime) {
              const endMs = new Date(filter.endTime).getTime();
              // endTime with T00:00:00 only reaches midnight of that day; extend to 23:59:59
              const endTimeStr = filter.endTime.split('T')[1];
              if (!endTimeStr || endTimeStr === '00:00:00') {
                if (entryTime > endMs + 86400000 - 1) continue;
              } else {
                if (entryTime > endMs) continue;
              }
            }
          }
        }

        if (filter.type && entry.type !== filter.type) continue;
        if (filter.severity && entry.severity !== filter.severity) continue;
        if (filter.userId && entry.userId !== filter.userId) continue;
        if (filter.username && entry.username !== filter.username) continue;

        filtered.push(entry);
      }
    }

    // Descending (newest first)
    filtered.reverse();

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const items = filtered.slice(startIndex, startIndex + pageSize);

    return { items, total, page, pageSize, date: `${startDateStr}~${endDateStr}` };
  }

  /**
   * Enumerate all dates between two dates (inclusive)
   */
  private enumerateDates(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [startDate];

    const current = new Date(start);
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates.length > 0 ? dates : [startDate];
  }

  /**
   * Get audit-log statistics
   *
   * Computes the day's audit-log total count, distribution by type/severity, and hash-chain integrity status.
   *
   * @param date date string (YYYY-MM-DD), defaults to today
   * @returns the statistics result
   */
  getStats(date?: string): AuditLogStats {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const config = getLogConfig();
    const auditFile = path.join(config.logDir, 'audit', `audit-${targetDate}.log`);

    const stats: AuditLogStats = {
      total: 0,
      byType: {},
      bySeverity: {},
      chainValid: true,
      date: targetDate,
    };

    if (!fs.existsSync(auditFile)) {
      return stats;
    }

    const content = fs.readFileSync(auditFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      let entry: AuditLogEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      stats.total++;
      // Defensive handling: old records may lack type/severity; normalize to 'unknown' to avoid "undefined" keys
      const entryType = entry.type || 'unknown';
      const entrySeverity = entry.severity || 'unknown';
      stats.byType[entryType] = (stats.byType[entryType] || 0) + 1;
      stats.bySeverity[entrySeverity] = (stats.bySeverity[entrySeverity] || 0) + 1;
    }

    // Verify hash-chain integrity
    const chainResult = this.verifyChain(targetDate);
    stats.chainValid = chainResult.valid;

    return stats;
  }

  /**
   * Restore prevHash from the last line of the day's audit log file
   *
   * The hash chain must resume after a service restart. Reads the hash field from the last line of the day's log file.
   * If there is no log file for the day, restarts from the genesis hash.
   */
  private loadLastHashFromToday(): string {
    try {
      const config = getLogConfig();
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(config.logDir, 'audit', `audit-${today}.log`);

      if (!fs.existsSync(auditFile)) {
        return AuditLoggerService.GENESIS_HASH;
      }

      const content = fs.readFileSync(auditFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) {
        return AuditLoggerService.GENESIS_HASH;
      }

      const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditLogEntry;
      if (lastEntry?.hash && /^[0-9a-f]{64}$/.test(lastEntry.hash)) {
        return lastEntry.hash;
      }

      return AuditLoggerService.GENESIS_HASH;
    } catch (err) {
      // On restore failure, use the genesis hash (breaks the day's chain, but better than being unable to write)
      console.warn(
        `[AuditLogger] 恢复 prevHash 失败，使用创世哈希: ${(err as Error).message}`,
      );
      return AuditLoggerService.GENESIS_HASH;
    }
  }

  /**
   * Generate a canonical JSON string (top-level keys sorted alphabetically), ensuring deterministic hash computation
   *
   * Excludes the hash field itself (hash is the computation result and must not participate in its own computation)
   *
   * Note: do not use JSON.stringify's replacer array (the second argument),
   * because a replacer array recursively filters keys of objects at all levels,
   * dropping sub-keys of nested objects like details, making different content produce the same hash.
   * Instead, manually build a sorted new object and then serialize.
   */
  private canonicalString(entry: AuditLogEntry): string {
    const fields: Record<string, any> = {
      timestamp: entry.timestamp,
      type: entry.type,
      severity: entry.severity,
      userId: entry.userId,
      username: entry.username,
      ip: entry.ip,
      userAgent: entry.userAgent,
      details: entry.details,
      prevHash: entry.prevHash,
    };
    // Manually build a new object with sorted keys (top level only), ensuring determinism
    // JSON.stringify automatically ignores undefined values
    const sortedKeys = Object.keys(fields).sort();
    const sorted: Record<string, any> = {};
    for (const key of sortedKeys) {
      if (fields[key] !== undefined) {
        sorted[key] = fields[key];
      }
    }
    return JSON.stringify(sorted);
  }

  /**
   * Close the audit-log channel, awaiting all pending log writes to flush
   *
   * Used for:
   * 1. Graceful resource cleanup on application shutdown (preventing log loss)
   * 2. In tests, waiting for winston's async writes to finish before reading the file for verification
   *
   * Implementation notes:
   *   winston's end() triggers the 'finish' event, but DailyRotateFile transport's
   *   underlying FileStreamRotator may flush late. To prevent 'finish' never firing in edge
   *   cases and awaiting forever, a 2s fallback timeout is added.
   */
  async close(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finishHandler = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        this.winstonLogger.removeListener('finish', finishHandler);
        // setImmediate ensures the underlying file stream completes its final flush
        setImmediate(resolve);
      };
      this.winstonLogger.on('finish', finishHandler);
      this.winstonLogger.end();
      // Fallback: force resolve after 2s (prevents hanging forever when 'finish' does not fire)
      const fallbackTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.winstonLogger.removeListener('finish', finishHandler);
        resolve();
      }, 2000);
    });
  }
}
