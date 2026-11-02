// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/** Tag variables selected by the device variable selector (reused by variable binding configs of system plugins) */
export interface SelectableVariable {
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  tagId: string;
  tagName: string;
  dataType: string;
  /** Tag variable unit (carried from DataTag.unit) */
  unit?: string;
  /** Tag variable decimal places (carried from DataTag.decimalPlaces) */
  decimalPlaces?: number;
}
