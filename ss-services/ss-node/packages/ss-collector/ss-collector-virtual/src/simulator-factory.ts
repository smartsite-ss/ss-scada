// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Injectable } from '@nestjs/common';
import { isBooleanDataType } from '@ss-node/ss-collector-sdk';
import { VariableSimulator, CachedSimulator } from './simulators/variable-simulator.interface';
import { FixedValueSimulator } from './simulators/fixed-value.simulator';
import { RangeValueSimulator } from './simulators/range-value.simulator';
import { EnumValueSimulator } from './simulators/enum-value.simulator';
import { BoolSimulator } from './simulators/bool.simulator';
import { StringSimulator } from './simulators/string.simulator';
import { FaultInjectionSimulator } from './simulators/fault-injection.simulator';
import {
  VariableSimulationConfig,
  FixedValueParams,
  RangeValueParams,
  EnumValueParams,
  BoolParams,
  StringParams,
  FaultInjectionParams,
} from './simulation-config.types';

/**
 * Simulator factory - manages all simulator instances, supports get/create/update/delete by tagId.
 * Prefers the simulation config from tagConfig; when absent, infers a default strategy from dataType.
 */
@Injectable()
export class SimulatorFactory {
  private simulators = new Map<string, CachedSimulator>();

  /**
   * Get or create a variable simulator.
   */
  getOrCreate(tagId: string, tagConfig: Record<string, any> | undefined): VariableSimulator {
    const existing = this.simulators.get(tagId);
    if (existing) return existing;

    const simConfig = this.extractSimConfig(tagConfig);
    const inner = this.createFromConfig(simConfig);
    const cached = new CachedSimulator(inner, simConfig.updateIntervalSec);
    this.simulators.set(tagId, cached);
    return cached;
  }

  /** Get an existing simulator */
  get(tagId: string): VariableSimulator | undefined {
    return this.simulators.get(tagId);
  }

  /** Update simulator config */
  update(tagId: string, config: VariableSimulationConfig): void {
    const simulator = this.simulators.get(tagId);
    if (simulator) {
      simulator.updateConfig(config);
    }
  }

  /** Remove the simulator for the specified tag */
  remove(tagId: string): void {
    this.simulators.delete(tagId);
  }

  /** Clear all simulators */
  clear(): void {
    this.simulators.clear();
  }

  /** Get the count of all simulators */
  get size(): number {
    return this.simulators.size;
  }

  /** Extract simulation config from tagConfig; infer a default strategy from dataType when absent */
  private extractSimConfig(tagConfig: Record<string, any> | undefined): VariableSimulationConfig {
    if (tagConfig?.simulation?.enabled) {
      return tagConfig.simulation as VariableSimulationConfig;
    }
    return this.getDefaultSimulation(tagConfig?.dataType || 'float32');
  }

  /** Create a simulator from config */
  private createFromConfig(config: VariableSimulationConfig): VariableSimulator {
    switch (config.mode) {
      case 'fixed':
        return new FixedValueSimulator(config.params as FixedValueParams, config);
      case 'range':
        return new RangeValueSimulator(config.params as RangeValueParams, config);
      case 'enum':
        return new EnumValueSimulator(config.params as EnumValueParams, config);
      case 'bool':
        return new BoolSimulator(config.params as BoolParams, config);
      case 'string':
        return new StringSimulator(config.params as StringParams, config);
      case 'fault_injection':
        return new FaultInjectionSimulator(config.params as FaultInjectionParams, config);
      default:
        throw new Error(`不支持的仿真模式: ${(config as any).mode}`);
    }
  }

  /** When simulation is not configured, auto-infer the default strategy from data type (also handles the point-table spec string 'boolean') */
  private getDefaultSimulation(dataType: string): VariableSimulationConfig {
    if (isBooleanDataType(dataType)) {
      return {
        enabled: true,
        mode: 'bool',
        updateIntervalSec: 2,
        params: { switchMode: 'random', trueProbability: 0.5 } as BoolParams,
      };
    }
    switch (dataType) {
      case 'string':
        return {
          enabled: true,
          mode: 'string',
          updateIntervalSec: 10,
          params: { values: ['OK', 'WARN', 'ERR'], switchMode: 'sequential' } as StringParams,
        };
      default:
        // Numeric types default to: range random walk
        return {
          enabled: true,
          mode: 'range',
          updateIntervalSec: 1,
          params: { min: 0, max: 100, pattern: 'random_walk', step: 1 } as RangeValueParams,
        };
    }
  }
}
