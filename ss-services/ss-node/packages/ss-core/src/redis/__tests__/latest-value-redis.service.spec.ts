// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { LatestValueRedisService } from '../latest-value-redis.service';
import type Redis from 'ioredis';

/**
 * LatestValueRedisService unit tests (v3 -- project->device->tag hierarchy)
 *
 * Covers:
 * - key construction: deviceKey(projectId, deviceCode) / treeKey(projectId)
 * - serialize (full-semantics 7 fields) / deserialize (v3/P0/legacy {v,d,q,t} three-format compatibility + fault tolerance)
 * - enabled
 * - write (params object -> HSET device Key + HSET tree index)
 * - readTag / readDevice / readDevices (pipeline) -- direct path by deviceCode
 * - readTree (HGETALL tree index) / readTagByDeviceId (tree reverse lookup) -- by deviceId
 * - readAll (readTree + pipeline HGETALL, result keyed by deviceId)
 */
describe('LatestValueRedisService', () => {
  let mockRedis: jest.Mocked<Pick<Redis, 'hget' | 'hgetall' | 'hset' | 'pipeline'>>;
  let mockPipeline: jest.Mocked<{ hgetall: jest.Mock; exec: jest.Mock }>;
  let service: LatestValueRedisService;

  beforeEach(() => {
    mockPipeline = {
      hgetall: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockRedis = {
      hget: jest.fn(),
      hgetall: jest.fn(),
      hset: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn().mockReturnValue(mockPipeline),
    };
    service = new LatestValueRedisService(mockRedis as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ──────────── Key construction ────────────

  describe('key construction', () => {
    it('TC-LVR-001: deviceKey should join projectId and deviceCode', () => {
      expect(service.deviceKey('proj-1', 'pump-station-01')).toBe(
        'ss:latest:proj-1:pump-station-01',
      );
    });

    it('TC-LVR-002: treeKey should join projectId', () => {
      expect(service.treeKey('proj-1')).toBe('ss:latest:tree:proj-1');
    });
  });

  // ──────────── enabled ────────────

  describe('enabled', () => {
    it('TC-LVR-003: enabled=true when client is non-null', () => {
      expect(service.enabled).toBe(true);
    });

    it('TC-LVR-004: enabled=false when client is null', () => {
      expect(new LatestValueRedisService(null).enabled).toBe(false);
    });
  });

  // ──────────── serialize / deserialize ────────────

  describe('serialize', () => {
    it('TC-LVR-005: should output all semantic fields (including hierarchical path projectId/deviceCode/deviceId/tagId)', () => {
      const ts = new Date('2025-06-01T12:00:00Z');
      const parsed = JSON.parse(
        service.serialize('proj-1', 'pump-01', 'dev-uuid-1', 'tag-1', 42.5, 'good', ts),
      );
      expect(parsed).toEqual({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-uuid-1',
        tagId: 'tag-1',
        value: 42.5,
        quality: 'good',
        timestamp: '2025-06-01T12:00:00.000Z',
      });
    });

    it('TC-LVR-006: Date timestamps should be converted to ISO strings', () => {
      const raw = service.serialize(
        'p',
        'c',
        'd',
        't',
        1,
        'good',
        new Date('2025-12-31T23:59:59.999Z'),
      );
      expect(JSON.parse(raw).timestamp).toBe('2025-12-31T23:59:59.999Z');
    });

    it('TC-LVR-007: string timestamps should be kept as-is', () => {
      const raw = service.serialize('p', 'c', 'd', 't', 1, 'good', '2025-06-01T12:00:00Z');
      expect(JSON.parse(raw).timestamp).toBe('2025-06-01T12:00:00Z');
    });

    it('TC-LVR-008: should support null value', () => {
      expect(
        JSON.parse(service.serialize('p', 'c', 'd', 't', null, 'good', new Date())).value,
      ).toBeNull();
    });

    it('TC-LVR-009: should support boolean value', () => {
      expect(
        JSON.parse(service.serialize('p', 'c', 'd', 't', true, 'good', new Date())).value,
      ).toBe(true);
    });

    it('TC-LVR-010: should support string value', () => {
      expect(
        JSON.parse(service.serialize('p', 'c', 'd', 't', 'hello', 'good', new Date())).value,
      ).toBe('hello');
    });
  });

  describe('deserialize', () => {
    it('TC-LVR-011: should parse the v3 format (full semantic fields)', () => {
      const raw = JSON.stringify({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 42.5,
        quality: 'good',
        timestamp: '2025-06-01T12:00:00Z',
      });
      expect(service.deserialize(raw)).toEqual({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 42.5,
        quality: 'good',
        timestamp: new Date('2025-06-01T12:00:00Z'),
      });
    });

    it('TC-LVR-012: should be compatible with the P0 format {value,deviceId,quality,timestamp}', () => {
      const raw = JSON.stringify({
        value: 42.5,
        deviceId: 'dev-1',
        quality: 'good',
        timestamp: '2025-06-01T12:00:00Z',
      });
      expect(service.deserialize(raw)).toEqual({
        projectId: '',
        deviceCode: '',
        deviceId: 'dev-1',
        tagId: '',
        value: 42.5,
        quality: 'good',
        timestamp: new Date('2025-06-01T12:00:00Z'),
      });
    });

    it('TC-LVR-013: should be compatible with the legacy format {v,d,q,t}', () => {
      const raw = JSON.stringify({ v: 95, d: 'dev-1', q: 'good', t: '2025-06-01T12:00:00Z' });
      expect(service.deserialize(raw)).toEqual({
        projectId: '',
        deviceCode: '',
        deviceId: 'dev-1',
        tagId: '',
        value: 95,
        quality: 'good',
        timestamp: new Date('2025-06-01T12:00:00Z'),
      });
    });

    it('TC-LVR-014: should use default values when the legacy format lacks d/q', () => {
      const raw = JSON.stringify({ v: 1, t: '2025-06-01T12:00:00Z' });
      expect(service.deserialize(raw)).toEqual({
        projectId: '',
        deviceCode: '',
        deviceId: '',
        tagId: '',
        value: 1,
        quality: 'unknown',
        timestamp: new Date('2025-06-01T12:00:00Z'),
      });
    });

    it('TC-LVR-015: quality should default to unknown when the v3 format lacks it', () => {
      const raw = JSON.stringify({ value: 1, deviceId: 'd', timestamp: '2025-06-01T12:00:00Z' });
      expect(service.deserialize(raw)!.quality).toBe('unknown');
    });

    it('TC-LVR-016: null input should return null', () => {
      expect(service.deserialize(null)).toBeNull();
    });

    it('TC-LVR-017: undefined input should return null', () => {
      expect(service.deserialize(undefined)).toBeNull();
    });

    it('TC-LVR-018: corrupted JSON should return null (without throwing)', () => {
      expect(service.deserialize('{not valid json')).toBeNull();
    });

    it('TC-LVR-019: non-object JSON (number) should return null', () => {
      expect(service.deserialize('42')).toBeNull();
    });

    it('TC-LVR-020: an object with neither value nor v should return null', () => {
      expect(service.deserialize(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });
  });

  // ──────────── write ────────────

  describe('write', () => {
    it('TC-LVR-021: should HSET the device Hash (field=tagId, value=full-semantic serialized payload)', async () => {
      const ts = new Date('2025-06-01T12:00:00Z');
      await service.write({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 42.5,
        quality: 'good',
        timestamp: ts,
      });
      expect(mockRedis.hset).toHaveBeenCalledWith(
        'ss:latest:proj-1:pump-01',
        'tag-1',
        service.serialize('proj-1', 'pump-01', 'dev-1', 'tag-1', 42.5, 'good', ts),
      );
    });

    it('TC-LVR-022: should HSET the tree index (deviceId → {deviceCode, deviceName})', async () => {
      await service.write({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 1,
        quality: 'good',
        timestamp: new Date(),
        deviceName: '泵站A',
      });
      const treeCall = mockRedis.hset.mock.calls.find((c) => c[0] === 'ss:latest:tree:proj-1');
      expect(treeCall).toBeDefined();
      expect(treeCall![1]).toBe('dev-1');
      expect(JSON.parse(treeCall![2] as string)).toEqual({
        deviceCode: 'pump-01',
        deviceName: '泵站A',
      });
    });

    it('TC-LVR-023: a failed tree HSET should not affect the main write (fire-and-forget)', async () => {
      // The second hset (tree) fails; the first hset (device Key) should still succeed
      mockRedis.hset
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('tree HSET failed') as never);
      await expect(
        service.write({
          projectId: 'proj-1',
          deviceCode: 'pump-01',
          deviceId: 'dev-1',
          tagId: 'tag-1',
          value: 1,
          quality: 'good',
          timestamp: new Date(),
        }),
      ).resolves.toBeUndefined();
      expect(mockRedis.hset).toHaveBeenCalledTimes(2);
    });

    it('TC-LVR-024: write should be a no-op when client is null', async () => {
      await new LatestValueRedisService(null).write({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 1,
        quality: 'good',
        timestamp: new Date(),
      });
    });
  });

  // ──────────── readTag (by deviceCode) ────────────

  describe('readTag', () => {
    it('TC-LVR-025: should HGET the specified field and deserialize, backfilling hierarchical fields', async () => {
      mockRedis.hget.mockResolvedValue(
        JSON.stringify({
          projectId: 'proj-1',
          deviceCode: 'pump-01',
          deviceId: 'dev-1',
          tagId: 'tag-1',
          value: 42.5,
          quality: 'good',
          timestamp: '2025-06-01T12:00:00Z',
        }) as never,
      );
      const entry = await service.readTag('proj-1', 'pump-01', 'tag-1');
      expect(mockRedis.hget).toHaveBeenCalledWith('ss:latest:proj-1:pump-01', 'tag-1');
      expect(entry).toEqual({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 42.5,
        quality: 'good',
        timestamp: new Date('2025-06-01T12:00:00Z'),
      });
    });

    it('TC-LVR-026: backfill hierarchy fields from key/field context when the legacy value lacks them', async () => {
      mockRedis.hget.mockResolvedValue(
        JSON.stringify({
          value: 42.5,
          deviceId: 'dev-1',
          quality: 'good',
          timestamp: '2025-06-01T12:00:00Z',
        }) as never,
      );
      const entry = await service.readTag('proj-1', 'pump-01', 'tag-1');
      expect(entry).toEqual({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 42.5,
        quality: 'good',
        timestamp: new Date('2025-06-01T12:00:00Z'),
      });
    });

    it('TC-LVR-027: should return null when HGET returns null', async () => {
      mockRedis.hget.mockResolvedValue(null as never);
      expect(await service.readTag('proj-1', 'pump-01', 'tag-1')).toBeNull();
    });

    it('TC-LVR-028: should return null when client is null', async () => {
      expect(
        await new LatestValueRedisService(null).readTag('proj-1', 'pump-01', 'tag-1'),
      ).toBeNull();
    });
  });

  // ──────────── readDevice (by deviceCode) ────────────

  describe('readDevice', () => {
    it('TC-LVR-029: should HGETALL and deserialize all fields', async () => {
      mockRedis.hgetall.mockResolvedValue({
        'tag-1': JSON.stringify({
          projectId: 'proj-1',
          deviceCode: 'pump-01',
          deviceId: 'dev-1',
          tagId: 'tag-1',
          value: 1,
          quality: 'good',
          timestamp: '2025-06-01T12:00:00Z',
        }),
        'tag-2': JSON.stringify({
          projectId: 'proj-1',
          deviceCode: 'pump-01',
          deviceId: 'dev-1',
          tagId: 'tag-2',
          value: 2,
          quality: 'good',
          timestamp: '2025-06-01T12:01:00Z',
        }),
      } as never);
      const result = await service.readDevice('proj-1', 'pump-01');
      expect(mockRedis.hgetall).toHaveBeenCalledWith('ss:latest:proj-1:pump-01');
      expect(Object.keys(result).sort()).toEqual(['tag-1', 'tag-2']);
      expect(result['tag-1'].value).toBe(1);
      expect(result['tag-2'].value).toBe(2);
    });

    it('TC-LVR-030: corrupted field values should be skipped (without throwing)', async () => {
      mockRedis.hgetall.mockResolvedValue({
        'tag-1': '{broken',
        'tag-2': JSON.stringify({
          value: 2,
          deviceId: 'd',
          quality: 'good',
          timestamp: '2025-06-01T12:00:00Z',
        }),
      } as never);
      const result = await service.readDevice('proj-1', 'pump-01');
      expect(Object.keys(result)).toEqual(['tag-2']);
    });

    it('TC-LVR-031: should return an empty object when client is null', async () => {
      expect(await new LatestValueRedisService(null).readDevice('proj-1', 'pump-01')).toEqual({});
    });
  });

  // ──────────── readDevices (batch by deviceCode) ────────────

  describe('readDevices', () => {
    it('TC-LVR-032: should pipeline HGETALL for every device, returning Map<deviceCode, entries>', async () => {
      mockPipeline.exec.mockResolvedValue([
        [
          null,
          {
            'tag-a': JSON.stringify({
              value: 10,
              deviceId: 'd1',
              quality: 'good',
              timestamp: '2025-06-01T12:00:00Z',
            }),
          },
        ],
        [
          null,
          {
            'tag-b': JSON.stringify({
              value: 20,
              deviceId: 'd2',
              quality: 'good',
              timestamp: '2025-06-01T12:00:00Z',
            }),
          },
        ],
      ] as never);
      const result = await service.readDevices('proj-1', ['pump-01', 'pump-02']);
      expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
      expect(mockPipeline.hgetall).toHaveBeenCalledWith('ss:latest:proj-1:pump-01');
      expect(mockPipeline.hgetall).toHaveBeenCalledWith('ss:latest:proj-1:pump-02');
      expect(result.get('pump-01')!['tag-a'].value).toBe(10);
      expect(result.get('pump-02')!['tag-b'].value).toBe(20);
    });

    it('TC-LVR-033: empty deviceCodes should return an empty Map directly (without calling pipeline)', async () => {
      const result = await service.readDevices('proj-1', []);
      expect(result.size).toBe(0);
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });

    it('TC-LVR-034: a failed HGETALL for one device should skip it (without interrupting the whole batch)', async () => {
      mockPipeline.exec.mockResolvedValue([
        [new Error('HGETALL failed'), null],
        [
          null,
          {
            'tag-b': JSON.stringify({
              value: 20,
              deviceId: 'd2',
              quality: 'good',
              timestamp: '2025-06-01T12:00:00Z',
            }),
          },
        ],
      ] as never);
      const result = await service.readDevices('proj-1', ['pump-01', 'pump-02']);
      expect(result.get('pump-01')).toEqual({});
      expect(result.get('pump-02')!['tag-b'].value).toBe(20);
    });

    it('TC-LVR-035: should return an empty Map when client is null', async () => {
      expect(
        (await new LatestValueRedisService(null).readDevices('proj-1', ['pump-01'])).size,
      ).toBe(0);
    });
  });

  // ──────────── readTree (tree index, reverse lookup by deviceId) ────────────

  describe('readTree', () => {
    it('TC-LVR-036: should HGETALL the tree index, returning Map<deviceId, {deviceCode, deviceName}>', async () => {
      mockRedis.hgetall.mockResolvedValue({
        'dev-uuid-1': JSON.stringify({ deviceCode: 'pump-01', deviceName: '泵站A' }),
        'dev-uuid-2': JSON.stringify({ deviceCode: 'pump-02', deviceName: '泵站B' }),
      } as never);
      const result = await service.readTree('proj-1');
      expect(mockRedis.hgetall).toHaveBeenCalledWith('ss:latest:tree:proj-1');
      expect(result.size).toBe(2);
      expect(result.get('dev-uuid-1')).toEqual({ deviceCode: 'pump-01', deviceName: '泵站A' });
      expect(result.get('dev-uuid-2')).toEqual({ deviceCode: 'pump-02', deviceName: '泵站B' });
    });

    it('TC-LVR-037: corrupted tree entries should be skipped', async () => {
      mockRedis.hgetall.mockResolvedValue({
        'dev-1': '{broken',
        'dev-2': JSON.stringify({ deviceCode: 'pump-02', deviceName: '泵站B' }),
      } as never);
      const result = await service.readTree('proj-1');
      expect(result.size).toBe(1);
      expect(result.get('dev-2')!.deviceCode).toBe('pump-02');
    });

    it('TC-LVR-038: entries lacking deviceCode should be skipped', async () => {
      mockRedis.hgetall.mockResolvedValue({
        'dev-1': JSON.stringify({ deviceName: '无编码设备' }),
      } as never);
      const result = await service.readTree('proj-1');
      expect(result.size).toBe(0);
    });

    it('TC-LVR-039: should return an empty Map when client is null', async () => {
      expect((await new LatestValueRedisService(null).readTree('proj-1')).size).toBe(0);
    });
  });

  // ──────────── readTagByDeviceId (tree reverse lookup for deviceCode then read) ────────────

  describe('readTagByDeviceId', () => {
    it('TC-LVR-040: should first HGET the tree to reverse-lookup deviceCode, then HGET the device key to read the value', async () => {
      // First hget: tree-index reverse lookup
      // Second hget: read the latest value from the device Key
      mockRedis.hget
        .mockResolvedValueOnce(
          JSON.stringify({ deviceCode: 'pump-01', deviceName: '泵站A' }) as never,
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            projectId: 'proj-1',
            deviceCode: 'pump-01',
            deviceId: 'dev-1',
            tagId: 'tag-1',
            value: 42.5,
            quality: 'good',
            timestamp: '2025-06-01T12:00:00Z',
          }) as never,
        );
      const entry = await service.readTagByDeviceId('proj-1', 'dev-1', 'tag-1');
      expect(mockRedis.hget).toHaveBeenNthCalledWith(1, 'ss:latest:tree:proj-1', 'dev-1');
      expect(mockRedis.hget).toHaveBeenNthCalledWith(2, 'ss:latest:proj-1:pump-01', 'tag-1');
      expect(entry).toEqual({
        projectId: 'proj-1',
        deviceCode: 'pump-01',
        deviceId: 'dev-1',
        tagId: 'tag-1',
        value: 42.5,
        quality: 'good',
        timestamp: new Date('2025-06-01T12:00:00Z'),
      });
    });

    it('TC-LVR-041: should return null when the tree index has no such deviceId', async () => {
      mockRedis.hget.mockResolvedValue(null as never);
      expect(await service.readTagByDeviceId('proj-1', 'unknown-dev', 'tag-1')).toBeNull();
      expect(mockRedis.hget).toHaveBeenCalledTimes(1); // tree query only, no device key read
    });

    it('TC-LVR-042: should return null when the tree entry is corrupted (no deviceCode)', async () => {
      mockRedis.hget.mockResolvedValue(JSON.stringify({ deviceName: '无编码' }) as never);
      expect(await service.readTagByDeviceId('proj-1', 'dev-1', 'tag-1')).toBeNull();
    });

    it('TC-LVR-043: should return null when client is null', async () => {
      expect(
        await new LatestValueRedisService(null).readTagByDeviceId('proj-1', 'dev-1', 'tag-1'),
      ).toBeNull();
    });
  });

  // ──────────── readAll (whole project, tree + pipeline) ────────────

  describe('readAll', () => {
    it('TC-LVR-044: should HGETALL the tree then pipeline batch-read, returning Map<deviceId, entries>', async () => {
      // readTree: hgetall the tree index
      mockRedis.hgetall.mockResolvedValue({
        'dev-uuid-1': JSON.stringify({ deviceCode: 'pump-01', deviceName: '泵站A' }),
        'dev-uuid-2': JSON.stringify({ deviceCode: 'pump-02', deviceName: '泵站B' }),
      } as never);
      // readDevices: pipeline hgetall
      mockPipeline.exec.mockResolvedValue([
        [
          null,
          {
            'tag-a': JSON.stringify({
              value: 1,
              deviceId: 'd1',
              quality: 'good',
              timestamp: '2025-06-01T12:00:00Z',
            }),
          },
        ],
        [
          null,
          {
            'tag-b': JSON.stringify({
              value: 2,
              deviceId: 'd2',
              quality: 'good',
              timestamp: '2025-06-01T12:00:00Z',
            }),
          },
        ],
      ] as never);
      const result = await service.readAll('proj-1');
      expect(mockRedis.hgetall).toHaveBeenCalledWith('ss:latest:tree:proj-1');
      expect(mockPipeline.hgetall).toHaveBeenCalledWith('ss:latest:proj-1:pump-01');
      expect(mockPipeline.hgetall).toHaveBeenCalledWith('ss:latest:proj-1:pump-02');
      expect(result.size).toBe(2);
      expect(result.get('dev-uuid-1')!['tag-a'].value).toBe(1);
      expect(result.get('dev-uuid-2')!['tag-b'].value).toBe(2);
    });

    it('TC-LVR-045: a project with no devices (empty tree index) should return an empty Map', async () => {
      mockRedis.hgetall.mockResolvedValue({} as never);
      expect((await service.readAll('proj-1')).size).toBe(0);
    });

    it('TC-LVR-046: should return an empty Map when client is null', async () => {
      expect((await new LatestValueRedisService(null).readAll('proj-1')).size).toBe(0);
    });
  });
});
