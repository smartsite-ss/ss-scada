// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { TransformConfig } from './types';

/**
 * Value transform utility - provides linear transform (scale/offset/precision)
 *
 * Common logic extracted from the Modbus / S7 plugins
 */
export class ValueTransformUtil {
  /**
   * Apply linear transform: transformed = rawValue * scale + offset
   * @param rawValue the raw value
   * @param config the transform config (scale/offset/precision)
   * @returns the transformed value; returns null if rawValue is null/undefined
   */
  static apply(rawValue: number | null | undefined, config?: TransformConfig): number | null {
    if (rawValue === null || rawValue === undefined) return null;
    if (!config) return rawValue;

    const { scale = 1, offset = 0, precision = 2 } = config;
    let transformed = rawValue * scale + offset;

    if (precision !== undefined && precision >= 0) {
      transformed = parseFloat(transformed.toFixed(precision));
    }

    return transformed;
  }

  /**
   * Extract the transform config from tagConfig and apply it
   * @param rawValue the raw value
   * @param tagConfig the tag config (contains the transform field)
   * @returns the transformed value
   */
  static applyFromConfig(
    rawValue: number | null | undefined,
    tagConfig: Record<string, any>,
  ): number | null {
    if (!tagConfig.transform) return rawValue;
    return ValueTransformUtil.apply(rawValue, tagConfig.transform as TransformConfig);
  }
}
