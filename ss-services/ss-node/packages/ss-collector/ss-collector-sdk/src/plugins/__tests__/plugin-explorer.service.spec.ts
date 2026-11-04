// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { PluginExplorerService } from '../plugin-explorer.service';
import { COLLECTOR_PLUGIN_META } from '../plugin.decorator';
import { CollectorPluginMeta, IProviderScanner } from '../plugin.types';
import { IsolationMode, PluginCategory } from '../plugin.types';

// ============================================================
// Helpers
// ============================================================

function makePluginMeta(overrides: Partial<CollectorPluginMeta> = {}): CollectorPluginMeta {
  return {
    protocol: 'virtual',
    displayName: 'Virtual',
    version: '1.0.0',
    description: 'Virtual collector plugin',
    category: PluginCategory.INDUSTRIAL_BUS,
    transport: 'tcp',
    connectionSchema: { type: 'object', properties: {} },
    defaultConnection: {},
    supportedDataTypes: ['int16'],
    enabledByDefault: true,
    isolationMode: IsolationMode.IN_PROCESS,
    ...overrides,
  };
}

interface ExplorerHarness {
  service: PluginExplorerService;
  registry: any;
  configService: any;
  isolationFactory: any;
}

function makeService(overrides: {
  registry?: any;
  configService?: any;
  isolationFactory?: any;
  meta?: CollectorPluginMeta;
}): ExplorerHarness {
  const meta = overrides.meta ?? makePluginMeta();

  class DummyPlugin {
    connect = jest.fn();
  }
  Reflect.defineMetadata(COLLECTOR_PLUGIN_META, meta, DummyPlugin);

  const registry = overrides.registry ?? {
    register: jest.fn(),
    activate: jest.fn().mockResolvedValue(undefined),
    getPlugin: jest.fn().mockReturnValue(undefined),
  };
  const providerScanner: IProviderScanner = {
    getProviders: jest
      .fn()
      .mockReturnValue([{ instance: new DummyPlugin(), metatype: DummyPlugin }]),
  };
  const configService = overrides.configService ?? {
    getIsolationMode: jest.fn().mockReturnValue(undefined),
    getActivated: jest.fn().mockReturnValue(undefined),
  };
  const isolationFactory = overrides.isolationFactory ?? {
    prepare: jest.fn().mockResolvedValue(undefined),
  };

  const service = new PluginExplorerService(
    registry,
    providerScanner,
    configService,
    undefined,
    isolationFactory,
  );
  return { service, registry, configService, isolationFactory };
}

// ============================================================
// Test suite
// ============================================================

describe('PluginExplorerService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------
  // Activation-state restore (restart persistence)
  // -------------------------------------------------------------
  describe('activation-state restore priority', () => {
    it('persisted activated=false should stay deactivated even when enabledByDefault=true (bugfix regression)', async () => {
      const { service, registry, isolationFactory } = makeService({
        configService: {
          getIsolationMode: jest.fn().mockReturnValue(undefined),
          getActivated: jest.fn().mockReturnValue(false),
        },
      });

      await service.onModuleInit();

      expect(registry.register).toHaveBeenCalled();
      expect(registry.activate).not.toHaveBeenCalled();
      expect(isolationFactory.prepare).not.toHaveBeenCalled();
    });

    it('persisted activated=true should restore activation', async () => {
      const { service, registry } = makeService({
        configService: {
          getIsolationMode: jest.fn().mockReturnValue(undefined),
          getActivated: jest.fn().mockReturnValue(true),
        },
      });

      await service.onModuleInit();

      expect(registry.activate).toHaveBeenCalledWith('virtual');
    });

    it('persisted activated=true should also pre-warm the executor when the plugin becomes active', async () => {
      const { service, registry, isolationFactory } = makeService({
        configService: {
          getIsolationMode: jest.fn().mockReturnValue(undefined),
          getActivated: jest.fn().mockReturnValue(true),
        },
        registry: {
          register: jest.fn(),
          activate: jest.fn().mockResolvedValue(undefined),
          getPlugin: jest.fn().mockReturnValue({ status: 'active' }),
        },
      });

      await service.onModuleInit();

      expect(registry.activate).toHaveBeenCalled();
      expect(isolationFactory.prepare).toHaveBeenCalledWith('virtual');
    });

    it('no persisted state + enabledByDefault=true should auto-activate', async () => {
      const { service, registry } = makeService({});

      await service.onModuleInit();

      expect(registry.activate).toHaveBeenCalledWith('virtual');
    });

    it('no persisted state + enabledByDefault=false should stay deactivated', async () => {
      const { service, registry } = makeService({
        meta: makePluginMeta({ enabledByDefault: false }),
      });

      await service.onModuleInit();

      expect(registry.activate).not.toHaveBeenCalled();
    });

    it('a deactivated plugin should not spawn a collector process (no pre-warm)', async () => {
      const { service, isolationFactory } = makeService({
        configService: {
          getIsolationMode: jest.fn().mockReturnValue(undefined),
          getActivated: jest.fn().mockReturnValue(false),
        },
        registry: {
          register: jest.fn(),
          activate: jest.fn(),
          getPlugin: jest.fn().mockReturnValue({ status: 'inactive' }),
        },
      });

      await service.onModuleInit();

      expect(isolationFactory.prepare).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------
  // Isolation-mode override
  // -------------------------------------------------------------
  describe('isolation-mode override', () => {
    it('persisted isolationMode should override the decorator default', async () => {
      const meta = makePluginMeta({ isolationMode: IsolationMode.IN_PROCESS });
      const { service } = makeService({
        meta,
        configService: {
          getIsolationMode: jest.fn().mockReturnValue('child_process'),
          getActivated: jest.fn().mockReturnValue(undefined),
        },
      });

      await service.onModuleInit();

      expect(meta.isolationMode).toBe('child_process');
    });

    it('no persisted isolationMode should keep the decorator default', async () => {
      const meta = makePluginMeta({ isolationMode: IsolationMode.IN_PROCESS });
      const { service } = makeService({ meta });

      await service.onModuleInit();

      expect(meta.isolationMode).toBe('in_process');
    });
  });

  // -------------------------------------------------------------
  // Error tolerance
  // -------------------------------------------------------------
  describe('error tolerance', () => {
    it('a registry failure should not break onModuleInit (error is caught and logged)', async () => {
      const { service } = makeService({
        registry: {
          register: jest.fn().mockImplementation(() => {
            throw new Error('register failed');
          }),
          activate: jest.fn(),
          getPlugin: jest.fn().mockReturnValue(undefined),
        },
      });

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it('providers without plugin metadata should be ignored', async () => {
      class PlainProvider {}
      const providerScanner: IProviderScanner = {
        getProviders: jest
          .fn()
          .mockReturnValue([
            { instance: new PlainProvider(), metatype: PlainProvider },
            { instance: null, metatype: null },
          ]),
      };
      const registry = {
        register: jest.fn(),
        activate: jest.fn().mockResolvedValue(undefined),
        getPlugin: jest.fn().mockReturnValue(undefined),
      };
      const service = new PluginExplorerService(
        registry as any,
        providerScanner,
        {
          getIsolationMode: jest.fn(),
          getActivated: jest.fn(),
        } as any,
        undefined,
        { prepare: jest.fn().mockResolvedValue(undefined) } as any,
      );

      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect(registry.register).not.toHaveBeenCalled();
    });
  });
});
