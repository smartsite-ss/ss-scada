// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Data-migration result
 */
export interface MigrationResult {
  /** Project name */
  projectName: string;
  /** Migrated entity statistics */
  entities: {
    name: string;
    tableName: string;
    rowCount: number;
    errors: number;
  }[];
  /** Warning messages */
  warnings: string[];
  /** Total elapsed time (ms) */
  durationMs: number;
}

/**
 * Data-migration service
 *
 * Provides unified -> isolated mode data migration
 * Migrates a project's data from the global ss-data.db into the project-level system.db
 */
@Injectable()
export class DataMigrationService {
  private readonly logger = new Logger(DataMigrationService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Migrate a project's data from the global database to the project-level system.db
   *
   * @param globalDataSource the global ss-data.db DataSource
   * @param projectDataSource the project-level system.db DataSource
   * @param projectName project name
   * @param tables the tables to migrate (table name -> selection conditions)
   */
  async migrateProjectFromGlobal(
    globalDataSource: DataSource,
    projectDataSource: DataSource,
    projectName: string,
    tables: Array<{
      tableName: string;
      /** WHERE condition filtering this table's data from the global DB */
      whereCondition?: string;
      /** projectId field name (default "projectId") */
      projectIdField?: string;
      /** Displayed entity name */
      entityName?: string;
    }>,
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const entityResults: MigrationResult['entities'] = [];

    for (const table of tables) {
      const tableName = table.tableName;
      const projectIdField = table.projectIdField || 'projectId';
      const entityName = table.entityName || tableName;
      let rowCount = 0;
      let errors = 0;

      try {
        // Check whether the target table exists
        const tablesResult = await projectDataSource.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`,
        );
        if (tablesResult.length === 0) {
          warnings.push(`[${entityName}] 目标表 "${tableName}" 不存在于项目数据库中，已跳过`);
          entityResults.push({ name: entityName, tableName, rowCount: 0, errors: 0 });
          continue;
        }

        // Query data from the global DB
        let selectSQL = `SELECT * FROM "${tableName}"`;
        if (table.whereCondition) {
          selectSQL += ` WHERE ${table.whereCondition}`;
        } else {
          selectSQL += ` WHERE "${projectIdField}" = ?`;
        }

        const rows = await globalDataSource.query(selectSQL, [projectName]);

        if (rows.length === 0) {
          entityResults.push({ name: entityName, tableName, rowCount: 0, errors: 0 });
          continue;
        }

        // Get the target table's columns
        const columnsResult = await projectDataSource.query(`PRAGMA table_info("${tableName}")`);
        const targetColumns = columnsResult.map((c: any) => c.name);

        // Batch-insert into the project database
        for (const row of rows) {
          try {
            const filteredRow: Record<string, any> = {};
            for (const col of targetColumns) {
              if (col in row) {
                filteredRow[col] = row[col];
              }
            }

            const columns = Object.keys(filteredRow);
            const placeholders = columns.map(() => '?').join(', ');
            const values = Object.values(filteredRow);
            const insertSQL = `INSERT OR IGNORE INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

            await projectDataSource.query(insertSQL, values);
            rowCount++;
          } catch (err) {
            errors++;
            if (errors <= 5) {
              this.logger.warn(`[${entityName}] 插入行失败: ${(err as Error).message}`);
            }
          }
        }

        this.logger.log(`[${entityName}] 迁移完成: ${rowCount} 行, ${errors} 个错误`);
      } catch (err) {
        const msg = `[${entityName}] 迁移失败: ${(err as Error).message}`;
        this.logger.error(msg);
        warnings.push(msg);
      }

      entityResults.push({ name: entityName, tableName, rowCount, errors });
    }

    const durationMs = Date.now() - startTime;
    const totalRows = entityResults.reduce((sum, e) => sum + e.rowCount, 0);
    const totalErrors = entityResults.reduce((sum, e) => sum + e.errors, 0);
    this.logger.log(
      `[${projectName}] 数据迁移完成: ${totalRows} 行, ${totalErrors} 个错误, 耗时 ${durationMs}ms`,
    );

    return {
      projectName,
      entities: entityResults,
      warnings,
      durationMs,
    };
  }

  /**
   * Back up the global database
   *
   * @param globalDataSource the global DataSource
   * @param backupDir backup directory
   */
  async backupGlobalDatabase(globalDataSource: DataSource, backupDir: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `ss-data_backup_${timestamp}.db`;
    const backupPath = path.join(backupDir, backupFileName);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const dbPath = (globalDataSource.options as any).database;
    if (!dbPath || !fs.existsSync(dbPath)) {
      throw new Error(`全局数据库文件不存在: ${dbPath}`);
    }

    fs.copyFileSync(dbPath, backupPath);
    this.logger.log(`全局数据库已备份到: ${backupPath}`);
    return backupPath;
  }

  /**
   * Get the specified project's data statistics in the global database
   */
  async getProjectDataStats(
    globalDataSource: DataSource,
    projectName: string,
    tables: string[],
  ): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};

    for (const tableName of tables) {
      try {
        const whereClause =
          tableName === 'projects' ? `name = '${projectName}'` : `projectId = '${projectName}'`;

        const result = await globalDataSource.query(
          `SELECT COUNT(*) as count FROM "${tableName}" WHERE ${whereClause}`,
        );
        stats[tableName] = result[0]?.count || 0;
      } catch {
        stats[tableName] = -1; // table missing or query failed
      }
    }

    return stats;
  }
}
