// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChildProcess, spawn, exec } from 'child_process';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { BaseServiceEntity } from './base-service.entity';
import { CreateBaseServiceDto, UpdateBaseServiceDto } from './base-service.dto';

/**
 * Service run status
 */
export interface ServiceStatus {
  id: string;
  name: string;
  displayName: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  pid?: number;
  port?: number;
  portReachable: boolean;
  processRunning: boolean;
  startedAt?: Date;
  uptimeSeconds?: number;
  binaryExists: boolean;
  configExists: boolean;
  dataDirExists: boolean;
  logDirExists: boolean;
  autoStart: boolean;
  processGuard: boolean;
  lastError?: string;
}

/**
 * Start/stop operation result
 */
export interface ServiceActionResult {
  success: boolean;
  name: string;
  action: 'start' | 'stop' | 'restart';
  pid?: number;
  message: string;
  durationMs: number;
}

/** InfluxDB setup status */
export interface InfluxSetupStatus {
  /** Whether InfluxDB is reachable */
  reachable: boolean;
  /** Whether initialization has been completed (false = setup needs to run) */
  initialized: boolean;
  /** Whether the currently configured TOKEN is empty */
  tokenConfigured: boolean;
}

/** InfluxDB initialization result */
export interface InfluxSetupResult {
  success: boolean;
  message: string;
  token?: string;
  org?: string;
  bucket?: string;
  details?: Record<string, any>;
}

/** InfluxDB health status */
export interface InfluxHealthStatus {
  /** Overall health status: healthy / degraded / unhealthy */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** InfluxDB version number */
  version?: string;
  /** Commit hash */
  commit?: string;
  /** Check duration (ms) */
  responseTimeMs?: number;
  /** Error message */
  error?: string;
}

/** InfluxDB Bucket */
export interface InfluxBucket {
  id: string;
  name: string;
  orgID?: string;
  description?: string;
  retentionPeriodHrs?: number;
  storageBytes?: number;
  createdAt?: string;
  updatedAt?: string;
  /** Measurement count */
  measurementCount?: number;
  /** Last write time (ISO string) */
  lastWriteAt?: string;
  /** Total data points (approximate) */
  dataPointCount?: number;
}

/** InfluxDB environment configuration */
export interface InfluxConfig {
  url: string;
  org: string;
  bucket: string;
  tokenConfigured: boolean;
  tokenMasked: string;
}

/** NanoMQ MQTT health status */
export interface NanomqHealthStatus {
  /** Whether the MQTT port is reachable */
  reachable: boolean;
  /** Check duration (ms) */
  responseTimeMs?: number;
  /** Error message */
  error?: string;
}

/** Log entry */
export interface LogEntry {
  filename: string;
  size: number;
  modifiedAt: Date;
  lines: string[];
  totalLines: number;
}

/** Service runtime record */
interface RuntimeRecord {
  pid?: number;
  startedAt?: Date;
  childProcess?: ChildProcess;
}

/** Timeout for waiting for the port to be ready at startup (ms) */
const START_TIMEOUT_MS = 15000;
/** Timeout for waiting for the process to exit on stop (ms) */
const STOP_TIMEOUT_MS = 5000;
/** Max lines read per log fetch */
const LOG_MAX_LINES = 500;
/** Config file max size (1MB) */
const CONFIG_MAX_SIZE = 1024 * 1024;
/** Number of log rotations to keep */
const LOG_BACKUP_KEEP = 5;

@Injectable()
export class BaseServicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaseServicesService.name);
  /** Runtime state (in-memory PID records) */
  private readonly runtimes = new Map<string, RuntimeRecord>();
  /** Process-guard timer */
  private processGuardTimer: ReturnType<typeof setInterval> | null = null;
  /** Process-guard check interval (ms), default 30 seconds */
  private readonly PROCESS_GUARD_INTERVAL_MS = 30000;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(BaseServiceEntity)
    private readonly serviceRepo: Repository<BaseServiceEntity>,
    private readonly pathResolver: PathResolverService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Sync the default service configuration (empty table: full write; non-empty table: upsert from env vars)
    await this.syncDefaultServices();
    // Auto-start services marked autoStart
    await this.autoStartServices();
    // Start the process guard (periodically checks processGuard services)
    this.startProcessGuardian();
  }

  onModuleDestroy(): void {
    this.stopProcessGuardian();
  }

  // ==================== Default service sync ====================

  /**
   * Get the absolute path of the ss-services/ss-node project root
   *
   * Relative-path baselines:
   * - dev mode: go up 4 levels from __dirname = ss-services/ss-node
   *   (this file lives in packages/ss-system/dist/base-services/)
   *   relative paths configured in .env (e.g. ../../ss-run/ss/base_services) resolve against ss-services/ss-node
   * - production mode: process.cwd() = ss-run/ss/services/ss-node
   *   relative paths in .env resolve against that directory
   *
   * Fix history:
   * - Before v1.5, only __dirname was used without distinguishing prod; in prod, __dirname sits in
   *   node_modules/@ss-node/ss-system/dist/base-services/, so 4 levels up lands in node_modules/ (wrong)
   * - Now kept consistent with app.module.ts getDatabaseConfig() and backup.service.ts getProjectRoot()
   */
  private getProjectRoot(): string {
    return this.pathResolver.getProjectRoot();
  }

  /**
   * Resolve a path to an absolute path.
   * - Absolute paths: returned as-is
   * - Relative paths: resolved to an absolute path against the project root (ss-services/ss-node)
   *
   * This way the DB always stores absolute paths; fs.existsSync() and spawn() calls
   * no longer depend on process.cwd(), ensuring consistency across restarts.
   */
  private resolveAbsolutePath(p: string | undefined): string | undefined {
    if (!p) return undefined;
    return this.pathResolver.resolve(p);
  }

  /** Default service configuration definitions (env vars take precedence, BASE_SERVICES_DIR as fallback) */
  private getDefaultServiceDefs(): Array<{
    envPrefix: string;
    defaults: Partial<BaseServiceEntity>;
    startArgs: string;
  }> {
    // If BASE_SERVICES_DIR is not configured in env vars, compute the default path by mode:
    // - prod：SS_NODE_ROOT = ss-run/ss/services/ss-node/ → ../../base_services
    // - dev： SS_NODE_ROOT = ss-services/ss-node/       → ../../ss-run/ss/base_services
    // Both ultimately resolve to ss-run/ss/base_services/
    const isProduction = process.env.NODE_ENV === 'production';
    const defaultBaseDir = isProduction
      ? path.join('..', '..', 'base_services')
      : path.join('..', '..', 'ss-run', 'ss', 'base_services');

    const rawBaseDir =
      this.configService.get<string>('BASE_SERVICES_DIR') ||
      defaultBaseDir;
    // BASE_SERVICES_DIR may be a relative path (.env's ../../ss-run/ss/base_services),
    // it must be resolved to an absolute path before joining sub-paths, otherwise the DB-stored path changes with process.cwd()
    const baseDir = this.resolveAbsolutePath(rawBaseDir)!;
    // Nginx lives in ss-run/ss/web/nginx/, a sibling of base_services
    const nginxDir = path.join(baseDir, '..', 'web', 'nginx');

    return [
      {
        envPrefix: 'REDIS',
        defaults: {
          name: 'redis',
          displayName: 'Redis',
          description: 'Redis 缓存服务',
          binaryPath: path.join(baseDir, 'redis', 'redis-server.exe'),
          configPath: path.join(baseDir, 'redis', 'redis.conf'),
          dataDir: path.join(baseDir, 'redis', 'data'),
          logDir: path.join(baseDir, 'redis', 'logs'),
          processName: 'redis-server.exe',
          port: Number(this.configService.get<string>('REDIS_PORT')) || 6379,
          startScript: '',
          stopScript: '',
          enabled: true,
          autoStart: false,
          sortOrder: 1,
        },
        startArgs: 'redis.conf',
      },
      {
        envPrefix: 'INFLUXDB',
        defaults: {
          name: 'influxdb',
          displayName: 'InfluxDB',
          description: 'InfluxDB 时序数据库',
          binaryPath: path.join(baseDir, 'influxdb2-2.7.8', 'influxd.exe'),
          configPath: path.join(baseDir, 'influxdb2-2.7.8', 'config.yaml'),
          dataDir: path.join(baseDir, 'influxdb2-2.7.8', 'data'),
          logDir: path.join(baseDir, 'influxdb2-2.7.8', 'logs'),
          processName: 'influxd.exe',
          port: 8086,
          startScript: '',
          stopScript: '',
          enabled: true,
          autoStart: false,
          sortOrder: 2,
        },
        startArgs: '',
      },
      {
        envPrefix: 'INFLUXDB3',
        defaults: {
          name: 'influxdb3',
          displayName: 'InfluxDB 3 Core',
          description: 'InfluxDB 3 Core 时序数据库（多引擎存储适配）',
          binaryPath: path.join(baseDir, 'influxdb3-3.11.2', 'influxdb3.exe'),
          configPath: '',
          dataDir: path.join(baseDir, 'influxdb3-3.11.2', 'data'),
          logDir: path.join(baseDir, 'influxdb3-3.11.2', 'logs'),
          processName: 'influxdb3.exe',
          port: Number(this.configService.get<string>('INFLUXDB3_PORT')) || 8181,
          startScript: '',
          stopScript: '',
          enabled: true,
          autoStart: false,
          sortOrder: 5,
        },
        // cwd is the binary's directory; --data-dir data is relative to it (consistent with dataDir)
        startArgs: 'serve --node-id ss-node --object-store file --data-dir data',
      },
      {
        envPrefix: 'NANOMQ',
        defaults: {
          name: 'nanomq',
          displayName: 'NanoMQ',
          description: 'NanoMQ MQTT 消息代理',
          binaryPath: path.join(baseDir, 'nanomq', 'bin', 'nanomq.exe'),
          configPath: path.join(baseDir, 'nanomq', 'etc', 'nanomq.conf'),
          dataDir: path.join(baseDir, 'nanomq', 'data'),
          logDir: path.join(baseDir, 'nanomq', 'logs'),
          processName: 'nanomq.exe',
          port: Number(this.configService.get<string>('NANOMQ_PORT')) || 1883,
          startScript: '',
          stopScript: '',
          enabled: true,
          autoStart: false,
          sortOrder: 3,
        },
        startArgs: 'start',
      },
      {
        envPrefix: 'NGINX',
        defaults: {
          name: 'nginx',
          displayName: 'Nginx',
          description: 'Nginx Web 服务（前端静态资源 + API 代理）',
          binaryPath: path.join(nginxDir, 'nginx.exe'),
          configPath: path.join(nginxDir, 'conf', 'nginx.conf'),
          dataDir: path.join(nginxDir, 'html'),
          logDir: path.join(nginxDir, 'logs'),
          processName: 'nginx.exe',
          port: Number(this.configService.get<string>('NGINX_PORT')) || 8800,
          startScript: '',
          stopScript: '',
          enabled: true,
          autoStart: false,
          sortOrder: 4,
        },
        startArgs: '',
      },
    ];
  }

  /**
   * Read service paths from env vars; env vars take precedence over defaults.
   *
   * Env var mapping:
   *   {PREFIX}_BINARY_PATH  → binaryPath
   *   {PREFIX}_CONFIG_PATH  → configPath
   *   {PREFIX}_DATA_DIR     → dataDir
   *   {PREFIX}_LOG_DIR      → logDir
   *
   * All paths go through resolveAbsolutePath, ensuring the DB stores absolute paths.
   * This avoids fs.existsSync() resolution failures caused by different process.cwd()
   * (e.g. when started via pnpm --filter, cwd is apps/ss-node-server).
   */
  private resolveServicePaths(
    envPrefix: string,
    defaults: Partial<BaseServiceEntity>,
  ): Partial<BaseServiceEntity> {
    const result = { ...defaults };

    const envBinaryPath = this.configService.get<string>(`${envPrefix}_BINARY_PATH`);
    const envConfigPath = this.configService.get<string>(`${envPrefix}_CONFIG_PATH`);
    const envDataDir = this.configService.get<string>(`${envPrefix}_DATA_DIR`);
    const envLogDir = this.configService.get<string>(`${envPrefix}_LOG_DIR`);

    // Env vars take precedence; absolute or relative, all paths are uniformly resolved to absolute paths before storing in the DB
    if (envBinaryPath) result.binaryPath = this.resolveAbsolutePath(envBinaryPath);
    if (envConfigPath) result.configPath = this.resolveAbsolutePath(envConfigPath);
    if (envDataDir) result.dataDir = this.resolveAbsolutePath(envDataDir);
    if (envLogDir) result.logDir = this.resolveAbsolutePath(envLogDir);

    return result;
  }

  /**
   * Sync default services into the DB (v1.1 — env-var association + upsert)
   * - Empty table: write all default services
   * - Non-empty table: upsert each default service (insert if missing, update fields if present)
   */
  async syncDefaultServices(): Promise<void> {
    const count = await this.serviceRepo.count();
    const defs = this.getDefaultServiceDefs();

    if (count === 0) {
      // Empty table: full write
      for (const { defaults, envPrefix, startArgs } of defs) {
        const resolved = this.resolveServicePaths(envPrefix, defaults);
        const entity = this.serviceRepo.create({
          ...resolved,
          startArgs: startArgs || undefined,
        });
        await this.serviceRepo.save(entity);
      }
      this.logger.log(`Initialized ${defs.length} default base services (empty DB)`);
      return;
    }

    // Non-empty table: upsert
    let synced = 0;
    for (const { defaults, envPrefix, startArgs } of defs) {
      const name = defaults.name;
      if (!name) continue;

      const resolved = this.resolveServicePaths(envPrefix, defaults);
      const existing = await this.serviceRepo.findOne({ where: { name } });

      if (!existing) {
        // Missing: insert
        const entity = this.serviceRepo.create({
          ...resolved,
          startArgs: startArgs || undefined,
        });
        await this.serviceRepo.save(entity);
        synced++;
        this.logger.log(`Inserted missing default service: ${name}`);
      } else {
        // Present: update path fields (keep user-configured enabled/autoStart etc. unchanged)
        const fieldsToSync: (keyof BaseServiceEntity)[] = [
          'binaryPath',
          'configPath',
          'dataDir',
          'logDir',
          'processName',
          'port',
          'displayName',
          'description',
        ];
        let updated = false;
        for (const field of fieldsToSync) {
          const newVal = resolved[field];
          if (newVal !== undefined && newVal !== existing[field]) {
            (existing as any)[field] = newVal;
            updated = true;
          }
        }
        // Sync startArgs (only when the default is non-empty or the user has not set it)
        if (startArgs && existing.startArgs !== startArgs) {
          existing.startArgs = startArgs;
          updated = true;
        }
        if (updated) {
          await this.serviceRepo.save(existing);
          synced++;
          this.logger.log(`Synced default service: ${name}`);
        }
      }
    }

    if (synced > 0) {
      this.logger.log(`Default services synced: ${synced} items inserted/updated`);
    }
  }

  /** Auto-start services marked autoStart */
  private async autoStartServices(): Promise<void> {
    const autoStartServices = await this.serviceRepo.find({
      where: { autoStart: true, enabled: true },
    });
    for (const svc of autoStartServices) {
      try {
        const result = await this.start(svc.name);
        if (result.success) {
          this.logger.log(`Auto-started service: ${svc.name}`);
        } else {
          this.logger.warn(`Auto-start failed for ${svc.name}: ${result.message}`);
        }
      } catch (err: any) {
        this.logger.warn(`Auto-start error for ${svc.name}: ${err.message}`);
      }
    }
  }

  // ==================== Process guard ====================

  /** Start the process-guard timer */
  private startProcessGuardian(): void {
    if (this.processGuardTimer) return;
    this.logger.log(`Process guardian started, interval=${this.PROCESS_GUARD_INTERVAL_MS}ms`);
    this.processGuardTimer = setInterval(() => {
      this.checkAndGuardProcesses();
    }, this.PROCESS_GUARD_INTERVAL_MS);
  }

  /** Stop the process-guard timer */
  private stopProcessGuardian(): void {
    if (this.processGuardTimer) {
      clearInterval(this.processGuardTimer);
      this.processGuardTimer = null;
      this.logger.log('Process guardian stopped');
    }
  }

  /**
   * Process-guard check: inspects processGuard=true services and auto-starts them when the process is missing
   */
  private async checkAndGuardProcesses(): Promise<void> {
    const guardedServices = await this.serviceRepo.find({
      where: { processGuard: true, enabled: true },
    });

    for (const svc of guardedServices) {
      try {
        // Check the runtime record: whether a started process still exists
        const rt = this.runtimes.get(svc.name);
        if (rt?.pid) {
          // Runtime record exists; prefer PID detection (P1 optimization: avoids blocking tasklist exec)
          const alive = this.isPidAlive(rt.pid);
          if (alive) continue; // process alive, skip
          // Process is dead; clean up the old record
          this.runtimes.delete(svc.name);
        }

        // Double check: only use tasklist when there is a processName but no PID (P1 optimization: fallback only)
        if (!rt?.pid && svc.processName) {
          const running = await this.isProcessRunning(svc.processName);
          if (running) {
            // Recoverable: runtime record lost but the process exists; log at debug
            this.logger.debug(`Process guard: ${svc.name} running without runtime record`);
            continue;
          }
        }

        // Auto-start
        this.logger.warn(`Process guard: restarting ${svc.name} (${svc.displayName})`);
        const result = await this.start(svc.name);
        if (result.success) {
          this.logger.log(`Process guard: ${svc.name} restarted (PID=${result.pid})`);
        } else {
          this.logger.error(`Process guard: ${svc.name} restart failed: ${result.message}`);
        }
      } catch (err: any) {
        // If it is a ConflictException (process already running), the guard detection is working correctly
        if (err instanceof ConflictException) {
          this.logger.debug(`Process guard: ${svc.name} already running (conflict)`);
        } else {
          this.logger.error(`Process guard: ${svc.name} error: ${err.message}`);
        }
      }
    }
  }

  // ==================== CRUD operations ====================

  /** Get all service configurations */
  async findAll(): Promise<BaseServiceEntity[]> {
    return this.serviceRepo.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  /** Get a service configuration by name */
  async findByName(name: string): Promise<BaseServiceEntity> {
    const svc = await this.serviceRepo.findOne({ where: { name } });
    if (!svc) throw new NotFoundException(`基础服务不存在: ${name}`);
    return svc;
  }

  /** Create a new service */
  async create(dto: CreateBaseServiceDto): Promise<BaseServiceEntity> {
    const existing = await this.serviceRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`服务名称已存在: ${dto.name}`);
    }

    const entity = this.serviceRepo.create({
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description,
      binaryPath: dto.binaryPath,
      startArgs: dto.startArgs,
      configPath: dto.configPath,
      logDir: dto.logDir,
      dataDir: dto.dataDir,
      processName: dto.processName,
      port: dto.port ?? 0,
      startScript: dto.startScript,
      stopScript: dto.stopScript,
      enabled: dto.enabled ?? true,
      autoStart: dto.autoStart ?? false,
      processGuard: dto.processGuard ?? false,
      sortOrder: dto.sortOrder ?? 0,
    });

    const saved = await this.serviceRepo.save(entity);
    this.logger.log(`Created base service: ${dto.name}`);
    return saved;
  }

  /** Update a service configuration */
  async update(name: string, dto: UpdateBaseServiceDto): Promise<BaseServiceEntity> {
    const svc = await this.findByName(name);
    Object.assign(svc, dto);
    const saved = await this.serviceRepo.save(svc);
    this.logger.log(`Updated base service: ${name}`);
    return saved;
  }

  /** Delete a service */
  async remove(name: string): Promise<void> {
    const svc = await this.findByName(name);
    // If the service is running, stop it first
    const runtime = this.runtimes.get(name);
    if (runtime?.pid) {
      try {
        await this.stop(name);
      } catch {
        // Ignore stop errors
      }
    }
    await this.serviceRepo.remove(svc);
    this.logger.log(`Deleted base service: ${name}`);
  }

  // ==================== Status query ====================

  /** Get the status of all services */
  async getAllStatus(): Promise<ServiceStatus[]> {
    const services = await this.findAll();
    const results: ServiceStatus[] = [];
    for (const svc of services) {
      if (!svc.enabled) {
        results.push({
          id: svc.id,
          name: svc.name,
          displayName: svc.displayName,
          status: 'unknown',
          portReachable: false,
          processRunning: false,
          binaryExists: !!svc.binaryPath && fs.existsSync(svc.binaryPath),
          configExists: !!svc.configPath && fs.existsSync(svc.configPath),
          dataDirExists: !!svc.dataDir && fs.existsSync(svc.dataDir),
          logDirExists: !!svc.logDir && fs.existsSync(svc.logDir),
          autoStart: svc.autoStart,
          processGuard: svc.processGuard,
        });
        continue;
      }
      results.push(await this.getStatus(svc.name));
    }
    return results;
  }

  /** Get a single service's status */
  async getStatus(name: string): Promise<ServiceStatus> {
    const svc = await this.findByName(name);
    const runtime = this.runtimes.get(name) || {};

    const binaryExists = !!svc.binaryPath && fs.existsSync(svc.binaryPath);
    const configExists = !!svc.configPath && fs.existsSync(svc.configPath);
    const dataDirExists = !!svc.dataDir && fs.existsSync(svc.dataDir);
    const logDirExists = !!svc.logDir && fs.existsSync(svc.logDir);

    // Detect running state by process name
    let processRunning = false;
    if (svc.processName) {
      processRunning = await this.isProcessRunning(svc.processName);
    }

    // Detect by port
    let portReachable = false;
    if (svc.port && svc.port > 0) {
      portReachable = await this.checkPort(svc.port);
    }

    // PID liveness detection
    let pid = runtime.pid;
    let pidAlive = pid ? this.isPidAlive(pid) : false;
    if (!pidAlive && (processRunning || portReachable)) {
      pid = undefined;
      pidAlive = false;
    }

    let status: ServiceStatus['status'] = 'stopped';
    if (pidAlive || processRunning || portReachable) {
      status = 'running';
    }

    const startedAt = pidAlive ? runtime.startedAt : undefined;
    const uptimeSeconds = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
      : undefined;

    return {
      id: svc.id,
      name: svc.name,
      displayName: svc.displayName,
      status,
      pid,
      port: svc.port || undefined,
      portReachable,
      processRunning,
      startedAt,
      uptimeSeconds,
      binaryExists,
      configExists,
      dataDirExists,
      logDirExists,
      autoStart: svc.autoStart,
      processGuard: svc.processGuard,
    };
  }

  // ==================== Start/stop operations ====================

  /** Start a service */
  async start(name: string): Promise<ServiceActionResult> {
    const svc = await this.findByName(name);
    const startTime = Date.now();

    // Check whether it is already running
    if (svc.processName && (await this.isProcessRunning(svc.processName))) {
      throw new ConflictException(`${svc.displayName} 进程已在运行 (${svc.processName})`);
    }
    if (svc.port && svc.port > 0) {
      const portInUse = await this.checkPort(svc.port);
      if (portInUse) {
        throw new ConflictException(
          `端口 ${svc.port} 已被占用，可能 ${svc.displayName} 已由外部启动`,
        );
      }
    }

    // Ensure the directories exist
    if (svc.dataDir) this.ensureDir(svc.dataDir);
    if (svc.logDir) this.ensureDir(svc.logDir);

    try {
      let pid: number | undefined;

      if (svc.startScript) {
        // Use the start script
        pid = await this.executeScript(
          svc.startScript,
          svc.logDir ? path.join(svc.logDir, `${name}-stdout.log`) : undefined,
        );
      } else if (svc.binaryPath) {
        // Start with binaryPath + startArgs
        if (!fs.existsSync(svc.binaryPath)) {
          throw new BadRequestException(`可执行文件不存在: ${svc.binaryPath}`);
        }
        const args = svc.startArgs ? svc.startArgs.split(/\s+/).filter(Boolean) : [];
        const logFile = svc.logDir ? path.join(svc.logDir, `${name}-stdout.log`) : undefined;
        const logStream = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : undefined;

        const child = spawn(svc.binaryPath, args, {
          cwd: path.dirname(svc.binaryPath),
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: false,
        });

        if (logStream) {
          child.stdout?.pipe(logStream);
          child.stderr?.pipe(logStream);
        }

        child.on('error', (err) => {
          this.logger.error(`${svc.displayName} process error: ${err.message}`);
        });

        child.on('exit', (code, signal) => {
          this.logger.warn(`${svc.displayName} exited: code=${code}, signal=${signal}`);
          const rt = this.runtimes.get(name);
          if (rt && rt.pid === child.pid) {
            this.runtimes.delete(name);
          }
        });

        child.unref();
        pid = child.pid;

        this.runtimes.set(name, {
          pid,
          startedAt: new Date(),
          childProcess: child,
        });
      } else {
        throw new BadRequestException(`服务 ${svc.displayName} 未配置启动脚本或可执行文件路径`);
      }

      this.logger.log(`${svc.displayName} started: PID=${pid}`);

      // Wait for the port to be ready (if a port is configured)
      if (svc.port && svc.port > 0) {
        const ready = await this.waitForPort(svc.port, START_TIMEOUT_MS);
        if (!ready) {
          return {
            success: false,
            name,
            action: 'start',
            pid,
            message: `进程已启动(PID=${pid})，但端口 ${svc.port} 在 ${START_TIMEOUT_MS / 1000}s 内未就绪，请查看日志`,
            durationMs: Date.now() - startTime,
          };
        }
      } else {
        // No port configured; wait 500ms for the process to start
        await new Promise((r) => setTimeout(r, 500));
      }

      return {
        success: true,
        name,
        action: 'start',
        pid,
        message: `${svc.displayName} 启动成功，PID=${pid}`,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException || err instanceof ConflictException) throw err;
      this.logger.error(`Failed to start ${svc.displayName}: ${err.message}`);
      throw new InternalServerErrorException(`启动 ${svc.displayName} 失败: ${err.message}`);
    }
  }

  /** Stop a service */
  async stop(name: string): Promise<ServiceActionResult> {
    const svc = await this.findByName(name);
    const startTime = Date.now();

    // Prefer the custom stop script
    if (svc.stopScript) {
      await this.executeScript(svc.stopScript);
      this.runtimes.delete(name);
      this.logger.log(`${svc.displayName} stopped via custom script`);
      return {
        success: true,
        name,
        action: 'stop',
        message: `${svc.displayName} 已通过停止脚本停止`,
        durationMs: Date.now() - startTime,
      };
    }

    // Kill by process name (default behavior: taskkill /F /IM <processName>)
    if (svc.processName) {
      const killed = await this.killProcessByName(svc.processName);
      if (killed) {
        this.runtimes.delete(name);
        this.logger.log(`${svc.displayName} stopped: process=${svc.processName}`);
        return {
          success: true,
          name,
          action: 'stop',
          message: `${svc.displayName} 已停止 (kill ${svc.processName})`,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Try stopping by PID
    const runtime = this.runtimes.get(name);
    if (runtime?.pid && this.isPidAlive(runtime.pid)) {
      try {
        process.kill(runtime.pid, 'SIGTERM');
        const exited = await this.waitForExit(runtime.pid, STOP_TIMEOUT_MS);
        if (!exited) {
          try {
            process.kill(runtime.pid, 'SIGKILL');
          } catch {
            /* ignore */
          }
          await this.waitForExit(runtime.pid, 2000);
        }
        this.runtimes.delete(name);
        this.logger.log(`${svc.displayName} stopped: PID=${runtime.pid}`);
        return {
          success: true,
          name,
          action: 'stop',
          pid: runtime.pid,
          message: `${svc.displayName} 已停止`,
          durationMs: Date.now() - startTime,
        };
      } catch (err: any) {
        this.logger.error(`Failed to stop ${svc.displayName}: ${err.message}`);
        throw new InternalServerErrorException(`停止 ${svc.displayName} 失败: ${err.message}`);
      }
    }

    // Service not running
    this.runtimes.delete(name);
    return {
      success: true,
      name,
      action: 'stop',
      message: `${svc.displayName} 未在运行`,
      durationMs: Date.now() - startTime,
    };
  }

  /** Restart a service */
  async restart(name: string): Promise<ServiceActionResult> {
    const svc = await this.findByName(name);
    const startTime = Date.now();

    // Try stopping (no error if not running)
    try {
      await this.stop(name);
      // Wait for the port to be released
      if (svc.port && svc.port > 0) {
        await this.waitForPortRelease(svc.port, STOP_TIMEOUT_MS);
      }
    } catch {
      // Ignore stop errors
    }

    // Start
    const startResult = await this.start(name);
    return {
      ...startResult,
      action: 'restart',
      message: `${svc.displayName} 重启成功`,
      durationMs: Date.now() - startTime,
    };
  }

  // ==================== Configuration file management ====================

  /** Read config file content */
  async getConfig(name: string): Promise<{ content: string; path: string; size: number }> {
    const svc = await this.findByName(name);
    if (!svc.configPath) {
      throw new BadRequestException(`服务 ${svc.displayName} 未配置配置文件路径`);
    }
    if (!fs.existsSync(svc.configPath)) {
      return { content: '', path: svc.configPath, size: 0 };
    }
    const stat = fs.statSync(svc.configPath);
    if (stat.size > CONFIG_MAX_SIZE * 10) {
      throw new BadRequestException(`配置文件过大 (${Math.round(stat.size / 1024)}KB)，超过限制`);
    }
    const content = fs.readFileSync(svc.configPath, 'utf-8');
    return { content, path: svc.configPath, size: stat.size };
  }

  /** Save config file content (atomic write + backup) */
  async saveConfig(
    name: string,
    content: string,
  ): Promise<{ success: boolean; path: string; backupPath?: string }> {
    const svc = await this.findByName(name);
    if (!svc.configPath) {
      throw new BadRequestException(`服务 ${svc.displayName} 未配置配置文件路径`);
    }

    if (content.length > CONFIG_MAX_SIZE) {
      throw new BadRequestException(`配置内容过大，超过 ${CONFIG_MAX_SIZE / 1024}KB 限制`);
    }

    let backupPath: string | undefined;
    if (fs.existsSync(svc.configPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = `${svc.configPath}.bak.${ts}`;
      fs.copyFileSync(svc.configPath, backupPath);
      this.cleanupOldBackups(svc.configPath);
    }

    this.ensureDir(path.dirname(svc.configPath));
    const tmpPath = `${svc.configPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, svc.configPath);

    this.logger.log(`${svc.displayName} config saved: ${svc.configPath}`);
    return { success: true, path: svc.configPath, backupPath };
  }

  // ==================== Log management ====================

  /** Get the log list and content */
  async getLogs(name: string, limit = 200): Promise<LogEntry[]> {
    const svc = await this.findByName(name);
    if (!svc.logDir || !fs.existsSync(svc.logDir)) {
      return [];
    }

    const entries: LogEntry[] = [];
    const files = fs
      .readdirSync(svc.logDir)
      .filter((f) => f.endsWith('.log') || f.endsWith('.log.1'))
      .map((f) => ({
        name: f,
        fullPath: path.join(svc.logDir!, f),
        stat: fs.statSync(path.join(svc.logDir!, f)),
      }))
      .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime())
      .slice(0, 5);

    for (const file of files) {
      const content = fs.readFileSync(file.fullPath, 'utf-8');
      const allLines = content.split('\n');
      const lines = allLines.slice(-limit);
      entries.push({
        filename: file.name,
        size: file.stat.size,
        modifiedAt: file.stat.mtime,
        lines,
        totalLines: allLines.length,
      });
    }

    return entries;
  }

  /** Clean up logs */
  async clearLogs(name: string): Promise<{ cleared: string[] }> {
    const svc = await this.findByName(name);
    if (!svc.logDir || !fs.existsSync(svc.logDir)) {
      return { cleared: [] };
    }

    const cleared: string[] = [];
    const files = fs.readdirSync(svc.logDir).filter((f) => f.endsWith('.log'));
    for (const f of files) {
      const fullPath = path.join(svc.logDir, f);
      try {
        fs.truncateSync(fullPath, 0);
        cleared.push(f);
      } catch (err: any) {
        this.logger.warn(`Failed to truncate ${fullPath}: ${err.message}`);
      }
    }

    this.logger.log(`${svc.displayName} logs cleared: ${cleared.join(', ')}`);
    return { cleared };
  }

  // ==================== Private utility methods ====================

  /** Ensure a directory exists */
  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** Check whether a PID is alive */
  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** Check whether a port is connectable */
  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 1500;
      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, '127.0.0.1');
    });
  }

  /** Wait for the port to be ready */
  private async waitForPort(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.checkPort(port)) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /** Wait for the port to be released */
  private async waitForPortRelease(port: number, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!(await this.checkPort(port))) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  /** Wait for the process to exit */
  private waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (!this.isPidAlive(pid)) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, 300);
    });
  }

  /** Detect whether a process is running by name (Windows: tasklist) */
  private isProcessRunning(processName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const cmd = `tasklist /FI "IMAGENAME eq ${processName}" /NH /FO CSV`;
      exec(cmd, { windowsHide: true }, (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        // In tasklist's CSV output, containing the process name means it is running
        resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
      });
    });
  }

  /** Kill a process by name (Windows: taskkill /F /IM) */
  private killProcessByName(processName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const cmd = `taskkill /F /IM ${processName}`;
      exec(cmd, { windowsHide: true }, (err) => {
        resolve(!err);
      });
    });
  }

  /** Execute a script (returns the child process PID) */
  private executeScript(script: string, logFile?: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWindows ? ['/c', script] : ['-c', script];

      const logStream = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : undefined;
      const child = spawn(shell, shellArgs, {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: false,
      });

      if (logStream) {
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);
      }

      child.on('error', (err) => {
        reject(err);
      });

      child.on('spawn', () => {
        child.unref();
        resolve(child.pid);
      });
    });
  }

  /** Clean up old backup files */
  private cleanupOldBackups(configPath: string): void {
    try {
      const dir = path.dirname(configPath);
      const base = path.basename(configPath);
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(`${base}.bak.`))
        .map((f) => ({
          name: f,
          fullPath: path.join(dir, f),
          stat: fs.statSync(path.join(dir, f)),
        }))
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

      for (const file of files.slice(LOG_BACKUP_KEEP)) {
        fs.unlinkSync(file.fullPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // ==================== InfluxDB initialization ====================

  /**
   * Get the InfluxDB environment configuration (from process.env)
   */
  getInfluxConfig(): InfluxConfig {
    const token = process.env.INFLUXDB_TOKEN || '';
    return {
      url: process.env.INFLUXDB_URL || 'http://localhost:8086',
      org: process.env.INFLUXDB_ORG || 'ss-org',
      bucket: process.env.INFLUXDB_BUCKET || 'ss_node_data',
      tokenConfigured: !!token,
      tokenMasked: token ? token.slice(0, 8) + '••••' : '',
    };
  }

  /**
   * Detect whether InfluxDB has completed its first-time initialization
   *
   * InfluxDB 2.x starts in setup mode on first launch;
   * GET /api/v2/setup returning { allowed: true } means initialization is available.
   */
  async checkInfluxSetupStatus(): Promise<InfluxSetupStatus> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';

    try {
      const response = await fetch(`${url}/api/v2/setup`, {
        signal: AbortSignal.timeout(3000),
      });

      if (response.ok) {
        const body = await response.json();
        // allowed: true → not yet initialized, setup is needed
        // allowed: false → initialization already completed
        return {
          reachable: true,
          initialized: !body.allowed,
          tokenConfigured: !!token,
        };
      }

      return { reachable: false, initialized: false, tokenConfigured: !!token };
    } catch {
      return { reachable: false, initialized: false, tokenConfigured: !!token };
    }
  }

  /**
   * Auto-initialize InfluxDB (equivalent to the influx setup command)
   *
   * POST /api/v2/setup creates:
   *   - the initial user (username/password)
   *   - the initial Organization
   *   - the initial Bucket
   *   - an API Token (should be written to .env after the response)
   *
   * Parameter precedence: env vars > passed arguments > defaults
   */
  async setupInfluxDB(options?: {
    username?: string;
    password?: string;
    org?: string;
    bucket?: string;
  }): Promise<InfluxSetupResult> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';

    // Check whether it is already initialized first
    const status = await this.checkInfluxSetupStatus();
    if (!status.reachable) {
      return {
        success: false,
        message: `InfluxDB 不可达 (${url})，请先确保 InfluxDB 服务已启动`,
      };
    }
    if (status.initialized) {
      return {
        success: true,
        message: 'InfluxDB 已完成初始化，无需重复 setup',
        org: process.env.INFLUXDB_ORG || 'ss-org',
        bucket: process.env.INFLUXDB_BUCKET || 'ss_node_data',
      };
    }

    const username = options?.username || process.env.INFLUXDB_INIT_USERNAME || 'admin';
    const password = options?.password || process.env.INFLUXDB_INIT_PASSWORD || 'admin';
    const org = options?.org || process.env.INFLUXDB_ORG || 'ss-org';
    const bucket = options?.bucket || process.env.INFLUXDB_BUCKET || 'ss_node_data';

    try {
      const response = await fetch(`${url}/api/v2/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          org,
          bucket,
          retentionPeriodHrs: 0, // unlimited retention
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = (body as any).message || `HTTP ${response.status}`;
        return {
          success: false,
          message: `InfluxDB setup 失败: ${message}`,
          details: { status: response.status, body },
        };
      }

      const body = await response.json();

      // InfluxDB 2.x setup returns { auth: { token }, bucket, org, user }
      const generatedToken = (body as any).auth?.token || '';
      const resultOrg = (body as any).org?.name || org;
      const resultBucket = (body as any).bucket?.name || bucket;

      if (generatedToken) {
        this.logger.log(
          `InfluxDB setup completed: org="${resultOrg}", bucket="${resultBucket}", token=${generatedToken.slice(0, 8)}...`,
        );

        // Try writing the token into the .env file (if writable)
        const envWritten = this.writeInfluxTokenToEnv(generatedToken);
        if (envWritten) {
          this.logger.log('InfluxDB token written to .env file');
        }

        return {
          success: true,
          message: `InfluxDB 初始化成功${envWritten ? '，Token 已写入 .env 文件' : '（请手动将 Token 配置到 INFLUXDB_TOKEN）'}`,
          token: generatedToken,
          org: resultOrg,
          bucket: resultBucket,
          details: {
            envWritten,
            username,
            retentionPeriodHrs: 0,
          },
        };
      }

      return {
        success: false,
        message: 'InfluxDB setup 返回了空 Token',
        details: body,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `InfluxDB setup 请求失败: ${errorMsg}`,
      };
    }
  }

  // ==================== InfluxDB health check ====================

  /**
   * Check InfluxDB health
   *
   * Calls InfluxDB 2.x's /health endpoint, returning the service health status and version info.
   */
  async checkInfluxHealth(): Promise<InfluxHealthStatus> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const startTime = Date.now();

    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const responseTimeMs = Date.now() - startTime;

      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        return {
          status: body.status === 'pass' || body.status === 'healthy' ? 'healthy' : 'degraded',
          version: body.version || body.message,
          commit: body.commit,
          responseTimeMs,
        };
      }

      return {
        status: 'degraded',
        responseTimeMs,
        error: `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Check NanoMQ MQTT broker health
   *
   * Detects whether the NanoMQ MQTT port is reachable via a TCP connection.
   * The NanoMQ default port can be configured via the NANOMQ_PORT env var (default 1883).
   */
  async checkNanomqHealth(): Promise<NanomqHealthStatus> {
    const port = Number(process.env.NANOMQ_PORT) || 1883;
    const host = '127.0.0.1';
    const startTime = Date.now();

    return new Promise((resolve) => {
      const socket = new net.Socket();
      const timeout = 5000;

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        const responseTimeMs = Date.now() - startTime;
        socket.destroy();
        resolve({ reachable: true, responseTimeMs });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          reachable: false,
          responseTimeMs: Date.now() - startTime,
          error: `Connection timed out (${timeout}ms)`,
        });
      });

      socket.on('error', (err: Error) => {
        socket.destroy();
        resolve({
          reachable: false,
          responseTimeMs: Date.now() - startTime,
          error: err.message,
        });
      });

      socket.connect(port, host);
    });
  }

  /**
   * Get the InfluxDB bucket list
   *
   * Calls InfluxDB 2.x's /api/v2/buckets endpoint; requires a valid API token.
   */
  async listInfluxBuckets(): Promise<InfluxBucket[]> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';
    const org = process.env.INFLUXDB_ORG || 'ss-org';

    if (!token) {
      this.logger.warn('Cannot list InfluxDB buckets: INFLUXDB_TOKEN is not configured');
      return [];
    }

    try {
      const response = await fetch(`${url}/api/v2/buckets?org=${encodeURIComponent(org)}`, {
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.error(`Failed to list InfluxDB buckets: HTTP ${response.status}`);
        return [];
      }

      const body = await response.json();
      const buckets = (body as any).buckets || [];
      const storageMap = await this.queryInfluxStorageSizes(buckets);
      const bucketNames = buckets.map((b: any) => b.name || '').filter(Boolean);
      const detailsMap = await this.queryBucketDetails(bucketNames);

      return buckets.map((b: any) => {
        const bucketName = b.name || '';
        const details = detailsMap.get(bucketName);
        return {
          id: b.id || '',
          name: bucketName,
          orgID: b.orgID || '',
          description: b.description || '',
          retentionPeriodHrs: b.retentionRules?.[0]?.everySeconds
            ? Math.floor(b.retentionRules[0].everySeconds / 3600)
            : 0,
          storageBytes: storageMap.get(bucketName) ?? undefined,
          createdAt: b.createdAt || '',
          updatedAt: b.updatedAt || '',
          measurementCount: details?.measurementCount,
          lastWriteAt: details?.lastWriteAt,
          dataPointCount: details?.dataPointCount,
        };
      });
    } catch (error) {
      this.logger.error(
        `Failed to list InfluxDB buckets: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Query per-bucket storage usage of InfluxDB
   *
   * InfluxDB 2.x OSS's _monitoring bucket does not include the storage_shard_disk_size metric (Cloud-only),
   * so a file-system scan is used instead: read engine-path from InfluxDB's config.yaml and
   * measure each bucket's disk usage under engine/data/{bucketID}/ and engine/wal/{bucketID}/.
   *
   * @param buckets the bucket list returned by the InfluxDB API (must include id and name)
   */
  private async queryInfluxStorageSizes(buckets: any[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!buckets || buckets.length === 0) return map;

    const engineDir = await this.getInfluxEngineDir();
    if (!engineDir) {
      this.logger.warn('Cannot resolve InfluxDB engine dir; storage sizes unavailable');
      return map;
    }

    const dataDir = path.join(engineDir, 'data');
    const walDir = path.join(engineDir, 'wal');

    for (const bucket of buckets) {
      const bucketName = bucket.name || '';
      const bucketId = bucket.id || '';
      if (!bucketName || !bucketId) continue;

      let size = 0;
      const bucketDataDir = path.join(dataDir, bucketId);
      if (fs.existsSync(bucketDataDir)) {
        size += await this.getDirSize(bucketDataDir);
      }
      const bucketWalDir = path.join(walDir, bucketId);
      if (fs.existsSync(bucketWalDir)) {
        size += await this.getDirSize(bucketWalDir);
      }

      if (size > 0) {
        map.set(bucketName, size);
      }
    }

    return map;
  }

  /**
   * Resolve the absolute path of InfluxDB's engine data directory
   *
   * Reads the influxdb service's configPath and binaryPath from the base_services table, parses engine-path
   * (a relative path, relative to the influxd.exe directory) from config.yaml (JSON format), and derives the absolute path.
   *
   * @returns the absolute engine directory path, or null on failure
   */
  private async getInfluxEngineDir(): Promise<string | null> {
    try {
      const influxService = await this.serviceRepo.findOne({ where: { name: 'influxdb' } });
      if (!influxService?.configPath || !influxService?.binaryPath) return null;

      if (!fs.existsSync(influxService.configPath)) return null;
      const configContent = await fs.promises.readFile(influxService.configPath, 'utf-8');

      let enginePath: string | undefined;
      try {
        const config = JSON.parse(configContent);
        enginePath = config['engine-path'] || config.enginePath;
      } catch {
        // When config.yaml is not standard JSON, try extracting engine-path line by line
        const match = configContent.match(/["']?engine-path["']?\s*[:=]\s*["']([^"']+)["']/);
        enginePath = match?.[1];
      }

      if (!enginePath) return null;
      const influxHome = path.dirname(influxService.binaryPath);
      return path.resolve(influxHome, enginePath);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve InfluxDB engine dir: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Recursively compute a directory's total size (bytes)
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
          const stat = await fs.promises.stat(fullPath);
          total += stat.size;
        }
      }
    } catch {
      // Fail silently; some directories may not be accessible
    }
    return total;
  }

  /**
   * Query monitoring details per bucket (measurement count, last write time, data point count)
   *
   * Uses Flux queries to get each bucket's measurement list and last write time.
   * Uses parallel queries + timeout protection, avoiding slow per-bucket sequential queries.
   *
   * @param bucketNames the list of bucket names to query
   * @returns Map<bucketName, { measurementCount, lastWriteAt, dataPointCount }>
   */
  private async queryBucketDetails(
    bucketNames: string[],
  ): Promise<Map<string, { measurementCount?: number; lastWriteAt?: string; dataPointCount?: number }>> {
    const map = new Map<string, { measurementCount?: number; lastWriteAt?: string; dataPointCount?: number }>();
    if (bucketNames.length === 0) return map;

    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';
    const org = process.env.INFLUXDB_ORG || 'ss-org';
    if (!token) return map;

    // Query each bucket in parallel
    const results = await Promise.all(
      bucketNames.map(async (bucketName) => {
        try {
          const [measurementCount, lastWriteAt] = await Promise.all([
            this.queryMeasurementCount(url, token, org, bucketName),
            this.queryLastWriteTime(url, token, org, bucketName),
          ]);
          return { bucketName, measurementCount, lastWriteAt };
        } catch {
          return { bucketName, measurementCount: undefined, lastWriteAt: undefined };
        }
      }),
    );

    for (const result of results) {
      map.set(result.bucketName, {
        measurementCount: result.measurementCount,
        lastWriteAt: result.lastWriteAt,
      });
    }
    return map;
  }

  /**
   * Query the measurement count of a given bucket
   */
  private async queryMeasurementCount(
    url: string,
    token: string,
    org: string,
    bucketName: string,
  ): Promise<number | undefined> {
    // Use schema.measurement() to list all measurements, then count them
    const query = `import "influxdata/influxdb/schema"
schema.measurements(bucket: "${bucketName}")
  |> count(column: "_value")`;

    try {
      const response = await fetch(`${url}/api/v2/query?org=${encodeURIComponent(org)}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/vnd.flux',
          Accept: 'application/csv',
        },
        body: query,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return undefined;
      const csv = await response.text();
      const lines = csv.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
      if (lines.length < 2) return 0;

      // CSV header format: ,result,table,_start,_stop,_value
      const header = lines[0].split(',');
      const valueIdx = header.findIndex((h) => h === '_value');
      if (valueIdx < 0) return 0;

      // count() returns a single summary row; if multiple tables exist, accumulate
      let total = 0;
      let hasValue = false;
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',');
        const value = parseInt(row[valueIdx], 10);
        if (!Number.isNaN(value)) {
          total += value;
          hasValue = true;
        }
      }
      return hasValue ? total : 0;
    } catch (error) {
      this.logger.warn(
        `queryMeasurementCount failed for ${bucketName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  /**
   * Query a given bucket's last write time
   */
  private async queryLastWriteTime(
    url: string,
    token: string,
    org: string,
    bucketName: string,
  ): Promise<string | undefined> {
    const query = `from(bucket: "${bucketName}")
  |> range(start: -30d)
  |> last()
  |> keep(columns: ["_time"])`;

    try {
      const response = await fetch(`${url}/api/v2/query?org=${encodeURIComponent(org)}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/vnd.flux',
          Accept: 'application/csv',
        },
        body: query,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return undefined;
      const csv = await response.text();
      const lines = csv.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
      if (lines.length < 2) return undefined;

      // Find the _time column index
      const header = lines[0].split(',');
      const timeIndex = header.findIndex((h) => h === '_time');
      if (timeIndex < 0) return undefined;

      // last() returns one row per series; walk all rows to take the maximum time
      // (ISO 8601 strings can be compared directly lexicographically)
      let latestTime: string | undefined;
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',');
        const t = row[timeIndex];
        if (t && (!latestTime || t > latestTime)) {
          latestTime = t;
        }
      }
      return latestTime;
    } catch (error) {
      this.logger.warn(
        `queryLastWriteTime failed for ${bucketName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return undefined;
    }
  }

  /**
   * Export an InfluxDB bucket's data as CSV
   *
   * @param bucketName the bucket name
   * @param start start time (Flux format, e.g. -1d), default -1d
   * @param stop end time (Flux format, e.g. now()), default now()
   * @returns a CSV string (with BOM header)
   */
  async exportBucketData(
    bucketName: string,
    start?: string,
    stop?: string,
  ): Promise<string> {
    const url = process.env.INFLUXDB_URL || 'http://localhost:8086';
    const token = process.env.INFLUXDB_TOKEN || '';
    const org = process.env.INFLUXDB_ORG || 'ss-org';

    if (!token) {
      throw new Error('INFLUXDB_TOKEN is not configured');
    }

    const startTime = start || '-1d';
    const stopTime = stop || 'now()';

    const query = `from(bucket: "${bucketName}")
  |> range(start: ${startTime}, stop: ${stopTime})
  |> yield(name: "export")`;

    const response = await fetch(`${url}/api/v2/query?org=${encodeURIComponent(org)}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/vnd.flux',
        Accept: 'application/csv',
      },
      body: query,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`InfluxDB query failed: HTTP ${response.status} - ${errorText}`);
    }

    const csv = await response.text();
    // Add a UTF-8 BOM header so Excel recognizes the encoding correctly
    return '\uFEFF' + csv;
  }

  /**
   * Write the generated InfluxDB token into the .env file
   * Search order: .env.dev → .env.base → .env
   * Write rule: replace the existing INFLUXDB_TOKEN=... line, or append to the end of the file
   */
  private writeInfluxTokenToEnv(token: string): boolean {
    const projectRoot = this.getProjectRoot();
    const envFiles = [
      path.join(projectRoot, '.env.dev'),
      path.join(projectRoot, '.env.base'),
      path.join(projectRoot, '.env'),
    ];

    for (const envFile of envFiles) {
      if (!fs.existsSync(envFile)) continue;

      try {
        let content = fs.readFileSync(envFile, 'utf-8');

        if (content.includes('INFLUXDB_TOKEN=')) {
          // Replace the existing token
          content = content.replace(/^INFLUXDB_TOKEN=.*$/m, `INFLUXDB_TOKEN=${token}`);
        } else {
          // Append to the end of the file
          content = content.trimEnd() + `\nINFLUXDB_TOKEN=${token}\n`;
        }

        fs.writeFileSync(envFile, content, 'utf-8');
        this.logger.log(`Token written to: ${envFile}`);
        return true;
      } catch (err: any) {
        this.logger.warn(`Failed to write token to ${envFile}: ${err.message}`);
      }
    }

    return false;
  }
}
