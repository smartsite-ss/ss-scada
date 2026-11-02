// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/** Event binding configuration */
export interface EventBindingConfig {
  /** Full event name, e.g. "data:changed" */
  eventFullName: string;
  /** Bound script ID */
  scriptId: string;
  /** Optional condition expression */
  condition?: string;
}