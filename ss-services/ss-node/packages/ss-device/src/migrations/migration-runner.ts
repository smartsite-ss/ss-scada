// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Database migration runner
 * Executes SQL migration scripts in production environments
 */
@Injectable()
export class MigrationRunner {
  private readonly logger = new Logger(MigrationRunner.name);

  /**
   * Execute all SQL migration scripts in the given directory
   * @param migrationsDir migration-script directory path
   * @param db database instance (must support the exec method)
   */
  async runMigrations(migrationsDir: string, db: any): Promise<void> {
    if (!fs.existsSync(migrationsDir)) {
      this.logger.warn(`Migrations directory not found: ${migrationsDir}`);
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      this.logger.log('No migration files found');
      return;
    }

    // Create the migration-record table
    await this.ensureMigrationTable(db);

    for (const file of files) {
      await this.runMigration(migrationsDir, file, db);
    }
  }

  /**
   * Execute a single migration script
   */
  private async runMigration(migrationsDir: string, file: string, db: any): Promise<void> {
    // Check whether it has already run
    const alreadyRun = await this.isMigrationRun(db, file);
    if (alreadyRun) {
      this.logger.debug(`Migration already executed: ${file}`);
      return;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    this.logger.log(`Running migration: ${file}`);

    try {
      await this.execSql(db, sql);
      await this.recordMigration(db, file);
      this.logger.log(`Migration completed: ${file}`);
    } catch (err) {
      this.logger.error(`Migration failed: ${file} - ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Ensure the migration-record table exists
   */
  private async ensureMigrationTable(db: any): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS "_migrations" (
        "name"      TEXT PRIMARY KEY,
        "executedAt" DATETIME NOT NULL DEFAULT (datetime('now'))
      );
    `;
    await this.execSql(db, sql);
  }

  /**
   * Check whether a migration has already run
   */
  private async isMigrationRun(db: any, name: string): Promise<boolean> {
    try {
      const result = await this.querySql(
        db,
        `SELECT COUNT(*) as count FROM "_migrations" WHERE "name" = ?`,
        [name],
      );
      return result[0]?.count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Record a migration as executed
   */
  private async recordMigration(db: any, name: string): Promise<void> {
    await this.execSql(db, `INSERT INTO "_migrations" ("name") VALUES (?)`, [name]);
  }

  /**
   * Execute SQL (multiple statements separated by semicolons)
   */
  private async execSql(db: any, sql: string, params?: any[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (params) {
        db.run(sql, params, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        db.exec(sql, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  }

  /**
   * Query SQL
   */
  private async querySql(db: any, sql: string, params?: any[]): Promise<any[]> {
    return new Promise<any[]>((resolve, reject) => {
      db.all(sql, params || [], (err: Error | null, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}
