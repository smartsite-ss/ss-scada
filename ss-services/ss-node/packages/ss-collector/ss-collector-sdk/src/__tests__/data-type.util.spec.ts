// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { isBooleanDataType, isStringDataType } from '../data-type.util';

describe('data-type.util', () => {
  describe('isBooleanDataType', () => {
    it("Should recognize the point-table spec string 'boolean'", () => {
      expect(isBooleanDataType('boolean')).toBe(true);
    });

    it("Should be compatible with the collection pipeline's legacy 'bool' string", () => {
      expect(isBooleanDataType('bool')).toBe(true);
    });

    it('Should be case-insensitive', () => {
      expect(isBooleanDataType('BOOLEAN')).toBe(true);
      expect(isBooleanDataType('Bool')).toBe(true);
    });

    it('Numeric types should return false', () => {
      expect(isBooleanDataType('float32')).toBe(false);
      expect(isBooleanDataType('int16')).toBe(false);
      expect(isBooleanDataType('uint16')).toBe(false);
    });

    it('undefined / empty string should return false', () => {
      expect(isBooleanDataType(undefined)).toBe(false);
      expect(isBooleanDataType('')).toBe(false);
    });
  });

  describe('isStringDataType', () => {
    it("Should recognize 'string'", () => {
      expect(isStringDataType('string')).toBe(true);
      expect(isStringDataType('STRING')).toBe(true);
    });

    it('Other types should return false', () => {
      expect(isStringDataType('boolean')).toBe(false);
      expect(isStringDataType('float32')).toBe(false);
      expect(isStringDataType(undefined)).toBe(false);
    });
  });
});
