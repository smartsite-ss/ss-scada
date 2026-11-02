// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ProjectFsService } from '../services/project-fs.service';

/**
 * ProjectFsService unit tests (P0-1 atomic write / P0-2 path safety)
 * Uses the real file system + real adm-zip, focusing on security boundaries and atomic semantics.
 */
describe('ProjectFsService', () => {
  let service: ProjectFsService;
  let tempDir: string;

  beforeEach(() => {
    service = new ProjectFsService();
    tempDir = path.join(
      os.tmpdir(),
      `project-fs-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ==================== atomicWriteJson / atomicWriteFileSync ====================

  describe('atomicWriteJson', () => {
    it('Should write a parseable JSON file', () => {
      const filePath = path.join(tempDir, 'data.json');
      service.atomicWriteJson(filePath, { name: 'demo', count: 3 });

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(parsed).toEqual({ name: 'demo', count: 3 });
    });

    it('After overwriting an existing file, content should be the new content with no .tmp leftovers', () => {
      const filePath = path.join(tempDir, 'data.json');
      service.atomicWriteJson(filePath, { version: 1 });
      service.atomicWriteJson(filePath, { version: 2 });

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(parsed).toEqual({ version: 2 });

      const leftovers = fs.readdirSync(tempDir).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    it('Should support binary content (Buffer)', () => {
      const filePath = path.join(tempDir, 'blob.bin');
      const payload = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
      service.atomicWriteFileSync(filePath, payload);

      expect(fs.readFileSync(filePath)).toEqual(payload);
    });

    it('The target directory should be created automatically when it does not exist', () => {
      const filePath = path.join(tempDir, 'nested', 'dir', 'data.json');
      service.atomicWriteJson(filePath, { ok: true });

      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ ok: true });
    });
  });

  // ==================== assertPathWithin ====================

  describe('assertPathWithin', () => {
    it('Valid paths inside the base directory should pass', () => {
      expect(() =>
        service.assertPathWithin(tempDir, path.join(tempDir, 'sub', 'file.json')),
      ).not.toThrow();
    });

    it('Should reject .. traversal paths', () => {
      const escape = path.join(tempDir, '..', 'outside.json');
      expect(() => service.assertPathWithin(tempDir, escape)).toThrow(BadRequestException);
    });

    it('Should reject absolute paths outside the base directory', () => {
      expect(() =>
        service.assertPathWithin(tempDir, path.join(os.tmpdir(), 'totally-elsewhere.json')),
      ).toThrow(BadRequestException);
    });

    it('Should reject paths equal to the base directory itself (empty relative)', () => {
      expect(() => service.assertPathWithin(tempDir, tempDir)).toThrow(BadRequestException);
    });
  });

  // ==================== assertSafeSegment ====================

  describe('assertSafeSegment', () => {
    it.each([
      'kebab-case-id',
      'a',
      '项目中文名',
      '3f2a1b4c-5d6e-4f70-8a90-1b2c3d4e5f60',
    ])('合法路径段 [%s] 应通过', (segment) => {
      expect(() => service.assertSafeSegment(segment, 'projectId')).not.toThrow();
    });

    it.each([
      ['', '空值'],
      ['a/b', 'Forward slash'],
      ['a\\b', 'Backslash'],
      ['..', 'Pure traversal'],
      ['../evil', '穿越前缀'],
      ['evil/../x', '穿越中缀'],
      ['C:evil', '盘符前缀'],
      [' spaced', '首部空白'],
      ['spaced ', '尾部空白'],
    ])('非法路径段 [%s]（%s）应拒绝', (segment) => {
      expect(() => service.assertSafeSegment(segment, 'projectId')).toThrow(BadRequestException);
    });
  });

  // ==================== extractZipSafely ====================

  describe('extractZipSafely', () => {
    it('Should fully extract a normal ZIP\'s directories and files', () => {
      const zip = new AdmZip();
      zip.addFile('proj/projectinfo.json', Buffer.from(JSON.stringify({ pid: 'p1' }), 'utf-8'));
      zip.addFile('proj/db/system.db', Buffer.from([0x53, 0x51, 0x4c]));
      zip.addFile('proj/pages/p_home/page.json', Buffer.from('{"id":"page1"}', 'utf-8'));

      const targetDir = path.join(tempDir, 'extract');
      service.extractZipSafely(zip, targetDir);

      expect(
        JSON.parse(fs.readFileSync(path.join(targetDir, 'proj/projectinfo.json'), 'utf-8')),
      ).toEqual({ pid: 'p1' });
      expect(fs.existsSync(path.join(targetDir, 'proj/db/system.db'))).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(path.join(targetDir, 'proj/pages/p_home/page.json'), 'utf-8')),
      ).toEqual({ id: 'page1' });
    });

    it('Should reject Zip Slip entries (../ traversal) without writing to the target directory', () => {
      // Note: adm-zip's addFile sanitizes entry names (../ and leading / are cleaned),
      // so it cannot build a genuinely malicious ZIP; a duck-typed mock provides the raw dangerous entry names instead.
      const maliciousZip = {
        getEntries: () => [
          {
            isDirectory: false,
            entryName: 'proj/projectinfo.json',
            getData: () => Buffer.from('{}', 'utf-8'),
          },
          {
            isDirectory: false,
            entryName: '../evil.txt',
            getData: () => Buffer.from('malicious', 'utf-8'),
          },
        ],
      } as unknown as AdmZip;

      const targetDir = path.join(tempDir, 'extract');
      expect(() => service.extractZipSafely(maliciousZip, targetDir)).toThrow(
        BadRequestException,
      );

      // Out-of-bounds files must never be written out (whether inside the target directory or its parent)
      expect(fs.existsSync(path.join(targetDir, 'evil.txt'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'evil.txt'))).toBe(false);
    });

    it('Should reject absolute-path entries', () => {
      const maliciousZip = {
        getEntries: () => [
          {
            isDirectory: false,
            entryName: '/abs/evil.txt',
            getData: () => Buffer.from('malicious', 'utf-8'),
          },
        ],
      } as unknown as AdmZip;

      const targetDir = path.join(tempDir, 'extract');
      expect(() => service.extractZipSafely(maliciousZip, targetDir)).toThrow(
        BadRequestException,
      );
      expect(fs.existsSync(path.join(tempDir, 'abs'))).toBe(false);
    });
  });
});
