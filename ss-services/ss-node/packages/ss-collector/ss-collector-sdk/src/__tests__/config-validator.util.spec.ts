// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ConfigValidator } from '../config-validator.util';

describe('ConfigValidator', () => {
  // -------------------------------------------------------------
  // isValidHost
  // -------------------------------------------------------------
  describe('isValidHost', () => {
    it('Should accept IPv4 addresses', () => {
      expect(ConfigValidator.isValidHost('127.0.0.1')).toBe(true);
      expect(ConfigValidator.isValidHost('192.168.1.1')).toBe(true);
      expect(ConfigValidator.isValidHost('10.0.0.1')).toBe(true);
      expect(ConfigValidator.isValidHost('255.255.255.255')).toBe(true);
    });

    it('Should accept localhost', () => {
      expect(ConfigValidator.isValidHost('localhost')).toBe(true);
    });

    it('Should accept valid host names', () => {
      expect(ConfigValidator.isValidHost('example.com')).toBe(true);
      expect(ConfigValidator.isValidHost('server.local')).toBe(true);
      expect(ConfigValidator.isValidHost('host-01.internal.company.com')).toBe(true);
    });

    it('Should reject empty strings', () => {
      expect(ConfigValidator.isValidHost('')).toBe(false);
    });

    it('Should reject malformed hosts (structural errors)', () => {
      // Note: the source IPV4_REGEX only checks segment count and per-segment digit count (1-3), not per-segment range
      // so 999.999.999.999 passes validation;
      // Note: HOSTNAME_REGEX accepts any number of dot-separated segments, so 1.2.3 / 1.2.3.4.5 are also valid
      // Here we test only structural errors: leading/trailing dots, consecutive dots, special characters
      expect(ConfigValidator.isValidHost('1.2.3.')).toBe(false); // trailing dot
      expect(ConfigValidator.isValidHost('1..2.3')).toBe(false); // consecutive dots
      expect(ConfigValidator.isValidHost('.1.2.3')).toBe(false); // leading dot
      expect(ConfigValidator.isValidHost('host with space')).toBe(false); // contains a space
      expect(ConfigValidator.isValidHost('host@invalid')).toBe(false); // contains special characters
    });

    it('Should reject invalid host names', () => {
      expect(ConfigValidator.isValidHost('-invalid')).toBe(false);
      expect(ConfigValidator.isValidHost('invalid-')).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // isValidPort
  // -------------------------------------------------------------
  describe('isValidPort', () => {
    it('Should accept ports within 1-65535', () => {
      expect(ConfigValidator.isValidPort(1)).toBe(true);
      expect(ConfigValidator.isValidPort(80)).toBe(true);
      expect(ConfigValidator.isValidPort(502)).toBe(true);
      expect(ConfigValidator.isValidPort(65535)).toBe(true);
    });

    it('Should reject 0', () => {
      expect(ConfigValidator.isValidPort(0)).toBe(false);
    });

    it('Should reject negative numbers', () => {
      expect(ConfigValidator.isValidPort(-1)).toBe(false);
    });

    it('Should reject ports greater than 65535', () => {
      expect(ConfigValidator.isValidPort(65536)).toBe(false);
      expect(ConfigValidator.isValidPort(100000)).toBe(false);
    });
  });

  // -------------------------------------------------------------
  // isInRange
  // -------------------------------------------------------------
  describe('isInRange', () => {
    it('Values in range should return true', () => {
      expect(ConfigValidator.isInRange(5, 1, 10)).toBe(true);
      expect(ConfigValidator.isInRange(1, 1, 10)).toBe(true); // boundary
      expect(ConfigValidator.isInRange(10, 1, 10)).toBe(true); // boundary
    });

    it('Values less than min should return false', () => {
      expect(ConfigValidator.isInRange(0, 1, 10)).toBe(false);
    });

    it('Values greater than max should return false', () => {
      expect(ConfigValidator.isInRange(11, 1, 10)).toBe(false);
    });

    it('min == max == value should return true', () => {
      expect(ConfigValidator.isInRange(5, 5, 5)).toBe(true);
    });
  });

  // -------------------------------------------------------------
  // validateHost
  // -------------------------------------------------------------
  describe('validateHost', () => {
    it('Valid host should return null', () => {
      expect(ConfigValidator.validateHost('127.0.0.1')).toBeNull();
      expect(ConfigValidator.validateHost('localhost')).toBeNull();
      expect(ConfigValidator.validateHost('example.com')).toBeNull();
    });

    it('Illegal host should return FieldError', () => {
      const result = ConfigValidator.validateHost('invalid host');
      expect(result).not.toBeNull();
      expect(result!.field).toBe('host');
      expect(result!.message).toContain('主机地址');
      expect(result!.message).toContain('格式无效');
    });

    it('Should support custom field and label', () => {
      const result = ConfigValidator.validateHost('invalid', 'ipAddress', 'IP 地址');
      expect(result).not.toBeNull();
      expect(result!.field).toBe('ipAddress');
      expect(result!.message).toContain('IP 地址');
    });

    it('Empty string should return null (skip validation)', () => {
      expect(ConfigValidator.validateHost('')).toBeNull();
    });
  });

  // -------------------------------------------------------------
  // validatePort
  // -------------------------------------------------------------
  describe('validatePort', () => {
    it('Valid port should return null', () => {
      expect(ConfigValidator.validatePort(80)).toBeNull();
      expect(ConfigValidator.validatePort(502)).toBeNull();
      expect(ConfigValidator.validatePort(65535)).toBeNull();
    });

    it('Invalid port should return FieldError', () => {
      const result = ConfigValidator.validatePort(0);
      expect(result).not.toBeNull();
      expect(result!.field).toBe('port');
      expect(result!.message).toContain('端口号');
      expect(result!.message).toContain('1-65535');
    });

    it('Should support custom field and label', () => {
      const result = ConfigValidator.validatePort(99999, 'modbusPort', 'Modbus 端口');
      expect(result).not.toBeNull();
      expect(result!.field).toBe('modbusPort');
      expect(result!.message).toContain('Modbus 端口');
    });

    it('An undefined port should return null (skip validation)', () => {
      expect(ConfigValidator.validatePort(undefined)).toBeNull();
    });

    it('Negative port should return FieldError', () => {
      const result = ConfigValidator.validatePort(-1);
      expect(result).not.toBeNull();
      expect(result!.message).toContain('1-65535');
    });
  });

  // -------------------------------------------------------------
  // validateRange
  // -------------------------------------------------------------
  describe('validateRange', () => {
    it('Values in range should return null', () => {
      expect(ConfigValidator.validateRange(5, 1, 10, 'field', '标签')).toBeNull();
    });

    it('Values out of range should return FieldError', () => {
      const result = ConfigValidator.validateRange(11, 1, 10, 'field', '标签');
      expect(result).not.toBeNull();
      expect(result!.field).toBe('field');
      expect(result!.message).toContain('标签');
      expect(result!.message).toContain('1-10');
    });

    it('Values equal to min should return null (boundary)', () => {
      expect(ConfigValidator.validateRange(1, 1, 10, 'f', 'l')).toBeNull();
    });

    it('Values equal to max should return null (boundary)', () => {
      expect(ConfigValidator.validateRange(10, 1, 10, 'f', 'l')).toBeNull();
    });

    it('An undefined value should return null (skip validation)', () => {
      expect(ConfigValidator.validateRange(undefined, 1, 10, 'f', 'l')).toBeNull();
    });

    it('Negative values out of range should return FieldError', () => {
      const result = ConfigValidator.validateRange(-1, 0, 100, 'field', '值');
      expect(result).not.toBeNull();
      expect(result!.message).toContain('0-100');
    });
  });

  // -------------------------------------------------------------
  // validateUrlPrefix
  // -------------------------------------------------------------
  describe('validateUrlPrefix', () => {
    it('A URL starting with the specified prefix should return null', () => {
      expect(
        ConfigValidator.validateUrlPrefix(
          'mqtt://broker.example.com',
          ['mqtt://', 'mqtts://'],
          'url',
          'MQTT URL',
        ),
      ).toBeNull();
      expect(
        ConfigValidator.validateUrlPrefix(
          'mqtts://broker.example.com',
          ['mqtt://', 'mqtts://'],
          'url',
          'MQTT URL',
        ),
      ).toBeNull();
    });

    it('A URL not starting with the specified prefix should return FieldError', () => {
      const result = ConfigValidator.validateUrlPrefix(
        'http://example.com',
        ['mqtt://', 'mqtts://'],
        'url',
        'MQTT URL',
      );
      expect(result).not.toBeNull();
      expect(result!.field).toBe('url');
      expect(result!.message).toContain('MQTT URL');
      expect(result!.message).toContain('mqtt://');
    });

    it('An undefined URL should return null (skip validation)', () => {
      expect(ConfigValidator.validateUrlPrefix(undefined, ['mqtt://'], 'url', 'URL')).toBeNull();
    });

    it('Empty string URL should return null (skip validation)', () => {
      expect(ConfigValidator.validateUrlPrefix('', ['mqtt://'], 'url', 'URL')).toBeNull();
    });

    it('Error message should contain all prefixes', () => {
      const result = ConfigValidator.validateUrlPrefix(
        'invalid',
        ['mqtt://', 'mqtts://'],
        'url',
        'URL',
      );
      expect(result!.message).toContain('mqtt://');
      expect(result!.message).toContain('mqtts://');
      expect(result!.message).toContain('或');
    });
  });

  // -------------------------------------------------------------
  // validateEnum
  // -------------------------------------------------------------
  describe('validateEnum', () => {
    it('Values in the enum should return null', () => {
      expect(
        ConfigValidator.validateEnum('tcp', ['tcp', 'serial', 'ws'], 'transport', '传输'),
      ).toBeNull();
    });

    it('Values not in the enum should return FieldError', () => {
      const result = ConfigValidator.validateEnum(
        'udp',
        ['tcp', 'serial', 'ws'],
        'transport',
        '传输',
      );
      expect(result).not.toBeNull();
      expect(result!.field).toBe('transport');
      expect(result!.message).toContain('传输');
      expect(result!.message).toContain('tcp');
      expect(result!.message).toContain('serial');
      expect(result!.message).toContain('ws');
    });

    it('An undefined value should return null (skip validation)', () => {
      expect(ConfigValidator.validateEnum(undefined, ['a', 'b'], 'field', '标签')).toBeNull();
    });

    it('Numeric enums should validate correctly', () => {
      expect(ConfigValidator.validateEnum(1, [1, 2, 3], 'mode', '模式')).toBeNull();

      const result = ConfigValidator.validateEnum(5, [1, 2, 3], 'mode', '模式');
      expect(result).not.toBeNull();
      expect(result!.message).toContain('1');
      expect(result!.message).toContain('2');
      expect(result!.message).toContain('3');
    });

    it('Error message should be separated by enumeration commas', () => {
      const result = ConfigValidator.validateEnum('x', ['a', 'b', 'c'], 'field', '标签');
      expect(result!.message).toContain('a、b、c');
    });
  });
});
