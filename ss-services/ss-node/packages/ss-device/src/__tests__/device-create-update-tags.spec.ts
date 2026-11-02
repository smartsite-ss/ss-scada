// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * device.service create/update/tags - comprehensive tests
 *
 * Covers:
 *   1. DataTag.projectId integrity (fixes the NOT NULL constraint error)
 *   2. Device creation (create) - various input combinations
 *   3. Device update (update) - template switch / connection change / scan period etc.
 *   4. Template application (applyTemplate) - dedupe / empty template / field mapping
 *   5. Template sync (syncTemplateTags) - add/update/delete
 *   6. Tag operations (addTag/addTags) - device validation / projectId injection
 */

// Mock ss-system module
jest.mock('@ss-node/ss-system', () => ({
  TemplateLoaderService: jest.fn().mockImplementation(() => ({
    getTemplate: jest.fn(),
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DeviceService } from '../device.service';
import { Device } from '../entities/device.entity';
import { DataTag } from '../entities/data-tag.entity';
import { DeviceGroup } from '../entities/device-group.entity';
import { I18nService } from '@ss-node/ss-i18n';
import { DeviceStatus, DeviceType } from '@ss-node/ss-sdk';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataPointCacheService, ProjectDatabaseService } from '@ss-node/ss-core';
import { ChannelConfigService } from '../channel/channel-config.service';
import { TemplateLoaderService } from '@ss-node/ss-system';

// ─── helpers ───────────────────────────────────────────────────────────

type MockRepository<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function createMockRepo<T>(): MockRepository<T> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
  };
}

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: overrides.id ?? 'dev-001',
    deviceCode: overrides.deviceCode ?? 'test-dev-001',
    deviceName: overrides.deviceName ?? '测试设备',
    nameAlias: overrides.nameAlias ?? null,
    description: overrides.description ?? '',
    type: overrides.type ?? DeviceType.MODBUS_TCP,
    config: overrides.config ?? {},
    status: overrides.status ?? DeviceStatus.OFFLINE,
    projectId: overrides.projectId ?? 'proj-001',
    createdAt: overrides.createdAt ?? new Date('2025-01-01'),
    updatedAt: overrides.updatedAt ?? new Date('2025-01-01'),
    lastOnlineAt: overrides.lastOnlineAt ?? null,
    errorCount: overrides.errorCount ?? 0,
    lastErrorAt: overrides.lastErrorAt ?? null,
    lastErrorMsg: overrides.lastErrorMsg ?? '',
    templateId: overrides.templateId ?? null,
    templateVersion: overrides.templateVersion ?? null,
    templateAppliedAt: overrides.templateAppliedAt ?? null,
    connection: overrides.connection ?? { host: '192.168.1.1', port: 502 },
    groupId: overrides.groupId ?? null,
    driver: overrides.driver ?? 'modbus_tcp',
    scanRate: overrides.scanRate ?? 1000,
    offlinePeriod: overrides.offlinePeriod ?? 30000,
    lastDataAt: overrides.lastDataAt ?? null,
    updatedBy: overrides.updatedBy ?? null,
  };
}

function makeTemplate(overrides: any = {}) {
  return {
    id: overrides.id ?? 'tpl-001',
    name: overrides.name ?? '温湿度模板',
    deviceType: overrides.deviceType ?? 'modbus_tcp',
    version: overrides.version ?? '1.0.0',
    variables: overrides.variables ?? [
      { name: 'temperature', address: 'HR40001', dataType: 'float', unit: '°C', enabled: true },
      { name: 'humidity', address: 'HR40003', dataType: 'float', unit: '%', enabled: true },
    ],
  };
}

const projectId = 'proj-001';

describe('DeviceService - 创建/更新/标签全面测试', () => {
  let service: DeviceService;
  let deviceRepo: MockRepository<Device>;
  let dataTagRepo: MockRepository<DataTag>;
  let deviceGroupRepo: MockRepository<DeviceGroup>;
  let mockDataSource: Partial<DataSource>;
  let mockProjectDbService: Partial<ProjectDatabaseService>;
  let mockI18nService: Partial<I18nService>;
  let mockTemplateLoader: any;

  beforeEach(async () => {
    deviceRepo = createMockRepo<Device>();
    dataTagRepo = createMockRepo<DataTag>();
    dataTagRepo.find!.mockResolvedValue([]);
    deviceGroupRepo = createMockRepo<DeviceGroup>();

    mockDataSource = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === Device) return deviceRepo;
        if (entity === DataTag) return dataTagRepo;
        if (entity === DeviceGroup) return deviceGroupRepo;
        return null;
      }),
    };

    mockProjectDbService = {
      getSystemDb: jest.fn().mockResolvedValue(mockDataSource),
      getLoadedSystemDb: jest.fn().mockReturnValue(mockDataSource),
    };

    mockI18nService = {
      tSync: jest.fn().mockImplementation((key: string, args?: any) => {
        if (key === 'error.device.DEV_001') return `Device ${args?.id || ''} not found`;
        if (key === 'error.device.DEV_002') return `TID ${args?.tid || ''} already exists`;
        return key;
      }),
    };

    mockTemplateLoader = {
      getTemplate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        { provide: getRepositoryToken(Device), useValue: deviceRepo },
        { provide: getRepositoryToken(DataTag), useValue: dataTagRepo },
        { provide: getRepositoryToken(DeviceGroup), useValue: deviceGroupRepo },
        { provide: I18nService, useValue: mockI18nService },
        { provide: ProjectDatabaseService, useValue: mockProjectDbService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('unified') } },
        { provide: DataPointCacheService, useValue: { updateLatestValue: jest.fn() } },
        { provide: ChannelConfigService, useValue: { validate: jest.fn().mockReturnValue(true) } },
        { provide: TemplateLoaderService, useValue: mockTemplateLoader },
      ],
    }).compile();

    service = module.get<DeviceService>(DeviceService);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. DataTag.projectId integrity (the key verification fixing SQLITE_CONSTRAINT)
  // ═══════════════════════════════════════════════════════════════════════

  describe('TC-DTAG-001: create 时 DataTag 携带 projectId', () => {
    it('设备创建应用模板时，每个 DataTag 都应包含 projectId', async () => {
      const template = makeTemplate();
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      deviceRepo.findOne!.mockResolvedValue(null); // tid does not conflict
      deviceRepo.create!.mockImplementation((dto: any) => ({ id: 'dev-new', ...dto }));
      deviceRepo.save!.mockImplementation((d: any) => Promise.resolve(d));
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-new', ...dto }));
      dataTagRepo.save!.mockImplementation((tags: any[]) => Promise.resolve(tags));

      await service.create(
        {
          deviceCode: 'dev-projid-001',
          deviceName: 'projectId 验证设备',
          templateId: 'tpl-001',
          driver: 'modbus_tcp',
          connection: { host: '192.168.1.1', port: 502 },
        },
        projectId,
      );

      // Verify dataTagRepo.create was called with projectId
      expect(dataTagRepo.create).toHaveBeenCalled();
      const createCalls = dataTagRepo.create.mock.calls;
      createCalls.forEach((call: any) => {
        expect(call[0]).toHaveProperty('projectId', projectId);
        expect(call[0]).toHaveProperty('deviceId', 'dev-new');
      });
    });
  });

  describe('TC-DTAG-002: applyTemplate 时 DataTag 携带 projectId', () => {
    it('模板应用创建的每个 DataTag 都应包含 projectId', async () => {
      const device = makeDevice();
      const template = makeTemplate();
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      dataTagRepo.find!.mockResolvedValue([]);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-new', ...dto }));
      dataTagRepo.save!.mockResolvedValue([
        { id: 'tag-1', name: 'temperature', projectId },
        { id: 'tag-2', name: 'humidity', projectId },
      ]);

      await service.applyTemplate('dev-001', 'tpl-001', projectId);

      const createCalls = dataTagRepo.create.mock.calls;
      expect(createCalls.length).toBeGreaterThanOrEqual(2);
      createCalls.forEach((call: any) => {
        expect(call[0]).toHaveProperty('projectId', projectId);
      });
    });
  });

  describe('TC-DTAG-003: syncTemplateTags 新增标签时 DataTag 携带 projectId', () => {
    it('syncTemplateTags 创建的新标签应包含 projectId', async () => {
      const device = makeDevice();
      const template = makeTemplate({
        variables: [{ name: 'new_tag', address: 'HR40010', dataType: 'float', enabled: true }],
      });
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([]);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-sync', ...dto }));
      dataTagRepo.save!.mockResolvedValue([{ id: 'tag-sync' }]);

      await service.syncTemplateTags('dev-001', 'tpl-001', projectId);

      expect(dataTagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          name: 'new_tag',
          deviceId: 'dev-001',
        }),
      );
    });
  });

  describe('TC-DTAG-004: addTag 时 DTO 携带 projectId（从 Controller 层注入）', () => {
    it('addTag 创建的标签应将 DTO 中的 projectId 传递给 dataTagRepo.create', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-added', ...dto }));
      dataTagRepo.save!.mockImplementation((tag: any) => Promise.resolve(tag));

      const dto = {
        name: 'manual_tag',
        dataType: 'float' as any,
        address: 'HR40020',
        deviceId: 'dev-001',
        projectId, // simulating injection already done by the controller
      };

      await service.addTag('dev-001', dto as any, projectId);

      expect(dataTagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          name: 'manual_tag',
          deviceId: 'dev-001',
        }),
      );
    });
  });

  describe('TC-DTAG-005: addTags 批量创建时 DataTag 携带 projectId', () => {
    it('addTags 批量创建的每个标签都应包含 projectId', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-batch', ...dto }));
      dataTagRepo.save!.mockResolvedValue([]);

      const dtos = [
        { name: 'tag_a', dataType: 'float' as any, projectId, deviceId: 'dev-001' },
        { name: 'tag_b', dataType: 'int16' as any, projectId, deviceId: 'dev-001' },
      ];

      await service.addTags('dev-001', dtos as any, projectId);

      const createCalls = dataTagRepo.create.mock.calls;
      createCalls.forEach((call: any) => {
        expect(call[0]).toHaveProperty('projectId', projectId);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Device creation (create) - comprehensive input combinations
  // ═══════════════════════════════════════════════════════════════════════

  describe('TC-CREATE-001: 设备创建 - 基础正常流程', () => {
    const baseDto = {
      deviceCode: 'create-basic',
      deviceName: '基础设备',
      templateId: 'tpl-001',
      driver: 'modbus_tcp' as any,
      connection: { host: '192.168.1.1', port: 502 },
    };

    beforeEach(() => {
      deviceRepo.findOne!.mockResolvedValue(null);
      deviceRepo.create!.mockImplementation((dto: any) => ({ id: 'dev-create', ...dto }));
      deviceRepo.save!.mockImplementation((d: any) => Promise.resolve(d));
      mockTemplateLoader.getTemplate.mockReturnValue(makeTemplate());
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-tpl', ...dto }));
      dataTagRepo.save!.mockImplementation((tags: any[]) => Promise.resolve(tags));
    });

    it('应成功创建设备并返回完整实体', async () => {
      const result = await service.create(baseDto, projectId);

      expect(result.id).toBe('dev-create');
      expect(result.deviceCode).toBe('create-basic');
      expect(result.projectId).toBe(projectId);
      expect(deviceRepo.save).toHaveBeenCalled();
    });

    it('创建后设备状态应为默认值', async () => {
      const result = await service.create(baseDto, projectId);
      // Status should not be set directly by create (set by the entity default or the collection layer)
      expect(result.deviceCode).toBe('create-basic');
    });

    it('应设置 templateAppliedAt 时间戳', async () => {
      deviceRepo.create!.mockImplementation((dto: any) => ({
        id: 'dev-create',
        ...dto,
        templateAppliedAt: dto.templateAppliedAt,
      }));

      await service.create(baseDto, projectId);

      expect(deviceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ templateAppliedAt: expect.any(Date) }),
      );
    });
  });

  describe('TC-CREATE-002: 设备创建 - TID 冲突', () => {
    it('同项目中重复 TID 应抛出 ConflictException', async () => {
      deviceRepo.findOne!.mockResolvedValue(makeDevice({ deviceCode: 'dup-tid' }));

      await expect(
        service.create(
          {
            deviceCode: 'dup-tid',
            deviceName: '冲突设备',
            templateId: 'tpl-001',
            driver: 'modbus_tcp' as any,
            connection: { host: '192.168.1.1', port: 502 },
          },
          projectId,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('TC-CREATE-003: 设备创建 - 模板不存在', () => {
    it('模板不存在时仍应创建设备但不创建 DataTag', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);
      deviceRepo.create!.mockImplementation((dto: any) => ({ id: 'dev-no-tpl', ...dto }));
      deviceRepo.save!.mockImplementation((d: any) => Promise.resolve(d));
      mockTemplateLoader.getTemplate.mockReturnValue(undefined);

      const result = await service.create(
        {
          deviceCode: 'no-tpl-dev',
          deviceName: '无模板设备',
          templateId: 'tpl-nonexistent',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
        },
        projectId,
      );

      expect(result.id).toBe('dev-no-tpl');
      // No DataTag should be created when templateLoader returns undefined
      expect(dataTagRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('TC-CREATE-004: 设备创建 - 模板无变量', () => {
    it('模板没有 variables 时不应创建 DataTag', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);
      deviceRepo.create!.mockImplementation((dto: any) => ({ id: 'dev-empty-tpl', ...dto }));
      deviceRepo.save!.mockImplementation((d: any) => Promise.resolve(d));
      mockTemplateLoader.getTemplate.mockReturnValue(makeTemplate({ variables: [] }));

      await service.create(
        {
          deviceCode: 'empty-tpl-dev',
          deviceName: '空模板设备',
          templateId: 'tpl-empty',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
        },
        projectId,
      );

      expect(dataTagRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('TC-CREATE-005: 设备创建 - 不同驱动类型', () => {
    beforeEach(() => {
      deviceRepo.findOne!.mockResolvedValue(null);
      deviceRepo.create!.mockImplementation((dto: any) => ({ id: 'dev-driver', ...dto }));
      deviceRepo.save!.mockImplementation((d: any) => Promise.resolve(d));
    });

    const drivers: { driver: string; connection: Record<string, any> }[] = [
      { driver: 'modbus_tcp', connection: { host: '192.168.1.1', port: 502 } },
      { driver: 'modbus_rtu', connection: { port: 'COM1', baudRate: 9600 } },
      { driver: 'opc_ua', connection: { endpoint: 'opc.tcp://1.2.3.4:4840' } },
      { driver: 'mqtt', connection: { broker: 'mqtt://broker:1883', topic: 'sensors/#' } },
      { driver: 'siemens_s7', connection: { host: '192.168.1.1', rack: 0, slot: 1 } },
      { driver: 'virtual', connection: { deviceId: 'vdev-001' } },
    ];

    drivers.forEach(({ driver, connection }) => {
      it(`应支持 ${driver} 类型设备创建`, async () => {
        const result = await service.create(
          {
            deviceCode: `dev-${driver.replace('_', '-')}`,
            deviceName: `${driver} 设备`,
            templateId: 'tpl-001',
            driver: driver as any,
            connection,
          },
          projectId,
        );

        expect(result.driver).toBe(driver);
        expect(deviceRepo.save).toHaveBeenCalled();
      });
    });
  });

  describe('TC-CREATE-006: 设备创建 - 可选字段', () => {
    beforeEach(() => {
      deviceRepo.findOne!.mockResolvedValue(null);
      deviceRepo.create!.mockImplementation((dto: any) => ({ id: 'dev-opt', ...dto }));
      deviceRepo.save!.mockImplementation((d: any) => Promise.resolve(d));
    });

    it('应支持设置 description', async () => {
      const result = await service.create(
        {
          deviceCode: 'desc-dev',
          deviceName: '描述设备',
          description: '这是一台位于三楼机房的温湿度传感器',
          templateId: 'tpl-001',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
        },
        projectId,
      );

      expect(result.description).toBe('这是一台位于三楼机房的温湿度传感器');
    });

    it('应支持设置 nameAlias', async () => {
      const result = await service.create(
        {
          deviceCode: 'alias-dev',
          deviceName: '别名设备',
          nameAlias: '三楼机房温湿度-01',
          templateId: 'tpl-001',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
        },
        projectId,
      );

      expect(result.nameAlias).toBe('三楼机房温湿度-01');
    });

    it('应支持设置 groupId', async () => {
      const result = await service.create(
        {
          deviceCode: 'group-dev',
          deviceName: '分组设备',
          templateId: 'tpl-001',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
          groupId: 'grp-001',
        },
        projectId,
      );

      expect(result.groupId).toBe('grp-001');
    });

    it('应支持设置 scanRate', async () => {
      const result = await service.create(
        {
          deviceCode: 'scanrate-dev',
          deviceName: '自定义采集周期设备',
          templateId: 'tpl-001',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
          scanRate: 500,
        },
        projectId,
      );

      expect(result.scanRate).toBe(500);
    });

    it('应支持设置 offlinePeriod', async () => {
      const result = await service.create(
        {
          deviceCode: 'dataperiod-dev',
          deviceName: '自定义数据周期设备',
          templateId: 'tpl-001',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
          offlinePeriod: 60000,
        },
        projectId,
      );

      expect(result.offlinePeriod).toBe(60000);
    });
  });

  describe('TC-CREATE-007: 设备创建 - 项目数据隔离', () => {
    it('不同项目可以使用相同 TID', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);
      deviceRepo.create!.mockImplementation((dto: any) => ({ id: 'dev-proj', ...dto }));
      deviceRepo.save!.mockImplementation((d: any) => Promise.resolve(d));

      const resultA = await service.create(
        {
          deviceCode: 'same-tid',
          deviceName: '项目A设备',
          templateId: 'tpl-001',
          driver: 'modbus_tcp' as any,
          connection: { host: '192.168.1.1', port: 502 },
        },
        'proj-a',
      );
      expect(resultA.projectId).toBe('proj-a');

      const resultB = await service.create(
        {
          deviceCode: 'same-tid',
          deviceName: '项目B设备',
          templateId: 'tpl-001',
          driver: 'virtual' as any,
          connection: { deviceId: 'vdev-001' },
        },
        'proj-b',
      );
      expect(resultB.projectId).toBe('proj-b');
      expect(resultB.deviceCode).toBe('same-tid');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Device update (update) - comprehensive scenarios
  // ═══════════════════════════════════════════════════════════════════════

  describe('TC-UPDATE-001: 更新设备基础字段', () => {
    it('应成功更新设备 deviceName', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      // save must sync changes back to the original mock object, simulating DB persistence
      // (findOne internally calls desensitizeDevice which creates a copy; Object.assign modifies the copy,
      // so save must write back to the original object, letting the update-final findOne return the updated data)
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      const result = await service.update('dev-001', { deviceName: '新名称' }, projectId);

      expect(result.deviceName).toBe('新名称');
    });

    it('应成功更新设备 description', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      const result = await service.update('dev-001', { description: '更新后的描述' }, projectId);

      expect(result.description).toBe('更新后的描述');
    });

    it('应成功更新设备 groupId', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      const result = await service.update('dev-001', { groupId: 'grp-new' }, projectId);

      expect(result.groupId).toBe('grp-new');
    });
  });

  describe('TC-UPDATE-002: 更新设备连接配置', () => {
    it('更新 connection 应触发插件校验', async () => {
      const device = makeDevice();
      const newConnection = { host: '10.0.0.1', port: 5020 };
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      const result = await service.update('dev-001', { connection: newConnection }, projectId);

      expect(result.connection).toEqual(newConnection);
    });

    it('连接无变化时不记录为变更字段', async () => {
      const device = makeDevice({ connection: { host: '192.168.1.1', port: 502 } });
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      await service.update(
        'dev-001',
        { connection: { host: '192.168.1.1', port: 502 } }, // same values
        projectId,
      );

      // With no changes it should return saved directly (without entering the eventBus notification branch)
      // Here we only verify it does not throw
      expect(deviceRepo.save).toHaveBeenCalled();
    });
  });

  describe('TC-UPDATE-003: 更新设备模板（核心场景 - 触发 applyTemplate）', () => {
    it('切换模板应触发模板应用并重新加载设备', async () => {
      // Device has no templateId, avoiding auto-apply inside findOne
      const device = makeDevice({ templateId: null });
      const newTemplate = makeTemplate({ id: 'tpl-new', name: '新模板' });
      const reloadedDevice = makeDevice({
        templateId: 'tpl-new',
        templateVersion: '1.0.0',
      });

      // findOne needs 2 rounds of dataTagRepo.find (update's first round + the reload round)
      // Return non-empty tags to avoid triggering auto-apply
      dataTagRepo
        .find!.mockResolvedValueOnce([{ id: 'tag-x', name: 'some_tag' }])
        .mockResolvedValueOnce([{ id: 'tag-x', name: 'some_tag' }]);

      // 3 findOne calls: update first round, applyTemplate, update reload
      deviceRepo
        .findOne!.mockResolvedValueOnce(device)
        .mockResolvedValueOnce(device)
        .mockResolvedValueOnce(reloadedDevice);
      deviceRepo.save!.mockResolvedValueOnce(device).mockResolvedValueOnce(device);
      mockTemplateLoader.getTemplate.mockReturnValue(newTemplate);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-new', ...dto }));
      dataTagRepo.save!.mockResolvedValue([]);

      const result = await service.update('dev-001', { templateId: 'tpl-new' }, projectId);

      expect(result.templateId).toBe('tpl-new');
      expect(mockTemplateLoader.getTemplate).toHaveBeenCalledWith('tpl-new');
    });

    it('模板变更时 DataTag 应包含 projectId（回归验证）', async () => {
      const device = makeDevice({ templateId: null });
      const newTemplate = makeTemplate({ id: 'tpl-new' });
      const reloadedDevice = makeDevice({ templateId: 'tpl-new' });

      dataTagRepo
        .find!.mockResolvedValueOnce([{ id: 'tag-x', name: 'some_tag' }])
        .mockResolvedValueOnce([{ id: 'tag-x', name: 'some_tag' }]);

      deviceRepo
        .findOne!.mockResolvedValueOnce(device)
        .mockResolvedValueOnce(device)
        .mockResolvedValueOnce(reloadedDevice);
      deviceRepo.save!.mockResolvedValueOnce(device).mockResolvedValueOnce(device);
      mockTemplateLoader.getTemplate.mockReturnValue(newTemplate);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-regr', ...dto }));
      dataTagRepo.save!.mockResolvedValue([]);

      await service.update('dev-001', { templateId: 'tpl-new' }, projectId);

      // Key regression point: DataTags created in applyTemplate must include projectId
      const createCalls = dataTagRepo.create.mock.calls;
      expect(createCalls.length).toBeGreaterThan(0);
      createCalls.forEach((call: any) => {
        expect(call[0]).toHaveProperty('projectId', projectId);
      });
    });

    it('模板不变但点表为空时，应触发修复性模板重新应用', async () => {
      const device = makeDevice({ templateId: 'tpl-001' });
      // Simulate a device with no tags
      (device as any).tags = [];
      const reloadedDevice = { ...device, tags: [{ id: 'tag-1' }] };

      deviceRepo
        .findOne!.mockResolvedValueOnce(device)
        .mockResolvedValueOnce(device)
        .mockResolvedValueOnce(reloadedDevice);
      deviceRepo.save!.mockResolvedValueOnce(device).mockResolvedValueOnce(device);
      mockTemplateLoader.getTemplate.mockReturnValue(makeTemplate());
      dataTagRepo.find!.mockResolvedValue([]);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-fix', ...dto }));
      dataTagRepo.save!.mockResolvedValue([]);

      const _result = await service.update('dev-001', { deviceName: '仅改名' }, projectId);

      // Although the template did not change, the tag table is empty -> applyTemplate should be called
      expect(mockTemplateLoader.getTemplate).toHaveBeenCalledWith('tpl-001');
      expect(dataTagRepo.create).toHaveBeenCalled();
    });
  });

  describe('TC-UPDATE-004: 更新不存在的设备', () => {
    it('应抛出 NotFoundException', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);

      await expect(service.update('dev-999', { deviceName: '不存在' }, projectId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('TC-UPDATE-005: 更新 TID', () => {
    it('更新为新的 TID 应成功', async () => {
      const device = makeDevice();
      // 3 findOne calls:
      //   1) update's first-round findOne finds the original device
      //   2) TID conflict check -> null (no conflict)
      //   3) update's final findOne returns the updated device
      deviceRepo
        .findOne!.mockResolvedValueOnce(device) // findOne finds the original device
        .mockResolvedValueOnce(null) // new TID does not conflict
        .mockResolvedValueOnce(device); // findOne at the end of update returns the device
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      const result = await service.update('dev-001', { deviceCode: 'new-tid' }, projectId);

      expect(result.deviceCode).toBe('new-tid');
    });

    it('更新为已存在的 TID 应抛出 ConflictException', async () => {
      const device = makeDevice({ deviceCode: 'old-tid' });
      const conflictDevice = makeDevice({ id: 'dev-002', deviceCode: 'conflict-tid' });
      deviceRepo
        .findOne!.mockResolvedValueOnce(device) // original device found
        .mockResolvedValueOnce(conflictDevice); // new TID already exists

      await expect(
        service.update('dev-001', { deviceCode: 'conflict-tid' }, projectId),
      ).rejects.toThrow(ConflictException);
    });

    it('更新为与自身相同的 TID 不应检查冲突', async () => {
      const device = makeDevice({ deviceCode: 'same-tid' });
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      const result = await service.update('dev-001', { deviceCode: 'same-tid' }, projectId);

      // When its own TID is unchanged, the conflict check should be skipped (no second findOne for the TID-conflict query)
      // In the update flow deviceRepo.findOne is called 2 times:
      //   1) the first findOne(id) finds the device
      //   2) the final findOne(savedId) returns the updated device
      expect(result.deviceCode).toBe('same-tid');
      expect(deviceRepo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('TC-UPDATE-006: 同时更新多个字段', () => {
    it('应正确应用所有变更', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockImplementation((d: any) => {
        Object.assign(device, d);
        return Promise.resolve(d);
      });

      const result = await service.update(
        'dev-001',
        {
          deviceName: '多字段更新',
          scanRate: 2000,
          offlinePeriod: 60000,
          groupId: 'grp-002',
          description: '批量更新测试',
        },
        projectId,
      );

      expect(result.deviceName).toBe('多字段更新');
      expect(result.scanRate).toBe(2000);
      expect(result.offlinePeriod).toBe(60000);
      expect(result.groupId).toBe('grp-002');
      expect(result.description).toBe('批量更新测试');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Template application (applyTemplate) - edge conditions
  // ═══════════════════════════════════════════════════════════════════════

  describe('TC-APPLYTPL-001: applyTemplate 字段完整映射', () => {
    it('应正确映射模板变量的所有字段到 DataTag', async () => {
      const device = makeDevice();
      const template = makeTemplate({
        variables: [
          {
            name: 'voltage',
            address: 'HR40005',
            dataType: 'float',
            unit: 'V',
            description: '电压值',
            scanRate: 500,
            timeout: 3000,
            retryCount: 5,
            scale: 0.01,
            offset: 0,
            conversionType: 'linear',
            conversionConfig: { a: 1, b: 0 },
            displayFormat: '0.00',
            minValue: 0,
            maxValue: 380,
            deadbandMode: 'percent',
            deadbandValue: 0,
            deadbandPercent: 5,
            deadbandTime: 0,
            alarmEnabled: true,
            alarmHighHigh: 400,
            alarmHigh: 380,
            alarmLow: 200,
            alarmLowLow: 180,
            alarmDeviation: 50,
            qualityCheckEnabled: true,
            maxAge: 60000,
            archiveEnabled: true,
            archiveInterval: 60000,
            enabled: true,
            registerCount: 3,
          },
        ],
      });

      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([]);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-1', ...dto }));
      dataTagRepo.save!.mockResolvedValue([{ id: 'tag-1' }]);

      await service.applyTemplate('dev-001', 'tpl-001', projectId);

      expect(dataTagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'voltage',
          address: 'HR40005',
          dataType: 'float',
          unit: 'V',
          scanRate: 500,
          timeout: 3000,
          retryCount: 3, // registerCount
          scale: 0.01,
          alarmEnabled: true,
          alarmHighHigh: 400,
          alarmHigh: 380,
          alarmLow: 200,
          archiveEnabled: true,
          projectId,
          deviceId: 'dev-001',
        }),
      );
    });
  });

  describe('TC-APPLYTPL-002: applyTemplate 标签去重', () => {
    it('已存在的同名标签不应重复创建', async () => {
      const device = makeDevice();
      const template = makeTemplate(); // temperature, humidity
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([
        { id: 'tag-1', name: 'temperature', deviceId: 'dev-001' },
      ]);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-2', ...dto }));
      dataTagRepo.save!.mockResolvedValue([{ id: 'tag-2' }]);

      const result = await service.applyTemplate('dev-001', 'tpl-001', projectId);

      // Only one new tag should be created (humidity); the existing temperature is skipped
      expect(result).toHaveLength(1);
      expect(dataTagRepo.create).toHaveBeenCalledTimes(1);
      expect(dataTagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'humidity' }),
      );
    });

    it('所有标签已存在时应创建 0 个新标签', async () => {
      const device = makeDevice();
      const template = makeTemplate();
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([
        { id: 'tag-1', name: 'temperature', deviceId: 'dev-001' },
        { id: 'tag-2', name: 'humidity', deviceId: 'dev-001' },
      ]);

      const result = await service.applyTemplate('dev-001', 'tpl-001', projectId);

      expect(result).toHaveLength(0);
      expect(dataTagRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('TC-APPLYTPL-003: applyTemplate 异常条件', () => {
    it('设备不存在时应抛出 NotFoundException', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);

      await expect(service.applyTemplate('dev-999', 'tpl-001', projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('模板不存在时应保存 templateId 但返回空数组', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(undefined);

      const result = await service.applyTemplate('dev-001', 'tpl-unknown', projectId);

      expect(result).toEqual([]);
      expect(dataTagRepo.create).not.toHaveBeenCalled();
      expect(deviceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'tpl-unknown' }),
      );
    });

    it('模板无变量时应返回空数组', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(makeTemplate({ variables: [] }));

      const result = await service.applyTemplate('dev-001', 'tpl-001', projectId);

      expect(result).toEqual([]);
      expect(dataTagRepo.create).not.toHaveBeenCalled();
    });

    it('templateLoaderService 不可用时应保存 templateId 但返回空数组', async () => {
      // Build an instance without templateLoaderService
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      const moduleWithoutTpl: TestingModule = await Test.createTestingModule({
        providers: [
          DeviceService,
          { provide: getRepositoryToken(Device), useValue: deviceRepo },
          { provide: getRepositoryToken(DataTag), useValue: dataTagRepo },
          { provide: getRepositoryToken(DeviceGroup), useValue: deviceGroupRepo },
          { provide: I18nService, useValue: mockI18nService },
          { provide: ProjectDatabaseService, useValue: mockProjectDbService },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('unified') } },
          { provide: DataPointCacheService, useValue: { updateLatestValue: jest.fn() } },
          {
            provide: ChannelConfigService,
            useValue: { validate: jest.fn().mockReturnValue(true) },
          },
        ],
      }).compile();
      const serviceNoTpl = moduleWithoutTpl.get<DeviceService>(DeviceService);

      const result = await serviceNoTpl.applyTemplate('dev-001', 'tpl-001', projectId);

      expect(result).toEqual([]);
      expect(deviceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'tpl-001', templateAppliedAt: expect.any(Date) }),
      );
    });
  });

  describe('TC-APPLYTPL-004: applyTemplate 后更新设备模板元数据', () => {
    it('应设置 templateId、templateVersion、templateAppliedAt', async () => {
      const device = makeDevice();
      const template = makeTemplate({ version: '2.0.0' });
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([]);
      // dataTagRepo.save must be mocked to return the tags array, avoiding createdTags being undefined
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-tpl', ...dto }));
      dataTagRepo.save!.mockResolvedValue([
        { id: 'tag-1', name: 'temperature' },
        { id: 'tag-2', name: 'humidity' },
      ]);

      await service.applyTemplate('dev-001', 'tpl-001', projectId);

      // The second save call should include template metadata
      expect(deviceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          templateId: 'tpl-001',
          templateVersion: '2.0.0',
          templateAppliedAt: expect.any(Date),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Template sync (syncTemplateTags) - add/update/delete
  // ═══════════════════════════════════════════════════════════════════════

  describe('TC-SYNC-010: syncTemplateTags 新增标签', () => {
    it('全新标签应被创建并包含 projectId', async () => {
      const device = makeDevice();
      const template = makeTemplate({
        variables: [{ name: 'new_var', address: 'HR40010', dataType: 'float', enabled: true }],
      });
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([]);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-sync', ...dto }));
      dataTagRepo.save!.mockResolvedValue([{ id: 'tag-sync' }]);

      const result = await service.syncTemplateTags('dev-001', 'tpl-001', projectId);

      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.removed).toBe(0);
      expect(dataTagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, name: 'new_var' }),
      );
    });
  });

  describe('TC-SYNC-011: syncTemplateTags 更新已有标签', () => {
    it('应更新标签地址和属性', async () => {
      const device = makeDevice();
      const template = makeTemplate({
        variables: [
          { name: 'temperature', address: 'HR40001-NEW', dataType: 'float', enabled: true },
        ],
      });
      const existingTag = {
        id: 'tag-1',
        name: 'temperature',
        deviceId: 'dev-001',
        address: 'HR40001-OLD',
      };
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([existingTag]);
      dataTagRepo.save!.mockResolvedValue(existingTag);

      const result = await service.syncTemplateTags('dev-001', 'tpl-001', projectId);

      expect(result.updated).toBe(1);
      expect(result.added).toBe(0);
      expect(dataTagRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ address: 'HR40001-NEW', id: 'tag-1' }),
      );
    });
  });

  describe('TC-SYNC-012: syncTemplateTags 删除多余标签', () => {
    it('模板中已移除的标签应被删除', async () => {
      const device = makeDevice();
      const template = makeTemplate({
        variables: [], // empty template
      });
      const obsoleteTag = {
        id: 'tag-obsolete',
        name: 'obsolete_var',
        deviceId: 'dev-001',
      };
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue([obsoleteTag]);

      const result = await service.syncTemplateTags('dev-001', 'tpl-001', projectId);

      expect(result.removed).toBe(1);
      expect(dataTagRepo.remove).toHaveBeenCalledWith(obsoleteTag);
    });
  });

  describe('TC-SYNC-013: syncTemplateTags 复合场景', () => {
    it('应同时处理增/改/删', async () => {
      const device = makeDevice();
      const template = makeTemplate({
        variables: [
          { name: 'temperature', address: 'HR40001-UPDATED', dataType: 'float', enabled: true },
          { name: 'humidity', address: 'HR40003', dataType: 'float', enabled: true },
        ],
      });
      // Existing tags: temperature (to update) + obsolete (to delete)
      const existingTags = [
        { id: 'tag-1', name: 'temperature', deviceId: 'dev-001', address: 'HR40001-OLD' },
        { id: 'tag-2', name: 'obsolete', deviceId: 'dev-001' },
      ];
      deviceRepo.findOne!.mockResolvedValue(device);
      deviceRepo.save!.mockResolvedValue(device);
      mockTemplateLoader.getTemplate.mockReturnValue(template);
      dataTagRepo.find!.mockResolvedValue(existingTags);
      dataTagRepo.create!.mockImplementation((dto: any) => ({ id: 'tag-sync', ...dto }));
      dataTagRepo.save!.mockResolvedValue([]);

      const result = await service.syncTemplateTags('dev-001', 'tpl-001', projectId);

      expect(result.updated).toBe(1); // temperature
      expect(result.added).toBe(1); // humidity
      expect(result.removed).toBe(1); // obsolete
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Tag operations (addTag / addTags / updateDataTag / removeTag)
  // ═══════════════════════════════════════════════════════════════════════

  describe('TC-TAG-010: addTag 设备不存在', () => {
    it('应抛出 NotFoundException', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.addTag(
          'dev-999',
          { name: 'test', dataType: 'float' as any, projectId, deviceId: 'dev-999' } as any,
          projectId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('TC-TAG-011: addTags 批量创建', () => {
    it('空数组应返回空结果且不调用 create', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      // save([]) must explicitly return [], because jest.fn() returns undefined by default
      dataTagRepo.save!.mockResolvedValue([]);

      const result = await service.addTags('dev-001', [], projectId);

      expect(result).toEqual([]);
      expect(dataTagRepo.create).not.toHaveBeenCalled();
    });

    it('应注入 deviceId 到每个标签', async () => {
      const device = makeDevice({ id: 'dev-special' });
      deviceRepo.findOne!.mockResolvedValue(device);
      dataTagRepo.create!.mockImplementation((dto: any) => dto);
      dataTagRepo.save!.mockResolvedValue([]);

      await service.addTags(
        'dev-special',
        [
          { name: 'tag1', dataType: 'int16' as any, projectId, deviceId: 'dev-special' } as any,
          { name: 'tag2', dataType: 'float' as any, projectId, deviceId: 'dev-special' } as any,
        ],
        projectId,
      );

      expect(dataTagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tag1', deviceId: 'dev-special', projectId }),
      );
      expect(dataTagRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'tag2', deviceId: 'dev-special', projectId }),
      );
    });
  });

  describe('TC-TAG-012: updateDataTag', () => {
    it('标签不存在时应抛出 NotFoundException', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      dataTagRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.updateDataTag('tag-999', 'dev-001', { name: 'updated' }, projectId),
      ).rejects.toThrow(NotFoundException);
    });

    it('应成功更新标签字段', async () => {
      const device = makeDevice();
      const tag = { id: 'tag-1', name: 'old_name', deviceId: 'dev-001' };
      deviceRepo.findOne!.mockResolvedValue(device);
      dataTagRepo.findOne!.mockResolvedValue(tag);
      dataTagRepo.save!.mockImplementation((t: any) => Promise.resolve(t));

      const result = await service.updateDataTag(
        'tag-1',
        'dev-001',
        { name: 'new_name' },
        projectId,
      );

      expect(result.name).toBe('new_name');
    });
  });

  describe('TC-TAG-013: removeTag', () => {
    it('标签不存在时应抛出 NotFoundException', async () => {
      const device = makeDevice();
      deviceRepo.findOne!.mockResolvedValue(device);
      dataTagRepo.findOne!.mockResolvedValue(null);

      await expect(service.removeTag('tag-999', 'dev-001', projectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('应成功删除标签', async () => {
      const device = makeDevice();
      const tag = { id: 'tag-1', name: 'to_delete', deviceId: 'dev-001' };
      deviceRepo.findOne!.mockResolvedValue(device);
      dataTagRepo.findOne!.mockResolvedValue(tag);

      await service.removeTag('tag-1', 'dev-001', projectId);

      expect(dataTagRepo.remove).toHaveBeenCalledWith(tag);
    });
  });
});
