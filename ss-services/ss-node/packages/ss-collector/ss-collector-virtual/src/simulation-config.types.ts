// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/** Simulation mode */
export type SimulationMode = 'fixed' | 'range' | 'enum' | 'bool' | 'string' | 'fault_injection';

/** Variable-level simulation config */
export interface VariableSimulationConfig {
  /** Whether simulation is enabled, default false */
  enabled: boolean;
  /** Simulation mode */
  mode: SimulationMode;
  /** Update interval (seconds), default 1.0 */
  updateIntervalSec: number;
  /** Mode parameters */
  params:
    | FixedValueParams
    | RangeValueParams
    | EnumValueParams
    | BoolParams
    | StringParams
    | FaultInjectionParams;
}

// ============== Mode parameter definitions ==============

/** Fixed-value parameters */
export interface FixedValueParams {
  /** The fixed output value */
  value: number;
}

/** Range variable-value parameters */
export interface RangeValueParams {
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Change mode */
  pattern: 'random_walk' | 'sine' | 'sawtooth' | 'ramp' | 'random';
  /** Change step (effective for random_walk/ramp) */
  step?: number;
  /** Sine period (seconds), only effective for sine, default 60 */
  period?: number;
  /** Random noise ratio (0-1), only effective for sine/ramp, default 0 */
  noiseLevel?: number;
}

/** Enum-value parameters */
export interface EnumValueParams {
  /** Enum value list */
  values: number[];
  /** Switch mode */
  switchMode: 'sequential' | 'random';
  /** Step count per switch in sequential mode (default 1) */
  stepSize?: number;
}

/** Boolean-value parameters */
export interface BoolParams {
  /** Switch mode */
  switchMode: 'toggle' | 'random' | 'fixed';
  /** Fixed value (fixed mode only), default false */
  fixedValue?: boolean;
  /** Toggle interval (seconds), toggle mode only, default 5 */
  toggleIntervalSec?: number;
  /** Probability of being true (0-1), random mode only, default 0.5 */
  trueProbability?: number;
}

/** String parameters */
export interface StringParams {
  /** String list */
  values: string[];
  /** Switch mode */
  switchMode: 'sequential' | 'random' | 'fixed';
  /** Switch interval (seconds), sequential/random mode only, default 10 */
  switchIntervalSec?: number;
}

/** Fault-injection parameters */
export interface FaultInjectionParams {
  /** Fault scenario */
  scenario: 'error' | 'timeout' | 'slow_rise' | 'spike';
  /** Error probability (0-1), error scenario only */
  errorRate?: number;
  /** Timeout probability (0-1), timeout scenario only */
  timeoutRate?: number;
  /** Rise rate (per second), slow_rise scenario only */
  riseRatePerSec?: number;
  /** Noise level (0-1), slow_rise scenario only */
  noiseLevel?: number;
  /** Spike probability (0-1), spike scenario only */
  spikeRate?: number;
  /** Spike amplitude, spike scenario only */
  spikeMagnitude?: number;
  /** Initial value */
  initialValue?: number;
}
