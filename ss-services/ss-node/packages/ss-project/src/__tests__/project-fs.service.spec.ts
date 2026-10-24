// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { ProjectFsService } from './project-fs.service';

/**
 * ProjectFsService 单元测试（P0-1 原子写 / P0-2 路径安全）
 * 使用真实文件系统 + 真实 adm-zip，重点验证安全边界与原子语义。
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
    it('应写入可解析的 JSON 文件', () => {
      const filePath = path.join(tempDir, 'data.json');
      service.atomicWriteJson(filePath, { name: 'demo', count: 3 });

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(parsed).toEqual({ name: 'demo', count: 3 });
    });

    it('覆盖已存在文件后内容应为新内容且不残留 .tmp 临时文件', () => {
      const filePath = path.join(tempDir, 'data.json');
      service.atomicWriteJson(filePath, { version: 1 });
      service.atomicWriteJson(filePath, { version: 2 });

      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(parsed).toEqual({ version: 2 });

      const leftovers = fs.readdirSync(tempDir).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    it('应支持二进制内容（Buffer）', () => {
      const filePath = path.join(tempDir, 'blob.bin');
      const payload = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
      service.atomicWriteFileSync(filePath, payload);

      expect(fs.readFileSync(filePath)).toEqual(payload);
    });

    it('目标目录不存在时应自动创建', () => {
      const filePath = path.join(tempDir, 'nested', 'dir', 'data.json');
      service.atomicWriteJson(filePath, { ok: true });

      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ ok: true });
    });
  });

  // ==================== assertPathWithin ====================

  describe('assertPathWithin', () => {
    it('基准目录内的合法路径应通过', () => {
      expect(() =>
        service.assertPathWithin(tempDir, path.join(tempDir, 'sub', 'file.json')),
      ).not.toThrow();
    });

    it('应拒绝 .. 穿越路径', () => {
      const escape = path.join(tempDir, '..', 'outside.json');
      expect(() => service.assertPathWithin(tempDir, escape)).toThrow(BadRequestException);
    });

    it('应拒绝基准目录之外的绝对路径', () => {
      expect(() =>
        service.assertPathWithin(tempDir, path.join(os.tmpdir(), 'totally-elsewhere.json')),
      ).toThrow(BadRequestException);
    });

    it('应拒绝等于基准目录本身（relative 为空）', () => {
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
      ['a/b', '正斜杠'],
      ['a\\b', '反斜杠'],
      ['..', '纯穿越'],
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
    it('应完整解压正常 ZIP 的目录与文件', () => {
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

    it('应拒绝 Zip Slip 条目（../ 穿越）且不写出目标目录', () => {
      const zip = new AdmZip();
      zip.addFile('proj/projectinfo.json', Buffer.from('{}', 'utf-8'));
      zip.addFile('../evil.txt', Buffer.from('malicious', 'utf-8'));

      const targetDir = path.join(tempDir, 'extract');
      expect(() => service.extractZipSafely(zip, targetDir)).toThrow(BadRequestException);

      // 越界文件绝不能被写出（无论在目标目录内还是其父目录）
      expect(fs.existsSync(path.join(targetDir, 'evil.txt'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'evil.txt'))).toBe(false);
    });

    it('应拒绝绝对路径条目', () => {
      const zip = new AdmZip();
      zip.addFile('/abs/evil.txt', Buffer.from('malicious', 'utf-8'));

      const targetDir = path.join(tempDir, 'extract');
      expect(() => service.extractZipSafely(zip, targetDir)).toThrow(BadRequestException);
      expect(fs.existsSync(path.join(tempDir, 'abs'))).toBe(false);
    });
  });
});
