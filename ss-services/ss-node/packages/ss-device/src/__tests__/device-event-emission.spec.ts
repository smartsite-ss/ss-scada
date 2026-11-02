// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Mock ss-system module to avoid broken import path
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
import { ConfigService } from '@nestjs/config';
import { DataPointCacheService, EventBusService, ProjectDatabaseService } from '@ss-node/ss-core';
import { ChannelConfigService } from '../channel/channel-config.service';
import { DeviceStatus, DeviceType } from '@ss-node/ss-sdk';
import { BadRequestException } from '@nestjs/common';

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

describe('DeviceService - event publishing', () => {
  let service: DeviceService;
  let deviceRepo: MockRepository<Device>;
  let dataTagRepo: MockRepository<DataTag>;
  let deviceGroupRepo: MockRepository<DeviceGroup>;
  let eventBus: { emit: jest.Mock };

  const projectId = 'proj-001';

  const mockDevice: Device = {
    id: 'dev-001',
    deviceCode: 'temp-hum-001',
    deviceName: '温湿度001',
    nameAlias: '',
    description: '',
    type: DeviceType.MODBUS_TCP,
    config: {},
    status: DeviceStatus.OFFLINE,
    projectId,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    lastOnlineAt: null,
    errorCount: 0,
    lastErrorAt: null,
    lastErrorMsg: '',
    templateId: 'tpl-001',
    templateVersion: '1.0.0',
    templateAppliedAt: new Date('2025-01-01'),
    connection: { protocol: 'modbus_tcp', host: '192.168.1.1', port: 502 },
    groupId: null,
    driver: 'modbus_tcp',
    scanRate: 1000,
  } as any;

  beforeEach(async () => {
    deviceRepo = createMockRepo<Device>();
    dataTagRepo = createMockRepo<DataTag>();
    // findOne() accesses tags.length when templateId exists; find must return an array
    dataTagRepo.find!.mockResolvedValue([]);
    deviceGroupRepo = createMockRepo<DeviceGroup>();

    const mockDataSource: Partial<DataSource> = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === Device) return deviceRepo;
        if (entity === DataTag) return dataTagRepo;
        if (entity === DeviceGroup) return deviceGroupRepo;
        return null;
      }),
    };

    const mockProjectDbService: Partial<ProjectDatabaseService> = {
      getSystemDb: jest.fn().mockResolvedValue(mockDataSource),
      getLoadedSystemDb: jest.fn().mockReturnValue(mockDataSource),
    };

    const mockI18nService: Partial<I18nService> = {
      tSync: jest.fn().mockImplementation((key: string, args?: any) => {
        if (key === 'error.device.DEV_001') return `Device ${args?.id || ''} not found`;
        if (key === 'error.device.DEV_002') return `TID ${args?.tid || ''} already exists`;
        return key;
      }),
    };

    eventBus = { emit: jest.fn() };

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
        { provide: EventBusService, useValue: eventBus },
      ],
    }).compile();

    service = module.get<DeviceService>(DeviceService);
  });

  describe('create - device.created event', () => {
    it('Creating a device should publish the device.created event', async () => {
      const dto = {
        deviceCode: 'temp-hum-001',
        deviceName: '温湿度001',
        templateId: 'tpl-001',
        driver: 'modbus_tcp' as any,
        connection: { host: '192.168.1.1', port: 502 },
        scanRate: 1000,
      };

      deviceRepo.findOne!.mockResolvedValue(null);
      deviceRepo.create!.mockReturnValue(mockDevice);
      deviceRepo.save!.mockResolvedValue(mockDevice);

      await service.create(dto, projectId);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.created',
        expect.objectContaining({
          deviceId: 'dev-001',
          projectId: 'proj-001',
          protocol: 'modbus_tcp',
          connection: expect.any(Object),
          scanRate: 1000,
          templateId: 'tpl-001',
          timestamp: expect.any(Number),
        }),
      );
    });

    it('Should not publish events when creation fails (TID conflict)', async () => {
      const dto = {
        deviceCode: 'temp-hum-001',
        deviceName: '温湿度001',
        templateId: 'tpl-001',
        driver: 'modbus_tcp' as any,
        connection: { host: '192.168.1.1', port: 502 },
      };

      deviceRepo.findOne!.mockResolvedValue(mockDevice);

      await expect(service.create(dto, projectId)).rejects.toThrow();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('update - device.updated event', () => {
    it('Changing connection should publish the device.updated event', async () => {
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      deviceRepo.save!.mockResolvedValue({ ...mockDevice, connection: { host: '10.0.0.1' } });

      await service.update(
        'dev-001',
        {
          connection: { host: '10.0.0.1' },
        },
        projectId,
      );

      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.updated',
        expect.objectContaining({
          deviceId: 'dev-001',
          projectId: 'proj-001',
          changedFields: expect.arrayContaining(['connection']),
          connection: { host: '10.0.0.1' },
          timestamp: expect.any(Number),
        }),
      );
    });

    it('Changing scanRate should publish the device.updated event', async () => {
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      deviceRepo.save!.mockResolvedValue({ ...mockDevice, scanRate: 500 });

      await service.update('dev-001', { scanRate: 500 }, projectId);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.updated',
        expect.objectContaining({
          deviceId: 'dev-001',
          changedFields: expect.arrayContaining(['scanRate']),
          scanRate: 500,
          timestamp: expect.any(Number),
        }),
      );
    });

    it('Changing deviceName should publish the device.updated event', async () => {
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      deviceRepo.save!.mockResolvedValue({ ...mockDevice, deviceName: '新名称' });

      await service.update('dev-001', { deviceName: '新名称' }, projectId);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.updated',
        expect.objectContaining({
          deviceId: 'dev-001',
          changedFields: expect.arrayContaining(['deviceName']),
          timestamp: expect.any(Number),
        }),
      );
    });

    it('Changing groupId should publish the device.updated event', async () => {
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      deviceRepo.save!.mockResolvedValue({ ...mockDevice, groupId: 'grp-1' });

      await service.update('dev-001', { groupId: 'grp-1' }, projectId);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.updated',
        expect.objectContaining({
          deviceId: 'dev-001',
          changedFields: expect.arrayContaining(['groupId']),
          timestamp: expect.any(Number),
        }),
      );
    });

    it('Should not publish events when no fields changed', async () => {
      // Use a device without templateId, avoiding an empty DTO implicitly clearing templateId
      const deviceWithoutTemplate = { ...mockDevice, templateId: null };
      deviceRepo.findOne!.mockResolvedValue(deviceWithoutTemplate);
      deviceRepo.save!.mockResolvedValue(deviceWithoutTemplate);

      await service.update('dev-001', {}, projectId);

      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('Changing multiple fields at once should include all changed fields', async () => {
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      deviceRepo.save!.mockResolvedValue({ ...mockDevice, deviceName: '新名称', scanRate: 200 });

      await service.update('dev-001', { deviceName: '新名称', scanRate: 200 }, projectId);

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      const payload = eventBus.emit.mock.calls[0][1];
      expect(payload.changedFields).toEqual(
        expect.arrayContaining(['deviceName', 'scanRate', 'tags']),
      );
      expect(payload.changedFields).toHaveLength(3);
      expect(payload.changes).toHaveProperty('deviceName');
      expect(payload.changes).toHaveProperty('scanRate');
      expect(payload.changes.deviceName).toEqual({ old: '温湿度001', new: '新名称' });
      expect(payload.changes.scanRate).toEqual({ old: 1000, new: 200 });
    });
  });

  describe('remove - device.deleted event', () => {
    it('Deleting a device should publish the device.deleted event', async () => {
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      dataTagRepo.find!.mockResolvedValue([]);
      deviceRepo.remove!.mockResolvedValue(undefined);

      await service.remove('dev-001', projectId);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.deleted',
        expect.objectContaining({
          deviceId: 'dev-001',
          projectId: 'proj-001',
          protocol: 'modbus_tcp',
          timestamp: expect.any(Number),
        }),
      );
    });

    it('Deleting a device should cascade-delete related tags', async () => {
      const tags = [{ id: 'tag-1' }, { id: 'tag-2' }];
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      dataTagRepo.find!.mockResolvedValue(tags);
      deviceRepo.remove!.mockResolvedValue(undefined);

      await service.remove('dev-001', projectId);

      expect(dataTagRepo.find).toHaveBeenCalledWith({ where: { deviceId: 'dev-001' } });
      expect(dataTagRepo.remove).toHaveBeenCalledWith(tags);
    });

    it('Deleting a non-existent device should throw and not publish events', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);

      await expect(service.remove('unknown', projectId)).rejects.toThrow();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('unbindTemplate - unbind the template', () => {
    beforeEach(() => {
      deviceRepo.findOne!.mockResolvedValue(mockDevice);
      deviceRepo.save!.mockResolvedValue({
        ...mockDevice,
        templateId: null,
        templateVersion: null,
      });
    });

    it('Unbinding a template (without deleting tags) should clear templateId and return the original template ID', async () => {
      const result = await service.unbindTemplate('dev-001', projectId, false);

      expect(result.templateId).toBe('tpl-001');
      expect(result.tagsDeleted).toBe(0);
      expect(deviceRepo.save).toHaveBeenCalled();
      const savedDevice = deviceRepo.save.mock.calls[0][0];
      expect(savedDevice.templateId).toBeNull();
      expect(savedDevice.templateVersion).toBeNull();
      expect(savedDevice.templateAppliedAt).toBeNull();
    });

    it('Unbinding a template (deleting tags) should delete related tags and return the deletion count', async () => {
      const tags = [{ id: 'tag-1' }, { id: 'tag-2' }, { id: 'tag-3' }];
      dataTagRepo.find!.mockResolvedValue(tags);

      const result = await service.unbindTemplate('dev-001', projectId, true);

      expect(result.tagsDeleted).toBe(3);
      expect(dataTagRepo.remove).toHaveBeenCalledWith(tags);
    });

    it('Should throw BadRequestException when the device has no bound template', async () => {
      deviceRepo.findOne!.mockResolvedValue({ ...mockDevice, templateId: null });

      await expect(service.unbindTemplate('dev-001', projectId, false)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Should throw when the device does not exist', async () => {
      deviceRepo.findOne!.mockResolvedValue(null);

      await expect(service.unbindTemplate('unknown', projectId, false)).rejects.toThrow();
    });
  });
});
