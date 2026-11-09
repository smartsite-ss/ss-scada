// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import { DeviceDataService } from '../device-data.service';

// ============================================================
// Helpers
// ============================================================

function makeService(dataQueryService?: any): DeviceDataService {
  const deviceRepo = { findOne: jest.fn().mockResolvedValue(null) };
  return new DeviceDataService(deviceRepo as any, undefined, dataQueryService);
}

// ============================================================
// Test suite
// ============================================================

describe('DeviceDataService.getTagHistory', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-11-01T01:00:00Z');

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Should query the project bucket by forwarding projectId', async () => {
    const dataQueryService = {
      queryTimeRange: jest.fn().mockResolvedValue({
        data: [
          { tagId: 'tag-1', numericValue: 12.5, timestamp: new Date('2026-11-01T00:10:00Z') },
          { tagId: 'tag-1', numericValue: 13, timestamp: new Date('2026-11-01T00:20:00Z') },
        ],
        total: 2,
      }),
    };

    const rows = await makeService(dataQueryService).getTagHistory(
      'tag-1',
      { start, end },
      undefined,
      'energy-management-demo',
    );

    expect(dataQueryService.queryTimeRange).toHaveBeenCalledWith(
      expect.objectContaining({
        tagId: 'tag-1',
        startTime: start,
        endTime: end,
        projectId: 'energy-management-demo',
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe(12.5);
    expect(rows[0].quality).toBe('good');
  });

  it('Should return an empty list when the query service is unavailable', async () => {
    const rows = await makeService(undefined).getTagHistory('tag-1', { start, end });

    expect(rows).toEqual([]);
  });

  it('Should swallow query errors and return an empty list', async () => {
    const dataQueryService = {
      queryTimeRange: jest.fn().mockRejectedValue(new Error('influx down')),
    };

    await expect(
      makeService(dataQueryService).getTagHistory('tag-1', { start, end }, undefined, 'proj-a'),
    ).resolves.toEqual([]);
  });
});
