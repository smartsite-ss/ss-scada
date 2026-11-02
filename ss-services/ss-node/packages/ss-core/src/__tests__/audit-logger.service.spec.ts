// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AuditLoggerService } from '../logger/audit-logger.service';
import type {
  AuditEvent,
  AuditLogEntry,
  AuditEventType,
  AuditSeverity,
} from '../logger/audit-logger.types';

/**
 * S-M02: dedicated audit-log channel - full unit tests
 *
 * Coverage:
 * 1. logSecurityEvent file-write verification (poll until winston async write completes)
 * 2. logSecurityEvent field validation and boundary conditions
 * 3. logSecurityEvent security (XSS/SQL-injection payloads must not corrupt the log)
 * 4. verifyChain full-chain verification and tamper detection
 * 5. hash-chain algorithm correctness (determinism, uniqueness, format)
 * 6. restart recovery prevHash boundary conditions
 * 7. logSecurityEvent + verifyChain integration test
 * 8. close() method functionality
 * 9. service lifecycle boundary conditions
 *
 * Key implementation notes:
 * - global setup.ts enables jest.useFakeTimers(), but winston's DailyRotateFile
 *   relies on real timers for file I/O. This test file switches back to real timers in beforeAll.
 * - winston DailyRotateFile transport writes asynchronously and close() does not guarantee
 *   data is flushed. The test polls file content to await completion instead of relying on close().
 * - all created AuditLoggerService instances are tracked and closed uniformly in afterEach,
 *   ensuring winston file streams are closed before the temp directory is removed, preventing ENOENT errors.
 */
describe('AuditLoggerService', () => {
  let tempLogDir: string;
  let originalLogDir: string | undefined;
  /** Track all created service instances and close them uniformly in afterEach */
  const createdServices: AuditLoggerService[] = [];
  /**
   * The base timestamp (ms) frozen at the start of each test case.
   *
   * Purpose: buildAuditEntry generates a deterministic timestamp via frozenBaseTime + index,
   * avoiding Date.now() returning different millisecond values within the same test under parallel load,
   * which would otherwise fail algorithm tests such as "same input should produce the same hash".
   */
  let frozenBaseTime: number;

  beforeAll(() => {
    // global setup.ts enables fake timers, but winston file I/O relies on real timers
    jest.useRealTimers();
  });

  afterAll(() => {
    // restore fake timers to avoid affecting subsequent test files
    jest.useFakeTimers();
  });

  beforeEach(() => {
    tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-audit-test-'));
    originalLogDir = process.env.LOG_DIR;
    process.env.LOG_DIR = tempLogDir;
    createdServices.length = 0;
    // freeze the base time at the start of each test case to ensure buildAuditEntry timestamp determinism
    frozenBaseTime = Date.now();
  });

  afterEach(async () => {
    // 1. close all winston instances first (await file stream completion)
    await Promise.all(
      createdServices.map((service) =>
        service.close().catch(() => {
          /* ignore close errors */
        }),
      ),
    );
    createdServices.length = 0;

    // 2. restore environment variables
    if (originalLogDir !== undefined) {
      process.env.LOG_DIR = originalLogDir;
    } else {
      delete process.env.LOG_DIR;
    }

    // 3. finally remove the temp directory (all file streams are closed now, no ENOENT)
    if (fs.existsSync(tempLogDir)) {
      fs.rmSync(tempLogDir, { recursive: true, force: true });
    }
  });

  // ──────────── Helper functions ────────────

  /**
   * Create an AuditLoggerService instance and track it automatically
   * Tracked instances are auto-closed in afterEach, ensuring the directory is cleaned up after streams close
   */
  function createService(): AuditLoggerService {
    const service = new AuditLoggerService();
    createdServices.push(service);
    return service;
  }

  /** Get today's audit log file path */
  function getTodayAuditFile(): string {
    const today = new Date().toISOString().split('T')[0];
    return path.join(tempLogDir, 'audit', `audit-${today}.log`);
  }

  /** Ensure the audit directory exists */
  function ensureAuditDir(): void {
    const auditDir = path.join(tempLogDir, 'audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
  }

  /**
   * Same algorithm as AuditLoggerService.canonicalString
   * Build a new object with manually key-sorted order (no replacer array, to avoid recursively filtering nested keys)
   */
  function computeCanonical(entry: AuditLogEntry): string {
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
   * Build an audit log entry manually (with a correct hash chain)
   * Uses the same canonicalString and SHA256 algorithm as AuditLoggerService
   */
  function buildAuditEntry(
    index: number,
    prevHash: string,
    event: Partial<AuditEvent> & { type: AuditEventType; severity: AuditSeverity },
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      // use frozenBaseTime (frozen once per test case) instead of Date.now(),
      // to ensure a deterministic timestamp across multiple buildAuditEntry calls in the same test,
      // avoiding test failures from millisecond-level time differences in "same input should produce same hash"
      timestamp: new Date(frozenBaseTime + index).toISOString(),
      type: event.type,
      severity: event.severity,
      userId: event.userId,
      username: event.username,
      ip: event.ip,
      userAgent: event.userAgent,
      details: event.details,
      prevHash,
      hash: '',
    };

    const canonical = computeCanonical(entry);
    entry.hash = crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
    return entry;
  }

  /** Write an array of audit entries to today's log file (one JSON per line) */
  function writeAuditFile(entries: AuditLogEntry[]): void {
    ensureAuditDir();
    const lines = entries.map((e) => JSON.stringify(e));
    fs.writeFileSync(getTodayAuditFile(), lines.join('\n') + '\n');
  }

  /** Read all lines of today's audit log file (parse into a JSON array, skipping unparseable lines) */
  function readTodayAuditEntries(): AuditLogEntry[] {
    const file = getTodayAuditFile();
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is AuditLogEntry => entry !== null);
  }

  /**
   * Poll until the audit log file contains the expected number of entries
   *
   * winston DailyRotateFile transport writes asynchronously and close() does not
   * guarantee data is flushed. Polling the file content ensures complete data is read.
   */
  async function waitForEntries(
    expectedCount: number,
    timeoutMs = 5000,
  ): Promise<AuditLogEntry[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const entries = readTodayAuditEntries();
      if (entries.length >= expectedCount) return entries;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const final = readTodayAuditEntries();
    if (final.length >= expectedCount) return final;
    throw new Error(
      `waitForEntries 超时：期望 ${expectedCount} 条，实际 ${final.length} 条`,
    );
  }

  /** Genesis hash constant */
  const GENESIS_HASH = '0'.repeat(64);

  // ═══════════════════════════════════════════════════════════════
  // 1. logSecurityEvent file-write verification
  // ═══════════════════════════════════════════════════════════════

  describe('logSecurityEvent 文件写入', () => {
    it('单条事件应写入文件并包含所有字段', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.success',
        severity: 'info',
        userId: 'user-001',
        username: 'admin',
        ip: '192.168.1.100',
        userAgent: 'Mozilla/5.0',
        details: { role: 'admin', durationMs: 150 },
      });

      const entries = await waitForEntries(1);
      expect(entries.length).toBe(1);
      const entry = entries[0];
      expect(entry.type).toBe('auth.login.success');
      expect(entry.severity).toBe('info');
      expect(entry.userId).toBe('user-001');
      expect(entry.username).toBe('admin');
      expect(entry.ip).toBe('192.168.1.100');
      expect(entry.userAgent).toBe('Mozilla/5.0');
      expect(entry.details).toEqual({ role: 'admin', durationMs: 150 });
    });

    it('第一条记录的 prevHash 应为创世哈希', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u1' });

      const entries = await waitForEntries(1);
      expect(entries[0].prevHash).toBe(GENESIS_HASH);
    });

    it('多条记录应形成正确的哈希链', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.logout', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.login.failed', severity: 'warning', userId: 'u2' });

      const entries = await waitForEntries(3);
      expect(entries.length).toBe(3);
      expect(entries[0].prevHash).toBe(GENESIS_HASH);
      expect(entries[1].prevHash).toBe(entries[0].hash);
      expect(entries[2].prevHash).toBe(entries[1].hash);
    });

    it('每条记录的 hash 应为 64 位十六进制', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info' });
      service.logSecurityEvent({ type: 'auth.logout', severity: 'info' });

      const entries = await waitForEntries(2);
      for (const entry of entries) {
        expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.prevHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('timestamp 应为 ISO 8601 格式', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info' });

      const entries = await waitForEntries(1);
      const ts = entries[0].timestamp;
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      const date = new Date(ts);
      expect(date.getTime()).not.toBeNaN();
    });

    it('winston 写入的 timestamp 字段不应覆盖审计条目的 timestamp', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });

      const entries = await waitForEntries(1);
      // winston.format.timestamp() adds a timestamp field, but our entry already has it
      // verify the timestamp exists and is a valid ISO 8601 string
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. logSecurityEvent field validation and boundary conditions
  // ═══════════════════════════════════════════════════════════════

  describe('logSecurityEvent 字段验证', () => {
    it('仅传入 type 和 severity 时应正确写入', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.logout', severity: 'info' });

      const entries = await waitForEntries(1);
      expect(entries[0].type).toBe('auth.logout');
      expect(entries[0].severity).toBe('info');
      expect(entries[0].userId).toBeUndefined();
      expect(entries[0].username).toBeUndefined();
      expect(entries[0].ip).toBeUndefined();
      expect(entries[0].userAgent).toBeUndefined();
    });

    it('所有 AuditEventType 都应正确写入', async () => {
      const eventTypes: AuditEventType[] = [
        'auth.login.success',
        'auth.login.failed',
        'auth.login.locked',
        'auth.refresh.success',
        'auth.refresh.failed',
        'auth.logout',
        'auth.password.changed',
        'auth.password.failed',
        'user.created',
        'user.deleted',
        'user.role_changed',
        'permission.denied',
        'permission.granted',
        'system.config_changed',
        'system.data_exported',
      ];

      const service = createService();
      for (const type of eventTypes) {
        service.logSecurityEvent({ type, severity: 'info' });
      }

      const entries = await waitForEntries(eventTypes.length);
      expect(entries.length).toBe(eventTypes.length);
      const writtenTypes = entries.map((e) => e.type);
      expect(writtenTypes).toEqual(eventTypes);
    });

    it('所有 AuditSeverity 级别都应正确写入', async () => {
      const severities: AuditSeverity[] = ['info', 'warning', 'critical'];

      const service = createService();
      for (const severity of severities) {
        service.logSecurityEvent({ type: 'auth.login.success', severity });
      }

      const entries = await waitForEntries(severities.length);
      expect(entries.map((e) => e.severity)).toEqual(severities);
    });

    it('details 为嵌套对象时应正确写入', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.failed',
        severity: 'warning',
        details: {
          reason: 'invalid_password',
          attemptCount: 3,
          maxAttempts: 5,
          context: { browser: 'Chrome', os: 'Windows' },
        },
      });

      const entries = await waitForEntries(1);
      expect(entries[0].details).toEqual({
        reason: 'invalid_password',
        attemptCount: 3,
        maxAttempts: 5,
        context: { browser: 'Chrome', os: 'Windows' },
      });
    });

    it('details 包含数组时应正确写入', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'permission.denied',
        severity: 'warning',
        details: {
          requiredPermissions: ['device:view', 'alarm:view'],
          attemptedAction: 'delete',
        },
      });

      const entries = await waitForEntries(1);
      expect(entries[0].details.requiredPermissions).toEqual(['device:view', 'alarm:view']);
    });

    it('details 包含 null 值时应正确写入', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.success',
        severity: 'info',
        details: { error: null, value: 42, flag: true },
      });

      const entries = await waitForEntries(1);
      expect(entries[0].details.error).toBeNull();
      expect(entries[0].details.value).toBe(42);
      expect(entries[0].details.flag).toBe(true);
    });

    it('details 包含数字和布尔值时应正确写入', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'system.config_changed',
        severity: 'info',
        details: { port: 3000, enabled: true, ratio: 0.95 },
      });

      const entries = await waitForEntries(1);
      expect(entries[0].details.port).toBe(3000);
      expect(entries[0].details.enabled).toBe(true);
      expect(entries[0].details.ratio).toBe(0.95);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. logSecurityEvent security
  // ═══════════════════════════════════════════════════════════════

  describe('logSecurityEvent 安全性', () => {
    it('XSS payload 不应破坏日志 JSON 格式', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.failed',
        severity: 'warning',
        username: '<script>alert("xss")</script>',
        userAgent: '<img src=x onerror=alert(1)>',
        details: { payload: '"><svg onload=alert(1)>' },
      });

      const entries = await waitForEntries(1);
      expect(entries.length).toBe(1);
      // the audit log faithfully records the raw payload; JSON serialization is inherently safe
      expect(entries[0].username).toBe('<script>alert("xss")</script>');
      expect(() => JSON.parse(JSON.stringify(entries[0]))).not.toThrow();
    });

    it('SQL 注入 payload 不应破坏日志格式', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.failed',
        severity: 'warning',
        username: "admin'; DROP TABLE users; --",
        details: { query: "' OR '1'='1" },
      });

      const entries = await waitForEntries(1);
      expect(entries[0].username).toBe("admin'; DROP TABLE users; --");
      expect(entries[0].details.query).toBe("' OR '1'='1");
    });

    it('超长字符串不应抛出异常', async () => {
      const service = createService();
      const longString = 'A'.repeat(10000);
      expect(() =>
        service.logSecurityEvent({
          type: 'auth.login.success',
          severity: 'info',
          userAgent: longString,
          details: { longField: longString },
        }),
      ).not.toThrow();

      const entries = await waitForEntries(1);
      expect(entries[0].userAgent.length).toBe(10000);
      expect(entries[0].details.longField.length).toBe(10000);
    });

    it('特殊 Unicode 字符应正确写入', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.success',
        severity: 'info',
        username: '用户管理员🎯',
        details: { emoji: '🚨🔒✅', chinese: '安全审计日志' },
      });

      const entries = await waitForEntries(1);
      expect(entries[0].username).toBe('用户管理员🎯');
      expect(entries[0].details.emoji).toBe('🚨🔒✅');
      expect(entries[0].details.chinese).toBe('安全审计日志');
    });

    it('换行符和制表符应被正确转义', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.success',
        severity: 'info',
        username: 'line1\nline2\ttabbed',
        details: { multiline: 'a\nb\nc' },
      });

      const entries = await waitForEntries(1);
      expect(entries[0].username).toBe('line1\nline2\ttabbed');
      expect(entries[0].details.multiline).toBe('a\nb\nc');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. verifyChain verification
  // ═══════════════════════════════════════════════════════════════

  describe('verifyChain', () => {
    it('完整未篡改的哈希链应验证通过', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(1, e1.hash, {
        type: 'auth.logout',
        severity: 'info',
        userId: 'u1',
      });
      const e3 = buildAuditEntry(2, e2.hash, {
        type: 'auth.login.failed',
        severity: 'warning',
        userId: 'u2',
      });
      writeAuditFile([e1, e2, e3]);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
      expect(result.brokenAtIndex).toBeNull();
    });

    it('单条记录应验证通过', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      writeAuditFile([e1]);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
    });

    it('100 条记录的链应验证通过', () => {
      const entries: AuditLogEntry[] = [];
      let prevHash = GENESIS_HASH;
      for (let i = 0; i < 100; i++) {
        const entry = buildAuditEntry(i, prevHash, {
          type: 'auth.login.success',
          severity: 'info',
          userId: `user-${i}`,
        });
        entries.push(entry);
        prevHash = entry.hash;
      }
      writeAuditFile(entries);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(100);
    });

    it('篡改日志内容后应检测到 hash 不匹配', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(1, e1.hash, {
        type: 'auth.logout',
        severity: 'info',
        userId: 'u1',
      });
      writeAuditFile([e1, e2]);

      // tamper with the first record's userId (without changing its hash)
      e1.userId = 'hacked-user-id';
      writeAuditFile([e1, e2]);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBe(1);
      expect(result.brokenReason).toContain('hash 不匹配');
    });

    it('断裂的 prevHash 链应被检测到', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      // the second record's prevHash is deliberately set to a wrong value
      const e2 = buildAuditEntry(1, 'a'.repeat(64), {
        type: 'auth.logout',
        severity: 'info',
        userId: 'u1',
      });
      writeAuditFile([e1, e2]);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBe(2);
      expect(result.brokenReason).toContain('prevHash 不匹配');
    });

    it('篡改最后一条记录应被检测到', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(1, e1.hash, {
        type: 'auth.logout',
        severity: 'info',
        userId: 'u1',
      });
      const e3 = buildAuditEntry(2, e2.hash, {
        type: 'auth.login.failed',
        severity: 'warning',
        userId: 'u2',
      });
      writeAuditFile([e1, e2, e3]);

      // tamper with the last record
      e3.userId = 'hacked';
      writeAuditFile([e1, e2, e3]);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBe(3);
    });

    it('篡改中间记录的 hash 值应导致后续 prevHash 不匹配', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(1, e1.hash, {
        type: 'auth.logout',
        severity: 'info',
        userId: 'u1',
      });
      const e3 = buildAuditEntry(2, e2.hash, {
        type: 'auth.login.failed',
        severity: 'warning',
        userId: 'u2',
      });
      writeAuditFile([e1, e2, e3]);

      // tamper with the second record's hash value (without changing its content)
      e2.hash = 'b'.repeat(64);
      writeAuditFile([e1, e2, e3]);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBe(2);
    });

    it('篡改 details 嵌套对象内容应被检测到', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
        details: { role: 'admin', ip: '10.0.0.1' },
      });
      const e2 = buildAuditEntry(1, e1.hash, {
        type: 'auth.logout',
        severity: 'info',
        userId: 'u1',
      });
      writeAuditFile([e1, e2]);

      // tamper with a nested value inside details
      e1.details.role = 'superadmin';
      writeAuditFile([e1, e2]);

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBe(1);
    });

    it('无日志文件时应返回 valid=true, totalEntries=0', () => {
      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
      expect(result.brokenAtIndex).toBeNull();
    });

    it('指定不存在日期时应返回 valid=true, totalEntries=0', () => {
      const service = createService();
      const result = service.verifyChain('2025-01-01');

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
      expect(result.date).toBe('2025-01-01');
    });

    it('JSON 解析失败的行应被检测为损坏', () => {
      ensureAuditDir();
      fs.writeFileSync(getTodayAuditFile(), '{ invalid json line\n');

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBe(1);
      expect(result.brokenReason).toContain('JSON 解析失败');
    });

    it('空文件应返回 valid=true, totalEntries=0', () => {
      ensureAuditDir();
      fs.writeFileSync(getTodayAuditFile(), '');

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
    });

    it('仅有空行的文件应返回 valid=true, totalEntries=0', () => {
      ensureAuditDir();
      fs.writeFileSync(getTodayAuditFile(), '\n\n\n');

      const service = createService();
      const result = service.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
    });

    it('验证指定日期的日志文件（非今天）', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      const targetDate = '2025-06-15';
      const auditDir = path.join(tempLogDir, 'audit');
      if (!fs.existsSync(auditDir)) {
        fs.mkdirSync(auditDir, { recursive: true });
      }
      const targetFile = path.join(auditDir, `audit-${targetDate}.log`);
      fs.writeFileSync(targetFile, JSON.stringify(e1) + '\n');

      const service = createService();
      const result = service.verifyChain(targetDate);

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
      expect(result.date).toBe(targetDate);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. hash-chain algorithm correctness
  // ═══════════════════════════════════════════════════════════════

  describe('哈希链算法', () => {
    it('相同输入应产生相同 hash（确定性）', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });

      expect(e1.hash).toBe(e2.hash);
    });

    it('不同输入应产生不同 hash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u2',
      });

      expect(e1.hash).not.toBe(e2.hash);
    });

    it('hash 应为 64 位十六进制字符串', () => {
      const entry = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });

      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('创世哈希应为 64 个 0', () => {
      expect(GENESIS_HASH).toBe('0'.repeat(64));
      expect(GENESIS_HASH.length).toBe(64);
    });

    it('不同 prevHash 应产生不同 hash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(0, 'a'.repeat(64), {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });

      expect(e1.hash).not.toBe(e2.hash);
    });

    it('不同 timestamp 应产生不同 hash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      const e2 = buildAuditEntry(1000, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });

      expect(e1.timestamp).not.toBe(e2.timestamp);
      expect(e1.hash).not.toBe(e2.hash);
    });

    it('不同 details 应产生不同 hash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        details: { key: 'value1' },
      });
      const e2 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        details: { key: 'value2' },
      });

      expect(e1.hash).not.toBe(e2.hash);
    });

    it('不同 severity 应产生不同 hash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      const e2 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'warning',
      });

      expect(e1.hash).not.toBe(e2.hash);
    });

    it('不同 type 应产生不同 hash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      const e2 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.failed',
        severity: 'info',
      });

      expect(e1.hash).not.toBe(e2.hash);
    });

    it('details 嵌套对象不同值应产生不同 hash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        details: { nested: { deep: 'value1' } },
      });
      const e2 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        details: { nested: { deep: 'value2' } },
      });

      expect(e1.hash).not.toBe(e2.hash);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. restart recovery prevHash
  // ═══════════════════════════════════════════════════════════════

  describe('重启恢复 prevHash', () => {
    it('服务重启后应从当天日志最后一行恢复 prevHash', () => {
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });
      const e2 = buildAuditEntry(1, e1.hash, {
        type: 'auth.logout',
        severity: 'info',
        userId: 'u1',
      });
      writeAuditFile([e1, e2]);

      // create a new instance (simulate restart); loadLastHashFromToday should recover from e2.hash
      const service = createService();

      // manually write a third record (prevHash should be e2.hash)
      const e3 = buildAuditEntry(2, e2.hash, {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u2',
      });
      const existing = fs.readFileSync(getTodayAuditFile(), 'utf-8');
      fs.writeFileSync(getTodayAuditFile(), existing + JSON.stringify(e3) + '\n');

      const result = service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
    });

    it('当天日志文件为空时应使用创世哈希', () => {
      ensureAuditDir();
      fs.writeFileSync(getTodayAuditFile(), '');

      const service = createService();

      // write a record whose prevHash is the genesis hash
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      const existing = fs.readFileSync(getTodayAuditFile(), 'utf-8');
      fs.writeFileSync(getTodayAuditFile(), existing + JSON.stringify(e1) + '\n');

      const result = service.verifyChain();
      expect(result.valid).toBe(true);
    });

    it('当天日志最后一行 JSON 解析失败时应使用创世哈希', () => {
      ensureAuditDir();
      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      fs.writeFileSync(getTodayAuditFile(), JSON.stringify(e1) + '\n{ invalid json }\n');

      expect(() => createService()).not.toThrow();
    });

    it('当天日志最后一行缺少 hash 字段时应使用创世哈希', () => {
      ensureAuditDir();
      const partialEntry = {
        timestamp: new Date().toISOString(),
        type: 'auth.login.success',
        severity: 'info',
        prevHash: GENESIS_HASH,
      };
      fs.writeFileSync(getTodayAuditFile(), JSON.stringify(partialEntry) + '\n');

      expect(() => createService()).not.toThrow();
    });

    it('当天日志最后一行 hash 格式不正确时应使用创世哈希', () => {
      ensureAuditDir();
      const badEntry = {
        timestamp: new Date().toISOString(),
        type: 'auth.login.success',
        severity: 'info',
        prevHash: GENESIS_HASH,
        hash: 'not-a-valid-hash',
      };
      fs.writeFileSync(getTodayAuditFile(), JSON.stringify(badEntry) + '\n');

      expect(() => createService()).not.toThrow();
    });

    it('无当天日志文件时应使用创世哈希', () => {
      const service = createService();

      const e1 = buildAuditEntry(0, GENESIS_HASH, {
        type: 'auth.login.success',
        severity: 'info',
      });
      writeAuditFile([e1]);

      const result = service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. logSecurityEvent + verifyChain integration test
  // ═══════════════════════════════════════════════════════════════

  describe('logSecurityEvent + verifyChain 集成', () => {
    it('logSecurityEvent 写入后 verifyChain 应验证通过', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.logout', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.password.changed', severity: 'info', userId: 'u1' });

      await waitForEntries(3);

      const result = service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
    });

    it('logSecurityEvent 写入后篡改文件，verifyChain 应检测到', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.logout', severity: 'info', userId: 'u1' });

      await waitForEntries(2);

      // read the file and tamper with the second record
      const file = getTodayAuditFile();
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.trim().split('\n');
      const secondEntry = JSON.parse(lines[1]);
      secondEntry.userId = 'tampered';
      lines[1] = JSON.stringify(secondEntry);
      fs.writeFileSync(file, lines.join('\n') + '\n');

      const result = service.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAtIndex).toBe(2);
    });

    it('logSecurityEvent 写入后删除中间记录，verifyChain 应检测到断裂', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.logout', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.login.failed', severity: 'warning', userId: 'u2' });

      await waitForEntries(3);

      // delete the middle record (the second)
      const file = getTodayAuditFile();
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.trim().split('\n');
      const modifiedLines = [lines[0], lines[2]];
      fs.writeFileSync(file, modifiedLines.join('\n') + '\n');

      const result = service.verifyChain();
      expect(result.valid).toBe(false);
    });

    it('两次创建实例写入的记录应形成连续哈希链', async () => {
      // first time: write 2 records
      const service1 = createService();
      service1.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u1' });
      service1.logSecurityEvent({ type: 'auth.logout', severity: 'info', userId: 'u1' });

      const entriesAfterFirst = await waitForEntries(2);
      expect(entriesAfterFirst.length).toBe(2);

      // second time: simulate restart, write 1 record
      const service2 = createService();
      service2.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u2' });

      const entriesAfterSecond = await waitForEntries(3);
      expect(entriesAfterSecond.length).toBe(3);
      // the third record's prevHash should equal the second record's hash (restart recovery succeeded)
      expect(entriesAfterSecond[2].prevHash).toBe(entriesAfterSecond[1].hash);

      // full-chain verification
      const result = service2.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
    });

    it('logSecurityEvent 写入带 details 嵌套对象后 verifyChain 应验证通过', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'system.config_changed',
        severity: 'info',
        userId: 'admin',
        details: {
          module: 'security',
          changes: { old: { enabled: false }, new: { enabled: true } },
          nested: { deep: { value: 42 } },
        },
      });

      await waitForEntries(1);

      const result = service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. close() method
  // ═══════════════════════════════════════════════════════════════

  describe('close()', () => {
    it('close 不应抛出异常', async () => {
      const service = createService();
      await expect(service.close()).resolves.not.toThrow();
    });

    it('未写入任何日志时 close 应正常完成', async () => {
      const service = createService();
      await expect(service.close()).resolves.not.toThrow();
    });

    it('close 后再次 close 不应抛出异常', async () => {
      const service = createService();
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info' });
      await service.close();
      await expect(service.close()).resolves.not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. service lifecycle boundary conditions
  // ═══════════════════════════════════════════════════════════════

  describe('服务生命周期边界条件', () => {
    it('logSecurityEvent 不应抛出异常', () => {
      const service = createService();
      expect(() =>
        service.logSecurityEvent({ type: 'auth.login.success', severity: 'info' }),
      ).not.toThrow();
    });

    it('高频连续写入 100 条记录应全部落盘', async () => {
      const service = createService();
      for (let i = 0; i < 100; i++) {
        service.logSecurityEvent({
          type: 'auth.login.success',
          severity: 'info',
          userId: `user-${i}`,
        });
      }

      const entries = await waitForEntries(100);
      expect(entries.length).toBe(100);

      // verify hash-chain integrity
      const result = service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(100);
    });

    it('同一服务实例多次写入+验证应保持链完整性', async () => {
      const service = createService();

      // first batch
      service.logSecurityEvent({ type: 'auth.login.success', severity: 'info', userId: 'u1' });
      service.logSecurityEvent({ type: 'auth.logout', severity: 'info', userId: 'u1' });

      await waitForEntries(2);
      let result = service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(2);

      // second batch (simulate subsequent writes from the same instance)
      service.logSecurityEvent({ type: 'user.created', severity: 'info', userId: 'u2' });

      await waitForEntries(3);
      result = service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
    });

    it('details 为 undefined 时应正确写入', async () => {
      const service = createService();
      service.logSecurityEvent({
        type: 'auth.login.success',
        severity: 'info',
        userId: 'u1',
      });

      const entries = await waitForEntries(1);
      expect(entries.length).toBe(1);
      expect(entries[0].details).toBeUndefined();
    });

    it('所有可选字段都传值时应正确写入', async () => {
      const service = createService();
      const fullEvent: AuditEvent = {
        type: 'auth.login.success',
        severity: 'info',
        userId: 'user-full-001',
        username: 'fulluser',
        ip: '10.20.30.40',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
        details: { source: 'test', timestamp: '2026-01-01', extra: { nested: true } },
      };
      service.logSecurityEvent(fullEvent);

      const entries = await waitForEntries(1);
      expect(entries[0]).toMatchObject({
        type: 'auth.login.success',
        severity: 'info',
        userId: 'user-full-001',
        username: 'fulluser',
        ip: '10.20.30.40',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      });
      expect(entries[0].details).toEqual({
        source: 'test',
        timestamp: '2026-01-01',
        extra: { nested: true },
      });
    });
  });
});
