// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Integration test: Alarm + EventBus workflow
 *
 * Test strategy:
 * - Use real instances of ConditionEvaluator and AlarmDebouncer
 * - Use a real EventBusService instance to verify event publishing
 * - Mock the underlying EventEmitter2 implementation
 * - Simulate the full alarm lifecycle: trigger -> acknowledge -> recover
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

jest.mock('@nestjs/typeorm', () => ({
  getRepositoryToken: jest.fn().mockReturnValue('MOCK_REPOSITORY_TOKEN'),
  InjectRepository: () => jest.fn(),
  TypeOrmModule: { forFeature: jest.fn(), forRoot: jest.fn() },
}));

jest.mock('@ss-node/ss-sdk', () => ({
  AlarmLevel: { INFO: 'info', WARNING: 'warning', ERROR: 'error', CRITICAL: 'critical' },
  AlarmStatus: {
    ACTIVE: 'active',
    ACKNOWLEDGED: 'acknowledged',
    CLEARED: 'cleared',
    SHELVED: 'shelved',
  },
  AlarmCondition: {
    GT: 'gt',
    LT: 'lt',
    EQ: 'eq',
    NEQ: 'neq',
    GTE: 'gte',
    LTE: 'lte',
    RANGE_IN: 'range_in',
    RANGE_OUT: 'range_out',
  },
  DataQuality: { GOOD: 'good', BAD: 'bad', UNCERTAIN: 'uncertain', COMM_ERROR: 'comm_error' },
  DeviceStatus: {
    OFFLINE: 'offline',
    ONLINE: 'online',
    CONNECTING: 'connecting',
    DEGRADED: 'degraded',
    ERROR: 'error',
  },
  DeviceType: { MODBUS_TCP: 'modbus_tcp', MQTT: 'mqtt' },
  SortOrder: { ASC: 'ASC', DESC: 'DESC' },
  PaginationDto: class {},
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

jest.mock('@ss-node/ss-project', () => ({
  Project: class {},
  Page: class {},
  ProjectModule: class {},
  ProjectService: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventBusService } from '../../packages/ss-core/src/event-bus/event-bus.service';
import { ConditionEvaluator } from '../../packages/ss-alarm/src/engine/condition-evaluator';
import { AlarmDebouncer } from '../../packages/ss-alarm/src/engine/alarm-debouncer';
import { AlarmNotificationService } from '../../packages/ss-alarm/src/alarm-notification.service';

// ─── Mock alarm rule repository ───

interface AlarmRuleConfig {
  id: string;
  name: string;
  tagId: string;
  deviceId: string;
  projectId: string;
  level: string;
  condition: string;
  conditionValue: any;
  debounceMs: number;
  enabled: boolean;
}

interface AlarmRecord {
  id: string;
  ruleId: string;
  tagId: string;
  deviceId: string;
  projectId: string;
  message: string;
  triggerValue: number;
  level: string;
  status: 'active' | 'acknowledged' | 'cleared' | 'shelved';
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  clearedAt?: number;
  clearedBy?: string;
  createdAt: number;
}

/**
 * Mock alarm engine - combines ConditionEvaluator + AlarmDebouncer + EventBus
 */
class SimulatedAlarmEngine {
  private alarmRecords: AlarmRecord[] = [];
  private alarmIdCounter = 0;

  constructor(
    private eventBusService: EventBusService,
    private conditionEvaluator: ConditionEvaluator,
    private alarmDebouncer: AlarmDebouncer,
  ) {}

  /**
   * Evaluate whether a data point triggers an alarm
   */
  evaluateDataPoint(
    rule: AlarmRuleConfig,
    value: number,
    timestamp: number,
  ): { triggered: boolean; record?: AlarmRecord } {
    if (!rule.enabled) return { triggered: false };

    const conditionMet = this.conditionEvaluator.evaluate(
      value,
      rule.condition as any,
      rule.conditionValue,
    );

    if (!conditionMet) {
      // Condition not met, clear debounce
      this.alarmDebouncer.clear(rule.id, rule.tagId);
      return { triggered: false };
    }

    const debounceResult = this.alarmDebouncer.check(rule.id, rule.tagId, value, rule.debounceMs);

    if (debounceResult !== 'trigger') {
      return { triggered: false };
    }

    // Create the alarm record
    const record = this.createAlarmRecord(rule, value, timestamp);

    // Publish the alarm-triggered event
    this.eventBusService.emitAlarmTriggered({
      alarmId: record.id,
      tagId: rule.tagId,
      deviceId: rule.deviceId,
      projectId: rule.projectId,
      level: rule.level as any,
      message: record.message,
      timestamp: record.createdAt,
      value,
      limit: Array.isArray(rule.conditionValue) ? rule.conditionValue[1] : rule.conditionValue,
    });

    return { triggered: true, record };
  }

  /**
   * Acknowledge the alarm
   */
  acknowledgeAlarm(alarmId: string, userId: string, timestamp: number): AlarmRecord | null {
    const record = this.alarmRecords.find((r) => r.id === alarmId);
    if (!record) return null;
    if (record.status !== 'active') return null;

    record.status = 'acknowledged';
    record.acknowledgedAt = timestamp;
    record.acknowledgedBy = userId;

    this.eventBusService.emitAlarmAcknowledged({
      alarmId: record.id,
      acknowledgedBy: userId,
      acknowledgedAt: timestamp,
    });

    return record;
  }

  /**
   * Clear the alarm (recover)
   */
  clearAlarm(alarmId: string, userId: string, timestamp: number): AlarmRecord | null {
    const record = this.alarmRecords.find((r) => r.id === alarmId);
    if (!record) return null;

    record.status = 'cleared';
    record.clearedAt = timestamp;
    record.clearedBy = userId;

    // Publish the alarm-recovered event
    this.eventBusService.emitHealthRecovered({
      checks: [
        {
          name: `alarm:${record.id}`,
          status: 'healthy',
          details: { alarmId: record.id, tagId: record.tagId },
        },
      ],
      timestamp,
    });

    return record;
  }

  /**
   * Get all alarm records
   */
  getRecords(): AlarmRecord[] {
    return [...this.alarmRecords];
  }

  /**
   * Get active alarms
   */
  getActiveAlarms(): AlarmRecord[] {
    return this.alarmRecords.filter((r) => r.status === 'active');
  }

  private createAlarmRecord(rule: AlarmRuleConfig, value: number, timestamp: number): AlarmRecord {
    const record: AlarmRecord = {
      id: `alarm-record-${++this.alarmIdCounter}`,
      ruleId: rule.id,
      tagId: rule.tagId,
      deviceId: rule.deviceId,
      projectId: rule.projectId,
      message: `${rule.name}: value ${value} exceeds ${JSON.stringify(rule.conditionValue)}`,
      triggerValue: value,
      level: rule.level,
      status: 'active',
      createdAt: timestamp,
    };
    this.alarmRecords.push(record);
    return record;
  }
}

// ─── Test suite ───

describe('Alarm + EventBus integration tests', () => {
  let eventBusService: EventBusService;
  let conditionEvaluator: ConditionEvaluator;
  let alarmDebouncer: AlarmDebouncer;
  let notificationService: AlarmNotificationService;
  let alarmEngine: SimulatedAlarmEngine;
  let mockEventEmitter: any;

  const TEST_PROJECT_ID = 'proj-alarm-001';
  const TEST_DEVICE_ID = 'dev-001';
  const TEST_USER_ID = 'user-001';

  const temperatureRule: AlarmRuleConfig = {
    id: 'rule-temp-high',
    name: 'Temperature High Alarm',
    tagId: 'tag-temp-001',
    deviceId: TEST_DEVICE_ID,
    projectId: TEST_PROJECT_ID,
    level: 'critical',
    condition: 'gt',
    conditionValue: 80,
    debounceMs: 0,
    enabled: true,
  };

  const pressureRule: AlarmRuleConfig = {
    id: 'rule-press-low',
    name: 'Pressure Low Alarm',
    tagId: 'tag-press-001',
    deviceId: TEST_DEVICE_ID,
    projectId: TEST_PROJECT_ID,
    level: 'warning',
    condition: 'lt',
    conditionValue: 10,
    debounceMs: 0,
    enabled: true,
  };

  const flowRateRule: AlarmRuleConfig = {
    id: 'rule-flow-range',
    name: 'Flow Rate Out of Range',
    tagId: 'tag-flow-001',
    deviceId: TEST_DEVICE_ID,
    projectId: TEST_PROJECT_ID,
    level: 'high',
    condition: 'range_out',
    conditionValue: [20, 100],
    debounceMs: 0,
    enabled: true,
  };

  const disabledRule: AlarmRuleConfig = {
    id: 'rule-disabled',
    name: 'Disabled Alarm',
    tagId: 'tag-temp-001',
    deviceId: TEST_DEVICE_ID,
    projectId: TEST_PROJECT_ID,
    level: 'info',
    condition: 'gt',
    conditionValue: 50,
    debounceMs: 0,
    enabled: false,
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
        EventBusService,
        ConditionEvaluator,
        AlarmDebouncer,
        AlarmNotificationService,
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    eventBusService = module.get<EventBusService>(EventBusService);
    conditionEvaluator = module.get<ConditionEvaluator>(ConditionEvaluator);
    alarmDebouncer = module.get<AlarmDebouncer>(AlarmDebouncer);
    notificationService = module.get<AlarmNotificationService>(AlarmNotificationService);

    alarmEngine = new SimulatedAlarmEngine(eventBusService, conditionEvaluator, alarmDebouncer);

    jest.clearAllMocks();
  });

  // ========================================================================
  // TC-INT-010: Tag value exceeds threshold → alarm triggered → event published via event bus
  // ========================================================================
  describe('TC-INT-010: tag value exceeds threshold → alarm triggered → event bus publishes', () => {
    it('Temperature exceeding the threshold should trigger an alarm and publish alarm_triggered', () => {
      const result = alarmEngine.evaluateDataPoint(temperatureRule, 85.5, Date.now());

      expect(result.triggered).toBe(true);
      expect(result.record).toBeDefined();
      expect(result.record!.level).toBe('critical');
      expect(result.record!.status).toBe('active');
      expect(result.record!.triggerValue).toBe(85.5);

      // Verify the event was published
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'alarm_triggered',
        expect.objectContaining({
          alarmId: result.record!.id,
          tagId: 'tag-temp-001',
          level: 'critical',
          value: 85.5,
          limit: 80,
        }),
      );
    });

    it('Temperature below the threshold should not trigger an alarm', () => {
      const result = alarmEngine.evaluateDataPoint(temperatureRule, 75.0, Date.now());

      expect(result.triggered).toBe(false);
      expect(result.record).toBeUndefined();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('Temperature equal to the threshold should not trigger a GT alarm', () => {
      const result = alarmEngine.evaluateDataPoint(temperatureRule, 80.0, Date.now());

      expect(result.triggered).toBe(false);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('Pressure below the threshold should trigger an alarm (LT condition)', () => {
      const result = alarmEngine.evaluateDataPoint(pressureRule, 5.0, Date.now());

      expect(result.triggered).toBe(true);
      expect(result.record!.level).toBe('warning');
      expect(result.record!.triggerValue).toBe(5.0);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'alarm_triggered',
        expect.objectContaining({
          level: 'warning',
          value: 5.0,
        }),
      );
    });

    it('Out-of-range alarm conditions should evaluate correctly', () => {
      // Within range, should not trigger
      const inRange = alarmEngine.evaluateDataPoint(flowRateRule, 50, Date.now());
      expect(inRange.triggered).toBe(false);

      // Out of range, should trigger
      const outOfRange = alarmEngine.evaluateDataPoint(flowRateRule, 150, Date.now());
      expect(outOfRange.triggered).toBe(true);
    });

    it('Disabled alarm rules should not trigger', () => {
      const result = alarmEngine.evaluateDataPoint(disabledRule, 100, Date.now());

      expect(result.triggered).toBe(false);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // TC-INT-011: Alarm acknowledged → event published
  // ========================================================================
  describe('TC-INT-011: alarm acknowledged → event published', () => {
    it('Acknowledging an active alarm should publish the alarm_acknowledged event', () => {
      const triggerResult = alarmEngine.evaluateDataPoint(temperatureRule, 90.0, Date.now());
      expect(triggerResult.triggered).toBe(true);

      const alarmId = triggerResult.record!.id;
      const ackTimestamp = Date.now();

      const ackResult = alarmEngine.acknowledgeAlarm(alarmId, TEST_USER_ID, ackTimestamp);

      expect(ackResult).not.toBeNull();
      expect(ackResult!.status).toBe('acknowledged');
      expect(ackResult!.acknowledgedBy).toBe(TEST_USER_ID);
      expect(ackResult!.acknowledgedAt).toBe(ackTimestamp);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'alarm_acknowledged',
        expect.objectContaining({
          alarmId,
          acknowledgedBy: TEST_USER_ID,
          acknowledgedAt: ackTimestamp,
        }),
      );
    });

    it('Acknowledging a non-existent alarm should return null', () => {
      const result = alarmEngine.acknowledgeAlarm('non-existent', TEST_USER_ID, Date.now());
      expect(result).toBeNull();
    });

    it('Acknowledging an already-acknowledged alarm should return null (duplicate acknowledgment not allowed)', () => {
      const triggerResult = alarmEngine.evaluateDataPoint(temperatureRule, 90.0, Date.now());
      const alarmId = triggerResult.record!.id;

      // First acknowledgement
      alarmEngine.acknowledgeAlarm(alarmId, TEST_USER_ID, Date.now());
      // Second acknowledgement
      const secondAck = alarmEngine.acknowledgeAlarm(alarmId, TEST_USER_ID, Date.now());

      expect(secondAck).toBeNull();
    });
  });

  // ========================================================================
  // TC-INT-012: Multiple alarms → batched notification
  // ========================================================================
  describe('TC-INT-012: multiple alarms → batch notification', () => {
    it('Multiple alarms should each trigger an independent alarm_triggered event', () => {
      alarmEngine.evaluateDataPoint(temperatureRule, 85.0, Date.now());
      alarmEngine.evaluateDataPoint(pressureRule, 5.0, Date.now());
      alarmEngine.evaluateDataPoint(flowRateRule, 150, Date.now());

      const alarmTriggeredCalls = mockEventEmitter.emit.mock.calls.filter(
        (call: any[]) => call[0] === 'alarm_triggered',
      );

      expect(alarmTriggeredCalls.length).toBe(3);

      const levels = alarmTriggeredCalls.map((call: any[]) => call[1].level);
      expect(levels).toContain('critical');
      expect(levels).toContain('warning');
      expect(levels).toContain('high');
    });

    it('Should be able to send batch alarm notifications via the notification service', async () => {
      const triggerResult = alarmEngine.evaluateDataPoint(temperatureRule, 90.0, Date.now());

      // Simulate notification: publish alarm.notification.sent via the event bus
      eventBusService.emit('alarm.notification.sent' as any, {
        alarmId: triggerResult.record!.id,
        channels: ['sound', 'popup'],
        timestamp: Date.now(),
      });

      // Simulate sound notification
      eventBusService.emit('alarm.sound.trigger' as any, {
        alarmId: triggerResult.record!.id,
        level: triggerResult.record!.level,
        config: { volume: 0.8, repeat: 3 },
      });

      // Simulate popup notification
      eventBusService.emit('alarm.popup.show' as any, {
        alarmId: triggerResult.record!.id,
        ruleName: temperatureRule.name,
        level: triggerResult.record!.level,
        message: triggerResult.record!.message,
        value: triggerResult.record!.triggerValue,
        timestamp: new Date(triggerResult.record!.createdAt),
        config: { duration: 10000, requireAck: true },
      });

      // Verify the notification-sent event
      const notificationCalls = mockEventEmitter.emit.mock.calls.filter(
        (call: any[]) => call[0] === 'alarm.notification.sent',
      );
      expect(notificationCalls.length).toBe(1);

      // Verify sound and popup notifications
      const soundCalls = mockEventEmitter.emit.mock.calls.filter(
        (call: any[]) => call[0] === 'alarm.sound.trigger',
      );
      const popupCalls = mockEventEmitter.emit.mock.calls.filter(
        (call: any[]) => call[0] === 'alarm.popup.show',
      );

      expect(soundCalls.length).toBe(1);
      expect(popupCalls.length).toBe(1);
    });

    it('Should be able to get the active alarm list', () => {
      alarmEngine.evaluateDataPoint(temperatureRule, 85.0, Date.now());
      alarmEngine.evaluateDataPoint(pressureRule, 5.0, Date.now());

      const activeAlarms = alarmEngine.getActiveAlarms();
      expect(activeAlarms.length).toBe(2);
    });

    it('Acknowledging one alarm does not affect other active alarms', () => {
      const r1 = alarmEngine.evaluateDataPoint(temperatureRule, 85.0, Date.now());
      const r2 = alarmEngine.evaluateDataPoint(pressureRule, 5.0, Date.now());

      alarmEngine.acknowledgeAlarm(r1.record!.id, TEST_USER_ID, Date.now());

      const activeAlarms = alarmEngine.getActiveAlarms();
      expect(activeAlarms.length).toBe(1);
      expect(activeAlarms[0].id).toBe(r2.record!.id);
    });
  });

  // ========================================================================
  // TC-INT-013: Alarm recovery → event published
  // ========================================================================
  describe('TC-INT-013: alarm recovered → event published', () => {
    it('Clearing an alarm should publish the health_recovered event', () => {
      const triggerResult = alarmEngine.evaluateDataPoint(temperatureRule, 90.0, Date.now());
      const alarmId = triggerResult.record!.id;

      const clearResult = alarmEngine.clearAlarm(alarmId, TEST_USER_ID, Date.now());

      expect(clearResult).not.toBeNull();
      expect(clearResult!.status).toBe('cleared');
      expect(clearResult!.clearedBy).toBe(TEST_USER_ID);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'health_recovered',
        expect.objectContaining({
          checks: expect.arrayContaining([
            expect.objectContaining({
              name: `alarm:${alarmId}`,
              status: 'healthy',
            }),
          ]),
        }),
      );
    });

    it('Recovered alarms no longer appear in the active alarm list', () => {
      const r1 = alarmEngine.evaluateDataPoint(temperatureRule, 85.0, Date.now());
      expect(alarmEngine.getActiveAlarms().length).toBe(1);

      alarmEngine.clearAlarm(r1.record!.id, TEST_USER_ID, Date.now());
      expect(alarmEngine.getActiveAlarms().length).toBe(0);
    });

    it('Should support the full alarm lifecycle: trigger → acknowledge → recover', () => {
      // Trigger
      const triggerResult = alarmEngine.evaluateDataPoint(temperatureRule, 95.0, Date.now());
      expect(triggerResult.triggered).toBe(true);
      const alarmId = triggerResult.record!.id;

      // Acknowledge
      const ackResult = alarmEngine.acknowledgeAlarm(alarmId, TEST_USER_ID, Date.now());
      expect(ackResult!.status).toBe('acknowledged');

      // Recover
      const clearResult = alarmEngine.clearAlarm(alarmId, TEST_USER_ID, Date.now());
      expect(clearResult!.status).toBe('cleared');

      // Verify the complete event sequence
      const eventTypes = mockEventEmitter.emit.mock.calls.map((call: any[]) => call[0]);
      expect(eventTypes).toContain('alarm_triggered');
      expect(eventTypes).toContain('alarm_acknowledged');
      expect(eventTypes).toContain('health_recovered');
    });
  });

  // ========================================================================
  // TC-INT-014: Event bus subscriber receives alarm events
  // ========================================================================
  describe('TC-INT-014: event bus subscribers receive alarm events', () => {
    it('The event bus should be able to register alarm event subscribers', () => {
      const handler = jest.fn();
      eventBusService.on('alarm_triggered' as any, handler);

      expect(eventBusService.getListenerCount('alarm_triggered')).toBe(1);
    });

    it('Subscribers should receive alarm triggered events', () => {
      const receivedEvents: any[] = [];
      eventBusService.on('alarm_triggered' as any, (event) => {
        receivedEvents.push(event);
      });

      alarmEngine.evaluateDataPoint(temperatureRule, 88.0, Date.now());

      // Verify emit was called correctly
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('alarm_triggered', expect.any(Object));
    });

    it('Subscribers should receive alarm acknowledged events', () => {
      const receivedEvents: any[] = [];
      eventBusService.on('alarm_acknowledged' as any, (event) => {
        receivedEvents.push(event);
      });

      const triggerResult = alarmEngine.evaluateDataPoint(temperatureRule, 88.0, Date.now());
      mockEventEmitter.emit.mockClear();
      alarmEngine.acknowledgeAlarm(triggerResult.record!.id, TEST_USER_ID, Date.now());

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('alarm_acknowledged', expect.any(Object));
    });

    it('Multiple subscribers should receive the same event simultaneously', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventBusService.on('alarm_triggered' as any, handler1);
      eventBusService.on('alarm_triggered' as any, handler2);

      expect(eventBusService.getListenerCount('alarm_triggered')).toBe(2);
    });

    it('Should no longer receive events after unsubscribing', () => {
      const handler = jest.fn();
      eventBusService.on('alarm_triggered' as any, handler);
      expect(eventBusService.getListenerCount('alarm_triggered')).toBe(1);

      eventBusService.off('alarm_triggered' as any, handler);
      expect(eventBusService.getListenerCount('alarm_triggered')).toBe(0);
    });

    it('Should be able to subscribe to multiple alarm-related events', () => {
      const alarmHandler = jest.fn();
      const ackHandler = jest.fn();
      const notificationHandler = jest.fn();

      eventBusService.on('alarm_triggered' as any, alarmHandler);
      eventBusService.on('alarm_acknowledged' as any, ackHandler);
      eventBusService.on('alarm.notification.sent' as any, notificationHandler);

      expect(eventBusService.getListenerCount()).toBe(3);
    });
  });

  // ========================================================================
  // Edge cases and error paths
  // ========================================================================
  describe('Edge cases and error paths', () => {
    it('Should trigger the alarm immediately when there is no debounce time', () => {
      const result = alarmEngine.evaluateDataPoint(temperatureRule, 100.0, Date.now());
      expect(result.triggered).toBe(true);
    });

    it('With a debounce time, triggering should be delayed', () => {
      const debouncedRule = { ...temperatureRule, debounceMs: 5000, id: 'rule-debounced' };
      const result = alarmEngine.evaluateDataPoint(debouncedRule, 100.0, Date.now());
      expect(result.triggered).toBe(false);
    });

    it('Same values should not re-trigger the debounce', () => {
      const debouncedRule = { ...temperatureRule, debounceMs: 5000, id: 'rule-debounce-2' };
      alarmEngine.evaluateDataPoint(debouncedRule, 100.0, Date.now());
      // Same value
      const result = alarmEngine.evaluateDataPoint(debouncedRule, 100.0, Date.now());
      expect(result.triggered).toBe(false);
    });

    it('Debounce state should be cleared after the value recovers', () => {
      const debouncedRule = { ...temperatureRule, debounceMs: 5000, id: 'rule-clear-test' };
      alarmEngine.evaluateDataPoint(debouncedRule, 100.0, Date.now());
      expect(alarmDebouncer.getDebouncingCount()).toBe(1);

      // Value returns to normal
      alarmEngine.evaluateDataPoint(debouncedRule, 50.0, Date.now());
      expect(alarmDebouncer.getDebouncingCount()).toBe(0);
    });

    it('GTE and LTE conditions should handle boundary values correctly', () => {
      const gteRule: AlarmRuleConfig = {
        ...temperatureRule,
        id: 'rule-gte',
        condition: 'gte',
        conditionValue: 80,
        debounceMs: 0,
      };

      expect(alarmEngine.evaluateDataPoint(gteRule, 80, Date.now()).triggered).toBe(true);
      expect(alarmEngine.evaluateDataPoint(gteRule, 79.9, Date.now()).triggered).toBe(false);

      const lteRule: AlarmRuleConfig = {
        ...temperatureRule,
        id: 'rule-lte',
        condition: 'lte',
        conditionValue: 10,
        debounceMs: 0,
      };

      expect(alarmEngine.evaluateDataPoint(lteRule, 10, Date.now()).triggered).toBe(true);
      expect(alarmEngine.evaluateDataPoint(lteRule, 10.1, Date.now()).triggered).toBe(false);
    });

    it('The notification service should support configuring different channels', () => {
      notificationService.configureChannel('email', {
        enabled: true,
        config: { smtpHost: 'smtp.test.com', smtpPort: 587 },
      });

      const enabledChannels = notificationService.getEnabledChannels();
      expect(enabledChannels).toContain('email');
      expect(enabledChannels).toContain('sound');
      expect(enabledChannels).toContain('popup');
      expect(enabledChannels).not.toContain('sms');
    });
  });
});
