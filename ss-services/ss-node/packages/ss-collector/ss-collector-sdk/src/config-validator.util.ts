// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { FieldError } from './types';

/**
 * Collector channel-config validation utilities
 *
 * Common validation logic extracted from the Modbus / S7 / MQTT plugins
 */
export class ConfigValidator {
  private static readonly IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
  private static readonly HOSTNAME_REGEX =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  /**
   * Validate a host address (IP / hostname / localhost)
   */
  static isValidHost(host: string): boolean {
    return (
      host === 'localhost' ||
      ConfigValidator.IPV4_REGEX.test(host) ||
      ConfigValidator.HOSTNAME_REGEX.test(host)
    );
  }

  /**
   * Validate a port-number range
   */
  static isValidPort(port: number): boolean {
    return port >= 1 && port <= 65535;
  }

  /**
   * Validate a numeric range
   */
  static isInRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  }

  /**
   * Validate the host address and return error entries (used by validateChannelConfig)
   */
  static validateHost(
    host: string,
    field: string = 'host',
    label: string = '主机地址',
  ): FieldError | null {
    if (host && !ConfigValidator.isValidHost(host)) {
      return { field, message: `${label}格式无效` };
    }
    return null;
  }

  /**
   * Validate the port range and return error entries
   */
  static validatePort(
    port: number | undefined,
    field: string = 'port',
    label: string = '端口号',
  ): FieldError | null {
    if (port !== undefined && !ConfigValidator.isValidPort(port)) {
      return { field, message: `${label}必须在1-65535范围内` };
    }
    return null;
  }

  /**
   * Validate the numeric range and return error entries
   */
  static validateRange(
    value: number | undefined,
    min: number,
    max: number,
    field: string,
    label: string,
  ): FieldError | null {
    if (value !== undefined && !ConfigValidator.isInRange(value, min, max)) {
      return { field, message: `${label}必须在${min}-${max}范围内` };
    }
    return null;
  }

  /**
   * Validate a URL prefix
   */
  static validateUrlPrefix(
    url: string | undefined,
    prefixes: string[],
    field: string,
    label: string,
  ): FieldError | null {
    if (url && !prefixes.some((p) => url.startsWith(p))) {
      return { field, message: `${label}必须以 ${prefixes.join(' 或 ')} 开头` };
    }
    return null;
  }

  /**
   * Validate an enum value
   */
  static validateEnum(
    value: any | undefined,
    allowedValues: any[],
    field: string,
    label: string,
  ): FieldError | null {
    if (value !== undefined && !allowedValues.includes(value)) {
      return { field, message: `${label}必须为 ${allowedValues.join('、')} 之一` };
    }
    return null;
  }
}
