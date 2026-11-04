// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import { PluginRegistry } from '../plugin-registry';
import { PluginConfigService } from '../plugin-config.service';
import { EventBusService } from '@ss-node/ss-core';
import {
  CollectorPluginMeta,
  PluginCategory,
  PluginMetrics,
  RegisteredPlugin,
  IsolationMode,
} from '../plugin.types';

// ============================================================
// Mock factories
// ============================================================

function makeMeta(overrides: Partial<CollectorPluginMeta> = {}): CollectorPluginMeta {
  return {
    protocol: 'modbus_tcp',
    displayName: 'Modbus TCP',
    version: '1.0.0',
    description: 'Modbus TCP collection plugin',
    category: PluginCategory.INDUSTRIAL_BUS,
    transport: 'tcp',
    connectionSchema: { type: 'object', properties: {} },
    defaultConnection: { host: '127.0.0.1', port: 502 },
    supportedDataTypes: ['int16', 'uint16', 'float32'],
    enabledByDefault: true,
    isolationMode: IsolationMode.IN_PROCESS,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<PluginMetrics> = {}): PluginMetrics {
  return {
    totalConnections: 0,
    activeConnections: 0,
    totalReads: 0,
    totalErrors: 0,
    avgResponseTime: 0,
    uptime: 0,
    lastActivity: null,
    ...overrides,
  };
}

interface RegistryFixture {
  registry: PluginRegistry;
  adapter: Record<string, jest.Mock>;
  eventBus: { on: jest.Mock; emit: jest.Mock };
  configService: { setActivated: jest.Mock };
}

function createRegistry(options: { withConfigService?: boolean } = {}): RegistryFixture {
  const adapter = {
    connect: jest.fn(),
    disconnect: jest.fn(),
    readTag: jest.fn(),
    writeTag: jest.fn(),
    validateChannelConfig: jest.fn(),
    onActivate: jest.fn().mockResolvedValue(undefined),
    onDeactivate: jest.fn().mockResolvedValue(undefined),
  };
  const eventBus = { on: jest.fn(), emit: jest.fn() };
  const configService = { setActivated: jest.fn() };
  const registry = new PluginRegistry(
    eventBus as unknown as EventBusService,
    options.withConfigService === false
      ? undefined
      : (configService as unknown as PluginConfigService),
  );
  registry.register(makeMeta(), adapter as any);
  return { registry, adapter, eventBus, configService };
}

// ============================================================
// Test suite
// ============================================================

describe('PluginRegistry — activate/deactivate persistence and events', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('activate', () => {
    it('should set the status to active and persist activated=true', async () => {
      const { registry, configService } = createRegistry();

      await registry.activate('modbus_tcp');

      expect(registry.getPlugin('modbus_tcp')!.status).toBe('active');
      expect(registry.getPlugin('modbus_tcp')!.activatedAt).toBeInstanceOf(Date);
      expect(configService.setActivated).toHaveBeenCalledWith('modbus_tcp', true);
    });

    it('should call the adapter onActivate lifecycle hook', async () => {
      const { registry, adapter } = createRegistry();

      await registry.activate('modbus_tcp');

      expect(adapter.onActivate).toHaveBeenCalledTimes(1);
    });

    it('should emit the plugin.activated event', async () => {
      const { registry, eventBus } = createRegistry();

      await registry.activate('modbus_tcp');

      expect(eventBus.emit).toHaveBeenCalledWith(
        'plugin.activated',
        expect.objectContaining({ protocol: 'modbus_tcp', status: 'active' }),
      );
    });

    it('should stay active when the adapter onActivate hook throws', async () => {
      const { registry, adapter } = createRegistry();
      adapter.onActivate.mockRejectedValue(new Error('onActivate failed'));

      await expect(registry.activate('modbus_tcp')).resolves.toBeUndefined();

      expect(registry.getPlugin('modbus_tcp')!.status).toBe('active');
    });

    it('should work without an injected PluginConfigService (optional dependency)', async () => {
      const { registry } = createRegistry({ withConfigService: false });

      await expect(registry.activate('modbus_tcp')).resolves.toBeUndefined();
      expect(registry.getPlugin('modbus_tcp')!.status).toBe('active');
    });
  });

  describe('deactivate', () => {
    it('should set the status to inactive and persist activated=false', async () => {
      const { registry, configService } = createRegistry();
      await registry.activate('modbus_tcp');
      configService.setActivated.mockClear();

      await registry.deactivate('modbus_tcp');

      expect(registry.getPlugin('modbus_tcp')!.status).toBe('inactive');
      expect(configService.setActivated).toHaveBeenCalledWith('modbus_tcp', false);
    });

    it('should call the adapter onDeactivate lifecycle hook', async () => {
      const { registry, adapter } = createRegistry();

      await registry.deactivate('modbus_tcp');

      expect(adapter.onDeactivate).toHaveBeenCalledTimes(1);
    });

    it('should emit the plugin.deactivated event', async () => {
      const { registry, eventBus } = createRegistry();

      await registry.deactivate('modbus_tcp');

      expect(eventBus.emit).toHaveBeenCalledWith(
        'plugin.deactivated',
        expect.objectContaining({ protocol: 'modbus_tcp', status: 'inactive' }),
      );
    });

    it('should not throw when the adapter onDeactivate hook throws', async () => {
      const { registry, adapter } = createRegistry();
      adapter.onDeactivate.mockRejectedValue(new Error('onDeactivate failed'));

      await expect(registry.deactivate('modbus_tcp')).resolves.toBeUndefined();
      expect(registry.getPlugin('modbus_tcp')!.status).toBe('inactive');
    });
  });

  describe('getAdapter', () => {
    it('should throw when the plugin is inactive', async () => {
      const { registry } = createRegistry();

      expect(() => registry.getAdapter('modbus_tcp')).not.toThrow(); // registered

      await registry.deactivate('modbus_tcp');
      expect(() => registry.getAdapter('modbus_tcp')).toThrow('Plugin is not active');
    });
  });
});
