// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { DeviceType } from '@ss-node/ss-sdk';

/** Device channel config -- one device has exactly one channel */
export type DeviceChannelConfig =
  | ModbusTcpChannel
  | ModbusRtuChannel
  | OpcUaChannel
  | MqttChannel
  | SiemensS7Channel
  | VirtualChannel;

/** Supported protocol types (aligned with the DeviceType enum) */
export type ChannelProtocol = DeviceType;

/** Modbus TCP channel */
export interface ModbusTcpChannel {
  protocol: 'modbus_tcp';
  host: string;
  port?: number; // default 502
  unitId?: number; // default 1
  timeout?: number; // default 5000ms
  retryInterval?: number; // default 3000ms
  maxRetries?: number; // default 3
  reversedBits?: boolean; // default false
  reversedWords?: boolean; // default false
}

/** Modbus RTU channel */
export interface ModbusRtuChannel {
  protocol: 'modbus_rtu';
  serialPort: string;
  baudRate: number; // 9600/19200/38400/115200
  dataBits?: 7 | 8; // default 8
  parity?: 'none' | 'even' | 'odd'; // default even
  stopBits?: 1 | 2; // default 1
  timeout?: number; // default 5000ms
  unitId?: number; // default 1
}

/** OPC UA channel */
export interface OpcUaChannel {
  protocol: 'opc_ua';
  endpoint: string; // opc.tcp://192.168.1.1:4840
  securityMode?: 'None' | 'Sign' | 'SignAndEncrypt';
  securityPolicy?: 'None' | 'Basic128Rsa15' | 'Basic256' | 'Basic256Sha256';
  authentication?: {
    type: 'anonymous' | 'username' | 'certificate';
    username?: string;
    password?: string;
    certificatePath?: string;
    privateKeyPath?: string;
  };
  sessionTimeout?: number; // default 60000ms
  autoReconnect?: boolean; // default true
  namespaceIndex?: number;
}

/** MQTT channel */
export interface MqttChannel {
  protocol: 'mqtt';
  brokerUrl: string; // mqtt://broker.example.com:1883
  clientId: string;
  cleanSession?: boolean; // default true
  qos?: 0 | 1 | 2; // default 1
  keepAlive?: number; // default 60s
  authentication?: {
    username?: string;
    password?: string;
  };
  tls?: {
    enabled: boolean;
    caPath?: string;
    certPath?: string;
    keyPath?: string;
    rejectUnauthorized: boolean;
  };
  will?: {
    topic: string;
    payload: string;
    qos: 0 | 1 | 2;
    retain: boolean;
  };
  topics?: string[]; // list of subscribed topics
}

/** Siemens S7 channel */
export interface SiemensS7Channel {
  protocol: 'siemens_s7';
  host: string; // PLC IP address
  port?: number; // default 102
  rack?: number; // default 0
  slot?: number; // default 1 (S7-300: 2, S7-1200/1500: 1)
  timeout?: number; // default 5000ms
  putGetEnabled?: boolean; // PUT/GET permission, default true
  optimizeBlockAccess?: boolean; // optimized block access; S7-1200/1500 must set this to false
}

/** Virtual-device channel (simulated data) */
export interface VirtualChannel {
  protocol: 'virtual';
  /** Data-generation interval (ms), default 1000 */
  interval?: number;
  /** Simulation strategy */
  strategy?: 'sine' | 'random' | 'constant';
}
