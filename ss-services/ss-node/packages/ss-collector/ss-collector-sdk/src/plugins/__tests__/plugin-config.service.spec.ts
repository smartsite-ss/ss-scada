// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginConfigService } from '../plugin-config.service';

// ============================================================
// Helpers
// ============================================================

function makeService(): PluginConfigService {
  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const pathResolver = { resolve: jest.fn((p: string) => p), getProjectRoot: jest.fn() };
  return new PluginConfigService(configService as any, pathResolver as any);
}

function readConfigFile(dir: string, protocol: string): any {
  const filePath = path.join(dir, `${protocol}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================================
// Test suite
// ============================================================

describe('PluginConfigService', () => {
  let tempDir: string;

  beforeEach(() => {
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'log').mockImplementation();
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-config-test-'));
    process.env['PLUGIN_CONFIG_DIR'] = tempDir;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env['PLUGIN_CONFIG_DIR'];
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------
  // Startup loading
  // -------------------------------------------------------------
  describe('onModuleInit', () => {
    it('Should create the config directory when it does not exist', async () => {
      const dir = path.join(tempDir, 'nested', 'configs');
      process.env['PLUGIN_CONFIG_DIR'] = dir;
      const service = makeService();

      await service.onModuleInit();

      expect(fs.existsSync(dir)).toBe(true);
    });

    it('Should load all persisted *.json configs at startup', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'mqtt.json'),
        JSON.stringify({ isolationMode: 'child_process', activated: false }),
      );
      fs.writeFileSync(
        path.join(tempDir, 'calc.json'),
        JSON.stringify({ activated: true }),
      );
      const service = makeService();

      await service.onModuleInit();

      expect(service.getActivated('mqtt')).toBe(false);
      expect(service.getActivated('calc')).toBe(true);
      expect(service.getIsolationMode('mqtt')).toBe('child_process');
      expect(service.getIsolationMode('calc')).toBeUndefined();
    });

    it('Should skip corrupted JSON files without throwing', async () => {
      fs.writeFileSync(path.join(tempDir, 'broken.json'), '{ not valid json !!');
      const service = makeService();

      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect(service.getConfig('broken')).toEqual({});
      expect(Object.keys(service.getAllConfigs())).toHaveLength(0);
    });

    it('Should skip non-object JSON configs (e.g. a bare string)', async () => {
      fs.writeFileSync(path.join(tempDir, 'scalar.json'), JSON.stringify('just-a-string'));
      const service = makeService();

      await service.onModuleInit();

      expect(service.getConfig('scalar')).toEqual({});
    });
  });

  // -------------------------------------------------------------
  // Read
  // -------------------------------------------------------------
  describe('getConfig / getActivated / getIsolationMode', () => {
    it('Should return an empty object for an unknown plugin', async () => {
      const service = makeService();
      await service.onModuleInit();

      expect(service.getConfig('unknown')).toEqual({});
      expect(service.getActivated('unknown')).toBeUndefined();
      expect(service.getIsolationMode('unknown')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------
  // Write + persistence
  // -------------------------------------------------------------
  describe('setActivated', () => {
    it('Should persist activated=true to {dir}/{protocol}.json immediately', async () => {
      const service = makeService();
      await service.onModuleInit();

      service.setActivated('mqtt', true);

      expect(readConfigFile(tempDir, 'mqtt')).toEqual({ activated: true });
      expect(service.getActivated('mqtt')).toBe(true);
    });

    it('Should persist activated=false so a restart stays deactivated', async () => {
      const service = makeService();
      await service.onModuleInit();

      service.setActivated('modbus_tcp', false);

      expect(readConfigFile(tempDir, 'modbus_tcp')).toEqual({ activated: false });
      expect(service.getActivated('modbus_tcp')).toBe(false);
    });
  });

  describe('saveConfig', () => {
    it('Should merge fields instead of replacing the whole config', async () => {
      const service = makeService();
      await service.onModuleInit();

      service.setIsolationMode('mqtt', 'worker_thread');
      service.setActivated('mqtt', true);

      expect(readConfigFile(tempDir, 'mqtt')).toEqual({
        isolationMode: 'worker_thread',
        activated: true,
      });
    });

    it('Should drop undefined fields from the merged config', async () => {
      const service = makeService();
      await service.onModuleInit();

      service.setIsolationMode('mqtt', 'child_process');
      service.saveConfig('mqtt', { isolationMode: undefined });

      // undefined fields are deleted from the merged config, not kept
      expect(service.getIsolationMode('mqtt')).toBeUndefined();
      expect(readConfigFile(tempDir, 'mqtt')).toEqual({});
    });
  });

  // -------------------------------------------------------------
  // Restart simulation
  // -------------------------------------------------------------
  describe('restart simulation', () => {
    it('Should restore the activation state written before a restart via a new instance', async () => {
      // First "run": user deactivates mqtt and activates calc
      const firstRun = makeService();
      await firstRun.onModuleInit();
      firstRun.setActivated('mqtt', false);
      firstRun.setActivated('calc', true);
      firstRun.setIsolationMode('mqtt', 'child_process');

      // Second "run": brand-new service instance loads from disk again
      const secondRun = makeService();
      await secondRun.onModuleInit();

      expect(secondRun.getActivated('mqtt')).toBe(false);
      expect(secondRun.getActivated('calc')).toBe(true);
      expect(secondRun.getIsolationMode('mqtt')).toBe('child_process');
    });
  });

  // -------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------
  describe('deleteConfig', () => {
    it('Should remove the config file and the cache entry', async () => {
      const service = makeService();
      await service.onModuleInit();
      service.setActivated('mqtt', true);

      service.deleteConfig('mqtt');

      expect(fs.existsSync(path.join(tempDir, 'mqtt.json'))).toBe(false);
      expect(service.getConfig('mqtt')).toEqual({});
    });

    it('Should not throw when deleting a plugin without a config file', async () => {
      const service = makeService();
      await service.onModuleInit();

      expect(() => service.deleteConfig('unknown')).not.toThrow();
    });
  });
});
