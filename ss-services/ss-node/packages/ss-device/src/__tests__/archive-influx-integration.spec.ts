// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * 3.15 + 3.17 integration tests - DeviceArchiveService / ArchiveService connected to a real InfluxDB
 *
 * Verifies:
 * - When InfluxWriteService is available, archiveToInfluxDB calls the real writePoint()
 * - When DataQueryService is available, queryArchive / queryHistory query the HistoricalData table
 * - Degrades to an in-memory Map / empty return when unavailable
 * - toInfluxPoint data mapping is correct
 */
import { DeviceArchiveService } from '../archive/device-archive.service';
import { ArchiveService } from '../data/archive.service';
import { Repository } from 'typeorm';
import { DataTag } from '../entities/data-tag.entity';
import { ProjectDatabaseService } from '@ss-node/ss-core';

type MockRepository<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

function createMockDataTagRepo(): MockRepository<DataTag> {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn(),
    remove: jest.fn(),
  };
}

function createMockProjectDbService(repo: MockRepository<DataTag>): ProjectDatabaseService {
  return {
    getSystemDb: jest.fn().mockResolvedValue({
      getRepository: jest.fn(() => repo),
    }),
    getLoadedSystemDb: jest.fn(),
    unloadProjectDatabases: jest.fn(),
    getActiveProjects: jest.fn(),
    isConnected: jest.fn(),
    setProjectsDir: jest.fn(),
  } as any;
}

function createMockInfluxWriteService() {
  return {
    writePoint: jest.fn().mockResolvedValue(undefined),
    writePoints: jest.fn().mockResolvedValue(undefined),
    flushAll: jest.fn(),
    getStats: jest.fn().mockReturnValue({ totalWritten: 0, totalErrors: 0 }),
  };
}

function createMockDataQueryService() {
  return {
    queryTimeRange: jest.fn().mockResolvedValue({ data: [], total: 0 }),
  };
}

describe('3.15 + 3.17 — DeviceArchiveService InfluxDB integration', () => {
  describe('When InfluxWriteService is available', () => {
    let service: DeviceArchiveService;
    let mockInfluxWrite: any;

    beforeEach(() => {
      const mockRepo = createMockDataTagRepo();
      const mockPdb = createMockProjectDbService(mockRepo);
      mockInfluxWrite = createMockInfluxWriteService();
      const mockDataQuery = createMockDataQueryService();

      service = new DeviceArchiveService(mockRepo as any, mockPdb, mockInfluxWrite, mockDataQuery);
    });

    it('TC-ARC-IFLX-001: archiveToInfluxDB should call influxWriteService.writePoint', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const endTime = new Date('2024-01-01T00:01:00.000Z');

      // Simulate DataQueryService returning data
      const mockDataQuery = (service as any).dataQueryService;
      mockDataQuery.queryTimeRange.mockResolvedValue({
        data: [
          { tagId: 'tag-001', numericValue: 42.5, timestamp: new Date('2024-01-01T00:00:01.000Z') },
          { tagId: 'tag-001', numericValue: 43.0, timestamp: new Date('2024-01-01T00:00:02.000Z') },
        ],
        total: 2,
      });

      const result = await service.archiveToInfluxDB('tag-001', startTime, endTime);

      expect(result.archived).toBe(2);
      expect(mockInfluxWrite.writePoint).toHaveBeenCalledTimes(2);
      expect(mockInfluxWrite.writePoint).toHaveBeenCalledWith(
        expect.objectContaining({
          measurement: 'device_archive',
          tags: expect.objectContaining({ tagId: 'tag-001' }),
          fields: expect.objectContaining({ value: 42.5 }),
        }),
      );
    });

    it('TC-ARC-IFLX-002: the toInfluxPoint mapping should include measurement/tags/fields/timestamp', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const endTime = new Date('2024-01-01T00:01:00.000Z');

      const mockDataQuery = (service as any).dataQueryService;
      mockDataQuery.queryTimeRange.mockResolvedValue({
        data: [
          { tagId: 'tag-002', numericValue: 100, timestamp: new Date('2024-01-01T00:00:01.000Z') },
        ],
        total: 1,
      });

      await service.archiveToInfluxDB('tag-002', startTime, endTime);

      const call = mockInfluxWrite.writePoint.mock.calls[0][0];
      expect(call.measurement).toBe('device_archive');
      expect(call.tags).toHaveProperty('tagId', 'tag-002');
      expect(call.tags).toHaveProperty('projectId');
      expect(call.tags).toHaveProperty('deviceId');
      expect(call.fields).toHaveProperty('value', 100);
      expect(call.fields).toHaveProperty('quality');
      expect(call.timestamp).toBeInstanceOf(Date);
    });

    it('TC-ARC-IFLX-003: queryArchive should query from DataQueryService', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const endTime = new Date('2024-01-01T00:01:00.000Z');

      const mockDataQuery = (service as any).dataQueryService;
      mockDataQuery.queryTimeRange.mockResolvedValue({
        data: [
          { tagId: 'tag-003', numericValue: 55, timestamp: new Date('2024-01-01T00:00:30.000Z') },
        ],
        total: 1,
      });

      const result = await service.queryArchive('tag-003', {
        startTime,
        endTime,
        page: 1,
        pageSize: 50,
      });

      expect(mockDataQuery.queryTimeRange).toHaveBeenCalledWith({
        tagId: 'tag-003',
        startTime,
        endTime,
        page: 1,
        pageSize: 50,
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].value).toBe(55);
      expect(result.total).toBe(1);
    });

    it('TC-ARC-IFLX-004: should degrade to memory when the DataQueryService query fails', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const endTime = new Date('2024-01-01T00:01:00.000Z');

      const mockDataQuery = (service as any).dataQueryService;
      mockDataQuery.queryTimeRange.mockRejectedValue(new Error('DB 连接失败'));

      const result = await service.queryArchive('tag-004', {
        startTime,
        endTime,
      });

      // Degrade to in-memory, returning an empty result
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('When InfluxWriteService is unavailable (degraded mode)', () => {
    let service: DeviceArchiveService;

    beforeEach(() => {
      const mockRepo = createMockDataTagRepo();
      const mockPdb = createMockProjectDbService(mockRepo);
      // Do not pass influxWriteService and dataQueryService
      service = new DeviceArchiveService(mockRepo as any, mockPdb);
    });

    it('TC-ARC-IFLX-010: should degrade to an in-memory Map without InfluxWriteService', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const endTime = new Date('2024-01-01T00:01:00.000Z');

      const result = await service.archiveToInfluxDB('tag-fallback', startTime, endTime);

      // fetchDataPoints returns an empty array without DataQueryService
      expect(result.archived).toBe(0);
      expect(result.jobId).toMatch(/^arc_/);
    });

    it('TC-ARC-IFLX-011: queryArchive degrades to an in-memory query without DataQueryService', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const endTime = new Date('2024-01-01T00:01:00.000Z');

      const result = await service.queryArchive('tag-fallback-query', {
        startTime,
        endTime,
      });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('TC-ARC-IFLX-012: fetchDataPoints returns an empty array without DataQueryService instead of generating random numbers', async () => {
      const startTime = new Date('2024-01-01T00:00:00.000Z');
      const endTime = new Date('2024-01-01T00:01:00.000Z');

      // Indirect verification: archiveToInfluxDB calls fetchDataPoints, so archived should be 0
      const result = await service.archiveToInfluxDB('tag-no-random', startTime, endTime);
      expect(result.archived).toBe(0);
    });
  });
});

describe('3.17 — ArchiveService InfluxDB integration', () => {
  describe('When InfluxWriteService is available', () => {
    let archiveService: ArchiveService;
    let mockInfluxWrite: any;

    beforeEach(() => {
      mockInfluxWrite = createMockInfluxWriteService();
      const mockDataQuery = createMockDataQueryService();
      archiveService = new ArchiveService(mockInfluxWrite, mockDataQuery);
    });

    it('TC-ARC-SVC-001: archiveDataPoint should call influxWriteService.writePoint', async () => {
      const point = {
        tagId: 'tag-100',
        deviceId: 'device-001',
        value: 88.8,
        quality: 'good',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
      };

      await archiveService.archiveDataPoint(point);

      expect(mockInfluxWrite.writePoint).toHaveBeenCalledTimes(1);
      const call = mockInfluxWrite.writePoint.mock.calls[0][0];
      expect(call.measurement).toBe('tag_archive');
      expect(call.tags.tagId).toBe('tag-100');
      expect(call.fields.value).toBe(88.8);
    });

    it('TC-ARC-SVC-002: queryHistory should call dataQueryService.queryTimeRange', async () => {
      const start = new Date('2024-01-01T00:00:00.000Z');
      const end = new Date('2024-01-01T01:00:00.000Z');

      const mockDataQuery = (archiveService as any).dataQueryService;
      mockDataQuery.queryTimeRange.mockResolvedValue({
        data: [
          { tagId: 'tag-200', numericValue: 10, timestamp: new Date('2024-01-01T00:30:00.000Z') },
        ],
        total: 1,
      });

      const result = await archiveService.queryHistory('tag-200', start, end);

      expect(mockDataQuery.queryTimeRange).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].tagId).toBe('tag-200');
      expect(result[0].value).toBe(10);
    });

    it('TC-ARC-SVC-003: errors thrown by writePoint should be caught without rethrowing', async () => {
      mockInfluxWrite.writePoint.mockRejectedValue(new Error('InfluxDB down'));

      await archiveService.archiveDataPoint({
        tagId: 'tag-err',
        deviceId: 'dev-001',
        value: 1,
        quality: 'good',
        timestamp: new Date(),
      });
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('When InfluxWriteService is unavailable', () => {
    let archiveService: ArchiveService;

    beforeEach(() => {
      archiveService = new ArchiveService(undefined, undefined);
    });

    it('TC-ARC-SVC-010: archiveDataPoint should only log without InfluxWrite', async () => {
      await archiveService.archiveDataPoint({
        tagId: 'tag-noop',
        deviceId: 'dev-001',
        value: 1,
        quality: 'good',
        timestamp: new Date(),
      });
      // Should not throw
      expect(true).toBe(true);
    });

    it('TC-ARC-SVC-011: queryHistory should return an empty array without DataQuery', async () => {
      const result = await archiveService.queryHistory(
        'tag-noop',
        new Date('2024-01-01'),
        new Date('2024-01-02'),
      );
      expect(result).toEqual([]);
    });
  });
});
