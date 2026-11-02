// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable } from '@nestjs/common';
import * as mqtt from 'mqtt';
import {
  BaseCollectorService,
  CollectorPlugin,
  ConfigValidator,
  JsonPathUtil,
  PluginCategory,
  type CollectorReadResult,
  type ITagContext,
} from '@ss-node/ss-collector-sdk';

export interface MqttConfig {
  host: string;
  port?: number;
  protocol?: 'mqtt' | 'mqtts' | 'ws' | 'wss';
  clientId?: string;
  username?: string;
  password?: string;
  clean?: boolean;
  keepalive?: number;
  reconnectPeriod?: number;
  qos?: 0 | 1 | 2;
  will?: {
    topic: string;
    payload: string;
    qos?: 0 | 1 | 2;
    retain?: boolean;
  };
}

export interface MqttReadResult extends CollectorReadResult {
  value: any;
}

/**
 * MQTT Protocol Adapter
 *
 * Supports topic subscription and publishing; suitable for IoT scenarios
 */
@Injectable()
@CollectorPlugin({
  protocol: 'mqtt',
  displayName: 'MQTT',
  version: '0.1.0',
  description: 'MQTT 物联网协议采集插件，支持主题订阅与发布',
  category: PluginCategory.IOT,
  transport: 'tcp',
  connectionSchema: {
    type: 'object',
    required: ['host'],
    properties: {
      host: { type: 'string', title: 'Broker 地址', default: 'mqtt://localhost' },
      port: { type: 'number', title: '端口号', default: 1883 },
      clientId: { type: 'string', title: '客户端ID' },
      username: { type: 'string', title: '用户名' },
      password: { type: 'string', title: '密码' },
      qos: { type: 'number', title: 'QoS', default: 0, enum: [0, 1, 2] },
    },
  },
  defaultConnection: { host: 'mqtt://localhost', port: 1883, qos: 0 },
  supportedDataTypes: ['string', 'number', 'json'],
  enabledByDefault: false,
  tags: ['mqtt', 'iot', 'subscribe', 'publish'],
})
export class MqttService extends BaseCollectorService {
  private messageHandlers = new Map<string, (topic: string, message: Buffer) => void>();

  /** Get connection status of all devices (consistent with ModbusService/S7Service) */
  getAllConnectionStatus(): Map<string, boolean> {
    const result = new Map<string, boolean>();
    for (const [deviceId] of this.getClientEntries()) {
      result.set(deviceId, this.getConnectionStatus(deviceId));
    }
    return result;
  }

  /** Check whether a given device is connected */
  isConnected(deviceId: string): boolean {
    return this.getConnectionStatus(deviceId);
  }

  async connect(deviceConfig: Record<string, any>): Promise<any> {
    const { deviceId: clientId, alreadyConnected } = this.preConnect(
      { id: deviceConfig.id, connection: deviceConfig } as any,
      'mqtt',
    );

    const config: MqttConfig = {
      host: deviceConfig.host || '127.0.0.1',
      port: deviceConfig.port || 1883,
      protocol: deviceConfig.protocol || 'mqtt',
      clientId: deviceConfig.clientId || `ss-data-${clientId}`,
      username: deviceConfig.username,
      password: deviceConfig.password,
      clean: deviceConfig.clean !== false,
      keepalive: deviceConfig.keepalive || 60,
      reconnectPeriod: deviceConfig.reconnectPeriod || 5000,
      qos: deviceConfig.qos || 1,
      will: deviceConfig.will,
    };

    // Already connected and client still connected -> return directly
    if (alreadyConnected) {
      const entries = this.getClientEntries();
      const entry = entries.get(clientId);
      if (entry?.client?.connected) {
        this.logger.log(`MQTT client ${clientId} already connected`);
        return { type: 'mqtt', clientId, config };
      }
      // Client is disconnected, keep reconnecting
    }

    try {
      const brokerUrl = `${config.protocol}://${config.host}:${config.port}`;
      this.logger.log(`Connecting to MQTT broker: ${brokerUrl}`);

      const options: mqtt.IClientOptions = {
        clientId: config.clientId,
        clean: config.clean,
        keepalive: config.keepalive,
        reconnectPeriod: config.reconnectPeriod,
        connectTimeout: 10000,
        ...(config.username && { username: config.username }),
        ...(config.password && { password: config.password }),
        ...(config.will && {
          will: {
            topic: config.will.topic,
            payload: config.will.payload,
            qos: config.will.qos ?? 1,
            retain: config.will.retain ?? false,
          },
        }),
      };

      const client = await mqtt.connectAsync(brokerUrl, options);

      client.on('connect', () => {
        this.logger.log(`MQTT client ${clientId} connected to ${brokerUrl}`);
      });

      client.on('error', (error) => {
        this.logger.error(`MQTT error for client ${clientId}: ${error.message}`);
        this.markDisconnected(clientId);
      });

      client.on('reconnect', () => {
        this.logger.warn(`MQTT client ${clientId} reconnecting...`);
      });

      client.on('message', (topic, message) => {
        const handler = this.messageHandlers.get(clientId);
        if (handler) {
          handler(topic, message);
        }
      });

      this.postConnect(clientId, client);

      return { type: 'mqtt', clientId, config };
    } catch (error) {
      this.logger.error(`Failed to connect MQTT client ${clientId}: ${(error as Error).message}`);
      throw error;
    }
  }

  /** Tag read with error capture (overrides the base class retry version) */
  async readTag(client: any, tagConfig: Record<string, any>): Promise<MqttReadResult> {
    const tagId = tagConfig.id || 'unknown-tag';
    const topic = tagConfig.topic;

    if (!topic) {
      throw new Error(`Topic not specified for tag ${tagId}`);
    }

    const result: MqttReadResult = {
      tagId,
      value: null,
      timestamp: new Date(),
      quality: 'good',
    };

    try {
      return (await this.doReadTag(client, tagConfig)) as MqttReadResult;
    } catch (error) {
      result.quality = 'bad';
      result.error = (error as Error).message;
      this.logger.warn(
        `Failed to read tag ${tagId} from topic ${topic}: ${(error as Error).message}`,
      );
      return result;
    }
  }

  /** Tag write with error capture */
  async writeTag(client: any, tagConfig: Record<string, any>, value: any): Promise<void> {
    const tagId = tagConfig.id || 'unknown-tag';
    const topic = tagConfig.topic;

    if (!topic) {
      throw new Error(`Topic not specified for tag ${tagId}`);
    }

    try {
      await this.doWriteTag(client, tagConfig, value);
    } catch (error) {
      this.logger.error(
        `Failed to write tag ${tagId} to topic ${topic}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  protected async doReadTag(
    client: any,
    tagConfig: Record<string, any>,
  ): Promise<CollectorReadResult> {
    const tagId = tagConfig.id || 'unknown-tag';
    const topic = tagConfig.topic;
    const qos = tagConfig.qos || 1;

    const message = await new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MQTT subscribe timeout'));
      }, 5000);

      const tempTopic = `${topic}/response/${Date.now()}`;

      client.subscribe(tempTopic, { qos }, (err) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }
      });

      client.once('message', (receivedTopic, msg) => {
        if (receivedTopic === tempTopic) {
          clearTimeout(timeout);
          resolve(msg);
          client.unsubscribe(tempTopic);
        }
      });

      client.publish(topic, JSON.stringify({ action: 'read', tagId }), { qos });
    });

    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(message.toString());
    } catch {
      parsedValue = message.toString();
    }

    let value: unknown;
    const jsonPath = tagConfig.jsonPath as string | undefined;
    if (jsonPath && typeof parsedValue === 'object' && parsedValue !== null) {
      value = JsonPathUtil.extract(parsedValue, jsonPath);
    } else if (
      typeof parsedValue === 'object' &&
      parsedValue !== null &&
      (parsedValue as Record<string, unknown>).value !== undefined
    ) {
      value = (parsedValue as Record<string, unknown>).value;
    } else {
      value = parsedValue;
    }

    const timestamp = new Date(
      typeof parsedValue === 'object' && parsedValue !== null
        ? ((parsedValue as Record<string, unknown>).timestamp as string | number | undefined) ||
            Date.now()
        : Date.now(),
    );

    return {
      tagId,
      value,
      timestamp,
      quality: 'good',
    };
  }

  protected async doWriteTag(
    client: any,
    tagConfig: Record<string, any>,
    value: any,
  ): Promise<void> {
    const tagId = tagConfig.id || 'unknown-tag';
    const topic = tagConfig.topic;
    const qos = tagConfig.qos || 1;

    const payload = JSON.stringify({
      action: 'write',
      tagId,
      value,
      timestamp: new Date().toISOString(),
    });

    await client.publishAsync(topic, payload, { qos });
    this.logger.debug(`Wrote tag ${tagId} to topic ${topic}: ${value}`);
  }

  protected async doDisconnect(client: any): Promise<void> {
    if (!client) return;
    await client.end();
  }

  async validateChannelConfig(config: Record<string, any>) {
    const errors: { field: string; message: string }[] = [];

    const urlError = ConfigValidator.validateUrlPrefix(
      config.host,
      ['mqtt://', 'mqtts://', 'ws://', 'wss://'],
      'host',
      'Broker URL',
    );
    if (urlError) errors.push(urlError);

    const portError = ConfigValidator.validatePort(config.port, 'port', '端口号');
    if (portError) errors.push(portError);

    const qosError = ConfigValidator.validateEnum(config.qos, [0, 1, 2], 'qos', 'QoS');
    if (qosError) errors.push(qosError);

    return { valid: errors.length === 0, errors };
  }

  // ---- MQTT-specific methods ----

  async publish(
    client: any,
    topic: string,
    message: any,
    options?: { qos?: number; retain?: boolean },
  ): Promise<void> {
    if (!client || !client.connected) {
      throw new Error('MQTT client not connected');
    }

    try {
      const payload = typeof message === 'string' ? message : JSON.stringify(message);
      const qos = options?.qos || 1;
      const retain = options?.retain || false;

      await client.publishAsync(topic, payload, { qos, retain });
      this.logger.debug(`Published to topic ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to publish to topic ${topic}: ${(error as Error).message}`);
      throw error;
    }
  }

  async subscribe(
    client: any,
    topic: string,
    callback: (topic: string, message: Buffer) => void,
    options?: { qos?: number },
  ): Promise<void> {
    if (!client || !client.connected) {
      throw new Error('MQTT client not connected');
    }

    try {
      const qos = options?.qos || 1;
      await client.subscribeAsync(topic, { qos });

      const clientId = this.getClientId(client);
      this.messageHandlers.set(clientId, callback);

      this.logger.debug(`Subscribed to topic ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic ${topic}: ${(error as Error).message}`);
      throw error;
    }
  }

  async unsubscribe(client: any, topic: string): Promise<void> {
    if (!client || !client.connected) return;

    try {
      await client.unsubscribeAsync(topic);
      this.logger.debug(`Unsubscribed from topic ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from topic ${topic}: ${(error as Error).message}`);
    }
  }

  /**
   * Handle an MQTT message received via subscription, extracting values per tag's jsonPath config.
   *
   * For the case where one MQTT message contains data for multiple tags:
   * the body is JSON, and each tag extracts its field via its own `jsonPath`.
   *
   * @param tags     list of tags subscribed to this topic (must include jsonPath config)
   * @param _topic   the topic the message was received on
   * @param message the MQTT message body
   * @returns an array of read results, one per tag that has a jsonPath configured
   */
  processMessage(tags: ITagContext[], _topic: string, message: Buffer): MqttReadResult[] {
    const results: MqttReadResult[] = [];
    const timestamp = new Date();

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.toString());
    } catch {
      // Non-JSON message: all jsonPath tags fail to extract
      for (const tag of tags) {
        if (!tag.jsonPath) continue;
        results.push({
          tagId: tag.id,
          value: undefined,
          timestamp,
          quality: 'bad',
          error: `Message is not valid JSON, cannot apply jsonPath '${tag.jsonPath}'`,
        });
      }
      return results;
    }

    for (const tag of tags) {
      const jsonPath = tag.jsonPath as string | undefined;
      if (!jsonPath) continue;

      const value = JsonPathUtil.extract(parsed, jsonPath);
      results.push({
        tagId: tag.id,
        value,
        timestamp,
        quality: value !== undefined ? 'good' : 'bad',
        error: value === undefined ? `JSONPath '${jsonPath}' not found in message` : undefined,
      });
    }

    return results;
  }

  private getClientId(client: mqtt.MqttClient): string {
    for (const [id, entry] of this.getClientEntries()) {
      if (entry.client === client) return id;
    }
    return 'unknown';
  }
}
