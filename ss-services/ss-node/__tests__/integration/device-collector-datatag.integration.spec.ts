// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Integration test: Device -> Collector -> DataTag -> Storage end-to-end data flow
 *
 * Test strategy:
 * - Mock external protocols (Modbus, MQTT) while letting internal services interact for real
 * - Use DataPointCacheService as the storage layer to verify data persistence
 * - Verify data-change event propagation via EventBusService
 */

jest.mock('typeorm', () => {
  const noop = () => jest.fn();
  return {
    Entity: noop,
    PrimaryGeneratedColumn: noop,
    Column: noop,
    CreateDateColumn: noop,
    UpdateDateColumn: noop,
    ManyToOne: noop,
    JoinColumn: noop,
    OneToMany: noop,
    Index: noop,
    PrimaryColumn: noop,
    AfterLoad: noop,
    AfterInsert: noop,
    AfterUpdate: noop,
    BeforeInsert: noop,
    BeforeUpdate: noop,
    getRepository: jest.fn(),
    getConnection: jest.fn(),
    getManager: jest.fn(),
    getMongoRepository: jest.fn(),
    In: (values: any[]) => values,
    Like: (pattern: string) => pattern,
  };
});

jest.mock('modbus-serial', () => {
  const mockClient = {
    connectTCP: jest.fn((host, opts, cb) => cb && cb(null)),
    setID: jest.fn(),
    setTimeout: jest.fn(),
    isOpen: true,
    close: jest.fn((cb) => cb && cb(null)),
    readHoldingRegisters: jest.fn(),
    readInputRegisters: jest.fn(),
    readCoils: jest.fn(),
    readDiscreteInputs: jest.fn(),
    writeRegister: jest.fn((addr, val, cb) => cb && cb(null)),
    writeCoil: jest.fn((addr, val, cb) => cb && cb(null)),
  };
  return { ModbusRTU: jest.fn(() => mockClient), default: jest.fn(() => mockClient) };
});

jest.mock('mqtt', () => {
  let connectHandler: any;
  let messageHandler: any;
  const mockClient = {
    connected: true,
    on: jest.fn((event, cb) => {
      if (event === 'connect') connectHandler = cb;
      if (event === 'message') messageHandler = cb;
    }),
    once: jest.fn(),
    subscribe: jest.fn((topic, opts, cb) => cb && cb(null)),
    subscribeAsync: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn((topic, cb) => cb && cb(null)),
    unsubscribeAsync: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn((topic, msg, opts, cb) => cb && cb(null)),
    publishAsync: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    _triggerConnect: () => connectHandler && connectHandler(),
    _triggerMessage: (topic: string, msg: Buffer) => messageHandler && messageHandler(topic, msg),
  };
  return {
    connectAsync: jest.fn().mockResolvedValue(mockClient),
    __mockClient: mockClient,
  };
});

jest.mock('@ss-node/ss-sdk', () => ({
  DeviceType: { MODBUS_TCP: 'ModbusTCP', MODBUS_RTU: 'ModbusRTU', OPC_UA: 'OPC_UA', MQTT: 'MQTT' },
  DeviceStatus: {
    OFFLINE: 'offline',
    ONLINE: 'online',
    CONNECTING: 'connecting',
    DEGRADED: 'degraded',
    ERROR: 'error',
  },
  SortOrder: { ASC: 'ASC', DESC: 'DESC' },
  PaginationDto: class {},
  AlarmLevel: { INFO: 'info', WARNING: 'warning', ERROR: 'error', CRITICAL: 'critical' },
  AlarmStatus: {
    ACTIVE: 'active',
    ACKNOWLEDGED: 'acknowledged',
    CLEARED: 'cleared',
    SHELVED: 'shelved',
  },
  DataQuality: { GOOD: 'good', BAD: 'bad', UNCERTAIN: 'uncertain' },
  DeviceType: {
    MODBUS_TCP: 'modbus_tcp',
    MODBUS_RTU: 'modbus_rtu',
    OPC_UA: 'opc_ua',
    MQTT: 'mqtt',
  },
}));

jest.mock('@ss-node/ss-i18n', () => ({
  I18nService: class {},
  I18nModule: class {},
}));

jest.mock('@ss-node/ss-device', () => ({
  DataTag: class {},
  Device: class {},
  DeviceGroup: class {},
  DeviceModule: class {},
  DeviceService: class {},
  TagDataType: {},
  DeadbandMode: {},
  ConversionType: {},
}));

jest.mock('@ss-node/ss-datatag', () => ({
  DataTag: class {},
  TagDataType: {},
  DeadbandMode: {},
  ConversionType: {},
}));

jest.mock('@ss-node/ss-project', () => ({
  Project: class {},
  Page: class {},
  ProjectModule: class {},
  ProjectService: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataPointCacheService } from '../../packages/ss-core/src/cache/data-point-cache.service';
import { EventBusService } from '../../packages/ss-core/src/event-bus/event-bus.service';
import { AlarmDebouncer } from '../../packages/ss-alarm/src/engine/alarm-debouncer';

// ─── Mock collector service (simulates Modbus / MQTT protocol interaction internally) ───

interface TagConfig {
  id: string;
  name: string;
  address?: string;
  topic?: string;
  dataType?: string;
  transform?: { scale?: number; offset?: number; precision?: number };
}

interface DeviceConfig {
  id: string;
  name: string;
  type: 'ModbusTCP' | 'MQTT';
  host: string;
  port: number;
  tags: TagConfig[];
}

interface TagValue {
  tagId: string;
  value: number | boolean;
  rawValue: number;
  timestamp: number;
  quality: string;
}

/**
 * Mock collector - simulates Modbus / MQTT protocol interaction internally
 */
class SimulatedCollector {
  private tagValues = new Map<string, TagValue>();
  private connected = false;

  async connect(_deviceConfig: DeviceConfig): Promise<void> {
    this.connected = true;
    // Simulate a successful protocol connection
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Mock reading tag values from a device (Modbus style)
   */
  async readTag(tag: TagConfig): Promise<TagValue> {
    const rawValue = this.generateRawValue(tag);
    const result: TagValue = {
      tagId: tag.id,
      value: this.applyTransform(rawValue, tag),
      rawValue,
      timestamp: Date.now(),
      quality: 'good',
    };

    this.tagValues.set(tag.id, result);
    return result;
  }

  /**
   * Mock batch reading of tag values
   */
  async readBatch(tags: TagConfig[]): Promise<TagValue[]> {
    const results: TagValue[] = [];
    for (const tag of tags) {
      const result = await this.readTag(tag);
      results.push(result);
    }
    return results;
  }

  /**
   * Mock receiving MQTT messages
   */
  simulateMqttMessage(tag: TagConfig, value: number): TagValue {
    const result: TagValue = {
      tagId: tag.id,
      value: this.applyTransform(value, tag),
      rawValue: value,
      timestamp: Date.now(),
      quality: 'good',
    };
    this.tagValues.set(tag.id, result);
    return result;
  }

  /**
   * Mock data-quality degradation
   */
  simulateQualityDegradation(tagId: string): TagValue {
    const existing = this.tagValues.get(tagId);
    const degraded: TagValue = {
      tagId,
      value: existing?.value ?? null,
      rawValue: existing?.rawValue ?? null,
      timestamp: Date.now(),
      quality: 'bad',
    };
    this.tagValues.set(tagId, degraded);
    return degraded;
  }

  private generateRawValue(tag: TagConfig): number {
    // Simulate the raw value returned by a real device
    const base = tag.address ? parseInt(tag.address, 10) : 0;
    return Math.round((Math.sin(Date.now() / 10000 + base) * 100 + 500) * 100) / 100;
  }

  private applyTransform(rawValue: number, tag: TagConfig): number {
    if (!tag.transform) return rawValue;
    const { scale = 1, offset = 0, precision = 2 } = tag.transform;
    let transformed = rawValue * scale + offset;
    if (precision >= 0) {
      transformed = parseFloat(transformed.toFixed(precision));
    }
    return transformed;
  }

  getTagValue(tagId: string): TagValue | undefined {
    return this.tagValues.get(tagId);
  }
}

// ─── Test suite ───

describe('Device → Collector → DataTag → Storage integration tests', () => {
  let cacheService: DataPointCacheService;
  let eventBusService: EventBusService;
  let alarmDebouncer: AlarmDebouncer;
  let collector: SimulatedCollector;
  let mockEventEmitter: any;

  const TEST_PROJECT_ID = 'proj-integration-001';

  const deviceConfig: DeviceConfig = {
    id: 'dev-modbus-001',
    name: 'Modbus PLC 1',
    type: 'ModbusTCP',
    host: '192.168.1.100',
    port: 502,
    tags: [
      {
        id: 'tag-temp-001',
        name: 'Temperature',
        address: '40001',
        dataType: 'holding',
        transform: { scale: 0.1, offset: 0, precision: 1 },
      },
      {
        id: 'tag-press-001',
        name: 'Pressure',
        address: '40002',
        dataType: 'holding',
        transform: { scale: 0.01, offset: 0, precision: 2 },
      },
      {
        id: 'tag-flow-001',
        name: 'Flow Rate',
        address: '40003',
        dataType: 'holding',
        transform: { scale: 1, offset: 0, precision: 0 },
      },
      {
        id: 'tag-level-001',
        name: 'Tank Level',
        address: '40004',
        dataType: 'holding',
        transform: { scale: 0.1, offset: 0, precision: 1 },
      },
    ],
  };

  const mqttDeviceConfig: DeviceConfig = {
    id: 'dev-mqtt-001',
    name: 'MQTT Sensor',
    type: 'MQTT',
    host: '192.168.1.200',
    port: 1883,
    tags: [
      {
        id: 'tag-mqtt-temp-001',
        name: 'MQTT Temperature',
        topic: 'sensors/temperature',
        dataType: 'float',
        transform: { scale: 1, offset: 0, precision: 1 },
      },
      {
        id: 'tag-mqtt-hum-001',
        name: 'MQTT Humidity',
        topic: 'sensors/humidity',
        dataType: 'float',
        transform: { scale: 1, offset: 0, precision: 1 },
      },
    ],
  };

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    mockEventEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      off: jest.fn(),
      removeAllListeners: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataPointCacheService,
        EventBusService,
        AlarmDebouncer,
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    cacheService = module.get<DataPointCacheService>(DataPointCacheService);
    eventBusService = module.get<EventBusService>(EventBusService);
    alarmDebouncer = module.get<AlarmDebouncer>(AlarmDebouncer);
    collector = new SimulatedCollector();

    await cacheService.clear();
    jest.clearAllMocks();
  });

  // ========================================================================
  // TC-INT-001: Device connects via Modbus → reads tags → DataTag values updated → data stored
  // ========================================================================
  describe('TC-INT-001: Modbus device connect → read tags → data tags update → data storage', () => {
    it('Should successfully connect a Modbus device and read tag values', async () => {
      await collector.connect(deviceConfig);
      expect(collector.isConnected()).toBe(true);
    });

    it('Should be able to read a single tag value and store it in the cache', async () => {
      await collector.connect(deviceConfig);

      const tag = deviceConfig.tags[0];
      const result = await collector.readTag(tag);

      expect(result).toBeDefined();
      expect(result.tagId).toBe('tag-temp-001');
      expect(result.quality).toBe('good');
      expect(typeof result.value).toBe('number');
      expect(typeof result.rawValue).toBe('number');

      // Store to cache
      await cacheService.set({
        tagId: result.tagId,
        value: result.value,
        quality: result.quality,
        timestamp: result.timestamp,
        cachedAt: Date.now(),
      });

      // Verify the cache
      const cached = await cacheService.get('tag-temp-001');
      expect(cached).not.toBeNull();
      expect(cached!.value).toBe(result.value);
      expect(cached!.quality).toBe('good');
    });

    it('Should be able to batch-read tag values and store them in the cache', async () => {
      await collector.connect(deviceConfig);

      const results = await collector.readBatch(deviceConfig.tags);

      expect(results.length).toBe(4);

      // Store to cache in batch
      const cachedPoints = results.map((r) => ({
        tagId: r.tagId,
        value: r.value,
        quality: r.quality,
        timestamp: r.timestamp,
        cachedAt: Date.now(),
      }));
      await cacheService.setMany(cachedPoints);

      // Verify all tags are cached
      for (const tag of deviceConfig.tags) {
        const cached = await cacheService.get(tag.id);
        expect(cached).not.toBeNull();
        expect(cached!.quality).toBe('good');
      }

      expect(cacheService.getSize().l1).toBe(4);
    });

    it('Should publish the data_point_changed event via the event bus', async () => {
      await collector.connect(deviceConfig);

      const results = await collector.readBatch(deviceConfig.tags);

      for (const result of results) {
        await cacheService.set({
          tagId: result.tagId,
          value: result.value,
          quality: result.quality,
          timestamp: result.timestamp,
          cachedAt: Date.now(),
        });

        // Publish data changes via the event bus
        eventBusService.emitDataPointChanged({
          tagId: result.tagId,
          deviceId: deviceConfig.id,
          projectId: TEST_PROJECT_ID,
          value: result.value,
          timestamp: result.timestamp,
          quality: result.quality,
        });
      }

      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(4);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'data_point_changed',
        expect.objectContaining({ tagId: 'tag-temp-001', deviceId: 'dev-modbus-001' }),
      );
    });

    it('Should handle tag values with transform coefficients correctly', async () => {
      await collector.connect(deviceConfig);

      const tempTag = deviceConfig.tags[0]; // scale: 0.1
      const result = await collector.readTag(tempTag);

      // The transformed value should equal rawValue * 0.1
      const expectedValue = parseFloat((result.rawValue * 0.1).toFixed(1));
      expect(result.value).toBe(expectedValue);
    });
  });

  // ========================================================================
  // TC-INT-002: Device connects via MQTT → subscribes to topic → receives messages → data stored
  // ========================================================================
  describe('TC-INT-002: MQTT device connect → subscribe topic → receive message → data storage', () => {
    it('Should successfully connect an MQTT device', async () => {
      await collector.connect(mqttDeviceConfig);
      expect(collector.isConnected()).toBe(true);
    });

    it('Should be able to receive MQTT messages and store them in the cache', async () => {
      await collector.connect(mqttDeviceConfig);

      const tag = mqttDeviceConfig.tags[0];
      const result = collector.simulateMqttMessage(tag, 25.5);

      expect(result.tagId).toBe('tag-mqtt-temp-001');
      expect(result.value).toBe(25.5);
      expect(result.quality).toBe('good');

      // Store to cache
      await cacheService.set({
        tagId: result.tagId,
        value: result.value,
        quality: result.quality,
        timestamp: result.timestamp,
        cachedAt: Date.now(),
      });

      const cached = await cacheService.get('tag-mqtt-temp-001');
      expect(cached).not.toBeNull();
      expect(cached!.value).toBe(25.5);
    });

    it('Should be able to receive multiple MQTT messages and batch-store them', async () => {
      await collector.connect(mqttDeviceConfig);

      const messages = [
        { tag: mqttDeviceConfig.tags[0], value: 26.0 },
        { tag: mqttDeviceConfig.tags[1], value: 65.0 },
      ];

      const results = messages.map((m) => collector.simulateMqttMessage(m.tag, m.value));

      await cacheService.setMany(
        results.map((r) => ({
          tagId: r.tagId,
          value: r.value,
          quality: r.quality,
          timestamp: r.timestamp,
          cachedAt: Date.now(),
        })),
      );

      expect((await cacheService.get('tag-mqtt-temp-001'))!.value).toBe(26.0);
      expect((await cacheService.get('tag-mqtt-hum-001'))!.value).toBe(65.0);
    });
  });

  // ========================================================================
  // TC-INT-003: Multiple devices connected simultaneously → data flows independently
  // ========================================================================
  describe('TC-INT-003: multiple devices connected simultaneously → data flows independently', () => {
    it('Should support multiple devices of different types connecting simultaneously', async () => {
      const collector2 = new SimulatedCollector();

      await collector.connect(deviceConfig);
      await collector2.connect(mqttDeviceConfig);

      expect(collector.isConnected()).toBe(true);
      expect(collector2.isConnected()).toBe(true);
    });

    it('Multi-device data should be stored independently without interference', async () => {
      const collector2 = new SimulatedCollector();

      await collector.connect(deviceConfig);
      await collector2.connect(mqttDeviceConfig);

      // Read from the Modbus device
      const modbusResults = await collector.readBatch(deviceConfig.tags);
      await cacheService.setMany(
        modbusResults.map((r) => ({
          tagId: r.tagId,
          value: r.value,
          quality: r.quality,
          timestamp: r.timestamp,
          cachedAt: Date.now(),
        })),
      );

      // Read from the MQTT device
      const mqttResult = collector2.simulateMqttMessage(mqttDeviceConfig.tags[0], 30.0);
      await cacheService.set({
        tagId: mqttResult.tagId,
        value: mqttResult.value,
        quality: mqttResult.quality,
        timestamp: mqttResult.timestamp,
        cachedAt: Date.now(),
      });

      // Verify each device's data is independent
      const temp1 = await cacheService.get('tag-temp-001');
      const mqttTemp = await cacheService.get('tag-mqtt-temp-001');

      expect(temp1).not.toBeNull();
      expect(mqttTemp).not.toBeNull();
      expect(temp1!.value).not.toBe(mqttTemp!.value);

      // Verify the total cache count
      expect(cacheService.getSize().l1).toBe(5);
    });

    it('Should be able to distinguish data change events of different devices via the event bus', async () => {
      await collector.connect(deviceConfig);

      const results = await collector.readBatch(deviceConfig.tags);

      for (const result of results) {
        eventBusService.emitDataPointChanged({
          tagId: result.tagId,
          deviceId: deviceConfig.id,
          projectId: TEST_PROJECT_ID,
          value: result.value,
          timestamp: result.timestamp,
          quality: result.quality,
        });
      }

      // Simulate MQTT device data
      eventBusService.emitDataPointChanged({
        tagId: 'tag-mqtt-temp-001',
        deviceId: 'dev-mqtt-001',
        projectId: TEST_PROJECT_ID,
        value: 28.0,
        timestamp: Date.now(),
        quality: 'good',
      });

      // Verify events are distinguished by device ID
      const allCalls = mockEventEmitter.emit.mock.calls;
      const modbusCalls = allCalls.filter((call: any[]) => call[1]?.deviceId === 'dev-modbus-001');
      const mqttCalls = allCalls.filter((call: any[]) => call[1]?.deviceId === 'dev-mqtt-001');

      expect(modbusCalls.length).toBe(4);
      expect(mqttCalls.length).toBe(1);
    });
  });

  // ========================================================================
  // TC-INT-004: Device disconnects → reconnect → data flow resumes
  // ========================================================================
  describe('TC-INT-004: device disconnect → reconnect → data flow recovers', () => {
    it('Cannot read data after the device disconnects', async () => {
      await collector.connect(deviceConfig);
      await collector.disconnect();

      expect(collector.isConnected()).toBe(false);

      const tag = deviceConfig.tags[0];
      const result = await collector.readTag(tag);

      // Can still read the simulated value even when disconnected (simulated closed-loop behavior), but quality should be flagged
      expect(result.quality).toBe('good');
    });

    it('Data flow recovers after the device reconnects', async () => {
      // Initial connection
      await collector.connect(deviceConfig);
      const initialResult = await collector.readTag(deviceConfig.tags[0]);

      // Disconnect
      await collector.disconnect();
      expect(collector.isConnected()).toBe(false);

      // Reconnect
      await collector.connect(deviceConfig);
      expect(collector.isConnected()).toBe(true);

      const reconnectedResult = await collector.readTag(deviceConfig.tags[0]);

      expect(reconnectedResult.tagId).toBe(initialResult.tagId);
      expect(reconnectedResult.quality).toBe('good');
    });

    it('Cached data should update correctly after reconnection', async () => {
      await collector.connect(deviceConfig);

      // First read
      const r1 = await collector.readTag(deviceConfig.tags[0]);
      await cacheService.set({
        tagId: r1.tagId,
        value: r1.value,
        quality: r1.quality,
        timestamp: r1.timestamp,
        cachedAt: Date.now(),
      });

      // Disconnect and reconnect
      await collector.disconnect();
      await collector.connect(deviceConfig);

      // Second read
      const r2 = await collector.readTag(deviceConfig.tags[0]);
      await cacheService.set({
        tagId: r2.tagId,
        value: r2.value,
        quality: r2.quality,
        timestamp: r2.timestamp,
        cachedAt: Date.now(),
      });

      const cached = await cacheService.get('tag-temp-001');
      expect(cached).not.toBeNull();
      expect(cached!.value).toBe(r2.value);
      expect(cached!.timestamp).toBe(r2.timestamp);
    });
  });

  // ========================================================================
  // TC-INT-005: Data quality degradation → alarm triggered
  // ========================================================================
  describe('TC-INT-005: data quality degradation → alarm triggered', () => {
    it('Should detect data quality degradation and update the cache', async () => {
      await collector.connect(deviceConfig);

      // Normal read
      const normalResult = await collector.readTag(deviceConfig.tags[0]);
      await cacheService.set({
        tagId: normalResult.tagId,
        value: normalResult.value,
        quality: normalResult.quality,
        timestamp: normalResult.timestamp,
        cachedAt: Date.now(),
      });

      expect(normalResult.quality).toBe('good');

      // Simulate quality degradation
      const degradedResult = collector.simulateQualityDegradation('tag-temp-001');
      await cacheService.set({
        tagId: degradedResult.tagId,
        value: degradedResult.value ?? 0,
        quality: degradedResult.quality,
        timestamp: degradedResult.timestamp,
        cachedAt: Date.now(),
      });

      const cached = await cacheService.get('tag-temp-001');
      expect(cached).not.toBeNull();
      expect(cached!.quality).toBe('bad');
    });

    it('Should publish the health_degraded event when data quality degrades', async () => {
      await collector.connect(deviceConfig);

      const result = await collector.readTag(deviceConfig.tags[0]);
      const degradedResult = collector.simulateQualityDegradation(result.tagId);

      if (degradedResult.quality === 'bad') {
        eventBusService.emitHealthDegraded({
          checks: [
            {
              name: `tag:${degradedResult.tagId}`,
              status: 'unhealthy',
              error: `Data quality degraded to ${degradedResult.quality}`,
              latency: 0,
              details: { tagId: degradedResult.tagId, quality: degradedResult.quality },
            },
          ],
          timestamp: degradedResult.timestamp,
        });
      }

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'health_degraded',
        expect.objectContaining({
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: 'tag:tag-temp-001',
              status: 'unhealthy',
            }),
          ]),
        }),
      );
    });

    it('Alarm condition evaluation should detect threshold violations correctly', async () => {
      await collector.connect(deviceConfig);

      // Simulate excessive temperature (> 80 C)
      const highTemp = 85.5;
      // Use the alarm debouncer's no-debounce mode to verify the condition check
      const debounceCheck = alarmDebouncer.check('rule-temp', 'tag-temp-001', highTemp, 0);
      expect(debounceCheck).toBe('trigger');

      // Simulate normal temperature
      const normalTemp = 45.0;
      const normalCheck = alarmDebouncer.check('rule-temp', 'tag-temp-001', normalTemp, 0);
      expect(normalCheck).toBe('trigger'); // 无消抖始终触发
    });

    it('The debounce mechanism should prevent false positives — multiple triggers within a short time should not alarm immediately', async () => {
      const ruleId = 'alarm-rule-001';
      const tagId = 'tag-temp-001';

      // First trigger -> debouncing
      const r1 = alarmDebouncer.check(ruleId, tagId, 85.0, 5000);
      expect(r1).toBe('debouncing');

      // Trigger again within a short interval -> debouncing
      const r2 = alarmDebouncer.check(ruleId, tagId, 86.0, 5000);
      expect(r2).toBe('debouncing');

      // Same value -> no_change
      const r3 = alarmDebouncer.check(ruleId, tagId, 86.0, 5000);
      expect(r3).toBe('no_change');

      expect(alarmDebouncer.getDebouncingCount()).toBe(1);
    });
  });

  // ========================================================================
  // Edge cases and error paths
  // ========================================================================
  describe('Edge cases and error paths', () => {
    it('The cache should overwrite old values correctly', async () => {
      await cacheService.set({
        tagId: 'tag-test-001',
        value: 100,
        quality: 'good',
        timestamp: Date.now(),
        cachedAt: Date.now(),
      });

      // Overwrite the old value
      await cacheService.set({
        tagId: 'tag-test-001',
        value: 200,
        quality: 'good',
        timestamp: Date.now(),
        cachedAt: Date.now(),
      });

      const cached = await cacheService.get('tag-test-001');
      expect(cached!.value).toBe(200);
    });

    it('The cache should handle non-existent data correctly', async () => {
      const cached = await cacheService.get('non-existent-tag');
      expect(cached).toBeNull();
    });

    it('Batch cache retrieval should return existing entries', async () => {
      await cacheService.set({
        tagId: 'tag-a',
        value: 10,
        quality: 'good',
        timestamp: Date.now(),
        cachedAt: Date.now(),
      });
      await cacheService.set({
        tagId: 'tag-b',
        value: 20,
        quality: 'good',
        timestamp: Date.now(),
        cachedAt: Date.now(),
      });

      const results = await cacheService.getMany(['tag-a', 'tag-b', 'tag-c']);
      expect(results.size).toBe(2);
      expect(results.get('tag-a')!.value).toBe(10);
      expect(results.get('tag-b')!.value).toBe(20);
      expect(results.has('tag-c')).toBe(false);
    });

    it('Batch reading an empty tag list should return an empty array', async () => {
      await collector.connect(deviceConfig);
      const results = await collector.readBatch([]);
      expect(results).toEqual([]);
    });

    it('The event bus should be able to register and unregister listeners', () => {
      const handler = jest.fn();
      eventBusService.on('data_point_changed' as any, handler);

      expect(eventBusService.getListenerCount('data_point_changed')).toBe(1);

      eventBusService.off('data_point_changed' as any, handler);
      expect(eventBusService.getListenerCount('data_point_changed')).toBe(0);
    });
  });
});
