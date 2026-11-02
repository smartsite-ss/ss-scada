// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ValueTransformUtil } from '../value-transform.util';
import { TransformConfig } from '../types';

describe('ValueTransformUtil', () => {
  // -------------------------------------------------------------
  // apply()
  // -------------------------------------------------------------
  describe('apply', () => {
    it('rawValue of null should return null', () => {
      // eslint-disable-next-line prefer-spread
      expect(ValueTransformUtil.apply(null, { scale: 2 })).toBeNull();
    });

    it('rawValue of undefined should return null', () => {
      // eslint-disable-next-line prefer-spread
      expect(ValueTransformUtil.apply(undefined, { scale: 2 })).toBeNull();
    });

    it('With no config, rawValue should be returned as-is', () => {
      expect(ValueTransformUtil.apply(42)).toBe(42);
    });

    it('With no config, rawValue null should return null', () => {
      expect(ValueTransformUtil.apply(null)).toBeNull();
    });

    it('Should apply the scale zoom correctly', () => {
      const config: TransformConfig = { scale: 2 };
      // 10 * 2 + 0 = 20
      expect(ValueTransformUtil.apply(10, config)).toBe(20);
    });

    it('Should apply the offset shift correctly', () => {
      const config: TransformConfig = { offset: 5 };
      // 10 * 1 + 5 = 15
      expect(ValueTransformUtil.apply(10, config)).toBe(15);
    });

    it('Should apply both scale and offset', () => {
      const config: TransformConfig = { scale: 3, offset: 100 };
      // 10 * 3 + 100 = 130
      expect(ValueTransformUtil.apply(10, config)).toBe(130);
    });

    it('Should handle decimal precision according to precision', () => {
      const config: TransformConfig = { scale: 0.1, precision: 2 };
      // 100 * 0.1 + 0 = 10 (in theory) - but floating point may have error; assert the result is 10
      const result = ValueTransformUtil.apply(100, config);
      expect(result).toBe(10);
    });

    it('precision=0 should return integers', () => {
      const config: TransformConfig = { scale: 0.333, precision: 0 };
      // 10 * 0.333 = 3.33 → toFixed(0) = '3' → 3
      expect(ValueTransformUtil.apply(10, config)).toBe(3);
    });

    it('precision=4 should keep 4 decimal places', () => {
      const config: TransformConfig = { scale: 1 / 3, precision: 4 };
      // 10 * (1/3) = 3.33333... → toFixed(4) = '3.3333' → 3.3333
      expect(ValueTransformUtil.apply(10, config)).toBe(3.3333);
    });

    it('Should use the defaults scale=1, offset=0, precision=2', () => {
      const config: TransformConfig = {};
      // 3.14159 * 1 + 0 = 3.14159 → toFixed(2) = '3.14' → 3.14
      expect(ValueTransformUtil.apply(3.14159, config)).toBe(3.14);
    });

    it('A negative scale should be computed correctly', () => {
      const config: TransformConfig = { scale: -2, offset: 100 };
      // 10 * -2 + 100 = 80
      expect(ValueTransformUtil.apply(10, config)).toBe(80);
    });

    it('rawValue of 0 should be computed correctly', () => {
      const config: TransformConfig = { scale: 2, offset: 5 };
      // 0 * 2 + 5 = 5
      expect(ValueTransformUtil.apply(0, config)).toBe(5);
    });

    it('Negative rawValue should be computed correctly', () => {
      const config: TransformConfig = { scale: 2, offset: 10 };
      // -5 * 2 + 10 = 0
      expect(ValueTransformUtil.apply(-5, config)).toBe(0);
    });

    it('Float rawValue should be computed correctly', () => {
      const config: TransformConfig = { scale: 2, precision: 2 };
      // 1.5 * 2 + 0 = 3
      expect(ValueTransformUtil.apply(1.5, config)).toBe(3);
    });
  });

  // -------------------------------------------------------------
  // applyFromConfig()
  // -------------------------------------------------------------
  describe('applyFromConfig', () => {
    it('When tagConfig has no transform field, rawValue should be returned as-is', () => {
      const tagConfig = { id: 'tag-1', address: '40001' };
      expect(ValueTransformUtil.applyFromConfig(42, tagConfig)).toBe(42);
    });

    it('When tagConfig.transform is undefined, rawValue should be returned as-is', () => {
      const tagConfig = { id: 'tag-1', transform: undefined };
      expect(ValueTransformUtil.applyFromConfig(42, tagConfig)).toBe(42);
    });

    it('Should extract configuration from tagConfig.transform and apply it', () => {
      const tagConfig = {
        id: 'tag-1',
        transform: { scale: 2, offset: 10, precision: 2 },
      };
      // 10 * 2 + 10 = 30
      expect(ValueTransformUtil.applyFromConfig(10, tagConfig)).toBe(30);
    });

    it('rawValue of null should return null even with transform', () => {
      const tagConfig = { transform: { scale: 2 } };
      expect(ValueTransformUtil.applyFromConfig(null, tagConfig)).toBeNull();
    });

    it('rawValue of undefined should return null even with transform', () => {
      const tagConfig = { transform: { scale: 2 } };
      expect(ValueTransformUtil.applyFromConfig(undefined, tagConfig)).toBeNull();
    });

    it('Should support scale-only configuration', () => {
      const tagConfig = { transform: { scale: 0.5 } };
      // 10 * 0.5 + 0 = 5 → toFixed(2) = '5.00' → 5
      expect(ValueTransformUtil.applyFromConfig(10, tagConfig)).toBe(5);
    });

    it('Should support offset-only configuration', () => {
      const tagConfig = { transform: { offset: -10 } };
      // 10 * 1 + (-10) = 0 → toFixed(2) = '0.00' → 0
      expect(ValueTransformUtil.applyFromConfig(10, tagConfig)).toBe(0);
    });

    it('Should support precision-only configuration', () => {
      const tagConfig = { transform: { precision: 0 } };
      // 3.7 * 1 + 0 = 3.7 → toFixed(0) = '4' → 4
      expect(ValueTransformUtil.applyFromConfig(3.7, tagConfig)).toBe(4);
    });

    it('Empty transform object should use default values', () => {
      const tagConfig = { transform: {} };
      // 3.14159 * 1 + 0 = 3.14159 → toFixed(2) = '3.14' → 3.14
      expect(ValueTransformUtil.applyFromConfig(3.14159, tagConfig)).toBe(3.14);
    });
  });
});
