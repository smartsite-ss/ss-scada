// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityTarget, Repository } from 'typeorm';
import { ProjectDatabaseService, ProjectDbMode } from '@ss-node/ss-core';

/**
 * Project-level repository factory service
 *
 * Selects the data source automatically by PROJECT_DB_MODE:
 * - unified: returns the global TypeORM Repository (injected via NestJS DI)
 * - isolated: dynamically creates a Repository from the project-level system.db DataSource
 *
 * Usage (isolated mode):
 * ```
 * const repo = this.repoService.getRepository(Device, projectName);
 * const devices = await repo.find({ where: { projectId } });
 * ```
 *
 * unified-mode compatibility (no changes to existing code needed):
 * ```
 * const repo = this.repoService.getRepositoryOrFallback(Device, projectName, this.deviceRepo);
 * ```
 */
@Injectable()
export class ProjectRepositoryService {
  private readonly logger = new Logger(ProjectRepositoryService.name);

  /** Global DataSource (used in unified mode) */
  private globalDataSource: DataSource | null = null;

  constructor(private readonly projectDbService: ProjectDatabaseService) {}

  /**
   * Set the global DataSource reference (injected at AppModule initialization)
   */
  setGlobalDataSource(ds: DataSource): void {
    this.globalDataSource = ds;
  }

  /**
   * Get the current database mode
   */
  getMode(): ProjectDbMode {
    return this.projectDbService.getMode();
  }

  /**
   * Get an entity's Repository for a specified project
   *
   * @param entity       entity class
   * @param projectName  project name
   * @returns TypeORM Repository
   */
  getRepository<Entity extends object>(
    entity: EntityTarget<Entity>,
    projectName: string,
  ): Repository<Entity> {
    if (this.projectDbService.getMode() === 'isolated') {
      const systemDs = this.projectDbService.getLoadedSystemDb(projectName);
      if (!systemDs) {
        throw new Error(
          `[ProjectRepositoryService] Project "${projectName}" system.db not loaded. ` +
            `Call ProjectDatabaseService.loadProjectDatabases() first.`,
        );
      }
      return systemDs.getRepository(entity);
    }

    // unified mode: use the global DataSource
    if (!this.globalDataSource) {
      throw new Error(
        '[ProjectRepositoryService] Global DataSource not set. ' +
          'Call setGlobalDataSource() during app initialization.',
      );
    }
    return this.globalDataSource.getRepository(entity);
  }

  /**
   * Get a Repository with unified-mode fallback
   *
   * In unified mode, returns the passed fallbackRepo directly (avoiding an extra global DataSource lookup)
   * In isolated mode, creates it from the project-level DataSource
   *
   * @param entity       entity class
   * @param projectName  project name
   * @param fallbackRepo the Repository instance used in unified mode
   * @returns TypeORM Repository
   */
  getRepositoryOrFallback<Entity extends object>(
    entity: EntityTarget<Entity>,
    projectName: string,
    fallbackRepo: Repository<Entity>,
  ): Repository<Entity> {
    if (this.projectDbService.getMode() === 'isolated') {
      return this.getRepository(entity, projectName);
    }
    return fallbackRepo;
  }

  /**
   * Load the project database asynchronously (if not yet loaded)
   * Usually called on a project's first access
   *
   * @param projectName project name
   */
  async ensureProjectLoaded(projectName: string): Promise<void> {
    if (this.projectDbService.getMode() !== 'isolated') return;

    const conn = this.projectDbService.getConnection(projectName);
    if (!conn) {
      await this.projectDbService.loadProjectDatabases(projectName);
    }
  }

  /**
   * Get system.db's raw DataSource (for direct queries)
   */
  getSystemDataSource(projectName: string): DataSource {
    if (this.projectDbService.getMode() === 'isolated') {
      const ds = this.projectDbService.getLoadedSystemDb(projectName);
      if (!ds) {
        throw new Error(
          `[ProjectRepositoryService] Project "${projectName}" system.db not loaded.`,
        );
      }
      return ds;
    }

    if (!this.globalDataSource) {
      throw new Error('[ProjectRepositoryService] Global DataSource not set.');
    }
    return this.globalDataSource;
  }
}
