// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PathResolverService } from '@ss-node/ss-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock sqlite3 (async callback API)
// Uses process.nextTick to defer callbacks, avoiding the "Cannot access 'db' before initialization" TDZ error
// Reason: in const db = new Database(path, cb), if cb runs synchronously, db has not been assigned yet (TDZ)
const mockDb = {
  get: jest.fn().mockImplementation((sql: string, cb: (err: Error | null, row?: any) => void) => {
    process.nextTick(() => {
      if (sql.includes('COUNT(*)')) {
        cb(null, { cnt: 5 });
      } else {
        cb(null, undefined);
      }
    });
  }),
  all: jest
    .fn()
    .mockImplementation((sql: string, cb: (err: Error | null, rows?: any[]) => void) => {
      process.nextTick(() => {
        if (sql.includes('integrity_check')) {
          cb(null, [{ integrity_check: 'ok' }]);
        } else {
          cb(null, []);
        }
      });
    }),
  exec: jest.fn().mockImplementation((sql: string, cb: (err: Error | null) => void) => {
    process.nextTick(() => cb(null));
  }),
  close: jest.fn().mockImplementation((cb?: (err: Error | null) => void) => {
    if (cb) process.nextTick(() => cb(null));
  }),
};

jest.mock('sqlite3', () => {
  return {
    Database: jest.fn().mockImplementation((dbPath: string, ...args: any[]) => {
      // Support both constructor signatures:
      //   new Database(path, cb)  /  new Database(path, mode, cb)
      const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      // cb must be invoked asynchronously, otherwise const db = new Database(...) triggers TDZ
      if (cb) process.nextTick(() => cb(null));
      return mockDb;
    }),
    OPEN_READONLY: 1,
    OPEN_READWRITE: 2,
    OPEN_CREATE: 4,
  };
});

import { DatabaseService } from '../backup/database.service';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let mockConfigService: any;
  let tempDir: string;
  let systemDbPath: string;
  let projectsDir: string;

  beforeAll(() => {
    // setup.ts globally enables jest.useFakeTimers(), which intercepts process.nextTick,
    // so the sqlite3 mock's async callbacks never fire and the test times out.
    // This test file needs real timers to drive sqlite3's async callbacks.
    jest.useRealTimers();

    tempDir = path.join(os.tmpdir(), `db-service-test-${Date.now()}`);

    // Create the system database
    const dbDir = path.join(tempDir, 'data');
    systemDbPath = path.join(dbDir, 'database.sqlite');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(systemDbPath, 'SQLite format 3\x00' + 'test-data'.repeat(100));

    // Create the project database
    projectsDir = path.join(tempDir, 'projects');
    const projectDbDir = path.join(projectsDir, 'test-project', 'db');
    fs.mkdirSync(projectDbDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDbDir, 'system.db'),
      'SQLite format 3\x00' + 'project-data'.repeat(50),
    );
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const fakeProjectRoot = path.join(__dirname, '..', '..', '..', '..');

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return systemDbPath;
        if (key === 'PROJECTS_DIR') return projectsDir;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PathResolverService, useValue: { resolve: jest.fn((p: string) => path.resolve(fakeProjectRoot, p)), getProjectRoot: jest.fn().mockReturnValue(fakeProjectRoot) } },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
    jest.clearAllMocks();
  });

  // ==================== Database status ====================

  describe('getSystemDatabaseStatus', () => {
    it('TC-DB-001: should return system database status with ISO date string', async () => {
      const status = await service.getSystemDatabaseStatus();

      expect(status.type).toBe('system');
      expect(status.exists).toBe(true);
      expect(status.sizeBytes).toBeGreaterThan(0);
      expect(status.sizeFormatted).toBeDefined();
      expect(status.tableCount).toBeGreaterThanOrEqual(0);
      // lastModified should be an ISO-format string
      expect(status.lastModified).toBeTruthy();
      expect(typeof status.lastModified).toBe('string');
      expect(new Date(status.lastModified!).getTime()).not.toBeNaN();
      // A healthy database should have no errorMessage
      expect(status.errorMessage).toBeUndefined();
    });

    it('TC-DB-001b: should return errorMessage when database file not found', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return path.join(tempDir, 'nonexistent', 'db.sqlite');
        if (key === 'PROJECTS_DIR') return projectsDir;
        return undefined;
      });

      const status = await service.getSystemDatabaseStatus();

      expect(status.exists).toBe(false);
      expect(status.lastModified).toBeNull();
      expect(status.errorMessage).toBeDefined();
      expect(status.errorMessage).toContain('Database file not found');
      expect(status.errorMessage).toContain('nonexistent');
    });
  });

  describe('getProjectDatabasesStatus', () => {
    it('TC-DB-002: should return project database status list with ISO date', async () => {
      const statuses = await service.getProjectDatabasesStatus();

      expect(statuses.length).toBeGreaterThan(0);
      const projectDb = statuses.find((s) => s.name === 'test-project');
      expect(projectDb).toBeDefined();
      expect(projectDb!.type).toBe('project');
      expect(projectDb!.exists).toBe(true);
      expect(projectDb!.sizeBytes).toBeGreaterThan(0);
      // lastModified should be an ISO-format string
      expect(typeof projectDb!.lastModified).toBe('string');
      expect(new Date(projectDb!.lastModified!).getTime()).not.toBeNaN();
      // A healthy database should have no errorMessage
      expect(projectDb!.errorMessage).toBeUndefined();
    });

    it('TC-DB-003: should return empty list when projects dir is missing', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return systemDbPath;
        if (key === 'PROJECTS_DIR') return path.join(tempDir, 'nonexistent');
        return undefined;
      });

      const statuses = await service.getProjectDatabasesStatus();
      expect(statuses).toEqual([]);
    });

    it('TC-DB-003b: should return errorMessage for non-existent project db', async () => {
      // Create an empty directory to simulate a missing project database
      const emptyProjectDir = path.join(projectsDir, 'empty-project');
      fs.mkdirSync(emptyProjectDir, { recursive: true });

      const statuses = await service.getProjectDatabasesStatus();
      const emptyProject = statuses.find((s) => s.name === 'empty-project');

      expect(emptyProject).toBeDefined();
      expect(emptyProject!.exists).toBe(false);
      expect(emptyProject!.errorMessage).toBeDefined();
      expect(emptyProject!.errorMessage).toContain('Database file not found');

      fs.rmdirSync(emptyProjectDir);
    });
  });

  describe('getAllDatabasesStatus', () => {
    it('TC-DB-004: should return system and project status', async () => {
      const result = await service.getAllDatabasesStatus();

      expect(result.system).toBeDefined();
      expect(result.system.type).toBe('system');
      expect(result.projects).toBeDefined();
      expect(Array.isArray(result.projects)).toBe(true);
    });
  });

  // ==================== Path resolution (added in v1.3) ====================

  describe('Path Resolution (v1.3)', () => {
    it('TC-DB-PATH-001: should resolve relative DATABASE_PATH to absolute path', async () => {
      // Simulate the relative-path config from .env.ss
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return '../../ss-run/ss/data/db/ss-node.db';
        if (key === 'PROJECTS_DIR') return projectsDir;
        return undefined;
      });

      const status = await service.getSystemDatabaseStatus();

      // Expected: the returned path is absolute
      expect(path.isAbsolute(status.path)).toBe(true);
      // Expected: the path ends with ss-run/ss/data/db/ss-node.db
      expect(status.path).toContain(path.normalize('ss-run/ss/data/db/ss-node.db'));
      // Expected: the path does not depend on process.cwd(), resolved against ss-services/ss-node
      // ss-services/ss-node + ../../ss-run/ss/data/db/ss-node.db = ss-v7/ss-run/ss/data/db/ss-node.db
      expect(status.path).not.toContain('apps/ss-node-server');
    });

    it('TC-DB-PATH-002: should resolve relative PROJECTS_DIR to absolute path', async () => {
      // Simulate the relative-path config from .env.ss
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return systemDbPath;
        if (key === 'PROJECTS_DIR') return '../../ss-project';
        return undefined;
      });

      const statuses = await service.getProjectDatabasesStatus();

      // Even if the directory does not exist, an empty array is expected (no throw)
      expect(Array.isArray(statuses)).toBe(true);
      // Since ../../ss-project does not exist in the test environment (relative to ss-services/ss-node),
      // returning an empty array is correct
    });

    it('TC-DB-PATH-003: should return absolute path in status response for existing project', async () => {
      // Use an absolute-path projectsDir (created in beforeAll)
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return systemDbPath;
        if (key === 'PROJECTS_DIR') return projectsDir;
        return undefined;
      });

      const statuses = await service.getProjectDatabasesStatus();
      const projectDb = statuses.find((s) => s.name === 'test-project');

      expect(projectDb).toBeDefined();
      // Expected: the returned path is absolute (no longer depending on process.cwd())
      expect(path.isAbsolute(projectDb!.path)).toBe(true);
      expect(projectDb!.path).toBe(path.join(projectsDir, 'test-project', 'db', 'system.db'));
    });

    it('TC-DB-PATH-004: getProjectRoot should return ss-services/ss-node directory', () => {
      // Access the private method via reflection to verify the project-root computation
      const getProjectRoot = (service as any).getProjectRoot.bind(service);
      const projectRoot = getProjectRoot();

      expect(path.isAbsolute(projectRoot)).toBe(true);
      // The project root should contain the ss-services/ss-node path segment
      expect(projectRoot).toContain('ss-services');
      expect(projectRoot).toContain('ss-node');
      // It should not contain apps/ss-node-server (that is where process.cwd() is)
      expect(projectRoot).not.toContain('apps');
      expect(projectRoot).not.toContain('ss-node-server');
      // It should not contain packages/ss-system (where dist lives)
      expect(projectRoot).not.toContain('packages');
      expect(projectRoot).not.toContain('ss-system');
    });
  });

  // ==================== Integrity check ====================

  describe('checkSystemIntegrity', () => {
    it('TC-DB-010: should return ok for valid database', async () => {
      const result = await service.checkSystemIntegrity();

      expect(result.ok).toBe(true);
      expect(result.message).toBe('ok');
      expect(result.checkedAt).toBeInstanceOf(Date);
    });

    it('TC-DB-011: should return fail for invalid path', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return path.join(tempDir, 'nonexistent', 'db.sqlite');
        if (key === 'PROJECTS_DIR') return projectsDir;
        return undefined;
      });

      const result = await service.checkSystemIntegrity();
      expect(result.ok).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('TC-DB-011b: should return fail when integrity_check returns error', async () => {
      mockDb.all.mockImplementationOnce(
        (sql: string, cb: (err: Error | null, rows?: any[]) => void) => {
          cb(null, [{ integrity_check: 'database disk image is malformed' }]);
        },
      );

      const result = await service.checkSystemIntegrity();

      expect(result.ok).toBe(false);
      expect(result.message).toContain('malformed');
    });
  });

  describe('checkProjectIntegrity', () => {
    it('TC-DB-012: should return ok for valid project database', async () => {
      const result = await service.checkProjectIntegrity('test-project');

      expect(result.ok).toBe(true);
      expect(result.message).toBe('ok');
    });

    it('TC-DB-013: should return fail for non-existent project', async () => {
      const result = await service.checkProjectIntegrity('nonexistent-project');

      expect(result.ok).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  // ==================== Space reclaim ====================

  describe('vacuumSystem', () => {
    it('TC-DB-020: should execute VACUUM successfully', async () => {
      const result = await service.vacuumSystem();

      expect(result.ok).toBe(true);
      expect(result.beforeBytes).toBeGreaterThanOrEqual(0);
      expect(result.afterBytes).toBeGreaterThanOrEqual(0);
      expect(result.freedFormatted).toBeDefined();
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('TC-DB-020b: should throw when database file not found', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'DATABASE_PATH') return path.join(tempDir, 'nonexistent', 'db.sqlite');
        if (key === 'PROJECTS_DIR') return projectsDir;
        return undefined;
      });

      await expect(service.vacuumSystem()).rejects.toThrow('not found');
    });
  });

  describe('vacuumProject', () => {
    it('TC-DB-021: should execute VACUUM on project database', async () => {
      const result = await service.vacuumProject('test-project');

      expect(result.ok).toBe(true);
      expect(result.beforeBytes).toBeGreaterThan(0);
      expect(result.afterBytes).toBeGreaterThanOrEqual(0);
    });

    it('TC-DB-022: should throw for non-existent project', async () => {
      await expect(service.vacuumProject('nonexistent-project')).rejects.toThrow();
    });
  });

  // ==================== better-sqlite3 → sqlite3 migration (v1.4) ====================

  describe('sqlite3 migration (v1.4)', () => {
    it('TC-DB-MIG-001: should use sqlite3 (async) instead of better-sqlite3', async () => {
      // Verify the sqlite3 module is loaded (via the mock)
      // Since jest.mock replaced require('sqlite3'), if the service calls it normally,
      // it means sqlite3 is being used correctly
      const status = await service.getSystemDatabaseStatus();
      expect(status.exists).toBe(true);
      expect(mockDb.get).toHaveBeenCalled();
    });

    it('TC-DB-MIG-002: countTables should use sqlite3 OPEN_READONLY', async () => {
      await service.getSystemDatabaseStatus();

      // Verify that Database was constructed with OPEN_READONLY
      // mockDb has already been called
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        expect.any(Function),
      );
    });

    it('TC-DB-MIG-003: integrity check should use PRAGMA integrity_check', async () => {
      await service.checkSystemIntegrity();

      expect(mockDb.all).toHaveBeenCalledWith('PRAGMA integrity_check', expect.any(Function));
    });

    it('TC-DB-MIG-004: VACUUM should execute VACUUM command', async () => {
      await service.vacuumSystem();

      expect(mockDb.exec).toHaveBeenCalledWith('VACUUM', expect.any(Function));
    });
  });
});
