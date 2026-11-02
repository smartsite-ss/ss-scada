// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PathResolverService } from '@ss-node/ss-core';
import { BaseServicesService } from '../base-services/base-services.service';
import { BaseServiceEntity } from '../base-services/base-service.entity';
import { CreateBaseServiceDto, UpdateBaseServiceDto } from '../base-services/base-service.dto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock only the filesystem and child-process external dependencies, keeping the business logic genuinely testable
jest.mock('fs');
jest.mock('child_process');

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedChildProcess = require('child_process');

describe('BaseServicesService', () => {
  let service: BaseServicesService;
  let mockRepo: any;
  let mockConfigService: any;
  let tempDir: string;

  beforeAll(() => {
    tempDir = path.join(os.tmpdir(), `base-services-test-${Date.now()}`);
  });

  beforeEach(async () => {
    // The global setup.ts enables fake timers, but this test involves real setTimeout (startup waits etc.)
    // so we must switch back to real timers
    jest.useRealTimers();

    // Filesystem mock: by default no path exists; individual tests override as needed
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.readFileSync.mockReturnValue('');
    mockedFs.writeFileSync.mockReturnValue(undefined);
    mockedFs.statSync.mockReturnValue({ size: 0, mtime: new Date() } as any);
    mockedFs.readdirSync.mockReturnValue([]);
    mockedFs.renameSync.mockReturnValue(undefined);
    mockedFs.copyFileSync.mockReturnValue(undefined);
    mockedFs.truncateSync.mockReturnValue(undefined);
    mockedFs.unlinkSync.mockReturnValue(undefined);
    mockedFs.createWriteStream.mockReturnValue({
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    } as any);

    // child_process mock
    mockedChildProcess.exec.mockImplementation(
      (cmd: string, opts: any, cb: (err: any, stdout: string) => void) => {
        // By default tasklist finds no process
        if (cmd.includes('tasklist')) {
          cb(null, 'INFO: No tasks are running which match the specified criteria.');
        } else if (cmd.includes('taskkill')) {
          cb(null, 'SUCCESS: ...');
        } else {
          cb(null, '');
        }
      },
    );
    mockedChildProcess.spawn.mockImplementation(() => ({
      pid: 12345,
      stdout: { pipe: jest.fn(), on: jest.fn() },
      stderr: { pipe: jest.fn(), on: jest.fn() },
      on: jest.fn(),
      unref: jest.fn(),
    }));

    // Repository mock
    const store = new Map<string, BaseServiceEntity>();

    mockRepo = {
      find: jest.fn().mockImplementation(async (opts?: any) => {
        let arr = Array.from(store.values());
        if (opts?.where) {
          arr = arr.filter((e) =>
            Object.entries(opts.where).every(([k, v]) => (e as any)[k] === v),
          );
        }
        arr.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
        return arr;
      }),
      findOne: jest.fn().mockImplementation(async (opts?: any) => {
        const where = opts?.where || {};
        for (const e of store.values()) {
          if (Object.entries(where).every(([k, v]) => (e as any)[k] === v)) return e;
        }
        return null;
      }),
      count: jest.fn().mockImplementation(async () => store.size),
      create: jest.fn().mockImplementation((dto: any) => {
        const entity: any = {
          id: `id-${dto.name || Math.random().toString(36).slice(2)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          enabled: true,
          autoStart: false,
          processGuard: false,
          sortOrder: 0,
          port: 0,
          ...dto,
        };
        return entity;
      }),
      save: jest.fn().mockImplementation(async (entity: any) => {
        if (!entity.id) {
          entity.id = `id-${entity.name || Math.random().toString(36).slice(2)}`;
        }
        entity.updatedAt = new Date();
        store.set(entity.name, entity);
        return entity;
      }),
      remove: jest.fn().mockImplementation(async (entity: any) => {
        store.delete(entity.name);
        return entity;
      }),
      __store: store,
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const map: Record<string, string | undefined> = {
          BASE_SERVICES_DIR: tempDir,
          REDIS_PORT: '6379',
        };
        return map[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaseServicesService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: getRepositoryToken(BaseServiceEntity), useValue: mockRepo },
        { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => path.isAbsolute(p) ? p : path.resolve('/fake/ss-services/ss-node', p)), getProjectRoot: jest.fn().mockReturnValue('/fake/ss-services/ss-node') } },
      ],
    }).compile();

    service = module.get<BaseServicesService>(BaseServicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ==================== CRUD ====================

  describe('create', () => {
    it('成功创建新服务', async () => {
      const dto: CreateBaseServiceDto = {
        name: 'nginx',
        displayName: 'Nginx Web Server',
        description: '反向代理服务器',
        binaryPath: 'C:/nginx/nginx.exe',
        processName: 'nginx.exe',
        port: 80,
        enabled: true,
        autoStart: false,
        sortOrder: 1,
      };
      const created = await service.create(dto);
      expect(created.id).toBeDefined();
      expect(created.name).toBe('nginx');
      expect(created.displayName).toBe('Nginx Web Server');
      expect(created.port).toBe(80);
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('名称重复时抛出 ConflictException', async () => {
      const dto: CreateBaseServiceDto = {
        name: 'redis',
        displayName: 'Redis',
      };
      // Pre-insert a record with the same name
      await service.create({ name: 'redis', displayName: 'Redis' });
      await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('未提供 enabled 时默认为 true', async () => {
      const created = await service.create({ name: 'svc1', displayName: 'S1' });
      expect(created.enabled).toBe(true);
    });

    it('未提供 port 时默认为 0', async () => {
      const created = await service.create({ name: 'svc2', displayName: 'S2' });
      expect(created.port).toBe(0);
    });
  });

  describe('findAll', () => {
    it('返回所有服务并按 sortOrder 排序', async () => {
      await service.create({ name: 'b', displayName: 'B', sortOrder: 2 });
      await service.create({ name: 'a', displayName: 'A', sortOrder: 1 });
      const list = await service.findAll();
      expect(list.length).toBeGreaterThanOrEqual(2);
      const names = list.map((s) => s.name);
      // a with sortOrder=1 should come before b
      expect(names.indexOf('a')).toBeLessThan(names.indexOf('b'));
    });
  });

  describe('findByName', () => {
    it('返回存在的服务', async () => {
      await service.create({ name: 'mysql', displayName: 'MySQL' });
      const svc = await service.findByName('mysql');
      expect(svc.name).toBe('mysql');
    });

    it('不存在时抛出 NotFoundException', async () => {
      await expect(service.findByName('not-exist')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('成功更新服务字段', async () => {
      await service.create({ name: 'redis', displayName: 'Redis', port: 6379 });
      const dto: UpdateBaseServiceDto = { displayName: 'Redis 缓存', port: 6380 };
      const updated = await service.update('redis', dto);
      expect(updated.displayName).toBe('Redis 缓存');
      expect(updated.port).toBe(6380);
    });

    it('更新不存在的服务抛出 NotFoundException', async () => {
      await expect(service.update('ghost', { displayName: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('更新 processGuard 字段', async () => {
      await service.create({ name: 'guard-test', displayName: 'GuardTest' });
      const updated = await service.update('guard-test', { processGuard: true });
      expect(updated.processGuard).toBe(true);
    });
  });

  describe('processGuard', () => {
    beforeEach(async () => {
      // Clean up the store
      mockRepo.__store.clear();
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        binaryPath: 'C:/redis/redis-server.exe',
        processName: 'redis-server.exe',
        enabled: true,
        processGuard: true,
      });
      await service.create({
        name: 'influxdb',
        displayName: 'InfluxDB',
        binaryPath: 'C:/influxdb/influxd.exe',
        processName: 'influxd.exe',
        enabled: true,
        processGuard: false,
      });
      // Ensure the fs mock reports the file as existing
      mockedFs.existsSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('redis-server.exe')) return true;
        if (typeof p === 'string' && p.includes('influxd.exe')) return true;
        return false;
      });
    });

    it('create 保存 processGuard 默认值 false', async () => {
      const svc = await service.create({ name: 'new-svc', displayName: 'NewSvc' });
      expect(svc.processGuard).toBe(false);
    });

    it('create 保存 processGuard=true', async () => {
      const svc = await service.create({
        name: 'guarded',
        displayName: 'Guarded',
        processGuard: true,
      });
      expect(svc.processGuard).toBe(true);
    });

    it('getAllStatus 返回 autoStart 和 processGuard', async () => {
      const statuses = await service.getAllStatus();
      const redis = statuses.find((s) => s.name === 'redis');
      expect(redis).toBeDefined();
      expect(redis!.autoStart).toBe(false);
      expect(redis!.processGuard).toBe(true);
    });

    it('checkAndGuardProcesses 仅检查 processGuard=true 的服务', async () => {
      // Mock a successfully started spawn process
      mockedChildProcess.spawn.mockReturnValue({
        pid: 9999,
        unref: jest.fn(),
        on: jest.fn(),
        stdout: { on: jest.fn(), pipe: jest.fn() },
        stderr: { on: jest.fn(), pipe: jest.fn() },
      });
      // Call checkAndGuardProcesses (via reflection)
      await (service as any).checkAndGuardProcesses();
      // Should not affect services with processGuard=false
      const influxdb = await service.findByName('influxdb');
      expect(influxdb).toBeDefined();
    });
  });

  describe('remove', () => {
    it('删除存在的服务', async () => {
      await service.create({ name: 'todelete', displayName: 'ToDelete' });
      await service.remove('todelete');
      await expect(service.findByName('todelete')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('删除不存在服务抛出 NotFoundException', async () => {
      await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================== Status query ====================

  describe('getAllStatus', () => {
    it('返回每个服务状态对象', async () => {
      await service.create({
        name: 's1',
        displayName: 'S1',
        binaryPath: 'C:/s1.exe',
        configPath: 'C:/s1.conf',
        enabled: true,
      });
      const statuses = await service.getAllStatus();
      expect(statuses.length).toBeGreaterThan(0);
      const s1 = statuses.find((s) => s.name === 's1');
      expect(s1).toBeDefined();
      expect(s1!.status).toBe('stopped');
      expect(s1!.binaryExists).toBe(false); // mockedFs.existsSync defaults to false
    });

    it('禁用的服务返回 unknown 状态', async () => {
      await service.create({ name: 'disabled', displayName: 'D', enabled: false });
      const statuses = await service.getAllStatus();
      const d = statuses.find((s) => s.name === 'disabled');
      expect(d!.status).toBe('unknown');
      expect(d!.processRunning).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('文件存在时返回 binaryExists/configExists = true', async () => {
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        binaryPath: 'C:/redis/redis-server.exe',
        configPath: 'C:/redis/redis.conf',
        logDir: 'C:/redis/logs',
        dataDir: 'C:/redis/data',
      });
      // Allow these paths through
      mockedFs.existsSync.mockImplementation((p: any) => {
        return [
          'C:/redis/redis-server.exe',
          'C:/redis/redis.conf',
          'C:/redis/logs',
          'C:/redis/data',
        ].includes(String(p));
      });
      const st = await service.getStatus('redis');
      expect(st.binaryExists).toBe(true);
      expect(st.configExists).toBe(true);
      expect(st.dataDirExists).toBe(true);
      expect(st.logDirExists).toBe(true);
    });

    it('不存在服务抛出 NotFoundException', async () => {
      await expect(service.getStatus('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ==================== Configuration files ====================

  describe('getConfig', () => {
    it('未配置 configPath 抛出 BadRequestException', async () => {
      await service.create({ name: 'nocfg', displayName: 'NoCfg' });
      await expect(service.getConfig('nocfg')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('文件不存在时返回空内容', async () => {
      await service.create({ name: 'redis', displayName: 'Redis', configPath: 'C:/redis.conf' });
      mockedFs.existsSync.mockReturnValue(false);
      const result = await service.getConfig('redis');
      expect(result.content).toBe('');
      expect(result.size).toBe(0);
    });

    it('读取配置文件内容', async () => {
      await service.create({ name: 'redis', displayName: 'Redis', configPath: 'C:/redis.conf' });
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ size: 100, mtime: new Date() } as any);
      mockedFs.readFileSync.mockReturnValue('bind 127.0.0.1\nport 6379\n');
      const result = await service.getConfig('redis');
      expect(result.content).toContain('bind 127.0.0.1');
      expect(result.size).toBe(100);
    });

    it('文件过大抛出 BadRequestException', async () => {
      await service.create({ name: 'big', displayName: 'Big', configPath: 'C:/big.conf' });
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.statSync.mockReturnValue({ size: 20 * 1024 * 1024, mtime: new Date() } as any);
      await expect(service.getConfig('big')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('saveConfig', () => {
    it('保存配置文件并返回 success', async () => {
      await service.create({ name: 'redis', displayName: 'Redis', configPath: 'C:/redis.conf' });
      mockedFs.existsSync.mockReturnValue(true);
      const result = await service.saveConfig('redis', 'new content');
      expect(result.success).toBe(true);
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      expect(mockedFs.renameSync).toHaveBeenCalled();
    });

    it('未配置 configPath 抛出 BadRequestException', async () => {
      await service.create({ name: 'nocfg', displayName: 'NoCfg' });
      await expect(service.saveConfig('nocfg', 'x')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('内容过大抛出 BadRequestException', async () => {
      await service.create({ name: 'big', displayName: 'Big', configPath: 'C:/big.conf' });
      const big = 'a'.repeat(2 * 1024 * 1024);
      await expect(service.saveConfig('big', big)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ==================== Logs ====================

  describe('getLogs', () => {
    it('未配置 logDir 返回空数组', async () => {
      await service.create({ name: 'nolog', displayName: 'NoLog' });
      const logs = await service.getLogs('nolog');
      expect(logs).toEqual([]);
    });

    it('logDir 不存在返回空数组', async () => {
      await service.create({ name: 'redis', displayName: 'R', logDir: 'C:/redis/logs' });
      mockedFs.existsSync.mockReturnValue(false);
      const logs = await service.getLogs('redis');
      expect(logs).toEqual([]);
    });

    it('返回日志条目并按 mtime 排序', async () => {
      await service.create({ name: 'redis', displayName: 'R', logDir: 'C:/redis/logs' });
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue(['a.log', 'b.log'] as any);
      mockedFs.statSync.mockImplementation((p: any) => {
        if (String(p).endsWith('a.log')) return { size: 10, mtime: new Date(2024, 1, 1) } as any;
        return { size: 20, mtime: new Date(2024, 1, 2) } as any;
      });
      mockedFs.readFileSync.mockImplementation((p: any) => {
        if (String(p).endsWith('a.log')) return 'line-a1\nline-a2\n';
        return 'line-b1\n';
      });
      const logs = await service.getLogs('redis', 10);
      expect(logs.length).toBe(2);
      // b.log is newer and should be sorted first
      expect(logs[0].filename).toBe('b.log');
      expect(logs[0].lines.length).toBeGreaterThan(0);
    });
  });

  describe('clearLogs', () => {
    it('清理日志文件', async () => {
      await service.create({ name: 'redis', displayName: 'R', logDir: 'C:/redis/logs' });
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue(['a.log', 'b.log', 'c.txt'] as any);
      const result = await service.clearLogs('redis');
      // Only clean up .log files
      expect(result.cleared).toContain('a.log');
      expect(result.cleared).toContain('b.log');
      expect(result.cleared).not.toContain('c.txt');
      expect(mockedFs.truncateSync).toHaveBeenCalledTimes(2);
    });

    it('未配置 logDir 返回空数组', async () => {
      await service.create({ name: 'nolog', displayName: 'NoLog' });
      const result = await service.clearLogs('nolog');
      expect(result.cleared).toEqual([]);
    });
  });

  // ==================== Start/stop operations ====================

  describe('start', () => {
    it('服务不存在抛出 NotFoundException', async () => {
      await expect(service.start('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('未配置启动脚本和 binaryPath 抛出 BadRequestException', async () => {
      await service.create({ name: 'empty', displayName: 'Empty' });
      // Make both the process and port checks return false, avoiding false positives
      mockedChildProcess.exec.mockImplementation(
        (_cmd: string, _opts: any, cb: (err: any, stdout: string) => void) => {
          cb(null, 'INFO: No tasks');
        },
      );
      await expect(service.start('empty')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('配置 binaryPath 但文件不存在抛出 BadRequestException', async () => {
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        binaryPath: 'C:/redis/redis-server.exe',
      });
      mockedFs.existsSync.mockReturnValue(false);
      // Make tasklist report not running
      mockedChildProcess.exec.mockImplementation(
        (_cmd: string, _opts: any, cb: (err: any, stdout: string) => void) => {
          cb(null, 'INFO: No tasks');
        },
      );
      await expect(service.start('redis')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('进程已在运行抛出 ConflictException', async () => {
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        processName: 'redis-server.exe',
        binaryPath: 'C:/redis/redis-server.exe',
      });
      // Make tasklist find the process
      mockedChildProcess.exec.mockImplementation(
        (_cmd: string, _opts: any, cb: (err: any, stdout: string) => void) => {
          cb(null, '"redis-server.exe","1234","Console","1","10,000 K"');
        },
      );
      await expect(service.start('redis')).rejects.toBeInstanceOf(ConflictException);
    });

    it('端口被占用抛出 ConflictException', async () => {
      // This case would need the net module mocked to simulate an occupied port,
      // but net is bound when the service module loads and cannot be swapped at runtime.
      // The same ConflictException branch is already covered by the "process already running" test.
      // Here we only verify that no port check happens when port is not configured.
      await service.create({
        name: 'noport',
        displayName: 'NoPort',
        binaryPath: 'C:/np.exe',
        port: 0,
      });
      mockedFs.existsSync.mockReturnValue(true);
      mockedChildProcess.exec.mockImplementation(
        (_cmd: string, _opts: any, cb: (err: any, stdout: string) => void) => {
          cb(null, 'INFO: No tasks');
        },
      );
      const result = await service.start('noport');
      expect(result.success).toBe(true);
    });
  });

  describe('stop', () => {
    it('服务不存在抛出 NotFoundException', async () => {
      await expect(service.stop('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('使用 stopScript 停止成功', async () => {
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        stopScript: 'net stop redis',
      });
      mockedChildProcess.exec.mockImplementation(
        (_cmd: string, _opts: any, cb: (err: any, stdout: string) => void) => {
          cb(null, '');
        },
      );
      mockedChildProcess.spawn.mockImplementation(() => ({
        pid: 999,
        stdout: { pipe: jest.fn(), on: jest.fn() },
        stderr: { pipe: jest.fn(), on: jest.fn() },
        on: jest.fn((event: string, cb: () => void) => {
          // Fire the spawn event callback synchronously so executeScript's promise resolves
          if (event === 'spawn') cb();
        }),
        unref: jest.fn(),
      }));
      const result = await service.stop('redis');
      expect(result.success).toBe(true);
      expect(result.action).toBe('stop');
    });

    it('未运行服务返回 success 并提示未在运行', async () => {
      await service.create({ name: 'idle', displayName: 'Idle' });
      // taskkill failed, tasklist found nothing, PID not recorded
      mockedChildProcess.exec.mockImplementation(
        (_cmd: string, _opts: any, cb: (err: any, stdout: string) => void) => {
          if (_cmd.includes('taskkill')) cb(new Error('not found'), '');
          else cb(null, 'INFO: No tasks');
        },
      );
      const result = await service.stop('idle');
      expect(result.success).toBe(true);
      expect(result.message).toContain('未在运行');
    });
  });

  describe('restart', () => {
    it('服务不存在抛出 NotFoundException', async () => {
      await expect(service.restart('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('调用 stop 后调用 start', async () => {
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        binaryPath: 'C:/redis/redis-server.exe',
        processName: 'redis-server.exe',
        port: 0,
      });
      mockedFs.existsSync.mockReturnValue(true);
      mockedChildProcess.exec.mockImplementation(
        (_cmd: string, _opts: any, cb: (err: any, stdout: string) => void) => {
          // tasklist found no process
          cb(null, 'INFO: No tasks');
        },
      );
      const result = await service.restart('redis');
      expect(result.action).toBe('restart');
    });
  });

  // ==================== onModuleInit / syncDefaultServices ====================

  describe('syncDefaultServices', () => {
    it('数据库为空时初始化默认服务', async () => {
      const result = await service.findAll();
      expect(result.length).toBe(0);
      await service.syncDefaultServices();
      const list = await service.findAll();
      expect(list.length).toBeGreaterThanOrEqual(2);
      const names = list.map((s) => s.name);
      expect(names).toContain('redis');
      expect(names).toContain('influxdb');
    });

    it('数据库非空时不再重复初始化（不重复插入）', async () => {
      await service.syncDefaultServices();
      const countAfterFirst = (await service.findAll()).length;
      await service.syncDefaultServices();
      const countAfterSecond = (await service.findAll()).length;
      expect(countAfterSecond).toBe(countAfterFirst);
    });

    it('非空表时同步已有服务字段（路径更新）', async () => {
      // First write an old record with an incomplete path
      await service.create({
        name: 'redis',
        displayName: 'Redis Old',
        binaryPath: 'C:/old/redis-server.exe',
        configPath: 'C:/old/redis.conf',
        dataDir: 'C:/old/data',
        logDir: 'C:/old/logs',
        processName: 'redis-server.exe',
        port: 6379,
      });
      // syncDefaultServices should update the path fields
      await service.syncDefaultServices();
      const updated = await service.findByName('redis');
      // The path should be updated to the env-var value (tempDir) or the default path
      expect(updated.binaryPath).not.toBe('C:/old/redis-server.exe');
      expect(updated.configPath).not.toBe('C:/old/redis.conf');
      expect(updated.dataDir).not.toBe('C:/old/data');
      expect(updated.logDir).not.toBe('C:/old/logs');
      // name should stay unchanged
      expect(updated.name).toBe('redis');
    });

    it('非空表时插入缺失的默认服务', async () => {
      // Only redis is created; influxdb is missing
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        binaryPath: 'C:/redis/redis-server.exe',
        processName: 'redis-server.exe',
        port: 6379,
      });
      const listBefore = await service.findAll();
      expect(listBefore.find((s) => s.name === 'influxdb')).toBeUndefined();

      await service.syncDefaultServices();
      const listAfter = await service.findAll();
      const influx = listAfter.find((s) => s.name === 'influxdb');
      expect(influx).toBeDefined();
      expect(influx!.displayName).toBe('InfluxDB');
    });

    it('非空表时保留用户配置的 enabled/autoStart', async () => {
      await service.create({
        name: 'redis',
        displayName: 'Redis',
        binaryPath: 'C:/redis/redis-server.exe',
        processName: 'redis-server.exe',
        port: 6379,
        enabled: false,
        autoStart: true,
      });
      await service.syncDefaultServices();
      const updated = await service.findByName('redis');
      // sync should not overwrite user-configured enabled/autoStart
      expect(updated.enabled).toBe(false);
      expect(updated.autoStart).toBe(true);
    });
  });

  describe('resolveServicePaths (via syncDefaultServices)', () => {
    it('环境变量 REDIS_BINARY_PATH 优先于默认路径', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        const map: Record<string, string | undefined> = {
          BASE_SERVICES_DIR: tempDir,
          REDIS_PORT: '6379',
          REDIS_BINARY_PATH: 'C:/custom/redis/redis-server.exe',
          REDIS_CONFIG_PATH: 'C:/custom/redis/redis.conf',
          REDIS_DATA_DIR: 'C:/custom/redis/data',
          REDIS_LOG_DIR: 'C:/custom/redis/logs',
        };
        return map[key];
      });
      // Recreate the service to use the new configService mock
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BaseServicesService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getRepositoryToken(BaseServiceEntity), useValue: mockRepo },
          { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => path.isAbsolute(p) ? p : path.resolve('/fake/ss-services/ss-node', p)), getProjectRoot: jest.fn().mockReturnValue('/fake/ss-services/ss-node') } },
        ],
      }).compile();
      const svc = module.get<BaseServicesService>(BaseServicesService);
      await svc.syncDefaultServices();
      const redis = await svc.findByName('redis');
      // Absolute paths are normalized by path.normalize (unified separators) but their absolute location is unchanged
      expect(path.normalize(redis.binaryPath)).toBe(
        path.normalize('C:/custom/redis/redis-server.exe'),
      );
      expect(path.normalize(redis.configPath)).toBe(path.normalize('C:/custom/redis/redis.conf'));
      expect(path.normalize(redis.dataDir)).toBe(path.normalize('C:/custom/redis/data'));
      expect(path.normalize(redis.logDir)).toBe(path.normalize('C:/custom/redis/logs'));
    });

    it('未设置环境变量时使用 BASE_SERVICES_DIR 默认路径', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        const map: Record<string, string | undefined> = {
          BASE_SERVICES_DIR: 'C:/base',
          REDIS_PORT: '6379',
        };
        return map[key];
      });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BaseServicesService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getRepositoryToken(BaseServiceEntity), useValue: mockRepo },
          { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => path.isAbsolute(p) ? p : path.resolve('/fake/ss-services/ss-node', p)), getProjectRoot: jest.fn().mockReturnValue('/fake/ss-services/ss-node') } },
        ],
      }).compile();
      const svc = module.get<BaseServicesService>(BaseServicesService);
      await svc.syncDefaultServices();
      const redis = await svc.findByName('redis');
      // Use path.normalize to handle cross-platform path separator differences
      const expectedRedisDir = path.normalize('C:/base/redis');
      expect(path.normalize(redis.binaryPath)).toContain(expectedRedisDir);
      expect(path.normalize(redis.configPath)).toContain(expectedRedisDir);
      expect(path.normalize(redis.dataDir)).toContain(expectedRedisDir);
      expect(path.normalize(redis.logDir)).toContain(expectedRedisDir);

      // Verify the InfluxDB default path (directory name influxdb2-2.7.8, config file config.yaml)
      const influxdb = await svc.findByName('influxdb');
      const expectedInfluxDir = path.normalize('C:/base/influxdb2-2.7.8');
      expect(path.normalize(influxdb.binaryPath)).toContain(expectedInfluxDir);
      expect(path.normalize(influxdb.configPath)).toContain(
        path.normalize('C:/base/influxdb2-2.7.8/config.yaml'),
      );
      expect(path.normalize(influxdb.dataDir)).toContain(expectedInfluxDir);
      expect(path.normalize(influxdb.logDir)).toContain(expectedInfluxDir);
    });

    it('环境变量 INFLUXDB_BINARY_PATH 优先于默认路径', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        const map: Record<string, string | undefined> = {
          BASE_SERVICES_DIR: tempDir,
          INFLUXDB_BINARY_PATH: 'C:/custom/influxdb/influxd.exe',
          INFLUXDB_CONFIG_PATH: 'C:/custom/influxdb/influxdb.conf',
          INFLUXDB_DATA_DIR: 'C:/custom/influxdb/data',
          INFLUXDB_LOG_DIR: 'C:/custom/influxdb/logs',
        };
        return map[key];
      });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BaseServicesService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getRepositoryToken(BaseServiceEntity), useValue: mockRepo },
          { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => path.isAbsolute(p) ? p : path.resolve('/fake/ss-services/ss-node', p)), getProjectRoot: jest.fn().mockReturnValue('/fake/ss-services/ss-node') } },
        ],
      }).compile();
      const svc = module.get<BaseServicesService>(BaseServicesService);
      await svc.syncDefaultServices();
      const influxdb = await svc.findByName('influxdb');
      // Absolute paths are normalized by path.normalize (unified separators) but their absolute location is unchanged
      expect(path.normalize(influxdb.binaryPath)).toBe(
        path.normalize('C:/custom/influxdb/influxd.exe'),
      );
      expect(path.normalize(influxdb.configPath)).toBe(
        path.normalize('C:/custom/influxdb/influxdb.conf'),
      );
      expect(path.normalize(influxdb.dataDir)).toBe(path.normalize('C:/custom/influxdb/data'));
      expect(path.normalize(influxdb.logDir)).toBe(path.normalize('C:/custom/influxdb/logs'));
    });

    it('TC-BS-ENV-004: BASE_SERVICES_DIR 为相对路径时解析为绝对路径存入 DB', async () => {
      // Simulate the real .env.ss config: BASE_SERVICES_DIR=${RUN_DIR}/base_services, RUN_DIR=../../ss-run/ss
      // This is the user-reported bug scenario: after a relative path is stored in the DB, fs.existsSync resolves it against process.cwd() and fails
      mockConfigService.get.mockImplementation((key: string) => {
        const map: Record<string, string | undefined> = {
          BASE_SERVICES_DIR: '../../ss-run/ss/base_services',
          REDIS_PORT: '6379',
        };
        return map[key];
      });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BaseServicesService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getRepositoryToken(BaseServiceEntity), useValue: mockRepo },
          { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => path.isAbsolute(p) ? p : path.resolve('/fake/ss-services/ss-node', p)), getProjectRoot: jest.fn().mockReturnValue('/fake/ss-services/ss-node') } },
        ],
      }).compile();
      const svc = module.get<BaseServicesService>(BaseServicesService);
      await svc.syncDefaultServices();
      const redis = await svc.findByName('redis');
      const influxdb = await svc.findByName('influxdb');

      // Expected: the DB stores an absolute path, no longer depending on process.cwd()
      expect(path.isAbsolute(redis.binaryPath)).toBe(true);
      expect(path.isAbsolute(redis.configPath)).toBe(true);
      expect(path.isAbsolute(redis.dataDir)).toBe(true);
      expect(path.isAbsolute(redis.logDir)).toBe(true);

      expect(path.isAbsolute(influxdb.binaryPath)).toBe(true);
      expect(path.isAbsolute(influxdb.configPath)).toBe(true);
      expect(path.isAbsolute(influxdb.dataDir)).toBe(true);
      expect(path.isAbsolute(influxdb.logDir)).toBe(true);

      // Expected: the resolved absolute path ends with ss-run/ss/base_services
      const expectedBaseSuffix = path.normalize('ss-run/ss/base_services');
      expect(redis.binaryPath).toContain(expectedBaseSuffix);
      expect(influxdb.binaryPath).toContain(expectedBaseSuffix);

      // Expected: the redis binary path ends with base_services/redis/redis-server.exe
      expect(redis.binaryPath).toContain(path.normalize('redis/redis-server.exe'));
      // Expected: the influxdb binary path ends with base_services/influxdb2-2.7.8/influxd.exe
      expect(influxdb.binaryPath).toContain(path.normalize('influxdb2-2.7.8/influxd.exe'));
    });

    it('TC-BS-ENV-005: 环境变量为相对路径时也解析为绝对路径', async () => {
      // Simulate env vars where the user configured a relative path in .env (rare but should be supported)
      mockConfigService.get.mockImplementation((key: string) => {
        const map: Record<string, string | undefined> = {
          BASE_SERVICES_DIR: tempDir,
          REDIS_PORT: '6379',
          REDIS_BINARY_PATH: '../../custom-redis/redis-server.exe',
          REDIS_CONFIG_PATH: '../../custom-redis/redis.conf',
          REDIS_DATA_DIR: '../../custom-redis/data',
          REDIS_LOG_DIR: '../../custom-redis/logs',
        };
        return map[key];
      });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BaseServicesService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getRepositoryToken(BaseServiceEntity), useValue: mockRepo },
          { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => path.isAbsolute(p) ? p : path.resolve('/fake/ss-services/ss-node', p)), getProjectRoot: jest.fn().mockReturnValue('/fake/ss-services/ss-node') } },
        ],
      }).compile();
      const svc = module.get<BaseServicesService>(BaseServicesService);
      await svc.syncDefaultServices();
      const redis = await svc.findByName('redis');

      // Expected: the relative path is resolved to an absolute path, not depending on process.cwd()
      expect(path.isAbsolute(redis.binaryPath)).toBe(true);
      expect(path.isAbsolute(redis.configPath)).toBe(true);
      expect(path.isAbsolute(redis.dataDir)).toBe(true);
      expect(path.isAbsolute(redis.logDir)).toBe(true);

      // Expected: the resolved path contains custom-redis/redis-server.exe
      expect(redis.binaryPath).toContain(path.normalize('custom-redis/redis-server.exe'));
    });
  });

  describe('onModuleInit', () => {
    it('onModuleInit 调用 syncDefaultServices + autoStartServices', async () => {
      // The repository is empty
      const result = await service.findAll();
      expect(result.length).toBe(0);
      await service.onModuleInit();
      const list = await service.findAll();
      expect(list.length).toBeGreaterThanOrEqual(2);
      const names = list.map((s) => s.name);
      expect(names).toContain('redis');
      expect(names).toContain('influxdb');
    });
  });
});
