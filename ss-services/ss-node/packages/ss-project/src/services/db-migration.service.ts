// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';
import { DataSource } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Migration-script metadata
 */
export interface MigrationScript {
  /** File name */
  name: string;
  /** File path */
  filePath: string;
  /** Migration version number (extracted from the file name) */
  version: number;
  /** Migration type */
  targetDb: 'system';
}

/**
 * Project-level database migration management service
 *
 * Responsibilities:
 * 1. Manage project-level database migration scripts (the db/migration/ directory)
 * 2. Track executed migration versions (stored in projectinfo.json)
 * 3. Execute pending migration scripts in order
 */
@Injectable()
export class DbMigrationService {
  private readonly logger = new Logger(DbMigrationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pathResolver: PathResolverService,
  ) {}

  /**
   * Get the project migration-script directory
   *
   * Relative-path base:
   * - dev mode: __dirname up 4 levels = ss-services/ss-node
   *   (after compilation this file lives in packages/ss-project/dist/services/, 4 levels up:
   *    dist/services/ -> dist/ -> ss-project/ -> packages/ -> ss-node/)
   * - production: process.cwd() = ss-run/ss/services/ss-node
   *
   * Fix history: previously used 3-level traversal without distinguishing dev/prod; in dev mode it resolved to packages/ (wrong),
   * and in production __dirname lives in node_modules/@ss-node/ss-project/dist/services/, where 3 levels reaches node_modules/ (wrong).
   * Kept consistent with project-database.service.ts getProjectDbDir().
   */
  getMigrationDir(projectName: string): string {
    const projectsDir = this.configService.get<string>('PROJECTS_DIR') || './data/projects';
    const absoluteProjectsDir = this.pathResolver.resolve(projectsDir);
    return path.join(absoluteProjectsDir, projectName, 'db', 'migration');
  }

  /**
   * Scan the project migration-script directory, returning the list of pending migration scripts
   *
   * File naming convention: {index}_system_{description}.sql
   * Examples:
   *   001_system_init.sql
   *   002_system_add_alarm_priority.sql
   */
  scanMigrations(projectName: string): MigrationScript[] {
    const migrationDir = this.getMigrationDir(projectName);
    if (!fs.existsSync(migrationDir)) {
      return [];
    }

    const files = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // sort by file name

    const migrations: MigrationScript[] = [];
    for (const file of files) {
      const match = file.match(/^(\d+)_system_(.+)\.sql$/);
      if (match) {
        migrations.push({
          name: file,
          filePath: path.join(migrationDir, file),
          version: parseInt(match[1], 10),
          targetDb: 'system',
        });
      } else {
        this.logger.warn(`[${projectName}] Skip invalid migration file: ${file}`);
      }
    }

    return migrations;
  }

  /**
   * Get the list of executed migration versions
   */
  getExecutedMigrations(projectName: string): string[] {
    const infoPath = this.getProjectInfoPath(projectName);
    if (!fs.existsSync(infoPath)) {
      return [];
    }

    try {
      const raw = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
      return raw.dbMigrations || [];
    } catch {
      return [];
    }
  }

  /**
   * Record an executed migration
   */
  recordMigration(projectName: string, migrationName: string): void {
    const infoPath = this.getProjectInfoPath(projectName);
    if (!fs.existsSync(infoPath)) {
      this.logger.warn(`[${projectName}] projectinfo.json not found, cannot record migration`);
      return;
    }

    const raw = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    const executed = raw.dbMigrations || [];
    if (!executed.includes(migrationName)) {
      executed.push(migrationName);
      raw.dbMigrations = executed;
      fs.writeFileSync(infoPath, JSON.stringify(raw, null, 2), 'utf-8');
    }
  }

  /**
   * Get the current database schema version number
   */
  getDbSchemaVersion(projectName: string): number {
    const infoPath = this.getProjectInfoPath(projectName);
    if (!fs.existsSync(infoPath)) {
      return 0;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
      return raw.dbSchemaVersion || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Update the database schema version number
   */
  setDbSchemaVersion(projectName: string, version: number): void {
    const infoPath = this.getProjectInfoPath(projectName);
    if (!fs.existsSync(infoPath)) return;

    const raw = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    raw.dbSchemaVersion = version;
    fs.writeFileSync(infoPath, JSON.stringify(raw, null, 2), 'utf-8');
  }

  /**
   * Execute project database migrations
   *
   * @param projectName project name
   * @param systemDs    the system.db DataSource
   * @returns the number of migrations executed this time
   */
  async migrateProject(projectName: string, systemDs: DataSource): Promise<number> {
    const migrations = this.scanMigrations(projectName);
    if (migrations.length === 0) {
      return 0;
    }

    const executedNames = this.getExecutedMigrations(projectName);
    const pending = migrations.filter((m) => !executedNames.includes(m.name));

    if (pending.length === 0) {
      this.logger.log(`[${projectName}] No pending migrations`);
      return 0;
    }

    let count = 0;
    for (const migration of pending) {
      try {
        const sql = fs.readFileSync(migration.filePath, 'utf-8');

        this.logger.log(`[${projectName}] Executing migration: ${migration.name}`);
        await systemDs.query(sql);

        this.recordMigration(projectName, migration.name);
        this.setDbSchemaVersion(projectName, migration.version);
        count++;
      } catch (err) {
        this.logger.error(
          `[${projectName}] Migration "${migration.name}" failed: ${(err as Error).message}`,
          (err as Error).stack,
        );
        // Do not interrupt subsequent migrations
      }
    }

    this.logger.log(`[${projectName}] Migrations completed: ${count}/${pending.length} executed`);
    return count;
  }

  /**
   * Generate a blank migration-script file
   *
   * @param projectName project name
   * @param description migration description
   * @param targetDb    target database
   */
  createMigrationFile(projectName: string, description: string, targetDb: 'system'): string {
    const migrationDir = this.getMigrationDir(projectName);
    if (!fs.existsSync(migrationDir)) {
      fs.mkdirSync(migrationDir, { recursive: true });
    }

    const existing = this.scanMigrations(projectName);
    const nextVersion = existing.length > 0 ? Math.max(...existing.map((m) => m.version)) + 1 : 1;

    const safeDesc = description.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_').slice(0, 50);
    const fileName = `${String(nextVersion).padStart(3, '0')}_${targetDb}_${safeDesc}.sql`;
    const filePath = path.join(migrationDir, fileName);

    const template = `-- Migration: ${description}
-- Target: ${targetDb}.db
-- Created: ${new Date().toISOString()}
-- Version: ${nextVersion}

-- TODO: Write your migration SQL here
`;
    fs.writeFileSync(filePath, template, 'utf-8');
    this.logger.log(`[${projectName}] Migration file created: ${fileName}`);
    return filePath;
  }

  /**
   * Get the project's projectinfo.json path
   *
   * Path base matches getMigrationDir(): 4-level traversal in dev mode, process.cwd() in production.
   */
  private getProjectInfoPath(projectName: string): string {
    const projectsDir = this.configService.get<string>('PROJECTS_DIR') || './data/projects';
    const absoluteProjectsDir = this.pathResolver.resolve(projectsDir);
    return path.join(absoluteProjectsDir, projectName, 'projectinfo.json');
  }
}
