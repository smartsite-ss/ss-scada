// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Logger, OnModuleDestroy } from '@nestjs/common';
import { IProtocolAdapter, IDeviceContext, ITagContext, ChannelValidationResult } from './types';

/**
 * Base class for collector plugins
 *
 * Provides common capabilities such as connection-pool management, retry, timeout, and resource release.
 * Plugin developers only need to implement four abstract methods: doConnect/doReadTag/doWriteTag/doDisconnect.
 * validateChannelConfig() provides a default empty implementation that subclasses can override as needed.
 */
export abstract class BaseCollectorService implements IProtocolAdapter, OnModuleDestroy {
  protected readonly logger = new Logger(this.constructor.name);
  private clients = new Map<string, ClientEntry>();
  private connectionStatus = new Map<string, boolean>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();

  // ---- Abstract methods (must be implemented by subclasses) ----

  /** Establish the protocol connection and return the protocol client object */
  abstract connect(device: IDeviceContext): Promise<any>;

  /** Perform a single tag read */
  protected abstract doReadTag(
    client: any,
    tag: ITagContext,
  ): Promise<{ tagId: string; value: any; timestamp: Date }>;

  /** Perform a single tag write */
  protected abstract doWriteTag(client: any, tag: ITagContext, value: any): Promise<void>;

  /** Disconnect the protocol connection */
  protected abstract doDisconnect(client: any): Promise<void>;

  // ═══ Validation interface (override as needed by subclasses) ═══

  /** Validate channel config - default empty implementation; subclasses override as needed to add protocol-specific semantic validation */
  async validateChannelConfig(_config: Record<string, any>): Promise<ChannelValidationResult> {
    return { valid: true, errors: [] };
  }

  // ---- Public methods (with retry/timeout) ----

  /** Tag read with retry */
  async readTag(
    client: any,
    tag: ITagContext,
  ): Promise<{ tagId: string; value: any; timestamp: Date }> {
    const maxRetries = tag.maxRetries ?? 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.doReadTag(client, tag);
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delay = Math.min(100 * Math.pow(2, attempt), 2000);
          await this.sleep(delay);
        }
      }
    }
    throw lastError;
  }

  /** Tag write with retry */
  async writeTag(client: any, tag: ITagContext, value: any): Promise<void> {
    const maxRetries = tag.maxRetries ?? 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.doWriteTag(client, tag, value);
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          await this.sleep(200);
        }
      }
    }
    throw lastError;
  }

  /** Disconnect and clean up internal state */
  async disconnect(client: any): Promise<void> {
    const deviceId = this.findDeviceIdByClient(client);
    try {
      await this.doDisconnect(client);
    } catch (error) {
      this.logger.warn(`Error during disconnect: ${(error as Error).message}`);
    }
    if (deviceId) {
      this.connectionStatus.set(deviceId, false);
      this.clients.delete(deviceId);
    }
  }

  /** Close all connections when the module is destroyed */
  async onModuleDestroy(): Promise<void> {
    this.logger.log(`Closing all ${this.constructor.name} connections...`);
    // Stop all reconnection timers
    for (const timer of this.reconnectTimers.values()) {
      clearInterval(timer);
    }
    this.reconnectTimers.clear();

    for (const [_deviceId, entry] of this.clients) {
      try {
        await this.doDisconnect(entry.client);
      } catch {
        // Silent
      }
    }
    this.clients.clear();
    this.connectionStatus.clear();
  }

  /**
   * Common pre-connection check: generate the device ID and check whether it is already connected
   *
   * Subclasses call this in connect() to avoid duplicating device-ID generation and connection-state check logic.
   *
   * @param device device context
   * @param protocolPrefix protocol prefix (e.g. 'modbus', 'mqtt', 'opcua', 's7'), used to generate the default device ID
   * @returns { deviceId, existingResult } - if already connected, existingResult is non-null and the caller should return directly
   */
  protected preConnect(
    device: IDeviceContext,
    protocolPrefix: string,
  ): { deviceId: string; alreadyConnected: boolean } {
    const deviceId = device.id || `${protocolPrefix}-${Date.now()}`;
    if (this.getConnectionStatus(deviceId)) {
      this.logger.log(`Device ${deviceId} already connected`);
      return { deviceId, alreadyConnected: true };
    }
    return { deviceId, alreadyConnected: false };
  }

  /**
   * Common post-connection wrap-up: track the client and mark as connected
   *
   * Subclasses call this after connect() successfully establishes the connection.
   *
   * @param deviceId device ID
   * @param client protocol client object
   */
  protected postConnect(deviceId: string, client: any): void {
    this.trackClient(deviceId, client);
    this.logger.log(`Device ${deviceId} connected successfully`);
  }

  // ---- Helper methods ----

  /** Track the client connection */
  protected trackClient(deviceId: string, client: any): void {
    this.clients.set(deviceId, { client, connectedAt: new Date() });
    this.connectionStatus.set(deviceId, true);
  }

  /** Get the connection status */
  protected getConnectionStatus(deviceId: string): boolean {
    return this.connectionStatus.get(deviceId) ?? false;
  }

  /** Mark the device as disconnected */
  protected markDisconnected(deviceId: string): void {
    this.connectionStatus.set(deviceId, false);
    this.clients.delete(deviceId);
  }

  /** Get the device-ID -> client map (read-only) */
  protected getClientEntries(): ReadonlyMap<string, ClientEntry> {
    return this.clients;
  }

  private findDeviceIdByClient(client: any): string | undefined {
    for (const [id, entry] of this.clients) {
      if (entry.client === client) return id;
    }
    return undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- Reconnection support ----

  /**
   * Start automatic reconnection
   *
   * Subclasses call this when connect fails or the connection drops, retrying at a fixed interval.
   *
   * @param deviceId device ID
   * @param reconnectFn reconnection function (typically () => this.connect(device))
   * @param interval reconnection interval (ms), default 30000
   */
  protected startAutoReconnect(
    deviceId: string,
    reconnectFn: () => Promise<any>,
    interval: number = parseInt(process.env['DEVICE_AUTO_RECONNECT_INTERVAL_MS'] || '30000', 10),
  ): void {
    this.stopAutoReconnect(deviceId);

    const timer = setInterval(async () => {
      this.logger.log(`Attempting to reconnect device ${deviceId}...`);
      try {
        await reconnectFn();
        this.stopAutoReconnect(deviceId);
        this.logger.log(`Device ${deviceId} reconnected successfully`);
      } catch (error) {
        this.logger.warn(`Reconnect failed for device ${deviceId}: ${(error as Error).message}`);
      }
    }, interval);

    this.reconnectTimers.set(deviceId, timer);
    this.logger.log(`Auto-reconnect started for device ${deviceId} (interval: ${interval}ms)`);
  }

  /** Stop automatic reconnection */
  protected stopAutoReconnect(deviceId: string): void {
    const timer = this.reconnectTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.reconnectTimers.delete(deviceId);
    }
  }
}

interface ClientEntry {
  client: any;
  connectedAt: Date;
}
