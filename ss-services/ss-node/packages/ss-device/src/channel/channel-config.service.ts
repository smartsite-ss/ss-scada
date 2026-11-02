// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from '@ss-node/ss-i18n';
import { ErrorFactory } from '@ss-node/ss-core';
import { validateChannelConfig } from './channel-config.validator';
import type {
  ModbusTcpChannel,
  ModbusRtuChannel,
  OpcUaChannel,
  MqttChannel,
  SiemensS7Channel,
  DeviceChannelConfig,
} from './channel-config.interface';

/**
 * Device channel-config service
 *
 * A device instance configures exactly one data-collection channel.
 * The channel carries the differentiated connection info after device instantiation
 * (serial port, IP address, port, MQTT broker, etc.).
 */
@Injectable()
export class ChannelConfigService {
  private readonly logger = new Logger(ChannelConfigService.name);
  private readonly err: ErrorFactory;

  constructor(private readonly i18nService: I18nService) {
    this.err = new ErrorFactory(this.i18nService);
  }

  /**
   * Validate the channel config and fill in defaults
   */
  validate(config: DeviceChannelConfig): DeviceChannelConfig {
    const errors = validateChannelConfig(config);
    if (errors.length > 0) {
      const message = errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      this.logger.warn(`Channel config validation failed: ${message}`);
      this.err.conflict('error.device.DEV_014', { detail: message });
    }

    return this.fillDefaults(config);
  }

  /**
   * Validate that the protocol type matches the device type
   */
  checkProtocolMatch(deviceType: string, channelProtocol: string): void {
    const protocolMap: Record<string, string> = {
      modbus_tcp: 'modbus_tcp',
      modbus_rtu: 'modbus_rtu',
      opc_ua: 'opc_ua',
      mqtt: 'mqtt',
      siemens_s7: 'siemens_s7',
    };

    const expected = protocolMap[deviceType];
    if (expected && expected !== channelProtocol) {
      this.err.conflict('error.device.DEV_016', {
        deviceType,
        protocol: channelProtocol,
      });
    }
  }

  /**
   * Generate the channel connection string (for logs/diagnostics)
   */
  toConnectionString(config: DeviceChannelConfig): string {
    const protocol = (config as any).protocol;
    switch (protocol) {
      case 'modbus_tcp': {
        const c = config as ModbusTcpChannel;
        return `modbus_tcp://${c.host}:${c.port}?unitId=${c.unitId ?? 1}`;
      }
      case 'modbus_rtu': {
        const c = config as ModbusRtuChannel;
        return `modbus_rtu://${c.serialPort}?baud=${c.baudRate}&unitId=${c.unitId ?? 1}`;
      }
      case 'opc_ua': {
        const c = config as OpcUaChannel;
        return c.endpoint;
      }
      case 'mqtt': {
        const c = config as MqttChannel;
        return c.brokerUrl;
      }
      case 'siemens_s7': {
        const c = config as SiemensS7Channel;
        return `s7://${c.host}:${c.port}?rack=${c.rack ?? 0}&slot=${c.slot ?? 1}`;
      }
      default:
        return `${protocol}: unknown`;
    }
  }

  /**
   * Fill in the channel config's default values
   */
  private fillDefaults(config: DeviceChannelConfig): DeviceChannelConfig {
    const protocol = (config as any).protocol;
    switch (protocol) {
      case 'modbus_tcp': {
        const c = config as ModbusTcpChannel;
        return {
          ...c,
          port: c.port ?? 502,
          unitId: c.unitId ?? 1,
          timeout: c.timeout ?? 5000,
          retryInterval: c.retryInterval ?? 3000,
          maxRetries: c.maxRetries ?? 3,
          reversedBits: c.reversedBits ?? false,
          reversedWords: c.reversedWords ?? false,
        };
      }
      case 'modbus_rtu': {
        const c = config as ModbusRtuChannel;
        return {
          ...c,
          dataBits: c.dataBits ?? 8,
          parity: c.parity ?? 'even',
          stopBits: c.stopBits ?? 1,
          timeout: c.timeout ?? 5000,
          unitId: c.unitId ?? 1,
        };
      }
      case 'opc_ua': {
        const c = config as OpcUaChannel;
        return {
          ...c,
          securityMode: c.securityMode ?? 'None',
          securityPolicy: c.securityPolicy ?? 'None',
          authentication: c.authentication ?? { type: 'anonymous' },
          sessionTimeout: c.sessionTimeout ?? 60000,
          autoReconnect: c.autoReconnect ?? true,
        };
      }
      case 'mqtt': {
        const c = config as MqttChannel;
        return {
          ...c,
          cleanSession: c.cleanSession ?? true,
          qos: c.qos ?? 1,
          keepAlive: c.keepAlive ?? 60,
          tls: c.tls ?? { enabled: false, rejectUnauthorized: true },
          topics: c.topics ?? [],
        };
      }
      case 'siemens_s7': {
        const c = config as SiemensS7Channel;
        return {
          ...c,
          port: c.port ?? 102,
          rack: c.rack ?? 0,
          slot: c.slot ?? 1,
          timeout: c.timeout ?? 5000,
          putGetEnabled: c.putGetEnabled ?? true,
          optimizeBlockAccess: c.optimizeBlockAccess ?? false,
        };
      }
      default:
        return config;
    }
  }
}
