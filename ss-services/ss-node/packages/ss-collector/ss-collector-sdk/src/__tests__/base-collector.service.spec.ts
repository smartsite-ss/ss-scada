// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger } from '@nestjs/common';
import { BaseCollectorService } from '../base-collector.service';
import { ITagContext } from '../types';

// ============================================================
// Concrete subclass for testing - exposes abstract methods as jest.fn for assertions
// ============================================================

class TestCollector extends BaseCollectorService {
  // Implement the abstract method (using jest.fn for assertions)
  connect = jest.fn();
  doReadTag = jest.fn();
  doWriteTag = jest.fn();
  doDisconnect = jest.fn();

  // Expose protected methods for test invocation
  trackClient(deviceId: string, client: any): void {
    super.trackClient(deviceId, client);
  }
  getConnectionStatus(deviceId: string): boolean {
    return super.getConnectionStatus(deviceId);
  }
  markDisconnected(deviceId: string): void {
    super.markDisconnected(deviceId);
  }
  getClientEntries(): ReadonlyMap<string, { client: any; connectedAt: Date }> {
    return super.getClientEntries();
  }
  startAutoReconnect(deviceId: string, reconnectFn: () => Promise<any>, interval?: number): void {
    super.startAutoReconnect(deviceId, reconnectFn, interval);
  }
  stopAutoReconnect(deviceId: string): void {
    super.stopAutoReconnect(deviceId);
  }
}

function makeTag(overrides: Partial<ITagContext> = {}): ITagContext {
  return {
    id: 'tag-001',
    name: '温度',
    address: '40001',
    dataType: 'float',
    ...overrides,
  };
}

describe('BaseCollectorService', () => {
  let service: TestCollector;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    service = new TestCollector();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // -------------------------------------------------------------
  // validateChannelConfig (default implementation)
  // -------------------------------------------------------------
  describe('validateChannelConfig', () => {
    it('By default should return valid=true with an empty error list', async () => {
      const result = await service.validateChannelConfig({ host: '1.2.3.4' });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('Should return valid=true for any configuration (default empty implementation)', async () => {
      const result = await service.validateChannelConfig({
        any: { nested: 'value' },
      });
      expect(result.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // readTag (with retry)
  // -------------------------------------------------------------
  describe('readTag', () => {
    it('First-time success should return the result directly without retrying', async () => {
      const client = { id: 'c1' };
      const tag = makeTag();
      const expected = { tagId: 'tag-001', value: 42, timestamp: new Date() };
      service.doReadTag.mockResolvedValueOnce(expected);

      const result = await service.readTag(client, tag);

      expect(result).toEqual(expected);
      expect(service.doReadTag).toHaveBeenCalledTimes(1);
    });

    it('On failure, retries 3 times with the default maxRetries=3', async () => {
      jest.useRealTimers();
      const client = { id: 'c1' };
      const tag = makeTag(); // maxRetries not set, defaults to 3
      service.doReadTag.mockImplementation(() => Promise.reject(new Error('read fail')));

      await expect(service.readTag(client, tag)).rejects.toThrow('read fail');
      expect(service.doReadTag).toHaveBeenCalledTimes(3);
    }, 15000);

    it('Mid-way success should stop retrying and return the result', async () => {
      const client = { id: 'c1' };
      const tag = makeTag({ maxRetries: 3 });
      const expected = { tagId: 'tag-001', value: 99, timestamp: new Date() };
      service.doReadTag
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce(expected);

      jest.useFakeTimers();
      const promise = service.readTag(client, tag);
      promise.catch(() => {}); // attach handler immediately to avoid unhandledRejection
      await jest.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result).toEqual(expected);
      expect(service.doReadTag).toHaveBeenCalledTimes(3);
    });

    it('Should use tag.maxRetries to override the default', async () => {
      const client = { id: 'c1' };
      const tag = makeTag({ maxRetries: 1 });
      service.doReadTag.mockImplementation(() => Promise.reject(new Error('fail')));

      await expect(service.readTag(client, tag)).rejects.toThrow('fail');
      expect(service.doReadTag).toHaveBeenCalledTimes(1);
    });

    it('The thrown error should be the last error', async () => {
      jest.useRealTimers();
      const client = { id: 'c1' };
      const tag = makeTag({ maxRetries: 2 });
      service.doReadTag
        .mockImplementationOnce(() => Promise.reject(new Error('first')))
        .mockImplementationOnce(() => Promise.reject(new Error('second')));

      await expect(service.readTag(client, tag)).rejects.toThrow('second');
      expect(service.doReadTag).toHaveBeenCalledTimes(2);
    }, 15000);
  });

  // -------------------------------------------------------------
  // writeTag (with retry)
  // -------------------------------------------------------------
  describe('writeTag', () => {
    it('First-time success should return directly without retrying', async () => {
      const client = { id: 'c1' };
      const tag = makeTag();
      service.doWriteTag.mockResolvedValue(undefined);

      await service.writeTag(client, tag, 100);

      expect(service.doWriteTag).toHaveBeenCalledTimes(1);
      expect(service.doWriteTag).toHaveBeenCalledWith(client, tag, 100);
    });

    it('On failure, retries 2 times with the default maxRetries=2', async () => {
      jest.useRealTimers();
      const client = { id: 'c1' };
      const tag = makeTag(); // default 2 times
      service.doWriteTag.mockImplementation(() => Promise.reject(new Error('write fail')));

      await expect(service.writeTag(client, tag, 100)).rejects.toThrow('write fail');
      expect(service.doWriteTag).toHaveBeenCalledTimes(2);
    }, 15000);

    it('Should use tag.maxRetries to override the default', async () => {
      jest.useRealTimers();
      const client = { id: 'c1' };
      const tag = makeTag({ maxRetries: 4 });
      service.doWriteTag.mockImplementation(() => Promise.reject(new Error('fail')));

      await expect(service.writeTag(client, tag, 1)).rejects.toThrow('fail');
      expect(service.doWriteTag).toHaveBeenCalledTimes(4);
    }, 15000);

    it('Mid-way success should stop retrying', async () => {
      const client = { id: 'c1' };
      const tag = makeTag({ maxRetries: 3 });
      service.doWriteTag.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined);

      jest.useFakeTimers();
      const promise = service.writeTag(client, tag, 1);
      promise.catch(() => {}); // attach handler immediately to avoid unhandledRejection
      await jest.advanceTimersByTimeAsync(5000);
      await promise;

      expect(service.doWriteTag).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------
  describe('disconnect', () => {
    it('Should call doDisconnect and clean up connection state', async () => {
      const client = { id: 'c1' };
      service.trackClient('dev-001', client);
      expect(service.getConnectionStatus('dev-001')).toBe(true);

      service.doDisconnect.mockResolvedValue(undefined);
      await service.disconnect(client);

      expect(service.doDisconnect).toHaveBeenCalledWith(client);
      expect(service.getConnectionStatus('dev-001')).toBe(false);
      expect(service.getClientEntries().has('dev-001')).toBe(false);
    });

    it('Errors thrown by doDisconnect should be swallowed while state is still cleaned up', async () => {
      const client = { id: 'c1' };
      service.trackClient('dev-001', client);
      service.doDisconnect.mockImplementation(() => Promise.reject(new Error('disconnect fail')));

      await expect(service.disconnect(client)).resolves.toBeUndefined();
      expect(service.getConnectionStatus('dev-001')).toBe(false);
    });

    it('An untracked client calling disconnect should still call doDisconnect', async () => {
      const client = { id: 'unknown' };
      service.doDisconnect.mockResolvedValue(undefined);
      await service.disconnect(client);
      expect(service.doDisconnect).toHaveBeenCalledWith(client);
    });
  });

  // -------------------------------------------------------------
  // onModuleDestroy
  // -------------------------------------------------------------
  describe('onModuleDestroy', () => {
    it('Should disconnect all tracked client connections', async () => {
      const c1 = { id: 'c1' };
      const c2 = { id: 'c2' };
      service.trackClient('dev-1', c1);
      service.trackClient('dev-2', c2);
      service.doDisconnect.mockResolvedValue(undefined);

      await service.onModuleDestroy();

      expect(service.doDisconnect).toHaveBeenCalledWith(c1);
      expect(service.doDisconnect).toHaveBeenCalledWith(c2);
      expect(service.getClientEntries().size).toBe(0);
    });

    it('Errors thrown by doDisconnect should be silently ignored without affecting other connections', async () => {
      const c1 = { id: 'c1' };
      const c2 = { id: 'c2' };
      service.trackClient('dev-1', c1);
      service.trackClient('dev-2', c2);
      service.doDisconnect
        .mockImplementationOnce(() => Promise.reject(new Error('fail')))
        .mockResolvedValueOnce(undefined);

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(service.getClientEntries().size).toBe(0);
    });

    it('Should clean up all reconnect timers', async () => {
      const reconnectFn = jest.fn().mockResolvedValue(undefined);
      jest.useFakeTimers();
      service.startAutoReconnect('dev-1', reconnectFn, 1000);

      await service.onModuleDestroy();

      // Advance time to verify reconnection is no longer triggered
      jest.advanceTimersByTime(5000);
      expect(reconnectFn).not.toHaveBeenCalled();
    });

    it('Should execute safely without a connection', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------
  // trackClient / getConnectionStatus / markDisconnected
  // -------------------------------------------------------------
  describe('trackClient & getConnectionStatus', () => {
    it('trackClient should record the connection status as true', () => {
      const client = { id: 'c1' };
      service.trackClient('dev-1', client);

      expect(service.getConnectionStatus('dev-1')).toBe(true);
      expect(service.getClientEntries().has('dev-1')).toBe(true);
      const entry = service.getClientEntries().get('dev-1')!;
      expect(entry.client).toBe(client);
      expect(entry.connectedAt).toBeInstanceOf(Date);
    });

    it('getConnectionStatus should return false for untracked devices', () => {
      expect(service.getConnectionStatus('unknown')).toBe(false);
    });

    it('markDisconnected should set the device status to false and remove it from clients', () => {
      const client = { id: 'c1' };
      service.trackClient('dev-1', client);
      expect(service.getConnectionStatus('dev-1')).toBe(true);

      service.markDisconnected('dev-1');

      expect(service.getConnectionStatus('dev-1')).toBe(false);
      expect(service.getClientEntries().has('dev-1')).toBe(false);
    });

    it('getClientEntries should return a read-only Map', () => {
      const entries = service.getClientEntries();
      expect(entries).toBeInstanceOf(Map);
      // Map methods are still callable, but semantically read-only
      expect(entries.size).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // startAutoReconnect / stopAutoReconnect
  // -------------------------------------------------------------
  describe('startAutoReconnect & stopAutoReconnect', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('Should call reconnectFn when the interval is reached, and stop after success', async () => {
      const reconnectFn = jest.fn().mockResolvedValue(undefined);
      service.startAutoReconnect('dev-1', reconnectFn, 1000);

      // 500ms: should not be called
      jest.advanceTimersByTime(500);
      expect(reconnectFn).not.toHaveBeenCalled();

      // 1000ms: should be called once
      jest.advanceTimersByTime(500);
      await Promise.resolve(); // let the await inside the setInterval callback resolve
      expect(reconnectFn).toHaveBeenCalledTimes(1);

      // After success, the timer should stop; advancing time again should not call it
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      expect(reconnectFn).toHaveBeenCalledTimes(1);
    });

    it('Should stop reconnecting after reconnectFn succeeds', async () => {
      const reconnectFn = jest.fn().mockResolvedValue(undefined);
      service.startAutoReconnect('dev-1', reconnectFn, 1000);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(reconnectFn).toHaveBeenCalledTimes(1);

      // Advancing time again should not call it
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      expect(reconnectFn).toHaveBeenCalledTimes(1);
    });

    it('Should keep retrying without throwing when reconnectFn fails', async () => {
      const reconnectFn = jest
        .fn()
        .mockImplementation(() => Promise.reject(new Error('connect fail')));
      service.startAutoReconnect('dev-1', reconnectFn, 1000);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(reconnectFn).toHaveBeenCalledTimes(1);

      // Advance time; it should be called again
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(reconnectFn).toHaveBeenCalledTimes(2);
    });

    it('stopAutoReconnect should stop the timer', () => {
      const reconnectFn = jest.fn().mockResolvedValue(undefined);
      service.startAutoReconnect('dev-1', reconnectFn, 1000);

      service.stopAutoReconnect('dev-1');

      jest.advanceTimersByTime(5000);
      expect(reconnectFn).not.toHaveBeenCalled();
    });

    it('stopAutoReconnect should be a safe no-op for devices not auto-reconnecting', () => {
      expect(() => service.stopAutoReconnect('unknown')).not.toThrow();
    });

    it('Repeated startAutoReconnect should stop the old timer before starting the new one', () => {
      const fn1 = jest.fn().mockResolvedValue(undefined);
      const fn2 = jest.fn().mockResolvedValue(undefined);

      service.startAutoReconnect('dev-1', fn1, 1000);
      service.startAutoReconnect('dev-1', fn2, 1000);

      jest.advanceTimersByTime(1000);
      // Only fn2 should be called
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledTimes(1);
    });

    it('Default interval should be 30000ms', () => {
      const reconnectFn = jest.fn().mockResolvedValue(undefined);
      service.startAutoReconnect('dev-1', reconnectFn);

      // 29s should not trigger
      jest.advanceTimersByTime(29000);
      expect(reconnectFn).not.toHaveBeenCalled();

      // 30s should trigger
      jest.advanceTimersByTime(1000);
      expect(reconnectFn).toHaveBeenCalledTimes(1);
    });
  });
});
