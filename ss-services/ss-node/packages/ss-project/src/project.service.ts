// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { pinyin } from 'pinyin-pro';
import { Project } from './entities/project.entity';

import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { PaginationDto, PaginatedResult } from '@ss-node/ss-sdk';
import { I18nService } from '@ss-node/ss-i18n';
import {
  EventBusService,
  ProjectDatabaseService,
  ErrorFactory,
  PathResolverService,
} from '@ss-node/ss-core';
import { DeviceService, DeviceStats } from '@ss-node/ss-device';
import { AlarmStatisticsService } from '@ss-node/ss-alarm';
import { ProjectFsService } from './services/project-fs.service';

const PROJECT_INFO_FILE = 'projectinfo.json';
const DEFAULT_PROJECT_FILE = '.default-project.json';

const SUBDIRS = ['db', 'rtdb', 'pages', 'template', 'images'];

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);
  private readonly err: ErrorFactory;

  constructor(
    private readonly configService: ConfigService,
    private readonly i18nService: I18nService,
    private readonly projectDbService: ProjectDatabaseService,
    private readonly eventBus: EventBusService,
    private readonly pathResolver: PathResolverService,
    @Inject(forwardRef(() => DeviceService))
    private readonly deviceService: DeviceService,
    @Inject(forwardRef(() => AlarmStatisticsService))
    private readonly alarmStatsService: AlarmStatisticsService,
    private readonly projectFs: ProjectFsService,
  ) {
    this.err = new ErrorFactory(this.i18nService);
  }

  /**
   * Get the project-directory absolute path
   *
   * Relative-path base:
   * - dev mode: __dirname up 3 levels = ss-services/ss-node (PROJECTS_DIR=../../ss-run/ss/data/projects in .env.dev is relative to this directory)
   * - production: process.cwd() = ss-run/ss/services/ss-node (PROJECTS_DIR=../../data/projects in .env is relative to this directory)
   *
   * Fix history: before v1.4 process.cwd() was used; in dev mode cwd = apps/ss-node-server,
   * so ../../ss-run/ss/data/projects resolved to ss-services/ss-node/ss-run/... (nonexistent),
   * pointing the project directory at the wrong location, making existing projects invisible after login.
   * Kept consistent with app.module.ts getDatabaseConfig() and database.service.ts getProjectRoot().
   */
  getProjectsDir(): string {
    const configuredDir = this.configService.get<string>('PROJECTS_DIR') || './data/projects';
    return this.pathResolver.resolve(configuredDir);
  }

  private ensureProjectsDir(): void {
    const dir = this.getProjectsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.log(`Created projects directory: ${dir}`);
    }
  }

  private getProjectDir(projectId: string): string {
    return path.join(this.getProjectsDir(), projectId);
  }

  private getProjectInfoPath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), PROJECT_INFO_FILE);
  }

  private ensureProjectSubdirs(projectId: string): void {
    const projectDir = this.getProjectDir(projectId);
    for (const subdir of SUBDIRS) {
      const subdirPath = path.join(projectDir, subdir);
      if (!fs.existsSync(subdirPath)) {
        fs.mkdirSync(subdirPath, { recursive: true });
      }
    }
  }

  private readProjectInfo(projectId: string): Project {
    const infoPath = this.getProjectInfoPath(projectId);
    if (!fs.existsSync(infoPath)) {
      this.err.notFound('error.project.PROJ_001', { id: projectId });
    }
    const raw = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    const projectDir = this.getProjectDir(projectId);
    const project = new Project({
      // Backward compatible: legacy projectinfo.json may contain a tid field (old directory name) rather than projectId
      // Note: the old pid was pinyin initials (e.g. 'zwxm'), not a directory name, and must not fall back as projectId
      projectId: raw.projectId || raw.tid || projectId,
      // Backward compatible: legacy projectinfo.json may contain a tid field rather than tenantId
      tenantId: raw.tenantId || raw.tid || projectId,
      projectName: raw.projectName || raw.name || projectId,
      description: raw.description || '',
      version: raw.version || '1.0.0',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      createdBy: raw.createdBy || '',
      updatedBy: raw.updatedBy || '',
      config: raw.config || {},
      projectPath: projectDir,
      databasePath: path.join(projectDir, 'db'),
      address: raw.address,
      longitude: raw.longitude,
      latitude: raw.latitude,
      owner: raw.owner,
      image: raw.image,
      // enabled reading: undefined when legacy projectinfo.json lacks the field; the Project constructor defaults it to false
      enabled: raw.enabled,
    });
    return project;
  }

  private writeProjectInfo(project: Project): void {
    const infoPath = this.getProjectInfoPath(project.projectId);
    fs.writeFileSync(infoPath, JSON.stringify(project.toProjectInfo(), null, 2), 'utf-8');
  }

  /**
   * Generate the project's unique identifier projectId (full pinyin kebab-case; used as the directory name / DB isolation / InfluxDB bucket / Redis key).
   *
   * Generation rules:
   * - Latin names: lowercased, spaces and special chars replaced with hyphens
   * Pure-Chinese names (empty Latin slug) fall back to a full-pinyin slug, ensuring non-empty
   *
   * Examples: a pure-Chinese name -> ce-shi-gong-cheng, "My Project" -> my-project
   */
  private generateProjectId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (slug) {
      return slug;
    }
    // Pure-Chinese / non-Latin names: generate the slug from full pinyin (e.g. a Chinese name -> ce-shi-gong-cheng)
    const py = pinyin(name, { toneType: 'none', type: 'array' })
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return py;
  }

  /**
   * Resolve the final projectId: user-provided values are validated for uniqueness (conflicts throw); blank values are auto-generated with a numeric suffix appended on conflict.
   */
  private resolveUniqueProjectId(userProjectId: string | undefined, projectName: string): string {
    const existingProjectIds = new Set(this.scanProjects().map((p) => p.projectId));

    if (userProjectId) {
      if (existingProjectIds.has(userProjectId)) {
        throw new BadRequestException(`项目代码 "${userProjectId}" 已存在`);
      }
      return userProjectId;
    }

    const base = this.generateProjectId(projectName);
    if (!existingProjectIds.has(base)) {
      return base;
    }
    let n = 2;
    while (existingProjectIds.has(`${base}${n}`)) {
      n++;
    }
    return `${base}${n}`;
  }

  private scanProjects(options?: { includeDisabled?: boolean }): Project[] {
    const includeDisabled = options?.includeDisabled ?? false;
    const projectsDir = this.getProjectsDir();
    if (!fs.existsSync(projectsDir)) {
      return [];
    }

    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const projects: Project[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip hidden files (e.g. the non-project directory containing .default-project.json)
      if (entry.name.startsWith('.')) continue;

      const infoPath = path.join(projectsDir, entry.name, PROJECT_INFO_FILE);
      if (fs.existsSync(infoPath)) {
        try {
          // entry.name is the directory name, equal to projectId after migration
          const project = this.readProjectInfo(entry.name);
          // Disabled projects are excluded by default (skips enabled=false when includeDisabled=false)
          if (!includeDisabled && !project.enabled) continue;
          projects.push(project);
        } catch (err) {
          this.logger.warn(
            `Failed to read project info for ${entry.name}: ${(err as Error).message}`,
          );
        }
      }
    }

    projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return projects;
  }

  async create(createProjectDto: CreateProjectDto, userId: string): Promise<Project> {
    this.ensureProjectsDir();

    const projectName = createProjectDto.projectName.trim();
    if (!projectName) {
      throw new BadRequestException('项目名称不能为空');
    }

    // Project names must be globally unique (same names forbidden even with different projectIds)
    const existingProjects = this.scanProjects();
    if (existingProjects.some((p) => p.projectName === projectName)) {
      throw new BadRequestException(`项目名称 "${projectName}" 已存在`);
    }

    // projectId (project unique identifier + directory name): user-specified or auto-generated from projectName (full pinyin kebab-case)
    const projectId = this.resolveUniqueProjectId(createProjectDto.projectId?.trim(), projectName);
    if (!projectId) {
      throw new BadRequestException('项目 projectId 不能为空');
    }

    // Check whether projectId (the directory name) conflicts
    const projectDir = this.getProjectDir(projectId);
    if (fs.existsSync(projectDir)) {
      throw new BadRequestException(`项目 projectId "${projectId}" 已存在`);
    }

    // tenantId: multi-tenant reserved, currently = projectId
    const tenantId = createProjectDto.tenantId?.trim() || projectId;

    const now = new Date().toISOString();
    const project = new Project({
      projectId,
      tenantId,
      projectName,
      description: createProjectDto.description || '',
      version: createProjectDto.version?.trim() || '1.0.0',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      config: createProjectDto.config || {},
      projectPath: projectDir,
      databasePath: path.join(projectDir, 'db'),
      address: createProjectDto.address?.trim() || undefined,
      longitude: createProjectDto.longitude?.trim() || undefined,
      latitude: createProjectDto.latitude?.trim() || undefined,
      owner: createProjectDto.owner?.trim() || undefined,
      image: createProjectDto.image?.trim() || undefined,
      enabled: createProjectDto.enabled ?? false,
    });

    fs.mkdirSync(projectDir, { recursive: true });
    this.ensureProjectSubdirs(projectId);
    this.writeProjectInfo(project);

    // isolated mode: initialize the project-level database system.db
    if (this.projectDbService.getMode() === 'isolated') {
      await this.projectDbService.initProjectDatabases(projectId);
    }

    this.logger.log(`Project created: ${projectName} (projectId: ${projectId}) by user ${userId}`);
    this.eventBus.emit('project.created', { projectId, tenantId, projectName });
    return project;
  }

  async findAll(
    userId: string,
    query?: PaginationDto,
    includeDisabled = false,
  ): Promise<PaginatedResult<Project>> {
    const allProjects = this.scanProjects({ includeDisabled });
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const keyword = query?.keyword?.trim().toLowerCase();

    let filtered = allProjects;
    if (keyword) {
      filtered = allProjects.filter(
        (p) =>
          p.projectName.toLowerCase().includes(keyword) ||
          p.description.toLowerCase().includes(keyword),
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const data = filtered.slice(start, start + pageSize);

    // Compute page counts and folder sizes for each project on the current page (runtime stats, not written into projectinfo.json)
    // Compute only the current page (at most pageSize items), avoiding performance issues from full traversal
    await Promise.all(
      data.map(async (project) => {
        project.pageCount = await this.getPageCount(project.projectId);
        project.folderSize = await this.getProjectFolderSize(project.projectId);
      }),
    );

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(projectId: string, _userId: string): Promise<Project> {
    return this.readProjectInfo(projectId);
  }

  async update(
    projectId: string,
    updateProjectDto: UpdateProjectDto,
    userId: string,
  ): Promise<Project> {
    const project = this.readProjectInfo(projectId);

    if (updateProjectDto.projectName && updateProjectDto.projectName !== project.projectName) {
      throw new BadRequestException('项目名称不支持修改');
    }
    if (updateProjectDto.description !== undefined) {
      project.description = updateProjectDto.description;
    }
    if (updateProjectDto.version !== undefined) {
      project.version = updateProjectDto.version;
    }
    if (updateProjectDto.config !== undefined) {
      project.config = updateProjectDto.config;
    }
    if (updateProjectDto.address !== undefined) {
      project.address = updateProjectDto.address.trim() || undefined;
    }
    if (updateProjectDto.longitude !== undefined) {
      project.longitude = updateProjectDto.longitude.trim() || undefined;
    }
    if (updateProjectDto.latitude !== undefined) {
      project.latitude = updateProjectDto.latitude.trim() || undefined;
    }
    if (updateProjectDto.owner !== undefined) {
      project.owner = updateProjectDto.owner.trim() || undefined;
    }
    if (updateProjectDto.image !== undefined) {
      project.image = updateProjectDto.image.trim() || undefined;
    }

    // Enabled-state change: detect false->true / true->false, emit EventBus to notify the collection layer to start/stop dynamically
    let enabledChanged = false;
    if (updateProjectDto.enabled !== undefined && updateProjectDto.enabled !== project.enabled) {
      project.enabled = updateProjectDto.enabled;
      enabledChanged = true;
    }

    project.updatedBy = userId;
    project.updatedAt = new Date().toISOString();

    this.writeProjectInfo(project);
    this.logger.log(`Project updated: ${projectId} by user ${userId}`);

    // Dynamic start/stop: notify the collection layer immediately when enabled changes
    if (enabledChanged) {
      if (project.enabled) {
        this.eventBus.emit('project:enabled', { projectId });
        this.logger.log(`Project enabled: ${projectId} — collector will start acquiring`);
      } else {
        this.eventBus.emit('project:disabled', { projectId });
        this.logger.log(`Project disabled: ${projectId} — collector will stop acquiring`);
      }
    }

    return project;
  }

  /**
   * Decide whether a projectId is valid (kebab-case format: lowercase letters/digits/hyphens).
   */
  private isValidProjectId(projectId: string | undefined): boolean {
    return !!projectId && /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(projectId);
  }

  /**
   * Regenerate a single project's projectId (based on the project name's full pinyin kebab-case), ensuring uniqueness.
   * Used to fix GUID/Chinese projectIds in legacy projects.
   */
  regenerateProjectId(projectId: string): {
    projectId: string;
    projectName: string;
    oldProjectId: string;
    newProjectId: string;
    changed: boolean;
  } {
    const project = this.readProjectInfo(projectId);
    const oldProjectId = project.projectId || '';

    // Skip if the current projectId is already valid
    if (this.isValidProjectId(oldProjectId)) {
      return {
        projectId: project.projectId,
        projectName: project.projectName,
        oldProjectId,
        newProjectId: oldProjectId,
        changed: false,
      };
    }

    // Generate a unique projectId from the project name (excluding itself)
    const existingProjectIds = new Set(
      this.scanProjects()
        .filter((p) => p.projectId !== project.projectId)
        .map((p) => p.projectId),
    );

    const base = this.generateProjectId(project.projectName);
    let newProjectId = base;
    if (existingProjectIds.has(newProjectId)) {
      let n = 2;
      while (existingProjectIds.has(`${base}${n}`)) {
        n++;
      }
      newProjectId = `${base}${n}`;
    }

    project.projectId = newProjectId;
    this.writeProjectInfo(project);
    this.logger.log(
      `Project projectId migrated: ${projectId} "${oldProjectId}" -> "${newProjectId}"`,
    );

    return {
      projectId: project.projectId,
      projectName: project.projectName,
      oldProjectId,
      newProjectId,
      changed: true,
    };
  }

  /**
   * Batch-migrate all projects' projectIds: scan all projects and repair invalid (GUID/Chinese/missing) projectIds.
   * Only modifies the projectId field in projectinfo.json, without historical-data association updates.
   */
  migrateAllProjectIds(): {
    total: number;
    migrated: number;
    skipped: number;
    details: Array<{
      projectId: string;
      projectName: string;
      oldProjectId: string;
      newProjectId: string;
      changed: boolean;
    }>;
  } {
    const allProjects = this.scanProjects();
    const details: Array<{
      projectId: string;
      projectName: string;
      oldProjectId: string;
      newProjectId: string;
      changed: boolean;
    }> = [];

    for (const project of allProjects) {
      try {
        const result = this.regenerateProjectId(project.projectId);
        details.push(result);
      } catch (err) {
        this.logger.warn(
          `Failed to migrate projectId for ${project.projectId}: ${(err as Error).message}`,
        );
        details.push({
          projectId: project.projectId,
          projectName: project.projectName,
          oldProjectId: project.projectId || '',
          newProjectId: project.projectId || '',
          changed: false,
        });
      }
    }

    const migrated = details.filter((d) => d.changed).length;
    this.logger.log(`ProjectId migration complete: ${migrated}/${allProjects.length} migrated`);

    return {
      total: allProjects.length,
      migrated,
      skipped: allProjects.length - migrated,
      details,
    };
  }

  async remove(projectId: string, userId: string): Promise<void> {
    const project = this.readProjectInfo(projectId);
    const projectDir = this.getProjectDir(project.projectId);

    // Notify the global ProjectDatabaseService to close the database connections related to this project
    // Must run before deleting files, otherwise the SQLite file is still held, causing EBUSY
    await this.eventBus.emitAsync('project.beforeDelete', {
      projectId: project.projectId,
      tenantId: project.tenantId,
      timestamp: Date.now(),
    });

    // Then release this module's database connections (isolated mode)
    if (this.projectDbService.getMode() === 'isolated') {
      await this.projectDbService.deleteProjectDatabases(project.projectId);
    }

    fs.rmSync(projectDir, { recursive: true, force: true });
    this.logger.log(`Project deleted: ${project.projectId} by user ${userId}`);
  }

  /**
   * Upload a project cover image to the {projectId}/images/ directory, returning the relative path.
   * If the project already has an old cover image, uploading a new one auto-deletes the old file.
   */
  uploadProjectImage(projectId: string, buffer: Buffer, originalName: string): string {
    const project = this.readProjectInfo(projectId);
    const projectDir = this.getProjectDir(projectId);
    const imagesDir = path.join(projectDir, 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Delete the old cover image (if present)
    if (project.image) {
      const oldPath = path.join(projectDir, project.image);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch (err) {
          this.logger.warn(
            `Failed to delete old project image ${oldPath}: ${(err as Error).message}`,
          );
        }
      }
    }

    // Generate a safe file name: cover-{timestamp}.{ext}
    const ext = path.extname(originalName).toLowerCase() || '.png';
    const fileName = `cover-${Date.now()}${ext}`;
    const relativePath = `images/${fileName}`;
    const filePath = path.join(imagesDir, fileName);

    fs.writeFileSync(filePath, buffer);
    this.logger.log(
      `Project image uploaded: ${projectId}/${relativePath} (${buffer.length} bytes)`,
    );

    // Update the image field in projectinfo.json
    project.image = relativePath;
    this.writeProjectInfo(project);

    return relativePath;
  }

  /**
   * Get the project cover image's absolute path (for file-stream responses).
   */
  getProjectImagePath(projectId: string): string | null {
    const project = this.readProjectInfo(projectId);
    if (!project.image) {
      return null;
    }
    const filePath = path.join(this.getProjectDir(projectId), project.image);
    return fs.existsSync(filePath) ? filePath : null;
  }

  async exportProject(
    projectId: string,
    _userId: string,
    options?: { includePages?: boolean; includeProjectDb?: boolean; includeRtdb?: boolean },
  ): Promise<{ filePath: string; projectName: string }> {
    const project = this.readProjectInfo(projectId);
    const projectDir = this.getProjectDir(project.projectId);
    const tmpDir = os.tmpdir();
    const zipFileName = `${project.projectId}_${Date.now()}.zip`;
    const zipFilePath = path.join(tmpDir, zipFileName);

    // Selective export: include everything by default when no params are given (backward compatible)
    const includePages = options?.includePages ?? true;
    const includeProjectDb = options?.includeProjectDb ?? true;
    const includeRtdb = options?.includeRtdb ?? true;
    const isSelective = options !== undefined;

    // isolated mode and including the project database: VACUUM-compact the database before export
    if (
      includeProjectDb &&
      this.projectDbService.getMode() === 'isolated' &&
      this.projectDbService.hasDatabaseFiles(project.projectId)
    ) {
      await this.projectDbService.vacuumProjectDatabases(project.projectId);
    }

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        this.logger.log(
          `Project exported: ${project.projectId} -> ${zipFileName} (${archive.pointer()} bytes)` +
            (isSelective
              ? ` [selective: pages=${includePages}, db=${includeProjectDb}, rtdb=${includeRtdb}]`
              : ''),
        );
        resolve();
      });

      output.on('error', (err: Error) => {
        reject(err);
      });

      archive.on('error', (err: Error) => {
        reject(err);
      });

      archive.on('warning', (err: any) => {
        if (err?.code !== 'ENOENT') {
          this.logger.warn(
            `[Export ${project.projectId}] archiver warning: ${err?.message || err}`,
          );
        }
      });

      archive.pipe(output);

      // projectinfo.json is always included (required project metadata)
      const infoPath = this.getProjectInfoPath(project.projectId);
      if (fs.existsSync(infoPath)) {
        archive.file(infoPath, { name: PROJECT_INFO_FILE });
      }

      // Selectively add subdirectories
      if (includePages) {
        const pagesDir = path.join(projectDir, 'pages');
        if (fs.existsSync(pagesDir)) {
          archive.directory(pagesDir, 'pages');
        }
      }
      if (includeProjectDb) {
        const dbDir = path.join(projectDir, 'db');
        if (fs.existsSync(dbDir)) {
          // Exclude SQLite WAL/SHM temp files: these are locked at runtime,
          // and packing them causes export failure or an inconsistent database after import
          this.addDirToArchiveExcludingDbTemp(archive, dbDir, 'db');
        }
      }
      if (includeRtdb) {
        const rtdbDir = path.join(projectDir, 'rtdb');
        if (fs.existsSync(rtdbDir)) {
          archive.directory(rtdbDir, 'rtdb');
        }
      }
      // The template directory is always included (templates are basic project resources, small in size)
      const templateDir = path.join(projectDir, 'template');
      if (fs.existsSync(templateDir)) {
        archive.directory(templateDir, 'template');
      }

      archive.finalize();
    });

    return { filePath: zipFilePath, projectName: project.projectId };
  }

  /**
   * Add a directory to the archive, excluding SQLite WAL/SHM temp files.
   *
   * Exclusion reasons:
   * - .db-wal / .db-shm are SQLite WAL-mode runtime temp files
   * - On Windows these files may be locked by the database process, causing archiver read failures
   * - VACUUM has already merged WAL data into the main .db file; the temp files need no export
   * - Including them at import would leave the database in an inconsistent state
   */
  private addDirToArchiveExcludingDbTemp(
    archive: archiver.Archiver,
    dirPath: string,
    archiveName: string,
  ): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const archiveEntryName = `${archiveName}/${entry.name}`;
      if (entry.isDirectory()) {
        // Process subdirectories recursively
        this.addDirToArchiveExcludingDbTemp(archive, fullPath, archiveEntryName);
      } else if (entry.isFile()) {
        // Exclude SQLite WAL and SHM temp files
        if (entry.name.endsWith('.db-wal') || entry.name.endsWith('.db-shm')) {
          continue;
        }
        archive.file(fullPath, { name: archiveEntryName });
      }
    }
  }

  async exportProjectZip(
    projectId: string,
    userId: string,
    options?: { includePages?: boolean; includeProjectDb?: boolean; includeRtdb?: boolean },
  ): Promise<{ filePath: string; projectName: string; fileName: string }> {
    const result = await this.exportProject(projectId, userId, options);
    return { ...result, fileName: path.basename(result.filePath) };
  }

  async importProjectZip(
    zipBuffer: Buffer,
    userId: string,
    options?: { overwrite?: boolean },
  ): Promise<{ project: Project; warnings: string[] }> {
    const warnings: string[] = [];
    const tmpDir = path.join(os.tmpdir(), `project_import_${Date.now()}`);

    try {
      fs.mkdirSync(tmpDir, { recursive: true });

      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      if (entries.length === 0) {
        throw new BadRequestException('ZIP 文件为空');
      }

      const rootDirs = new Set<string>();
      for (const entry of entries) {
        if (entry.isDirectory) {
          rootDirs.add(entry.entryName);
          continue;
        }
        const parts = entry.entryName.split('/');
        if (parts.length >= 1 && parts[0]) {
          rootDirs.add(parts[0] + '/');
        }
      }

      if (rootDirs.size !== 1) {
        throw new BadRequestException('ZIP 文件格式不正确：应包含单个项目根目录');
      }

      let extractedDirName = '';
      for (const dir of rootDirs) {
        extractedDirName = dir.replace(/\/+$/, '').split('/')[0];
      }

      if (!extractedDirName) {
        throw new BadRequestException('无法从 ZIP 文件中解析项目名称');
      }

      // The ZIP root directory name participates in path joining; do segment-level validation first (rejecting .. / separators / drive letters etc.)
      this.projectFs.assertSafeSegment(extractedDirName, 'ZIP 根目录名');

      const hasProjectInfo = entries.some(
        (entry) =>
          !entry.isDirectory &&
          entry.entryName.replace(/\\/g, '/') === `${extractedDirName}/${PROJECT_INFO_FILE}`,
      );

      if (!hasProjectInfo) {
        throw new BadRequestException('ZIP 文件缺少 projectinfo.json，项目数据不完整');
      }

      // Safe extraction: validate each entry's extraction target lies inside the temp directory, eliminating Zip Slip (P0-2)
      this.projectFs.extractZipSafely(zip, tmpDir);
      const sourceDir = path.join(tmpDir, extractedDirName);
      if (!fs.existsSync(sourceDir)) {
        throw new BadRequestException('ZIP 文件解压后未找到项目目录');
      }

      // Read the projectId from the extracted projectinfo.json (legacy tid-field compatible)
      let projectId: string;
      let projectName: string;
      try {
        const infoRaw = JSON.parse(
          fs.readFileSync(path.join(sourceDir, PROJECT_INFO_FILE), 'utf-8'),
        );
        // Backward compatible: legacy ZIPs may contain tid rather than projectId; use tid as the directory name then
        projectId = infoRaw.projectId || infoRaw.tid || extractedDirName;
        projectName = infoRaw.projectName || infoRaw.name || projectId;
      } catch {
        projectId = extractedDirName;
        projectName = extractedDirName;
      }

      // The projectId comes from the ZIP's projectinfo.json (user-controlled); do segment-level validation first,
      // rejecting `..` / path separators / drive letters etc., preventing rmSync/copyDirSync from escaping the projects root (P0-2)
      this.projectFs.assertSafeSegment(projectId, 'projectId');

      this.ensureProjectsDir();
      const targetDir = this.getProjectDir(projectId);
      // Defense in depth: confirm the final target directory really lies within the projects root
      this.projectFs.assertPathWithin(this.getProjectsDir(), targetDir);
      const existsLocally = fs.existsSync(targetDir);

      if (existsLocally) {
        if (options?.overwrite) {
          // Release any existing database connections first
          if (this.projectDbService.getMode() === 'isolated') {
            await this.projectDbService.unloadProjectDatabases(projectId);
          }
          fs.rmSync(targetDir, { recursive: true, force: true });
          warnings.push(`已覆盖现有项目 "${projectName}" (projectId: ${projectId})`);
        } else {
          throw new BadRequestException(
            `项目 "${projectName}" (projectId: ${projectId}) 已存在。如需覆盖请确认。`,
          );
        }
      }

      this.copyDirSync(sourceDir, targetDir);
      this.ensureProjectSubdirs(projectId);

      // isolated mode: validate/rebuild the database after import
      if (this.projectDbService.getMode() === 'isolated') {
        if (!this.projectDbService.hasDatabaseFiles(projectId)) {
          await this.projectDbService.initProjectDatabases(projectId);
          warnings.push('导入的项目缺少数据库文件，已自动创建空数据库');
        }
      }

      const project = this.readProjectInfo(projectId);
      this.logger.log(
        `Project imported: ${projectName} (projectId: ${projectId}) by user ${userId}`,
      );
      this.eventBus.emit('project.created', { projectId, tenantId: project.tenantId, projectName });

      return { project, warnings };
    } finally {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  async findOrCreateDefault(userId: string): Promise<Project> {
    this.ensureProjectsDir();

    const defaultName = '默认项目';
    const defaultProjectId = 'default-project';

    // Scan all projects first, looking for the default project with projectId "default-project"
    const existing = this.scanProjects();
    const defaultProject = existing.find((p) => p.projectId === defaultProjectId);
    if (defaultProject) {
      return defaultProject;
    }

    // Compatible: check the legacy directory named after the Chinese default-project name
    const legacyDir = this.getProjectDir(defaultName);
    if (fs.existsSync(legacyDir)) {
      const infoPath = this.getProjectInfoPath(defaultName);
      if (fs.existsSync(infoPath)) {
        return this.readProjectInfo(defaultName);
      }
    }

    const now = new Date().toISOString();
    const projectDir = this.getProjectDir(defaultProjectId);
    const project = new Project({
      projectId: defaultProjectId,
      tenantId: defaultProjectId,
      projectName: defaultName,
      description: '系统自动创建的默认项目',
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      config: {},
      projectPath: projectDir,
      databasePath: path.join(projectDir, 'db'),
    });

    fs.mkdirSync(projectDir, { recursive: true });
    this.ensureProjectSubdirs(defaultProjectId);
    this.writeProjectInfo(project);

    // isolated mode: initialize the default project's database
    if (this.projectDbService.getMode() === 'isolated') {
      await this.projectDbService.initProjectDatabases(defaultProjectId);
    }

    this.logger.log(
      `Default project created: ${defaultName} (projectId: ${defaultProjectId}) by user ${userId}`,
    );
    this.eventBus.emit('project.created', {
      projectId: defaultProjectId,
      tenantId: defaultProjectId,
      projectName: defaultName,
    });
    return project;
  }

  /**
   * Get the user-configured default project ID (read from .default-project.json)
   * Returns null when not configured
   */
  getDefaultProjectId(): string | null {
    const filePath = path.join(this.getProjectsDir(), DEFAULT_PROJECT_FILE);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data.projectId || null;
    } catch {
      this.logger.warn(`Failed to parse ${DEFAULT_PROJECT_FILE}, ignoring`);
      return null;
    }
  }

  /**
   * Set the default project ID, writing .default-project.json
   * Validates that the project directory exists
   */
  setDefaultProjectId(projectId: string): void {
    this.ensureProjectsDir();
    const projectDir = this.getProjectDir(projectId);
    if (!fs.existsSync(projectDir)) {
      throw new NotFoundException(`项目 "${projectId}" 不存在，无法设为默认`);
    }
    const filePath = path.join(this.getProjectsDir(), DEFAULT_PROJECT_FILE);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ projectId, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
    this.logger.log(`Default project set to: ${projectId}`);
  }

  /**
   * Clear the default-project setting (deletes .default-project.json)
   */
  clearDefaultProjectId(): void {
    const filePath = path.join(this.getProjectsDir(), DEFAULT_PROJECT_FILE);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.log('Default project cleared');
    }
  }

  /**
   * Diagnose project resource integrity
   * Detects whether the directory structure, config files, and database files exist
   */
  async diagnoseProject(projectId: string): Promise<DiagnoseResult> {
    this.ensureProjectsDir();
    const projectDir = this.getProjectDir(projectId);

    if (!fs.existsSync(projectDir)) {
      throw new NotFoundException(`项目 "${projectId}" 不存在`);
    }

    const project = this.readProjectInfo(projectId);
    const resources: DiagnoseResources = {};
    const issues: string[] = [];

    // 1. projectinfo.json
    const infoPath = this.getProjectInfoPath(projectId);
    resources.projectinfo = {
      status: fs.existsSync(infoPath) ? 'ok' : 'missing',
      path: infoPath,
    };
    if (resources.projectinfo.status === 'missing') {
      issues.push('projectinfo.json 文件缺失');
    }

    // 2. Subdirectories
    for (const subdir of SUBDIRS) {
      const subdirPath = path.join(projectDir, subdir);
      const key = `${subdir}Dir` as keyof DiagnoseResources;
      resources[key] = {
        status: fs.existsSync(subdirPath) ? 'ok' : 'missing',
        path: subdirPath,
      };
      if (resources[key].status === 'missing') {
        issues.push(`子目录 ${subdir} 缺失`);
      }
    }

    // 3. Database files (isolated mode)
    const dbMode = this.projectDbService.getMode();
    if (dbMode === 'isolated') {
      const dbDir = path.join(projectDir, 'db');
      const systemDbPath = path.join(dbDir, 'system.db');

      resources.systemDb = await this.checkDbFile(systemDbPath);

      if (resources.systemDb.status === 'missing') {
        issues.push('system.db 数据库文件缺失');
      } else if (resources.systemDb.status === 'empty') {
        issues.push('system.db 已创建，暂无业务表（待实体迁移）');
      } else if (resources.systemDb.status === 'error') {
        issues.push('system.db 文件损坏，无法读取');
      }
    }

    // Health determination
    let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Database health: if the db/ directory exists and contains a valid system.db file, the database resources count as available
    const dbDirPath = path.join(projectDir, 'db');
    let hasAnyDbFile = false;
    let hasAnyDbOk = false;
    if (dbMode === 'isolated' && fs.existsSync(dbDirPath)) {
      const dbFiles = fs.readdirSync(dbDirPath).filter((f) => f.endsWith('.db'));
      for (const dbFile of dbFiles) {
        hasAnyDbFile = true;
        const dbFilePath = path.join(dbDirPath, dbFile);
        const fileStatus = await this.checkDbFile(dbFilePath);
        if (fileStatus.status === 'ok') {
          hasAnyDbOk = true;
          break;
        }
      }
    }

    const hasCriticalMissing =
      resources.projectinfo.status === 'missing' ||
      resources.dbDir.status === 'missing' ||
      (dbMode === 'isolated' && !hasAnyDbFile);
    const hasDegradedDb = dbMode === 'isolated' && hasAnyDbFile && !hasAnyDbOk;
    const hasNonCriticalMissing =
      resources.rtdbDir.status === 'missing' ||
      resources.templateDir.status === 'missing' ||
      resources.pagesDir.status === 'missing';

    if (hasCriticalMissing) {
      health = 'unhealthy';
    } else if (hasNonCriticalMissing || hasDegradedDb) {
      health = 'degraded';
    }

    return {
      projectName: project.projectName,
      projectId: project.projectId,
      tenantId: project.tenantId,
      resources,
      health,
      issues,
      dbMode,
    };
  }

  /**
   * Initialize a project's missing resources
   * Auto-creates missing subdirectories and database files
   */
  async initProjectResources(
    projectId: string,
    targetResources?: string[],
  ): Promise<{
    initialized: string[];
    skipped: string[];
    warnings: string[];
  }> {
    this.ensureProjectsDir();
    const projectDir = this.getProjectDir(projectId);

    if (!fs.existsSync(projectDir)) {
      throw new NotFoundException(`项目 "${projectId}" 不存在`);
    }

    const initialized: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    // Clean up invalid resources params (e.g. [undefined])
    const cleanResources = targetResources?.filter(Boolean);
    const initAll = !cleanResources || cleanResources.length === 0;

    // Initialize subdirectories
    if (initAll || cleanResources?.includes('subdirs')) {
      const existingSubdirs = SUBDIRS.filter((sd) => fs.existsSync(path.join(projectDir, sd)));
      const missingSubdirs = SUBDIRS.filter((sd) => !fs.existsSync(path.join(projectDir, sd)));

      for (const subdir of SUBDIRS) {
        if (existingSubdirs.includes(subdir)) {
          skipped.push(`${subdir}Dir`);
        } else {
          initialized.push(`${subdir}Dir`);
        }
      }

      this.ensureProjectSubdirs(projectId);

      if (missingSubdirs.length > 0) {
        this.logger.log(
          `Project "${projectId}": initialized missing subdirs: ${missingSubdirs.join(', ')}`,
        );
      }
    }

    // Initialize the database
    if (initAll || cleanResources?.includes('database')) {
      const dbMode = this.projectDbService.getMode();
      const dbDir = path.join(projectDir, 'db');
      const systemDbPath = path.join(dbDir, 'system.db');

      if (dbMode === 'isolated') {
        const needSystemDb = !fs.existsSync(systemDbPath);
        const forceRecreateSystemDb =
          !needSystemDb && (await this.checkDbFile(systemDbPath)).status !== 'ok';

        if (forceRecreateSystemDb) {
          // Database file exists but is empty or corrupted; delete then re-initialize
          fs.unlinkSync(systemDbPath);
          this.logger.log(
            `Project "${projectId}": removing broken/empty system.db for re-initialization`,
          );
        }

        if (needSystemDb || forceRecreateSystemDb) {
          try {
            await this.projectDbService.initProjectDatabases(projectId);
            if (needSystemDb || forceRecreateSystemDb) initialized.push('systemDb');
            this.logger.log(
              `Project "${projectId}": initialized system.db (need=${needSystemDb || forceRecreateSystemDb})`,
            );
          } catch (err: any) {
            warnings.push(`数据库初始化失败: ${err.message}`);
            this.logger.error(`Project "${projectId}": database init failed: ${err.message}`);
          }
        } else {
          skipped.push('systemDb');
        }
      } else {
        skipped.push('systemDb');
        if (initAll || cleanResources?.includes('database')) {
          warnings.push(`项目数据库模式为 ${dbMode}，跳过项目级数据库初始化`);
        }
      }
    }

    return { initialized, skipped, warnings };
  }

  /**
   * Get a project's page count (lightweight, only one readdir, used for getOverview aggregation)
   */
  async getPageCount(projectId: string): Promise<number> {
    const pagesDir = path.join(this.getProjectDir(projectId), 'pages');
    try {
      const entries = await fs.promises.readdir(pagesDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  /**
   * Recursively compute a directory's total size (bytes)
   * Async traversal, avoiding blocking the event loop
   */
  private async getDirSize(dirPath: string): Promise<number> {
    let total = 0;
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await this.getDirSize(fullPath);
        } else if (entry.isFile()) {
          try {
            const stat = await fs.promises.stat(fullPath);
            total += stat.size;
          } catch {
            // Skip inaccessible files (e.g. locked SQLite WAL/SHM temp files)
          }
        }
      }
    } catch {
      // Directory does not exist or is inaccessible
    }
    return total;
  }

  /**
   * Compute a project directory's total size (bytes, including all subdirectories: db/pages/rtdb/template/images etc.)
   * Used by the card view to show a project's disk usage
   */
  private async getProjectFolderSize(projectId: string): Promise<number> {
    const projectDir = this.getProjectDir(projectId);
    return this.getDirSize(projectDir);
  }

  /**
   * Get a single file's size (bytes)
   * Only stats one file, an O(1) lightweight operation, avoiding the recursive stat heavy path on the libuv thread pool.
   * Returns 0 when the file does not exist or is inaccessible (e.g. the project's db not yet initialized).
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  /**
   * Get project management info (page count, database size, times, etc.)
   */
  async getManageInfo(projectId: string): Promise<ManageInfo> {
    const project = this.readProjectInfo(projectId);
    const projectDir = this.getProjectDir(projectId);
    const dbDir = path.join(projectDir, 'db');
    const rtdbDir = path.join(projectDir, 'rtdb');
    const pagesDir = path.join(projectDir, 'pages');

    // Page count (async read, avoiding blocking the event loop)
    let pageCount = 0;
    try {
      const entries = await fs.promises.readdir(pagesDir, { withFileTypes: true });
      pageCount = entries.filter((e) => e.isDirectory()).length;
    } catch {
      pageCount = 0;
    }

    // Database size: stat the system.db under the db/ directory
    // Does not traverse the whole project directory tree (rtdb/ may hold massive real-time data files)
    const dbSize = await this.getFileSize(path.join(dbDir, 'system.db'));
    const rtdbSize = 0; // rtdb is computed on demand, not walked in the overview

    const dbMode = this.projectDbService.getMode();

    return {
      projectName: project.projectName,
      tenantId: project.tenantId,
      projectId: project.projectId,
      version: project.version || '1.0.0',
      description: project.description || '',
      projectPath: projectDir,
      databasePath: dbDir,
      rtdbPath: rtdbDir,
      pageCount,
      dbSize,
      rtdbSize,
      dbMode,
      image: project.image,
      address: project.address,
      longitude: project.longitude,
      latitude: project.latitude,
      owner: project.owner,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      createdBy: project.createdBy,
      updatedBy: project.updatedBy,
    };
  }

  /**
   * Get system-overview statistics (aggregated over all projects)
   * The backend aggregates device and alarm statistics uniformly; the frontend needs only one request.
   *
   * Performance protections:
   * - Per-project timeout of 10s; timed-out projects are skipped without blocking the whole
   * - At most 5 projects load concurrently, avoiding SQLite contention
   * - Full elapsed-time logging for bottleneck troubleshooting
   */
  async getOverview(): Promise<ProjectOverview> {
    const t0 = Date.now();
    this.logger.log(`[getOverview] ======== ENTER ========`);

    const tScan0 = Date.now();
    const projects = this.scanProjects();
    this.logger.log(
      `[getOverview] scanProjects done: ${projects.length} projects (${Date.now() - tScan0}ms)`,
    );

    let totalPageCount = 0;
    let totalDbSize = 0;
    let successCount = 0;
    let failCount = 0;
    let timeoutCount = 0;

    // Aggregate device statistics
    const deviceStats: DeviceStats = {
      total: 0,
      online: 0,
      offline: 0,
      connecting: 0,
      degraded: 0,
      error: 0,
      totalTags: 0,
    };
    // Aggregate alarm statistics
    let alarmTotal = 0;
    let alarmActive = 0;
    let alarmAcknowledged = 0;
    let alarmCleared = 0;
    let alarmShelved = 0;

    // Per-project timeout protection
    const PER_PROJECT_TIMEOUT_MS = 10_000;
    // Concurrency limit: avoids SQLite busyness from too many projects opening DB connections at once
    const CONCURRENCY = 5;

    const processProject = async (project: Project) => {
      const pt0 = Date.now();
      let phaseTimings = '';
      try {
        // Parallel execution + independent per-phase timing (keeping the concurrency benefit)
        const timed = async <T>(fn: () => Promise<T>): Promise<{ dur: number; result: T }> => {
          const t = Date.now();
          const result = await fn();
          return { dur: Date.now() - t, result };
        };
        const result = await Promise.race([
          (async () => {
            const t1 = Date.now();
            // Fetch pageCount / device stats / alarm stats / system.db file size in parallel.
            // Note: only stat the single system.db file (O(1) lightweight), never recursively walk the rtdb tree --
            // getManageInfo's internal getDirSize recursively stats the massive files under rtdb (300MB+ possible),
            // which among 5 concurrent workers saturates the libuv thread pool and delays setTimeout by 10s+.
            // So rtdb size is still not computed here; it is fetched on demand by getManageInfo on the project detail page.
            const [pageCount, devTimed, almTimed, dbSize] = await Promise.all([
              this.getPageCount(project.projectId),
              timed(() => this.deviceService.getDeviceStats(project.projectId)),
              timed(() => this.alarmStatsService.getStatistics(project.projectId)),
              // Only stat the single system.db file (O(1)), never recursing the rtdb directory, avoiding libuv thread-pool saturation
              this.getFileSize(path.join(this.getProjectDir(project.projectId), 'db', 'system.db')),
            ]);
            phaseTimings = `pages=${Date.now() - t1}ms device=${devTimed.dur}ms alarm=${almTimed.dur}ms db=${dbSize}B`;
            return {
              pageCount,
              devStats: devTimed.result,
              almStats: almTimed.result,
              dbSize,
            };
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT')), PER_PROJECT_TIMEOUT_MS),
          ),
        ]);
        const elapsed = Date.now() - pt0;
        successCount++;
        this.logger.log(
          `[getOverview] ${project.projectId}: OK ${phaseTimings} total=${elapsed}ms`,
        );

        totalPageCount += result.pageCount;
        totalDbSize += result.dbSize;

        const { devStats, almStats } = result;
        deviceStats.total += devStats.total;
        deviceStats.online += devStats.online;
        deviceStats.offline += devStats.offline;
        deviceStats.connecting += devStats.connecting;
        deviceStats.degraded += devStats.degraded;
        deviceStats.error += devStats.error;
        deviceStats.totalTags += devStats.totalTags;

        alarmTotal += almStats.total;
        alarmActive += almStats.active;
        alarmAcknowledged += almStats.acknowledged;
        alarmCleared += almStats.cleared;
        alarmShelved += almStats.shelved;
      } catch (err) {
        const elapsed = Date.now() - pt0;
        if ((err as Error).message === 'TIMEOUT') {
          timeoutCount++;
          this.logger.warn(
            `[getOverview] ${project.projectId}: TIMEOUT after ${elapsed}ms (>${PER_PROJECT_TIMEOUT_MS}ms)`,
          );
        } else {
          failCount++;
          this.logger.warn(
            `[getOverview] ${project.projectId}: FAIL after ${elapsed}ms — ${(err as Error).message}`,
          );
        }
      }
    };

    // Rate-limited concurrent execution
    this.logger.log(
      `[getOverview] starting ${CONCURRENCY} workers for ${projects.length} projects...`,
    );
    const tWorkers0 = Date.now();
    const queue = [...projects];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const project = queue.shift()!;
        await processProject(project);
      }
    });
    await Promise.all(workers);
    const tWorkers = Date.now() - tWorkers0;

    const totalElapsed = Date.now() - t0;
    this.logger.log(
      `[getOverview] ======== EXIT ========` +
        ` projects=${projects.length} success=${successCount} fail=${failCount} timeout=${timeoutCount}` +
        ` | workers=${tWorkers}ms total=${totalElapsed}ms` +
        ` | devices=${deviceStats.total}(on=${deviceStats.online} off=${deviceStats.offline} err=${deviceStats.error})` +
        ` | alarms=${alarmTotal}(active=${alarmActive} ack=${alarmAcknowledged})` +
        ` | dbSize=${totalDbSize}B pages=${totalPageCount}`,
    );

    return {
      projectCount: projects.length,
      totalDbSize,
      totalPageCount,
      deviceStats,
      alarmStats: {
        total: alarmTotal,
        active: alarmActive,
        acknowledged: alarmAcknowledged,
        cleared: alarmCleared,
        shelved: alarmShelved,
      },
    };
  }

  /**
   * Detect the database file's state (three-layer detection: file exists -> size -> SQLite magic number)
   *
   * Uses the file-header magic number ("SQLite format 3\0") for detection, avoiding the better-sqlite3 native dependency.
   * Does not check table counts, because a database with empty tables is still a valid SQLite file, and Phase 2 entity migration will auto-create tables.
   */
  private async checkDbFile(dbPath: string): Promise<ResourceStatus> {
    if (!fs.existsSync(dbPath)) {
      return { status: 'missing', path: dbPath };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dbPath);
    } catch {
      return { status: 'error', path: dbPath };
    }
    if (stat.size < 100) {
      // SQLite file too small (a valid database contains at least the 100-byte header)
      return { status: 'empty', path: dbPath, size: stat.size };
    }
    try {
      // Read the SQLite file-header magic number: "SQLite format 3\0" (16 bytes)
      const fd = fs.openSync(dbPath, 'r');
      const header = Buffer.alloc(16);
      fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);

      const magic = header.toString('utf8', 0, 16);
      if (magic.startsWith('SQLite format 3')) {
        return { status: 'ok', path: dbPath, size: stat.size };
      }
      return { status: 'error', path: dbPath, size: stat.size };
    } catch {
      // File exists with a reasonable size, but cannot be opened with 'r' to read the magic number --
      // on Windows, when the SQLite file is exclusively locked by the current backend process (better-sqlite3/TypeORM),
      // fs.openSync throws EBUSY/EPERM.
      // Since that file is exactly the valid database created and maintained by this project's code,
      // "locked but existing and non-empty" is treated as valid here (status: 'ok'),
      // avoiding a false corruption report that would make diagnostics show "initialize missing resources".
      return { status: 'ok', path: dbPath, size: stat.size };
    }
  }
}

/** Diagnostic result type */
export interface DiagnoseResources {
  projectinfo?: ResourceStatus;
  dbDir?: ResourceStatus;
  rtdbDir?: ResourceStatus;
  pagesDir?: ResourceStatus;
  templateDir?: ResourceStatus;
  systemDb?: ResourceStatus;
}

export interface ResourceStatus {
  status: 'ok' | 'missing' | 'error' | 'empty';
  path: string;
  size?: number;
}

export interface DiagnoseResult {
  projectName: string;
  projectId: string;
  tenantId: string;
  resources: DiagnoseResources;
  health: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  dbMode: string;
}

/** Aggregated alarm statistics */
export interface AggregatedAlarmStats {
  total: number;
  active: number;
  acknowledged: number;
  cleared: number;
  shelved: number;
}

/** System-overview statistics */
export interface ProjectOverview {
  /** Total project count */
  projectCount: number;
  /** Total size of all projects' databases (bytes) */
  totalDbSize: number;
  /** Total page count across all projects */
  totalPageCount: number;
  /** Aggregated device statistics (summed over all projects) */
  deviceStats: DeviceStats;
  /** Aggregated alarm statistics (summed over all projects) */
  alarmStats: AggregatedAlarmStats;
}

/** Project management info */
export interface ManageInfo {
  projectName: string;
  tenantId: string;
  projectId: string;
  version: string;
  description: string;
  projectPath: string;
  databasePath: string;
  rtdbPath: string;
  pageCount: number;
  dbSize: number;
  rtdbSize: number;
  dbMode: string;
  image?: string;
  address?: string;
  longitude?: string;
  latitude?: string;
  owner?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}
