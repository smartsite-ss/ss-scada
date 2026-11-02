// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { VariableSimulationConfig } from '../simulation-config.types';

/** Variable simulator interface */
export interface VariableSimulator {
  /** Generate the next value */
  generate(): number | boolean | string;
  /** Set the current value (for external writes) */
  setValue(value: any): void;
  /** Reset the simulator state */
  reset(): void;
  /** Get the simulator config */
  getConfig(): VariableSimulationConfig;
  /** Update the simulator config */
  updateConfig(config: VariableSimulationConfig): void;
}

/** Cached simulator wrapper - controls update frequency by updateIntervalSec */
export class CachedSimulator implements VariableSimulator {
  private inner: VariableSimulator;
  private updateIntervalMs: number;
  private lastGeneratedTime: number = 0;
  private cachedValue: any = null;

  constructor(simulator: VariableSimulator, updateIntervalSec: number) {
    this.inner = simulator;
    this.updateIntervalMs = updateIntervalSec * 1000;
  }

  generate(): any {
    const now = Date.now();
    if (now - this.lastGeneratedTime >= this.updateIntervalMs) {
      this.cachedValue = this.inner.generate();
      this.lastGeneratedTime = now;
    }
    return this.cachedValue;
  }

  setValue(value: any): void {
    this.inner.setValue(value);
    this.cachedValue = value;
  }

  reset(): void {
    this.inner.reset();
    this.lastGeneratedTime = 0;
    this.cachedValue = null;
  }

  getConfig(): VariableSimulationConfig {
    return this.inner.getConfig();
  }

  updateConfig(config: VariableSimulationConfig): void {
    this.updateIntervalMs = config.updateIntervalSec * 1000;
    this.inner.updateConfig(config);
    this.lastGeneratedTime = 0;
    this.cachedValue = null;
  }
}
