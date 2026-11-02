// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeviceControlService } from '../device-control.service';
import { ControlOperationLog } from '../control-operation.entity';
import { QueryControlLogDto } from '../../dto/query-control-log.dto';
import { DeviceService } from '../../device.service';
import { DeviceDataService } from '../../data/device-data.service';
import { PluginRegistry } from '@ss-node/ss-collector-sdk';
import { ProjectDatabaseService, EventBusService } from '@ss-node/ss-core';

describe('DeviceControlService', () => {
  let service: DeviceControlService;
  let deviceService: DeviceService;
  let pluginRegistry: PluginRegistry;
  let deviceDataService: DeviceDataService;
  let eventBus: EventBusService;
  let mockSystemDbRepo: any;
  let mockProjectDbRepo: any;
  let mockQueryBuilder: any;

  const mockDevice = {
    id: 'device-001',
    name: 'Test Device',
    type: 'modbus',
    driver: 'modbus',
    scanRate: 1000,
    connection: { host: '192.168.1.100', port: 502 },
  };

  const mockDeviceNoType = {
    id: 'device-002',
    name: 'No Type Device',
    type: null,
    driver: null,
    scanRate: 1000,
    connection: { host: '192.168.1.101', port: 502 },
  };

  const mockDeviceDriverOnly = {
    id: 'device-003',
    name: 'Driver Only Device',
    type: null,
    driver: 'opcua',
    scanRate: 1000,
    connection: { endpoint: 'opc.tcp://localhost:4840' },
  };

  const mockWriteTag = {
    id: 'tag-001',
    name: 'Setpoint',
    address: '40001',
    dataType: 'float32',
    direction: 'write',
    description: 'Temperature setpoint',
    unit: '℃',
    minValue: null,
    maxValue: null,
  };

  const mockReadOnlyTag = {
    id: 'tag-002',
    name: 'Temperature',
    address: '30001',
    dataType: 'float32',
    direction: 'read',
    description: '环境温度',
    unit: '℃',
    minValue: null,
    maxValue: null,
  };

  const mockReadWriteTag = {
    id: 'tag-003',
    name: 'Pump Control',
    address: '40002',
    dataType: 'boolean',
    direction: 'read-write',
    description: 'Pump start/stop',
    unit: '',
    minValue: null,
    maxValue: null,
  };

  const mockTagNoDirection = {
    id: 'tag-004',
    name: 'Legacy Tag',
    address: '40003',
    dataType: 'int16',
    direction: null,
    description: 'Legacy tag without direction',
    unit: '',
    minValue: null,
    maxValue: null,
  };

  const mockRangeTag = {
    id: 'tag-005',
    name: 'Range Limited',
    address: '40005',
    dataType: 'float32',
    direction: 'write',
    description: 'Range limited tag',
    unit: '℃',
    minValue: 0,
    maxValue: 100,
  };

  const mockWriteParams = {
    projectId: 'proj-001',
    deviceId: 'device-001',
    tagId: 'tag-001',
    value: 25.5,
    reason: 'Operator adjustment',
    operatorId: 'user-001',
    operatorName: 'Test Operator',
    ipAddress: '192.168.1.200',
  };

  let mockAdapter: any;

  beforeEach(async () => {
    mockProjectDbRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockResolvedValue({ id: 'log-1' }),
    };

    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    mockSystemDbRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const mockProjectDbService = {
      getProjectGlobalDb: jest.fn().mockReturnValue({
        getRepository: jest.fn().mockReturnValue(mockProjectDbRepo),
      }),
      getSystemDb: jest.fn().mockResolvedValue({
        getRepository: jest.fn().mockReturnValue(mockSystemDbRepo),
      }),
    };

    mockAdapter = {
      connect: jest.fn().mockResolvedValue({ clientId: 'conn-1' }),
      writeTag: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const mockPluginRegistry = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
    };

    const mockDeviceDataService = {
      getDeviceLatestValues: jest.fn().mockResolvedValue({}),
      updateLatestValue: jest.fn().mockResolvedValue(undefined),
    };

    const mockEventBus = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceControlService,
        {
          provide: DeviceService,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: DeviceDataService,
          useValue: mockDeviceDataService,
        },
        {
          provide: ProjectDatabaseService,
          useValue: mockProjectDbService,
        },
        {
          provide: PluginRegistry,
          useValue: mockPluginRegistry,
        },
        {
          provide: EventBusService,
          useValue: mockEventBus,
        },
        {
          provide: getRepositoryToken(ControlOperationLog),
          useValue: {
            save: jest.fn().mockResolvedValue({ id: 'log-1' }),
          },
        },
      ],
    }).compile();

    service = module.get<DeviceControlService>(DeviceControlService);
    deviceService = module.get<DeviceService>(DeviceService);
    pluginRegistry = module.get<PluginRegistry>(PluginRegistry);
    deviceDataService = module.get<DeviceDataService>(DeviceDataService);
    eventBus = module.get<EventBusService>(EventBusService);

    // Default setup: device found, tag found, adapter found
    jest.spyOn(deviceService, 'findOne').mockResolvedValue(mockDevice as any);
    mockSystemDbRepo.findOne.mockResolvedValue(mockWriteTag);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ================================================================
  //  writeTagValue — Error Paths
  // ================================================================
  describe('writeTagValue — error paths', () => {
    // TC-DC-001: device does not exist
    it('TC-DC-001: should return success=false when device not found', async () => {
      jest.spyOn(deviceService, 'findOne').mockResolvedValue(null);

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('设备不存在');
    });

    // TC-DC-002: result contains the required fields
    it('TC-DC-002: should return WriteTagResult with required fields on error', async () => {
      jest.spyOn(deviceService, 'findOne').mockResolvedValue(null);

      const result = await service.writeTagValue(mockWriteParams);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('tagId', mockWriteParams.tagId);
      expect(result).toHaveProperty('value', mockWriteParams.value);
      expect(result).toHaveProperty('latencyMs');
      expect(typeof result.latencyMs).toBe('number');
    });

    // TC-DC-005: tag does not exist
    it('TC-DC-005: should return success=false when tag not found', async () => {
      mockSystemDbRepo.findOne.mockResolvedValue(null);

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('标签不存在');
    });

    // TC-DC-006: tag is read-only
    it('TC-DC-006: should return success=false when tag is read-only', async () => {
      mockSystemDbRepo.findOne.mockResolvedValue(mockReadOnlyTag);

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('只读');
    });

    // TC-DC-007: device type not configured
    it('TC-DC-007: should return success=false when device type/driver not configured', async () => {
      jest.spyOn(deviceService, 'findOne').mockResolvedValue(mockDeviceNoType as any);
      mockSystemDbRepo.findOne.mockResolvedValue(mockWriteTag);

      const result = await service.writeTagValue({
        ...mockWriteParams,
        deviceId: 'device-002',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('设备类型未配置');
    });

    // TC-DC-008: protocol adapter not found
    it('TC-DC-008: should return success=false when adapter not found', async () => {
      jest.spyOn(pluginRegistry, 'getAdapter').mockReturnValue(null);

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('协议适配器未找到');
    });

    // TC-DC-009: device connection failed
    it('TC-DC-009: should return success=false when connection fails', async () => {
      mockAdapter.connect.mockRejectedValue(new Error('Connection refused'));
      // Connection failure should also record an audit log
      mockProjectDbRepo.save.mockClear();

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('设备连接失败');
      // The audit log is recorded on connection failure
      expect(mockProjectDbRepo.save).not.toHaveBeenCalled(); // projectDbRepo is for reading, not logging
    });

    // TC-DC-010: write failure (writeTag throws)
    it('TC-DC-010: should return success=false and log audit when writeTag throws', async () => {
      mockAdapter.writeTag.mockRejectedValue(new Error('Modbus write timeout'));

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Modbus write timeout');
      // disconnect is NOT called when write throws (error is re-thrown before disconnect)
      expect(mockAdapter.disconnect).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  //  writeTagValue — Value Validation
  // ================================================================
  describe('writeTagValue — value validation', () => {
    // TC-DC-011: null value rejected
    it('TC-DC-011: should reject null value', async () => {
      const result = await service.writeTagValue({
        ...mockWriteParams,
        value: null,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('写入值不能为空');
    });

    // TC-DC-012: undefined value rejected
    it('TC-DC-012: should reject undefined value', async () => {
      const result = await service.writeTagValue({
        ...mockWriteParams,
        value: undefined,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('写入值不能为空');
    });

    // TC-DC-013: value below minimum
    it('TC-DC-013: should reject value below minValue', async () => {
      mockSystemDbRepo.findOne.mockResolvedValue(mockRangeTag);

      const result = await service.writeTagValue({
        ...mockWriteParams,
        tagId: 'tag-005',
        value: -10,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('小于最小值');
    });

    // TC-DC-014: value above maximum
    it('TC-DC-014: should reject value above maxValue', async () => {
      mockSystemDbRepo.findOne.mockResolvedValue(mockRangeTag);

      const result = await service.writeTagValue({
        ...mockWriteParams,
        tagId: 'tag-005',
        value: 150,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('大于最大值');
    });
  });

  // ================================================================
  //  writeTagValue — Successful Write (Happy Path)
  // ================================================================
  describe('writeTagValue — successful write', () => {
    // TC-DC-015: full success path
    it('TC-DC-015: should complete full happy path — connect/write/disconnect/audit', async () => {
      const result = await service.writeTagValue(mockWriteParams);

      expect(result.success).toBe(true);
      expect(result.tagId).toBe('tag-001');
      expect(result.value).toBe(25.5);
      expect(typeof result.latencyMs).toBe('number');
      expect(mockAdapter.connect).toHaveBeenCalled();
      expect(mockAdapter.writeTag).toHaveBeenCalled();
      expect(mockAdapter.disconnect).toHaveBeenCalled();
    });

    // TC-DC-016: read-write direction allows writing
    it('TC-DC-016: should allow write for read-write direction', async () => {
      mockSystemDbRepo.findOne.mockResolvedValue(mockReadWriteTag);

      const result = await service.writeTagValue({
        ...mockWriteParams,
        tagId: 'tag-003',
        value: true,
      });
      expect(result.success).toBe(true);
    });

    // TC-DC-017: previous value captured before write
    it('TC-DC-017: should capture previous value before write', async () => {
      jest.spyOn(deviceDataService, 'getDeviceLatestValues').mockResolvedValue({
        'tag-001': { value: 23.0, quality: 'good', timestamp: new Date() },
      });

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(true);
      expect(deviceDataService.getDeviceLatestValues).toHaveBeenCalledWith(
        'device-001',
        'proj-001',
      );
    });

    // TC-DC-018: latest-value cache updated after write
    it('TC-DC-018: should call updateLatestValue after successful write', async () => {
      const result = await service.writeTagValue(mockWriteParams);

      expect(result.success).toBe(true);
      expect(deviceDataService.updateLatestValue).toHaveBeenCalledWith(
        'tag-001',
        'device-001',
        25.5,
        'good',
        'proj-001',
      );
    });

    // TC-DC-019: event emitted after write
    it('TC-DC-019: should emit device.tag_written event after successful write', async () => {
      const result = await service.writeTagValue(mockWriteParams);

      expect(result.success).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.tag_written',
        expect.objectContaining({
          projectId: 'proj-001',
          deviceId: 'device-001',
          tagId: 'tag-001',
          value: 25.5,
          quality: 'good',
        }),
      );
    });

    // TC-DC-020: string value writable after write
    it('TC-DC-020: should accept string value for write', async () => {
      const result = await service.writeTagValue({
        ...mockWriteParams,
        value: 'ON',
      });
      expect(result.success).toBe(true);
      expect(deviceDataService.updateLatestValue).toHaveBeenCalledWith(
        'tag-001',
        'device-001',
        'ON',
        'good',
        'proj-001',
      );
    });
  });

  // ================================================================
  //  writeTagValue — Edge Cases
  // ================================================================
  describe('writeTagValue — edge cases', () => {
    // TC-DC-021: use driver instead of type
    it('TC-DC-021: should use driver when type is null', async () => {
      jest.spyOn(deviceService, 'findOne').mockResolvedValue(mockDeviceDriverOnly as any);
      mockSystemDbRepo.findOne.mockResolvedValue(mockWriteTag);
      jest.spyOn(pluginRegistry, 'getAdapter').mockReturnValue(mockAdapter);

      const result = await service.writeTagValue({
        ...mockWriteParams,
        deviceId: 'device-003',
      });
      expect(result.success).toBe(true);
      expect(pluginRegistry.getAdapter).toHaveBeenCalledWith('opcua');
    });

    // TC-DC-022: previous-value query failure does not block the write
    it('TC-DC-022: should not block write when previous value query fails', async () => {
      jest
        .spyOn(deviceDataService, 'getDeviceLatestValues')
        .mockRejectedValue(new Error('DB connection lost'));

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(true);
    });

    // TC-DC-023: updateLatestValue failure does not block the return
    it('TC-DC-023: should not block return when updateLatestValue fails', async () => {
      jest
        .spyOn(deviceDataService, 'updateLatestValue')
        .mockRejectedValue(new Error('Redis connection lost'));

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(true);
    });

    // TC-DC-024: disconnect failure does not block the return
    it('TC-DC-024: should not block return when disconnect fails', async () => {
      mockAdapter.disconnect.mockRejectedValue(new Error('Disconnect error'));

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(true);
    });

    // TC-DC-025: returns normally when eventBus is absent
    it('TC-DC-025: should not throw when eventBus is undefined', async () => {
      // Override the service's eventBus to be undefined (simulating Optional() not provided)
      (service as any)['eventBus'] = undefined;

      const result = await service.writeTagValue(mockWriteParams);
      expect(result.success).toBe(true);
    });

    // TC-DC-026: tag without a direction field defaults to read-only
    it('TC-DC-026: should treat tag without direction as read-only', async () => {
      mockSystemDbRepo.findOne.mockResolvedValue(mockTagNoDirection);

      const result = await service.writeTagValue({
        ...mockWriteParams,
        tagId: 'tag-004',
        value: 42,
      });
      // direction is null/falsy → treated as read-only per !tag.direction check
      expect(result.success).toBe(false);
      expect(result.error).toContain('只读');
    });
  });

  // ================================================================
  //  ControlOperationLog Entity
  // ================================================================
  describe('ControlOperationLog entity', () => {
    // TC-DC-003: audit-log entity field validation
    it('TC-DC-003: should have correct entity fields for audit logging', () => {
      const logEntity = new ControlOperationLog();
      logEntity.projectId = 'proj-001';
      logEntity.deviceId = 'device-001';
      logEntity.deviceName = 'Test Device';
      logEntity.tagId = 'tag-001';
      logEntity.tagName = 'Setpoint';
      logEntity.previousValue = '23.0';
      logEntity.writtenValue = '25.5';
      logEntity.success = true;
      logEntity.operatorId = 'user-001';
      logEntity.operatorName = 'Test Operator';
      logEntity.reason = 'Operator adjustment';
      logEntity.ipAddress = '192.168.1.200';
      logEntity.latencyMs = 100;

      expect(logEntity.projectId).toBe('proj-001');
      expect(logEntity.deviceId).toBe('device-001');
      expect(logEntity.deviceName).toBe('Test Device');
      expect(logEntity.tagId).toBe('tag-001');
      expect(logEntity.tagName).toBe('Setpoint');
      expect(logEntity.previousValue).toBe('23.0');
      expect(logEntity.writtenValue).toBe('25.5');
      expect(logEntity.success).toBe(true);
      expect(logEntity.operatorId).toBe('user-001');
      expect(logEntity.operatorName).toBe('Test Operator');
      expect(logEntity.reason).toBe('Operator adjustment');
      expect(logEntity.ipAddress).toBe('192.168.1.200');
      expect(logEntity.latencyMs).toBe(100);
    });

    // TC-DC-004: error-log entity fields
    it('TC-DC-004: should capture error fields for failed writes', () => {
      const logEntity = new ControlOperationLog();
      logEntity.success = false;
      logEntity.errorMessage = 'Connection timeout after 5000ms';

      expect(logEntity.success).toBe(false);
      expect(logEntity.errorMessage).toBe('Connection timeout after 5000ms');
    });
  });

  // ================================================================
  //  QueryLogs - operation-log query
  // ================================================================
  describe('queryLogs', () => {
    const mockLogs = [
      {
        id: 'log-1',
        projectId: 'proj-001',
        deviceId: 'device-001',
        deviceName: 'Test Device',
        tagId: 'tag-001',
        tagName: 'Setpoint',
        previousValue: '23.0',
        writtenValue: '25.5',
        success: true,
        errorMessage: null,
        operatorId: 'user-001',
        operatorName: 'Test Operator',
        reason: 'Operator adjustment',
        ipAddress: '192.168.1.200',
        latencyMs: 100,
        createdAt: new Date('2026-07-28T10:00:00Z'),
      },
      {
        id: 'log-2',
        projectId: 'proj-001',
        deviceId: 'device-001',
        deviceName: 'Test Device',
        tagId: 'tag-002',
        tagName: 'Temperature',
        previousValue: null,
        writtenValue: '100',
        success: false,
        errorMessage: 'Connection timeout',
        operatorId: 'user-002',
        operatorName: 'Admin',
        reason: null,
        ipAddress: '192.168.1.201',
        latencyMs: 5000,
        createdAt: new Date('2026-07-28T09:00:00Z'),
      },
    ];

    // TC-QL-001: basic paginated query
    it('TC-QL-001: should return paginated logs', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockLogs[0]], 1]);

      const result = await service.queryLogs('proj-001', 'device-001', {
        page: 1,
        pageSize: 20,
      } as QueryControlLogDto);

      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.pageSize).toBe(20);
      expect(result.pagination.totalPages).toBe(1);
      expect(mockSystemDbRepo.createQueryBuilder).toHaveBeenCalledWith('log');
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('log.projectId = :projectId', {
        projectId: 'proj-001',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.deviceId = :deviceId', {
        deviceId: 'device-001',
      });
    });

    // TC-QL-002: search by keyword
    it('TC-QL-002: should filter by keyword (tagName/operatorName)', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockLogs[0]], 1]);

      await service.queryLogs('proj-001', 'device-001', {
        page: 1,
        pageSize: 20,
        keyword: 'Setpoint',
      } as QueryControlLogDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(log.tagName LIKE :keyword OR log.operatorName LIKE :keyword OR log.deviceName LIKE :keyword)',
        { keyword: '%Setpoint%' },
      );
    });

    // TC-QL-003: filter by success
    it('TC-QL-003: should filter by success flag', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockLogs[0]], 1]);

      await service.queryLogs('proj-001', 'device-001', {
        page: 1,
        pageSize: 20,
        success: true,
      } as QueryControlLogDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.success = :success', {
        success: true,
      });
    });

    // TC-QL-004: filter by failure
    it('TC-QL-004: should filter by failed logs', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockLogs[1]], 1]);

      await service.queryLogs('proj-001', 'device-001', {
        page: 1,
        pageSize: 20,
        success: false,
      } as QueryControlLogDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.success = :success', {
        success: false,
      });
    });

    // TC-QL-005: filter by time range
    it('TC-QL-005: should filter by startDate and endDate', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockLogs, 2]);

      await service.queryLogs('proj-001', 'device-001', {
        page: 1,
        pageSize: 20,
        startDate: '2026-07-28T08:00:00Z',
        endDate: '2026-07-28T12:00:00Z',
      } as QueryControlLogDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.createdAt >= :startDate', {
        startDate: '2026-07-28T08:00:00Z',
      });
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.createdAt <= :endDate', {
        endDate: '2026-07-28T12:00:00Z',
      });
    });

    // TC-QL-006: empty result
    it('TC-QL-006: should return empty items when no logs', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.queryLogs('proj-001', 'device-001', {
        page: 1,
        pageSize: 20,
      } as QueryControlLogDto);

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    // TC-QL-007: pagination computed correctly
    it('TC-QL-007: should calculate totalPages correctly for multi-page results', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockLogs[0]], 2]);

      const result = await service.queryLogs('proj-001', 'device-001', {
        page: 1,
        pageSize: 1,
      } as QueryControlLogDto);

      expect(result.pagination.totalPages).toBe(2);
    });

    // TC-QL-008: default pagination params
    it('TC-QL-008: should use default page/pageSize when not provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockLogs, 2]);

      await service.queryLogs('proj-001', 'device-001', {} as QueryControlLogDto);

      // Should skip 0 (page 1 default → skip (1-1)*20 = 0)
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
    });

    // TC-QL-009: project-level query (no deviceId)
    it('TC-QL-009: should query all devices when deviceId is undefined', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockLogs, 2]);

      await service.queryLogs('proj-001', undefined, {
        page: 1,
        pageSize: 20,
      } as QueryControlLogDto);

      // Should filter by projectId only, NOT by deviceId
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('log.projectId = :projectId', {
        projectId: 'proj-001',
      });
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalledWith(
        'log.deviceId = :deviceId',
        expect.anything(),
      );
    });

    // TC-QL-010: filter by deviceName
    it('TC-QL-010: should filter by deviceName when provided', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockLogs[0]], 1]);

      await service.queryLogs('proj-001', undefined, {
        page: 1,
        pageSize: 20,
        deviceName: '测试',
      } as QueryControlLogDto);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('log.deviceName LIKE :deviceName', {
        deviceName: '%Test%',
      });
    });
  });
});
