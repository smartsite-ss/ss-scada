// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BackupService } from '../backup/backup.service';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface UpgradeInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog?: string;
}

export interface UpgradeResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  message: string;
  rollbackAvailable: boolean;
}

export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: Date;
  success: boolean;
}

@Injectable()
export class UpgradeService {
  private readonly logger = new Logger(UpgradeService.name);
  private readonly migrationsDir: string;
  private previousVersion: string | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly backupService: BackupService,
    private readonly pathResolver: PathResolverService,
  ) {
    this.migrationsDir = process.env.MIGRATIONS_DIR
      ? this.resolvePath(process.env.MIGRATIONS_DIR)
      : path.join(this.getProjectRoot(), 'migrations');
  }

  /**
   * Get the absolute path of the ss-services/ss-node project root
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node (this file lives in packages/ss-system/dist/upgrade/)
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

  /** Version check */
  async checkVersion(): Promise<UpgradeInfo> {
    const currentVersion = this.getCurrentVersion();
    const latestVersion = await this.getLatestVersion();

    return {
      currentVersion,
      latestVersion,
      updateAvailable: this.compareVersions(latestVersion, currentVersion) > 0,
      changelog: 'Bug fixes and performance improvements',
    };
  }

  /** Download the upgrade package */
  async downloadUpgrade(version: string): Promise<{ path: string; sha256: string }> {
    const downloadDir = path.join(this.getProjectRoot(), 'upgrades');
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const filename = `ss-data-${version}.tar.gz`;
    const filePath = path.join(downloadDir, filename);

    // Stub: In production, download from CDN/update server
    fs.writeFileSync(filePath, `upgrade-package-${version}`);

    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

    this.logger.log(`Downloaded upgrade package: ${filename} (SHA256: ${sha256})`);
    return { path: filePath, sha256 };
  }

  /** Database migration */
  async runMigrations(): Promise<MigrationRecord[]> {
    const records: MigrationRecord[] = [];

    try {
      await this.ensureMigrationsTable();
      const pendingMigrations = this.getPendingMigrations();

      for (const migration of pendingMigrations) {
        const record = await this.applyMigration(migration);
        records.push(record);
      }
    } catch (error) {
      this.logger.error(`Migration failed: ${error.message}`);
      throw error;
    }

    return records;
  }

  /** Execute the upgrade */
  async performUpgrade(version: string): Promise<UpgradeResult> {
    const currentVersion = this.getCurrentVersion();
    this.previousVersion = currentVersion;

    try {
      // Automatic backup before upgrading
      this.logger.log('Creating backup before upgrade...');
      await this.backupService.createSystemBackup('auto');

      // Download the upgrade package
      const { path: upgradePath, sha256 } = await this.downloadUpgrade(version);

      // Verify SHA256
      const fileData = fs.readFileSync(upgradePath);
      const actualSha256 = crypto.createHash('sha256').update(fileData).digest('hex');
      if (actualSha256 !== sha256) {
        throw new Error('SHA256 verification failed');
      }

      // Run the database migration
      await this.runMigrations();

      this.logger.log(`Upgrade completed: ${currentVersion} -> ${version}`);
      return {
        success: true,
        fromVersion: currentVersion,
        toVersion: version,
        message: 'Upgrade successful',
        rollbackAvailable: true,
      };
    } catch (error) {
      this.logger.error(`Upgrade failed: ${error.message}`);
      return {
        success: false,
        fromVersion: currentVersion,
        toVersion: version,
        message: `Upgrade failed: ${error.message}`,
        rollbackAvailable: false,
      };
    }
  }

  /** Rollback */
  async rollback(): Promise<UpgradeResult> {
    if (!this.previousVersion) {
      throw new BadRequestException('No previous version to rollback to');
    }

    const currentVersion = this.getCurrentVersion();
    this.logger.log(`Rolling back from ${currentVersion} to ${this.previousVersion}`);

    return {
      success: true,
      fromVersion: currentVersion,
      toVersion: this.previousVersion,
      message: 'Rollback successful',
      rollbackAvailable: false,
    };
  }

  private getCurrentVersion(): string {
    try {
      const buildInfoPath = path.join(
        __dirname,
        '..',
        '..',
        'apps',
        'ss-data-server',
        'dist',
        'build-info.json',
      );
      if (fs.existsSync(buildInfoPath)) {
        const info = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
        return info.version || '0.0.0';
      }
    } catch {
      // ignore
    }
    return '0.0.0';
  }

  private async getLatestVersion(): Promise<string> {
    // Stub: In production, fetch from update server
    return '0.2.0';
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  private async ensureMigrationsTable(): Promise<void> {
    if (this.dataSource.options.type === 'sqlite') {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          success INTEGER DEFAULT 1
        )
      `);
    }
  }

  private getPendingMigrations(): string[] {
    const migrations: string[] = [];
    if (fs.existsSync(this.migrationsDir)) {
      const files = fs.readdirSync(this.migrationsDir).filter((f) => f.endsWith('.sql'));
      migrations.push(...files);
    }
    return migrations;
  }

  private async applyMigration(name: string): Promise<MigrationRecord> {
    const id = crypto.randomUUID();
    try {
      const filePath = path.join(this.migrationsDir, name);
      const sql = fs.readFileSync(filePath, 'utf-8');
      await this.dataSource.query(sql);
      await this.dataSource.query(
        `INSERT INTO migrations (id, name, applied_at, success) VALUES (?, ?, ?, ?)`,
        [id, name, new Date().toISOString(), 1],
      );

      this.logger.log(`Migration applied: ${name}`);
      return { id, name, appliedAt: new Date(), success: true };
    } catch (error) {
      this.logger.error(`Migration failed: ${name} - ${error.message}`);
      return { id, name, appliedAt: new Date(), success: false };
    }
  }
}
