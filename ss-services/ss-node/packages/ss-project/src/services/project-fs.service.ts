// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type AdmZip from 'adm-zip';

/**
 * 项目文件系统公共工具服务
 *
 * 沉淀 ss-project 包内六个 service 重复的文件系统基础操作：
 * - 原子写（临时文件 + 同分区 rename），消除"写一半崩溃导致 JSON 损坏"
 * - 路径安全断言（assertPathWithin / assertSafeSegment），拒绝路径穿越
 * - ZIP 安全解压（逐条目校验），杜绝 Zip Slip 任意文件写
 *
 * 详见 docs-e/优化记录/2026-10-24-ss-project-代码质量分析与优化方案.md（P0-1 / P0-2）。
 */
@Injectable()
export class ProjectFsService {
  /** 确保目录存在（递归创建） */
  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * 原子写文件（文本或二进制）。
   *
   * 先写同目录临时文件，再 rename 替换目标文件：
   * - rename 在同一分区内是原子操作，任何时刻磁盘上的目标文件要么是旧完整内容、要么是新完整内容；
   * - 临时文件放在同目录（同分区），保证 rename 不跨分区降级为复制；
   * - 写入或替换失败时清理临时文件并抛出原始错误，目标文件保持旧内容不受影响。
   */
  atomicWriteFileSync(filePath: string, content: string | Buffer): void {
    const dir = path.dirname(filePath);
    this.ensureDir(dir);
    const tmpPath = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      fs.writeFileSync(tmpPath, content);
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.rmSync(tmpPath, { force: true });
        }
      } catch {
        // 清理临时文件失败不影响原始错误抛出
      }
      throw error;
    }
  }

  /** 原子写 JSON（默认 2 空格缩进，与既有落盘格式保持一致） */
  atomicWriteJson(filePath: string, data: unknown, space = 2): void {
    this.atomicWriteFileSync(filePath, JSON.stringify(data, null, space));
  }

  /**
   * 断言 candidate 解析后的绝对路径位于 baseDir 内。
   *
   * 用于所有"用户可控字符串参与 path.join 后落盘/删除"的调用点，作为纵深防御：
   * 即使上游遗漏了段级校验（assertSafeSegment），此处也会拦截 `..`、
   * 绝对路径、盘符等一切越出 baseDir 的结果。
   */
  assertPathWithin(baseDir: string, candidate: string): void {
    const resolvedBase = path.resolve(baseDir);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedBase, resolvedCandidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException(
        `非法路径（越出基准目录）: ${candidate}`,
      );
    }
  }

  /**
   * 校验直接参与文件路径拼接的路径段（projectId / templateId / 页面名等）。
   *
   * 拒绝：空值、路径分隔符（/ \）、`..`、盘符前缀、控制字符、首尾空白。
   * 有意保留中文/大写字母等合法字符：存量项目存在 GUID、中文目录名，
   * 不能按 kebab-case 强校验（create 流程已用 generateProjectId 保证新项目规范）。
   */
  assertSafeSegment(segment: string, label: string): void {
    if (
      !segment ||
      typeof segment !== 'string' ||
      /[/\\]/.test(segment) ||
      segment.includes('..') ||
      /^[a-zA-Z]:/.test(segment) ||
      /[\x00-\x1f]/.test(segment) ||
      segment !== segment.trim()
    ) {
      throw new BadRequestException(`非法的${label}: ${String(segment)}`);
    }
  }

  /**
   * 安全解压 ZIP 到目标目录（替代 adm-zip 的 extractAllTo）。
   *
   * 逐条目处理并校验解压目标始终位于 targetDir 内：
   * - 拒绝绝对路径 / 盘符条目；
   * - `path.resolve` 后用 assertPathWithin 二次确认，拦截 `../` 穿越条目（Zip Slip）；
   * - 目录条目创建目录，文件条目以 getData() 解压内容后写入；
   * - 不创建任何符号链接（符号链接条目按普通文件内容落盘）。
   */
  extractZipSafely(zip: AdmZip, targetDir: string): void {
    const resolvedTargetDir = path.resolve(targetDir);
    this.ensureDir(resolvedTargetDir);

    for (const entry of zip.getEntries()) {
      const entryName = entry.entryName.replace(/\\/g, '/');
      if (path.isAbsolute(entryName) || /^[a-zA-Z]:/.test(entryName)) {
        throw new BadRequestException(`ZIP 条目含非法路径: ${entry.entryName}`);
      }

      const destPath = path.resolve(resolvedTargetDir, entryName);
      this.assertPathWithin(resolvedTargetDir, destPath);

      if (entry.isDirectory) {
        this.ensureDir(destPath);
      } else {
        this.ensureDir(path.dirname(destPath));
        this.atomicWriteFileSync(destPath, entry.getData());
      }
    }
  }
}
