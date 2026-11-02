// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Test, TestingModule } from '@nestjs/testing';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SystemRestartService, RestartState } from '../restart/system-restart.service';

// Mock child_process.spawn to avoid actually spawning child processes
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({
    pid: 99999,
    unref: jest.fn(),
    on: jest.fn(),
  })),
}));

// Keep the real fs implementation; only existsSync can be mocked (fs.existsSync is a non-configurable property in Node.js)
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(actual.existsSync),
  };
});

describe('SystemRestartService', () => {
  let service: SystemRestartService;
  let tempDir: string;
  let markerPath: string;
  let spawnMock: jest.Mock;
  let originalProcessExit: typeof process.exit;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-test-'));
    process.env.DATA_DIR = tempDir;
    // Ensure we are not in a PM2 / Docker environment
    delete process.env.PM2_HOME;
    delete process.env.pm_id;
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Use fake timers to control setTimeout (avoiding process.exit's 1s delay actually running)
    jest.useFakeTimers();

    // Reset the spawn mock
    spawnMock = require('child_process').spawn as jest.Mock;
    spawnMock.mockClear();
    spawnMock.mockImplementation(() => ({
      pid: 99999,
      unref: jest.fn(),
      on: jest.fn(),
    }));

    // Reset the fs.existsSync mock to the real implementation
    (fs.existsSync as jest.Mock).mockImplementation(jest.requireActual('fs').existsSync);

    // Mock process.exit to prevent the test process from exiting
    originalProcessExit = process.exit;
    (process as any).exit = jest.fn((code?: number) => undefined as never);

    // Clean up marker files
    markerPath = path.join(tempDir, '.restart-marker.json');
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemRestartService,
        { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => p), getProjectRoot: jest.fn().mockReturnValue('/fake/project-root') } },
      ],
    }).compile();

    service = module.get<SystemRestartService>(SystemRestartService);
  });

  afterEach(() => {
    // Restore process.exit
    (process as any).exit = originalProcessExit;

    // Restore real timers
    jest.useRealTimers();

    // Clean up all mocks
    jest.clearAllMocks();

    // Clean up marker files
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
    }
  });

  // ==================== onModuleInit ====================

  describe('onModuleInit', () => {
    it('TC-RESTART-001: 无 marker 文件时应为 no-op', async () => {
      expect(fs.existsSync(markerPath)).toBe(false);
      await service.onModuleInit();
      expect(fs.existsSync(markerPath)).toBe(false);
    });

    it('TC-RESTART-002: marker 状态为 restarting 时应更新为 ready', async () => {
      const state: RestartState = {
        status: 'restarting',
        triggeredBy: 'admin',
        triggeredAt: Date.now() - 1000,
        oldPid: 12345,
        markerPath,
      };
      fs.writeFileSync(markerPath, JSON.stringify(state, null, 2), 'utf-8');

      await service.onModuleInit();

      const updated = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(updated.status).toBe('ready');
      expect(updated.newPid).toBe(process.pid);
      expect(updated.triggeredBy).toBe('admin');
      expect(updated.oldPid).toBe(12345);
    });

    it('TC-RESTART-003: marker 状态非 restarting 时不应更新', async () => {
      const state: RestartState = {
        status: 'idle',
        markerPath,
      };
      fs.writeFileSync(markerPath, JSON.stringify(state, null, 2), 'utf-8');

      await service.onModuleInit();

      const content = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(content.status).toBe('idle');
      expect(content.newPid).toBeUndefined();
    });

    it('TC-RESTART-004: marker 文件损坏时应删除', async () => {
      fs.writeFileSync(markerPath, '{ invalid json content !!! }', 'utf-8');
      expect(fs.existsSync(markerPath)).toBe(true);

      await service.onModuleInit();

      expect(fs.existsSync(markerPath)).toBe(false);
    });

    it('TC-RESTART-005: marker 状态为 ready 时应保持不变', async () => {
      const state: RestartState = {
        status: 'ready',
        triggeredBy: 'admin',
        oldPid: 12345,
        newPid: 54321,
        markerPath,
      };
      fs.writeFileSync(markerPath, JSON.stringify(state, null, 2), 'utf-8');

      await service.onModuleInit();

      const content = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(content.status).toBe('ready');
      expect(content.newPid).toBe(54321);
    });
  });

  // ==================== triggerRestart ====================

  describe('triggerRestart', () => {
    it('TC-RESTART-010: 成功触发重启应写入 marker 并 spawn 子进程', async () => {
      const username = 'admin';
      const result = await service.triggerRestart(username);

      expect(result.status).toBe('restarting');
      expect(result.triggeredBy).toBe(username);
      expect(result.oldPid).toBe(process.pid);
      expect(result.markerPath).toBe(markerPath);

      // Verify the marker file was written
      expect(fs.existsSync(markerPath)).toBe(true);
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(marker.status).toBe('restarting');
      expect(marker.triggeredBy).toBe(username);

      // Verify spawn was called
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [cmd, args, options] = spawnMock.mock.calls[0];
      expect(cmd).toBe('node');
      expect(args[0]).toMatch(/restarter\.js$/);
      expect(args[1]).toBe(String(process.pid));
      expect(options.detached).toBe(true);
      expect(options.stdio).toBe('ignore');

      // Verify the isRestarting state
      expect(service.isCurrentlyRestarting()).toBe(true);

      // Advance timers to trigger process.exit
      jest.advanceTimersByTime(1100);
      expect(process.exit as jest.Mock).toHaveBeenCalledWith(0);
    });

    it('TC-RESTART-011: 并发触发应抛出 BadRequestException', async () => {
      // Trigger once first
      await service.triggerRestart('admin');

      // The second time should throw
      await expect(service.triggerRestart('admin')).rejects.toThrow(/重启已在进行中/);

      // Advance timers so setTimeout runs
      jest.advanceTimersByTime(1100);
    });

    it('TC-RESTART-012: 冷却期内再次触发应抛出异常', async () => {
      // Manipulate private fields directly to simulate a just-triggered restart
      // Because process.exit is mocked, the process does not exit and isRestarting stays true
      // Reset isRestarting first, then set lastRestartAt to the current time
      (service as any).isRestarting = false;
      (service as any).lastRestartAt = Date.now();

      // Within the cooldown period (30 seconds) it should throw
      await expect(service.triggerRestart('admin')).rejects.toThrow(/重启冷却期内/);
    });

    it('TC-RESTART-013: PM2 环境应抛出友好提示', async () => {
      process.env.PM2_HOME = '/tmp/pm2-home';

      await expect(service.triggerRestart('admin')).rejects.toThrow(/PM2 环境.*pm2 restart/);

      delete process.env.PM2_HOME;
    });

    it('TC-RESTART-014: Docker 环境应抛出友好提示', async () => {
      // Mock fs.existsSync: the /.dockerenv file is detected as existing
      const realExistsSync = jest.requireActual('fs').existsSync;
      (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) => {
        if (p.toString() === '/.dockerenv') return true;
        return realExistsSync(p);
      });

      await expect(service.triggerRestart('admin')).rejects.toThrow(/Docker 环境.*docker restart/);
    });

    it('TC-RESTART-015: restarter.js 不存在时应标记为 failed', async () => {
      // Mock fs.existsSync: restarter.js candidate paths return false, others normal
      const realExistsSync = jest.requireActual('fs').existsSync;
      (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) => {
        const pStr = p.toString();
        if (pStr.endsWith('restarter.js')) return false;
        return realExistsSync(p);
      });

      await expect(service.triggerRestart('admin')).rejects.toThrow(/Restarter script not found/);

      // Verify the marker status is failed
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(marker.status).toBe('failed');
      expect(marker.errorMessage).toMatch(/Restarter script not found/);
    });

    it('TC-RESTART-016: spawn 抛出异常时应标记 failed 并重置 isRestarting', async () => {
      spawnMock.mockImplementation(() => {
        throw new Error('spawn EACCES');
      });

      await expect(service.triggerRestart('admin')).rejects.toThrow(/Failed to spawn restarter/);

      expect(service.isCurrentlyRestarting()).toBe(false);

      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
      expect(marker.status).toBe('failed');
      expect(marker.errorMessage).toMatch(/spawn EACCES/);
    });
  });

  // ==================== getRestartStatus ====================

  describe('getRestartStatus', () => {
    it('TC-RESTART-020: isRestarting 为 true 时应返回 restarting 状态', async () => {
      await service.triggerRestart('admin');

      const status = service.getRestartStatus();
      expect(status.status).toBe('restarting');
      expect(status.markerPath).toBe(markerPath);

      // Advance timers
      jest.advanceTimersByTime(1100);
    });

    it('TC-RESTART-021: 存在 marker 文件时应返回 marker 内容', () => {
      const state: RestartState = {
        status: 'ready',
        triggeredBy: 'admin',
        triggeredAt: Date.now(),
        oldPid: 12345,
        newPid: 54321,
        markerPath,
      };
      fs.writeFileSync(markerPath, JSON.stringify(state, null, 2), 'utf-8');

      const status = service.getRestartStatus();
      expect(status.status).toBe('ready');
      expect(status.triggeredBy).toBe('admin');
      expect(status.oldPid).toBe(12345);
      expect(status.newPid).toBe(54321);
    });

    it('TC-RESTART-022: 无 marker 文件且未在重启中应返回 idle', () => {
      const status = service.getRestartStatus();
      expect(status.status).toBe('idle');
      expect(status.markerPath).toBe(markerPath);
    });

    it('TC-RESTART-023: marker 文件损坏时应返回 idle', () => {
      fs.writeFileSync(markerPath, '{ corrupted !!! }', 'utf-8');

      const status = service.getRestartStatus();
      expect(status.status).toBe('idle');
    });
  });

  // ==================== clearMarker ====================

  describe('clearMarker', () => {
    it('TC-RESTART-030: 存在 marker 文件时应删除', () => {
      fs.writeFileSync(markerPath, JSON.stringify({ status: 'ready' }), 'utf-8');
      expect(fs.existsSync(markerPath)).toBe(true);

      service.clearMarker();

      expect(fs.existsSync(markerPath)).toBe(false);
    });

    it('TC-RESTART-031: 不存在 marker 文件时应为 no-op', () => {
      expect(fs.existsSync(markerPath)).toBe(false);
      expect(() => service.clearMarker()).not.toThrow();
    });
  });

  // ==================== detectRuntimeEnvironment ====================

  describe('detectRuntimeEnvironment', () => {
    it('TC-RESTART-040: 存在 PM2_HOME 时应返回 pm2', () => {
      process.env.PM2_HOME = '/tmp/pm2-home';
      expect(service.detectRuntimeEnvironment()).toBe('pm2');
      delete process.env.PM2_HOME;
    });

    it('TC-RESTART-041: 存在 pm_id 时应返回 pm2', () => {
      process.env.pm_id = '1';
      expect(service.detectRuntimeEnvironment()).toBe('pm2');
      delete process.env.pm_id;
    });

    it('TC-RESTART-042: 存在 /.dockerenv 时应返回 docker', () => {
      const realExistsSync = jest.requireActual('fs').existsSync;
      (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) => {
        if (p.toString() === '/.dockerenv') return true;
        return realExistsSync(p);
      });

      expect(service.detectRuntimeEnvironment()).toBe('docker');
    });

    it('TC-RESTART-043: 无 PM2/Docker 标识时应返回 standalone', () => {
      delete process.env.PM2_HOME;
      delete process.env.pm_id;

      const realExistsSync = jest.requireActual('fs').existsSync;
      (fs.existsSync as jest.Mock).mockImplementation((p: fs.PathLike) => {
        if (p.toString() === '/.dockerenv') return false;
        return realExistsSync(p);
      });

      expect(service.detectRuntimeEnvironment()).toBe('standalone');
    });
  });

  // ==================== isCurrentlyRestarting ====================

  describe('isCurrentlyRestarting', () => {
    it('TC-RESTART-050: 初始状态应为 false', () => {
      expect(service.isCurrentlyRestarting()).toBe(false);
    });

    it('TC-RESTART-051: 触发重启后应为 true', async () => {
      await service.triggerRestart('admin');
      expect(service.isCurrentlyRestarting()).toBe(true);

      // Advance timers
      jest.advanceTimersByTime(1100);
    });
  });

  // ==================== Boundary and integration scenarios ====================

  describe('集成场景', () => {
    it('TC-RESTART-060: 完整重启流程 - onModuleInit 检测到重启完成状态', async () => {
      // 1. Simulate the previous process writing the restarting status
      const oldState: RestartState = {
        status: 'restarting',
        triggeredBy: 'admin',
        triggeredAt: Date.now() - 5000,
        oldPid: 12345,
        markerPath,
      };
      fs.writeFileSync(markerPath, JSON.stringify(oldState, null, 2), 'utf-8');

      // 2. The new service calls onModuleInit at startup
      await service.onModuleInit();

      // 3. Verify the status has been updated to ready
      const status = service.getRestartStatus();
      expect(status.status).toBe('ready');
      expect(status.triggeredBy).toBe('admin');
      expect(status.oldPid).toBe(12345);
      expect(status.newPid).toBe(process.pid);

      // 4. Clean up the marker
      service.clearMarker();
      expect(fs.existsSync(markerPath)).toBe(false);

      // 5. Status returns to idle
      const finalStatus = service.getRestartStatus();
      expect(finalStatus.status).toBe('idle');
    });

    it('TC-RESTART-061: failed 状态的 marker 应能被 clearMarker 清除', () => {
      const failedState: RestartState = {
        status: 'failed',
        errorMessage: 'Restarter script not found',
        triggeredAt: Date.now(),
        markerPath,
      };
      fs.writeFileSync(markerPath, JSON.stringify(failedState, null, 2), 'utf-8');

      const status = service.getRestartStatus();
      expect(status.status).toBe('failed');
      expect(status.errorMessage).toMatch(/Restarter script not found/);

      service.clearMarker();
      expect(fs.existsSync(markerPath)).toBe(false);
    });
  });
});
